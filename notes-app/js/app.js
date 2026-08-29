/* ============================================================
   app.js — state, rendering and everything the user touches
   ============================================================ */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = Editor.esc;

/* ── state ─────────────────────────────────────────────── */
const st = {
  notes: [], notebooks: [],
  scope: { type:'all', id:null },
  query: '',
  noteId: null,
  dirty: false,
  saveTimer: 0,
  fileUrls: new Map(),      // attachment id -> object URL
  reminderTimers: new Map(),
  deferredInstall: null,
};

const ACCENTS = ['#12a89d','#4aa3ff','#8b5cf6','#f4677d','#f0b429','#22c55e','#ff7a45','#64748b'];
const NB_COLORS = ['#12a89d','#4aa3ff','#8b5cf6','#f4677d','#f0b429','#22c55e','#ff7a45','#94a3b8'];
const NB_EMOJI = ['📓','📗','📘','📙','🗂️','💼','🏠','🎓','💡','🎯','🧾','🍳','✈️','🎵','💪','❤️','🔒','⭐'];

const TEMPLATES = [
  { emoji:'📝', name:'Blank', desc:'An empty note', title:'', html:'<p><br></p>' },
  { emoji:'✅', name:'To-do list', desc:'A checklist to work through', title:'To-do',
    html:'<ul class="task"><li data-done="0">First thing</li><li data-done="0">Second thing</li><li data-done="0">Third thing</li></ul>' },
  { emoji:'🗓️', name:'Meeting notes', desc:'Attendees, notes, actions', title:'Meeting — ',
    html:'<h2>Attendees</h2><p><br></p><h2>Notes</h2><p><br></p><h2>Actions</h2><ul class="task"><li data-done="0">…</li></ul>' },
  { emoji:'📔', name:'Daily journal', desc:'How the day went', title:'',
    html:'<h2>Today</h2><p><br></p><h2>Went well</h2><p><br></p><h2>For tomorrow</h2><ul class="task"><li data-done="0">…</li></ul>' },
  { emoji:'💡', name:'Idea', desc:'Capture and shape a thought', title:'Idea — ',
    html:'<h2>The idea</h2><p><br></p><h2>Why it could work</h2><p><br></p><h2>Next step</h2><p><br></p>' },
  { emoji:'🛒', name:'Shopping list', desc:'Tick things off as you go', title:'Shopping',
    html:'<ul class="task"><li data-done="0">…</li></ul>' },
];

/* ── boot ──────────────────────────────────────────────── */
async function boot(){
  applySettings();
  await DB.open();
  st.notes = await DB.all('notes');
  st.notebooks = await DB.all('notebooks');

  if (!st.notebooks.length){
    const nb = mkNotebook('My Notebook', '#12a89d', '📓');
    st.notebooks.push(nb); await DB.put('notebooks', nb);
    DB.S.set('defaultNotebook', nb.id);
  }
  await purgeTrash();

  Editor.init($('#edBody'), onEditorChange);
  Editor.buildToolbar($('#toolbar'), toolbarAction);
  wire();
  renderAll();
  scheduleAllReminders();
  registerSW();

  const last = localStorage.getItem('mynotes.lastNote');
  if (last && st.notes.some(n => n.id === last && !n.trashed) && innerWidth > 1080) openNote(last);
}

/* ── settings + theme ──────────────────────────────────── */
function applySettings(){
  const s = DB.S.all();
  const theme = s.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : s.theme;
  document.documentElement.dataset.theme = theme;

  const root = document.documentElement.style;
  root.setProperty('--accent', s.accent);
  root.setProperty('--accent-soft', hexA(s.accent, .16));
  root.setProperty('--accent-ink', readable(s.accent));
  root.setProperty('--font-note', Editor.FONT_CSS[s.fontNote] || Editor.FONT_CSS.system);
  root.setProperty('--font-ui', Editor.FONT_CSS[s.fontUi] || Editor.FONT_CSS.system);
  root.setProperty('--note-size', s.noteSize + 'px');
  root.setProperty('--note-lh', s.lineHeight);

  const meta = $('meta[name=theme-color]');
  if (meta) meta.content = theme === 'light' ? '#ffffff' : '#0f1115';
  const bodyEl = $('#edBody');
  if (bodyEl) bodyEl.spellcheck = !!s.spellcheck;
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (DB.S.get('theme') === 'auto') applySettings();
});

const hexA = (hex, a) => {
  const h = hex.replace('#',''); const n = parseInt(h.length === 3 ? h.replace(/(.)/g,'$1$1') : h, 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
};
const readable = hex => {
  const h = hex.replace('#',''); const n = parseInt(h.length === 3 ? h.replace(/(.)/g,'$1$1') : h, 16);
  const l = (0.299*((n>>16)&255) + 0.587*((n>>8)&255) + 0.114*(n&255)) / 255;
  return l > 0.62 ? '#10151c' : '#ffffff';
};

/* ── models ────────────────────────────────────────────── */
function mkNotebook(name, color, emoji){
  return { id:DB.uid(), name, color, emoji, parentId:null, created:Date.now(), updated:Date.now() };
}
function mkNote(over = {}){
  const now = Date.now();
  return {
    id:DB.uid(), title:'', html:'<p><br></p>', plain:'',
    notebookId: st.scope.type === 'notebook' ? st.scope.id : DB.S.get('defaultNotebook'),
    tags: st.scope.type === 'tag' ? [st.scope.id] : [],
    pinned:false, reminder:null, trashed:false, trashedAt:null,
    created:now, updated:now, history:[], ...over,
  };
}

/* ── rendering ─────────────────────────────────────────── */
function renderAll(){ renderSidebar(); renderList(); }

function renderSidebar(){
  const live = st.notes.filter(n => !n.trashed);
  const counts = {
    all: live.length,
    pinned: live.filter(n => n.pinned).length,
    reminders: live.filter(n => n.reminder).length,
    trash: st.notes.filter(n => n.trashed).length,
  };
  const smart = [
    ['all','All notes','book',counts.all],
    ['pinned','Pinned','pin',counts.pinned],
    ['reminders','Reminders','clock',counts.reminders],
    ['trash','Trash','trash',counts.trash],
  ];
  $('#smartList').innerHTML = smart.map(([type,label,icon,c]) => `
    <li class="side-item ${st.scope.type===type?'active':''}" data-scope="${type}">
      ${svg(icon)}<span class="label">${label}</span><span class="count">${c||''}</span>
    </li>`).join('');

  $('#notebookList').innerHTML = st.notebooks.map(nb => {
    const c = live.filter(n => n.notebookId === nb.id).length;
    const on = st.scope.type === 'notebook' && st.scope.id === nb.id;
    return `<li class="side-item ${on?'active':''}" data-scope="notebook" data-id="${nb.id}">
      <span class="nb-emoji">${nb.emoji || '📓'}</span>
      <span class="label">${esc(nb.name)}</span>
      <span class="count">${c||''}</span>
      <button class="icon-btn sm" data-nb-menu="${nb.id}" title="Notebook options">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
      </button>
    </li>`;
  }).join('') || `<li class="side-item" style="color:var(--ink-3);cursor:default">No notebooks yet</li>`;

  const tags = new Map();
  live.forEach(n => (n.tags || []).forEach(t => tags.set(t, (tags.get(t) || 0) + 1)));
  const sorted = [...tags.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  $('#tagList').innerHTML = sorted.length
    ? sorted.map(([t,c]) => {
        const on = st.scope.type === 'tag' && st.scope.id === t;
        return `<li class="side-item ${on?'active':''}" data-scope="tag" data-id="${esc(t)}">
          ${svg('tag')}<span class="label">${esc(t)}</span><span class="count">${c}</span></li>`;
      }).join('')
    : `<li class="side-item" style="color:var(--ink-3);cursor:default">No tags yet</li>`;
}

function scopedNotes(){
  const s = st.scope;
  let list = st.notes.filter(n => s.type === 'trash' ? n.trashed : !n.trashed);
  if (s.type === 'notebook') list = list.filter(n => n.notebookId === s.id);
  if (s.type === 'tag')      list = list.filter(n => (n.tags||[]).includes(s.id));
  if (s.type === 'pinned')   list = list.filter(n => n.pinned);
  if (s.type === 'reminders')list = list.filter(n => n.reminder);

  const q = st.query.trim().toLowerCase();
  if (q){
    const words = q.split(/\s+/);
    list = list.filter(n => {
      const hay = ((n.title||'') + ' ' + (n.plain||'') + ' ' + (n.tags||[]).join(' ')).toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }

  const [key, dir] = (DB.S.get('sort') || 'updated-desc').split('-');
  const mul = dir === 'asc' ? 1 : -1;
  list.sort((a,b) => {
    if (a.pinned !== b.pinned && st.scope.type !== 'trash') return a.pinned ? -1 : 1;
    if (key === 'title') return mul * (a.title||'Untitled').localeCompare(b.title||'Untitled');
    return mul * ((a[key] || 0) - (b[key] || 0));
  });
  return list;
}

function renderList(){
  const list = scopedNotes();
  const wrap = $('#notes');
  wrap.classList.toggle('grid', DB.S.get('view') === 'grid');
  $('#viewBtn').innerHTML = DB.S.get('view') === 'grid'
    ? `<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`
    : `<svg viewBox="0 0 24 24"><path d="M3 5h18M3 12h18M3 19h18"/></svg>`;

  const scopeLabel = {
    all:'All notes', pinned:'Pinned', reminders:'With reminders', trash:'Trash',
    notebook:(st.notebooks.find(n => n.id === st.scope.id) || {}).name || 'Notebook',
    tag:'#' + st.scope.id,
  }[st.scope.type];
  $('#listScope').innerHTML =
    `<b style="color:var(--ink-2)">${esc(scopeLabel)}</b><span>${list.length} note${list.length===1?'':'s'}</span>` +
    (st.scope.type === 'trash' && list.length
      ? `<button class="btn ghost" style="padding:3px 10px;font-size:12px;margin-left:auto" data-act="empty-trash">Empty trash</button>` : '');

  if (!list.length){
    wrap.innerHTML = '';
    $('#listEmpty').classList.remove('hidden');
    $('#listEmpty').innerHTML = st.query
      ? `No notes match “${esc(st.query)}”.`
      : st.scope.type === 'trash' ? 'Trash is empty.' : 'No notes here yet. Tap + to start one.';
    return;
  }
  $('#listEmpty').classList.add('hidden');

  const grouped = DB.S.get('groupByDate') && !st.query &&
                  /^(updated|created)-desc$/.test(DB.S.get('sort'));
  let html = '', lastGroup = '';
  for (const n of list){
    if (grouped){
      const g = n.pinned && st.scope.type !== 'trash' ? 'Pinned' : dateGroup(n[DB.S.get('sort').split('-')[0]]);
      if (g !== lastGroup){ html += `<div class="group-label">${g}</div>`; lastGroup = g; }
    }
    html += card(n);
  }
  wrap.innerHTML = html;
}

function card(n){
  const nb = st.notebooks.find(b => b.id === n.notebookId);
  const snippet = (n.plain || '').slice(0, 200);
  const due = n.reminder ? fmtWhen(n.reminder) : '';
  return `<article class="note-card ${n.id===st.noteId?'sel':''}" data-note="${n.id}">
    <div class="nc-top">
      ${nb ? `<span class="nb-strip" style="background:${esc(nb.color)}"></span>` : ''}
      <h3>${esc(n.title || 'Untitled')}</h3>
      ${n.pinned ? `<span class="pin">${svg('pin')}</span>` : ''}
    </div>
    <p class="snip">${esc(snippet) || '<span style="opacity:.6">Empty note</span>'}</p>
    <div class="nc-foot">
      <span>${fmtWhen(n.updated)}</span>
      ${n.reminder ? `<span class="bell">${svg('clock')} ${esc(due)}</span>` : ''}
      ${(n.tags||[]).slice(0,3).map(t => `<span class="chip">#${esc(t)}</span>`).join('')}
    </div>
  </article>`;
}

/* ── note open / save ──────────────────────────────────── */
async function openNote(id){
  const n = st.notes.find(x => x.id === id);
  if (!n) return;
  await flushSave();
  st.noteId = id;
  localStorage.setItem('mynotes.lastNote', id);

  $('#edEmpty').classList.add('hidden');
  $('#edWrap').classList.remove('hidden');
  $('#app').dataset.pane = 'editor';

  $('#edTitle').value = n.title || '';
  $('#edBody').innerHTML = hydrate(n.html || '<p><br></p>');
  $('#pinBtn').classList.toggle('on', !!n.pinned);
  renderNoteChrome(n);
  renderList();
  syncToolbar();
  if (innerWidth <= 720) $('#app').classList.remove('side-open');
}

function renderNoteChrome(n){
  const nb = st.notebooks.find(b => b.id === n.notebookId);
  $('#crumb').innerHTML =
    `${nb ? `<b>${nb.emoji||''} ${esc(nb.name)}</b> › ` : ''}${esc(n.title || 'Untitled')}` +
    (n.trashed ? ' <span style="color:var(--danger)">· in trash</span>' : '');

  const bits = [`Edited ${fmtWhen(n.updated)}`, `Created ${fmtWhen(n.created)}`,
                `${words(n.plain)} words`];
  if (n.reminder) bits.push(`⏰ ${fmtWhen(n.reminder)}`);
  $('#edMeta').textContent = bits.join(' · ');

  $('#edTags').innerHTML =
    (n.tags||[]).map(t => `<span class="tag-chip">#${esc(t)}<button data-untag="${esc(t)}" title="Remove">×</button></span>`).join('') +
    `<button class="tag-add" data-act="add-tag">+ tag</button>`;
}

function onEditorChange(){
  st.dirty = true;
  clearTimeout(st.saveTimer);
  st.saveTimer = setTimeout(saveNote, 550);
}

async function saveNote(){
  if (!st.noteId || !st.dirty) return;
  const n = st.notes.find(x => x.id === st.noteId);
  if (!n) return;

  const bodyEl = $('#edBody');
  const html = serialize(bodyEl);
  const plain = bodyEl.innerText.replace(/\n{3,}/g, '\n\n').trim();
  let title = $('#edTitle').value.trim();
  if (!title && DB.S.get('autoTitle')) title = (plain.split('\n')[0] || '').slice(0, 80).trim();

  const changed = html !== n.html || title !== n.title;
  if (changed){
    const lastSnap = n.history && n.history[n.history.length - 1];
    if (!lastSnap || Date.now() - lastSnap.ts > 3 * 60 * 1000){
      n.history = [...(n.history || []), { ts:n.updated, title:n.title, html:n.html }].slice(-20);
    }
    n.html = html; n.plain = plain; n.title = title; n.updated = Date.now();
    await DB.put('notes', n);
  }
  st.dirty = false;
  flash();
  renderNoteChrome(n);
  renderList();
}
const flushSave = async () => { clearTimeout(st.saveTimer); await saveNote(); };

function flash(){
  const f = $('#savedFlag');
  f.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => f.classList.remove('show'), 1100);
}

/* attachment images live in IndexedDB; the note HTML stores file:<id> */
function serialize(el){
  const c = el.cloneNode(true);
  c.querySelectorAll('img[data-file]').forEach(img => img.setAttribute('src', 'file:' + img.dataset.file));
  return c.innerHTML;
}
function hydrate(html){
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('img[src^="file:"]').forEach(img => {
    const id = img.getAttribute('src').slice(5);
    img.dataset.file = id;
    const url = st.fileUrls.get(id);
    if (url) img.src = url;
    else { img.removeAttribute('src'); loadFileUrl(id).then(u => { if (u) img.src = u; }); }
  });
  return d.innerHTML;
}
async function loadFileUrl(id){
  if (st.fileUrls.has(id)) return st.fileUrls.get(id);
  const f = await DB.get('files', id);
  if (!f) return null;
  const url = URL.createObjectURL(f.blob);
  st.fileUrls.set(id, url);
  $$('#edBody img[data-file="' + id + '"]').forEach(i => i.src = url);
  return url;
}

/* ── note actions ──────────────────────────────────────── */
async function newNote(tpl){
  const n = mkNote(tpl ? { title:tpl.title, html:tpl.html, plain: htmlToText(tpl.html) } : {});
  st.notes.push(n);
  await DB.put('notes', n);
  if (st.scope.type === 'trash') setScope('all');
  renderAll();
  await openNote(n.id);
  ($('#edTitle')).focus();
}

async function trashNote(id){
  const n = st.notes.find(x => x.id === id); if (!n) return;
  if (DB.S.get('confirmDelete') && !await confirmSheet('Move to trash?',
      `“${n.title || 'Untitled'}” goes to the trash. You can restore it for ${DB.S.get('trashDays')} days.`,
      'Move to trash')) return;
  n.trashed = true; n.trashedAt = Date.now(); n.updated = Date.now();
  await DB.put('notes', n);
  unschedule(n.id);
  if (st.noteId === id) closeNote();
  renderAll();
  toast('Moved to trash');
}
async function restoreNote(id){
  const n = st.notes.find(x => x.id === id); if (!n) return;
  n.trashed = false; n.trashedAt = null; n.updated = Date.now();
  await DB.put('notes', n); renderAll(); scheduleReminder(n);
  toast('Restored');
}
async function deleteForever(id){
  const n = st.notes.find(x => x.id === id); if (!n) return;
  if (!await confirmSheet('Delete permanently?', 'This cannot be undone.', 'Delete', true)) return;
  st.notes = st.notes.filter(x => x.id !== id);
  await DB.del('notes', id);
  if (st.noteId === id) closeNote();
  renderAll(); toast('Deleted');
}
async function duplicateNote(id){
  const n = st.notes.find(x => x.id === id); if (!n) return;
  const copy = mkNote({ ...n, id:DB.uid(), title:(n.title||'Untitled') + ' (copy)',
    created:Date.now(), updated:Date.now(), history:[], pinned:false });
  st.notes.push(copy); await DB.put('notes', copy);
  renderAll(); openNote(copy.id); toast('Duplicated');
}
function closeNote(){
  st.noteId = null;
  $('#edWrap').classList.add('hidden');
  $('#edEmpty').classList.remove('hidden');
  $('#app').dataset.pane = 'list';
  localStorage.removeItem('mynotes.lastNote');
}
const curNote = () => st.notes.find(n => n.id === st.noteId);

/* ── toolbar dispatch ──────────────────────────────────── */
function toolbarAction(id, node){
  const simple = { undo:'undo', redo:'redo', bold:'bold', italic:'italic',
                   underline:'underline', strike:'strikeThrough',
                   ul:'insertUnorderedList', ol:'insertOrderedList',
                   alignL:'justifyLeft', alignC:'justifyCenter', alignR:'justifyRight' };
  if (simple[id]) return Editor.cmd(simple[id]);

  switch (id){
    case 'block':  return Editor.block(node.value === 'p' ? 'p' : node.value);
    case 'font':   return needSel() && Editor.setFont(node.value);
    case 'size':   return needSel() && Editor.setSize(node.value);
    case 'color':  return colorSheet('Text colour', Editor.TEXT_COLORS, v => Editor.applyInline('color', v));
    case 'highlight': return colorSheet('Highlight', Editor.HL_COLORS, v => Editor.applyInline('backgroundColor', v));
    case 'task':   return Editor.checklist();
    case 'quote':  return Editor.block('blockquote');
    case 'code':   return Editor.codeBlock();
    case 'table':  return tableSheet();
    case 'hr':     return Editor.divider();
    case 'link':   return linkSheet();
    case 'image':  return pickFiles('image/*', true);
    case 'file':   return pickFiles('', false);
    case 'draw':   return drawSheet();
    case 'mic':    return micToggle(node);
    case 'speak':  return speakToggle(node);
    case 'clearfmt': return Editor.clearFormat();
  }
}
/* keep the toolbar showing what the caret is actually sitting in */
let syncPending = false;
function syncToolbar(){
  if (syncPending) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    const bodyEl = $('#edBody');
    const sel = getSelection();
    if (!sel || !sel.anchorNode || !bodyEl.contains(sel.anchorNode)){
      const bs = $('[data-tb="block"]'); if (bs) bs.value = 'p';
      const fs = $('[data-tb="font"]');  if (fs) fs.value = DB.S.get('fontNote');
      const zs = $('[data-tb="size"]');
      if (zs){
        const px = +DB.S.get('noteSize') || 16;
        zs.value = String(Editor.SIZES.reduce((a, b) => Math.abs(b - px) < Math.abs(a - px) ? b : a));
      }
      $$('#toolbar .tb-btn.on').forEach(b => b.classList.remove('on'));
      return;
    }

    const state = { bold:'bold', italic:'italic', underline:'underline', strike:'strikeThrough' };
    for (const [id, c] of Object.entries(state)){
      const b = $(`[data-tb="${id}"]`);
      if (b) try { b.classList.toggle('on', document.queryCommandState(c)); } catch(_){}
    }
    let node = sel.anchorNode;
    if (node.nodeType === 3) node = node.parentElement;
    if (!node) return;

    const li = node.closest('li');
    const inTask = !!(li && li.parentElement.classList.contains('task'));
    const setOn = (id, v) => { const b = $(`[data-tb="${id}"]`); if (b) b.classList.toggle('on', v); };
    setOn('task', inTask);
    setOn('ul', !!node.closest('ul') && !inTask);
    setOn('ol', !!node.closest('ol'));

    const blockEl = node.closest('h1,h2,h3,blockquote,pre,div,p');
    const tag = blockEl ? blockEl.tagName.toLowerCase() : 'p';
    const blockSel = $('[data-tb="block"]');
    if (blockSel) blockSel.value = ['h1','h2','h3'].includes(tag) ? tag : 'p';

    const cs = getComputedStyle(node);
    const sizeSel = $('[data-tb="size"]');
    if (sizeSel){
      const px = Math.round(parseFloat(cs.fontSize) || 16);
      const near = Editor.SIZES.reduce((a, b) => Math.abs(b - px) < Math.abs(a - px) ? b : a);
      sizeSel.value = String(near);
    }
    const fontSel = $('[data-tb="font"]');
    if (fontSel){
      const fam = (cs.fontFamily || '').toLowerCase();
      const hit = Editor.FONTS.find(f => f[0] !== 'system' &&
        fam.includes(Editor.FONT_CSS[f[0]].split(',')[0].replace(/["']/g, '').toLowerCase()));
      fontSel.value = hit ? hit[0] : DB.S.get('fontNote');
    }
  });
}

function needSel(){
  const s = getSelection();
  if (!s || s.isCollapsed || !$('#edBody').contains(s.anchorNode)){
    toast('Select some text first', 'err'); return false;
  }
  return true;
}
function micToggle(btn){
  const r = Editor.dictate(on => btn.classList.toggle('on', on));
  if (!r.ok) toast(r.msg, 'err');
  else if (btn.classList.contains('on')) toast('Listening… tap the mic again to stop');
}
function speakToggle(btn){
  const n = curNote(); if (!n) return;
  const text = ($('#edTitle').value + '. ' + $('#edBody').innerText).trim();
  if (!text) return toast('Nothing to read', 'err');
  const r = Editor.readAloud(text, on => btn.classList.toggle('on', on));
  if (!r.ok) toast(r.msg, 'err');
}

/* ── attachments + drawing ─────────────────────────────── */
function pickFiles(accept, asImage){
  const inp = $('#filePicker');
  inp.accept = accept; inp.value = '';
  inp.onchange = async () => {
    for (const f of inp.files) await addFile(f, asImage || f.type.startsWith('image/'));
    inp.value = '';
  };
  inp.click();
}

async function addFile(file, asImage){
  const MAX = 12 * 1024 * 1024;
  if (file.size > MAX) return toast(`“${file.name}” is over 12 MB — too big to store`, 'err');
  const id = DB.uid();
  await DB.put('files', { id, name:file.name, type:file.type, size:file.size, blob:file });
  const url = URL.createObjectURL(file);
  st.fileUrls.set(id, url);
  if (asImage) Editor.insertHTML(`<img data-file="${id}" src="${url}" alt="${esc(file.name)}">`);
  else Editor.attachment(id, file.name, file.size, file.type);
  onEditorChange();
}

function drawSheet(){
  const s = openSheet({ title:'Sketch', wide:true, body:`
    <div class="draw-wrap"><canvas id="drawCanvas"></canvas></div>
    <div class="draw-tools">
      <div class="swatches" id="penColors">${
        ['#111827','#12a89d','#4aa3ff','#f4677d','#f0b429','#8b5cf6','#22c55e','#ffffff']
          .map((c,i) => `<span class="swatch ${i===0?'on':''}" data-pen="${c}" style="background:${c};border:1px solid #ccc"></span>`).join('')}</div>
      <label style="font-size:12px;color:var(--ink-2)">Size <input type="range" id="penSize" min="1" max="30" value="4"></label>
      <button class="btn ghost" id="penErase">Eraser</button>
      <button class="btn ghost" id="penClear">Clear</button>
    </div>`,
    foot:`<button class="btn ghost" data-close>Cancel</button>
          <button class="btn primary" id="drawInsert">Insert into note</button>` });

  const cv = $('#drawCanvas', s.el), ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  requestAnimationFrame(() => {
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
    ctx.lineCap = ctx.lineJoin = 'round';
  });

  let drawing = false, pen = '#111827', size = 4, erasing = false, lx = 0, ly = 0;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); drawing = true; [lx, ly] = pos(e);
    ctx.beginPath(); ctx.arc(lx, ly, size/2, 0, 7);
    ctx.fillStyle = erasing ? '#fff' : pen; ctx.fill();
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.strokeStyle = erasing ? '#fff' : pen;
    ctx.lineWidth = erasing ? size * 2.4 : size;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
    [lx, ly] = [x, y];
  });
  ['pointerup','pointercancel','pointerleave'].forEach(ev =>
    cv.addEventListener(ev, () => drawing = false));

  $('#penColors', s.el).addEventListener('click', e => {
    const sw = e.target.closest('[data-pen]'); if (!sw) return;
    $$('#penColors .swatch', s.el).forEach(x => x.classList.remove('on'));
    sw.classList.add('on'); pen = sw.dataset.pen; erasing = false;
    $('#penErase', s.el).classList.remove('primary');
  });
  $('#penSize', s.el).oninput = e => size = +e.target.value;
  $('#penErase', s.el).onclick = e => { erasing = !erasing; e.target.classList.toggle('primary', erasing); };
  $('#penClear', s.el).onclick = () => {
    const r = cv.getBoundingClientRect();
    ctx.save(); ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height); ctx.restore();
  };
  $('#drawInsert', s.el).onclick = () => cv.toBlob(async blob => {
    if (!blob) return;
    const file = new File([blob], `sketch-${Date.now()}.png`, { type:'image/png' });
    s.close(); await addFile(file, true); toast('Sketch added');
  }, 'image/png');
}

/* ── small sheets ──────────────────────────────────────── */
function colorSheet(title, colors, apply){
  const s = openSheet({ title, body:`<div class="swatches">${
    colors.map(c => `<span class="swatch" data-c="${c}" title="${c}" style="background:${
      c === 'transparent' ? 'repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 50%/12px 12px' : c
    };border:1px solid var(--line)"></span>`).join('')}</div>
    <p class="hint">${title === 'Highlight' ? 'The last swatch removes the highlight.' : 'Select text in the note first, then pick a colour.'}</p>` });
  s.el.addEventListener('click', e => {
    const sw = e.target.closest('[data-c]'); if (!sw) return;
    s.close(); apply(sw.dataset.c);
  });
}

function tableSheet(){
  const s = openSheet({ title:'Insert table', body:`
    <div style="display:flex;gap:12px">
      <div class="field" style="flex:1"><label>Rows</label><input type="number" id="tRows" value="3" min="1" max="30"></div>
      <div class="field" style="flex:1"><label>Columns</label><input type="number" id="tCols" value="3" min="1" max="10"></div>
    </div><p class="hint">The first row becomes a header. Tap any cell to type.</p>`,
    foot:`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="tGo">Insert</button>` });
  $('#tGo', s.el).onclick = () => {
    const r = Math.max(1, Math.min(30, +$('#tRows', s.el).value || 3));
    const c = Math.max(1, Math.min(10, +$('#tCols', s.el).value || 3));
    s.close(); Editor.table(r, c);
  };
}

function linkSheet(){
  const sel = getSelection();
  const selected = sel && !sel.isCollapsed ? sel.toString() : '';
  const others = st.notes.filter(n => !n.trashed && n.id !== st.noteId).slice(0, 60);
  const s = openSheet({ title:'Add a link', body:`
    <div class="field"><label>Web address</label>
      <input type="text" id="lkUrl" placeholder="example.com" autocomplete="off"></div>
    <div class="field"><label>Text to show</label>
      <input type="text" id="lkText" value="${esc(selected)}" placeholder="${esc(selected || 'Link text')}"></div>
    ${others.length ? `<div class="field"><label>…or link to another note</label>
      <select id="lkNote"><option value="">Choose a note…</option>
        ${others.map(n => `<option value="${n.id}">${esc(n.title || 'Untitled')}</option>`).join('')}
      </select></div>` : ''}`,
    foot:`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="lkGo">Add link</button>` });

  $('#lkGo', s.el).onclick = () => {
    const noteSel = $('#lkNote', s.el);
    if (noteSel && noteSel.value){
      const target = st.notes.find(n => n.id === noteSel.value);
      s.close();
      Editor.link('note:' + noteSel.value, $('#lkText', s.el).value || target.title || 'Untitled');
      return;
    }
    const url = $('#lkUrl', s.el).value.trim();
    if (!url) return toast('Type an address first', 'err');
    s.close(); Editor.link(url, $('#lkText', s.el).value.trim());
  };
}

/* ── note menu ─────────────────────────────────────────── */
function noteMenu(){
  const n = curNote(); if (!n) return;
  const item = (icon, label, act, sub, cls='') =>
    `<button class="menu-item ${cls}" data-m="${act}">${svg(icon)}<span class="grow">${label}${
      sub ? `<span class="mi-sub">${esc(sub)}</span>` : ''}</span></button>`;

  const nb = st.notebooks.find(b => b.id === n.notebookId);
  const s = openSheet({ title: n.title || 'Untitled', body:`<div class="menu-list">
    ${n.trashed
      ? item('history','Restore from trash','restore') + item('trash','Delete permanently','purge',null,'danger')
      : [
        item('book','Move to notebook','move', nb ? nb.name : 'None'),
        item('tag','Tags','tags', (n.tags||[]).length ? n.tags.map(t=>'#'+t).join(' ') : 'None'),
        item('clock','Reminder','remind', n.reminder ? fmtWhen(n.reminder) : 'None'),
        item('pin', n.pinned ? 'Unpin' : 'Pin to top','pin'),
        item('copy','Duplicate','dup'),
        item('history','Version history','hist', `${(n.history||[]).length} saved version${(n.history||[]).length===1?'':'s'}`),
        item('down','Export this note','export1', 'Backup file or plain text'),
        item('trash','Move to trash','trash',null,'danger'),
      ].join('')}
  </div>` });

  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const act = b.dataset.m; s.close();
    if (act === 'move')    moveSheet(n);
    if (act === 'tags')    tagSheet(n);
    if (act === 'remind')  reminderSheet(n);
    if (act === 'pin')     togglePin();
    if (act === 'dup')     duplicateNote(n.id);
    if (act === 'hist')    historySheet(n);
    if (act === 'export1') exportOneSheet(n);
    if (act === 'trash')   trashNote(n.id);
    if (act === 'restore') restoreNote(n.id);
    if (act === 'purge')   deleteForever(n.id);
  });
}

async function togglePin(){
  const n = curNote(); if (!n) return;
  n.pinned = !n.pinned; n.updated = Date.now();
  await DB.put('notes', n);
  $('#pinBtn').classList.toggle('on', n.pinned);
  renderAll(); toast(n.pinned ? 'Pinned' : 'Unpinned');
}

function moveSheet(n){
  const s = openSheet({ title:'Move to notebook', body:`<div class="menu-list">
    ${st.notebooks.map(b => `<button class="menu-item ${b.id===n.notebookId?'checked':''}" data-nb="${b.id}">
      <span style="font-size:18px">${b.emoji||'📓'}</span><span class="grow">${esc(b.name)}</span>
      ${b.id===n.notebookId?svg('check'):''}</button>`).join('')}
    <button class="menu-item" data-nb="__new">${svg('plus')}<span class="grow">New notebook…</span></button>
  </div>` });
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-nb]'); if (!b) return;
    s.close();
    if (b.dataset.nb === '__new') return notebookSheet(null, id => assign(id));
    assign(b.dataset.nb);
    async function assign(id){
      n.notebookId = id; n.updated = Date.now();
      await DB.put('notes', n); renderAll(); renderNoteChrome(n); toast('Moved');
    }
  });
}

function tagSheet(n){
  const all = new Set();
  st.notes.forEach(x => (x.tags||[]).forEach(t => all.add(t)));
  const s = openSheet({ title:'Tags', body:`
    <div class="field"><label>Add a tag</label>
      <input type="text" id="tagIn" placeholder="work, ideas, recipes…" autocomplete="off"></div>
    <div class="ed-tags" id="tagCur">${(n.tags||[]).map(t =>
      `<span class="tag-chip">#${esc(t)}<button data-rm="${esc(t)}">×</button></span>`).join('') || '<span class="hint">No tags yet.</span>'}</div>
    ${all.size ? `<p class="hint" style="margin-top:14px">Existing tags — tap to add</p>
      <div class="ed-tags">${[...all].filter(t => !(n.tags||[]).includes(t))
        .map(t => `<button class="tag-add" data-add="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}`,
    foot:`<button class="btn primary" data-close>Done</button>` });

  const input = $('#tagIn', s.el);
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); add(input.value); input.value = ''; }
  });
  s.el.addEventListener('click', e => {
    const a = e.target.closest('[data-add]'); if (a) return add(a.dataset.add);
    const r = e.target.closest('[data-rm]');  if (r) return rm(r.dataset.rm);
  });
  async function add(raw){
    const t = String(raw).trim().replace(/^#/, '').slice(0, 30);
    if (!t || (n.tags||[]).includes(t)) return;
    n.tags = [...(n.tags||[]), t]; n.updated = Date.now();
    await DB.put('notes', n); refresh();
  }
  async function rm(t){
    n.tags = (n.tags||[]).filter(x => x !== t); n.updated = Date.now();
    await DB.put('notes', n); refresh();
  }
  function refresh(){
    $('#tagCur', s.el).innerHTML = (n.tags||[]).map(t =>
      `<span class="tag-chip">#${esc(t)}<button data-rm="${esc(t)}">×</button></span>`).join('')
      || '<span class="hint">No tags yet.</span>';
    renderAll(); renderNoteChrome(n);
  }
}

function historySheet(n){
  const hist = [...(n.history || [])].reverse();
  const s = openSheet({ title:'Version history', body: hist.length ? `<div class="menu-list">
      ${hist.map((h, i) => `<button class="menu-item" data-h="${hist.length-1-i}">
        ${svg('history')}<span class="grow">${esc(h.title || 'Untitled')}
        <span class="mi-sub">${fmtWhen(h.ts)} · ${words(htmlToText(h.html))} words</span></span></button>`).join('')}
    </div><p class="hint">Restoring keeps the current version in history too.</p>`
    : `<p class="hint">No earlier versions saved yet. A version is kept each time you edit after a few minutes' gap.</p>` });

  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    const h = n.history[+b.dataset.h]; s.close();
    if (!await confirmSheet('Restore this version?', fmtWhen(h.ts) + ' — the current text is kept in history.', 'Restore')) return;
    n.history = [...(n.history||[]), { ts:n.updated, title:n.title, html:n.html }].slice(-20);
    n.title = h.title; n.html = h.html; n.plain = htmlToText(h.html); n.updated = Date.now();
    await DB.put('notes', n);
    $('#edTitle').value = n.title || '';
    $('#edBody').innerHTML = hydrate(n.html);
    renderNoteChrome(n); renderList(); toast('Version restored');
  });
}

function exportOneSheet(n){
  const s = openSheet({ title:'Export this note', body:`<div class="menu-list">
    <button class="menu-item" data-x="json">${svg('down')}<span class="grow">Backup file<span class="mi-sub">Keeps all formatting — re-importable</span></span></button>
    <button class="menu-item" data-x="txt">${svg('text')}<span class="grow">Plain text<span class="mi-sub">Readable anywhere</span></span></button>
    <button class="menu-item" data-x="html">${svg('code')}<span class="grow">HTML file<span class="mi-sub">Opens in any browser</span></span></button>
    <button class="menu-item" data-x="copy">${svg('copy')}<span class="grow">Copy text to clipboard</span></button>
    <button class="menu-item" data-x="print">${svg('text')}<span class="grow">Print / save as PDF</span></button>
  </div>` });
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const k = b.dataset.x; s.close();
    const safe = (n.title || 'note').replace(/[^\w\- ]+/g, '').trim() || 'note';
    if (k === 'json'){ await Transfer.exportFile({ noteIds:[n.id] }); toast('Backup saved'); }
    if (k === 'txt')  Transfer.downloadBlob(new Blob([(n.title||'Untitled') + '\n\n' + n.plain], { type:'text/plain' }), safe + '.txt');
    if (k === 'html') Transfer.downloadBlob(new Blob([
      `<!doctype html><meta charset="utf-8"><title>${esc(n.title||'Untitled')}</title>` +
      `<body style="font-family:system-ui;max-width:44em;margin:40px auto;padding:0 20px;line-height:1.6">` +
      `<h1>${esc(n.title||'Untitled')}</h1>${n.html}`], { type:'text/html' }), safe + '.html');
    if (k === 'copy'){ await navigator.clipboard.writeText((n.title||'') + '\n\n' + n.plain); toast('Copied'); }
    if (k === 'print') print();
  });
}

/* ── notebooks ─────────────────────────────────────────── */
function notebookSheet(nb, after){
  const editing = !!nb;
  const cur = nb || { name:'', color:NB_COLORS[0], emoji:'📓' };
  const s = openSheet({ title: editing ? 'Edit notebook' : 'New notebook', body:`
    <div class="field"><label>Name</label>
      <input type="text" id="nbName" value="${esc(cur.name)}" placeholder="Work, Recipes, Ideas…"></div>
    <div class="field"><label>Colour</label>
      <div class="swatches" id="nbColors">${NB_COLORS.map(c =>
        `<span class="swatch ${c===cur.color?'on':''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>
    <div class="field"><label>Icon</label>
      <div class="emoji-grid" id="nbEmoji">${NB_EMOJI.map(e =>
        `<button class="${e===cur.emoji?'on':''}" data-e="${e}">${e}</button>`).join('')}</div></div>`,
    foot:`${editing ? `<button class="btn danger" id="nbDel" style="margin-right:auto">Delete</button>` : ''}
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn primary" id="nbSave">${editing ? 'Save' : 'Create'}</button>` });

  let color = cur.color, emoji = cur.emoji;
  $('#nbColors', s.el).onclick = e => {
    const x = e.target.closest('[data-c]'); if (!x) return;
    $$('#nbColors .swatch', s.el).forEach(y => y.classList.remove('on'));
    x.classList.add('on'); color = x.dataset.c;
  };
  $('#nbEmoji', s.el).onclick = e => {
    const x = e.target.closest('[data-e]'); if (!x) return;
    $$('#nbEmoji button', s.el).forEach(y => y.classList.remove('on'));
    x.classList.add('on'); emoji = x.dataset.e;
  };
  $('#nbSave', s.el).onclick = async () => {
    const name = $('#nbName', s.el).value.trim();
    if (!name) return toast('Give it a name', 'err');
    if (editing){ Object.assign(nb, { name, color, emoji, updated:Date.now() }); await DB.put('notebooks', nb); }
    else {
      const made = mkNotebook(name, color, emoji);
      st.notebooks.push(made); await DB.put('notebooks', made);
      after && after(made.id);
    }
    s.close(); renderAll();
    const n = curNote(); if (n) renderNoteChrome(n);
  };
  if (editing) $('#nbDel', s.el).onclick = async () => {
    const inside = st.notes.filter(n => n.notebookId === nb.id && !n.trashed).length;
    s.close();
    if (!await confirmSheet('Delete this notebook?',
      inside ? `${inside} note${inside===1?'':'s'} will move to the first notebook — nothing is deleted.`
             : 'The notebook is empty.', 'Delete notebook', true)) return;
    const fallback = st.notebooks.find(b => b.id !== nb.id);
    for (const n of st.notes.filter(n => n.notebookId === nb.id)){
      n.notebookId = fallback ? fallback.id : null; n.updated = Date.now();
      await DB.put('notes', n);
    }
    st.notebooks = st.notebooks.filter(b => b.id !== nb.id);
    await DB.del('notebooks', nb.id);
    if (st.scope.type === 'notebook' && st.scope.id === nb.id) setScope('all');
    if (DB.S.get('defaultNotebook') === nb.id) DB.S.set('defaultNotebook', fallback ? fallback.id : null);
    renderAll(); toast('Notebook deleted');
  };
}

/* ── reminders ─────────────────────────────────────────── */
function reminderSheet(n){
  const val = n.reminder ? new Date(n.reminder - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  const s = openSheet({ title:'Reminder', body:`
    <div class="field"><label>Remind me at</label>
      <input type="datetime-local" id="remAt" value="${val}"></div>
    <div class="seg" id="remQuick">
      <button data-q="60">In 1 hour</button><button data-q="180">In 3 hours</button>
      <button data-q="tomorrow">Tomorrow 9am</button><button data-q="week">Next week</button>
    </div>
    <p class="hint">Reminders show a phone notification while the app is installed. On iPhone this needs iOS 16.4 or newer, with the app added to your Home Screen.</p>`,
    foot:`${n.reminder ? `<button class="btn danger" id="remClear" style="margin-right:auto">Remove</button>` : ''}
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn primary" id="remSave">Set reminder</button>` });

  $('#remQuick', s.el).onclick = e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const d = new Date();
    if (b.dataset.q === 'tomorrow'){ d.setDate(d.getDate()+1); d.setHours(9,0,0,0); }
    else if (b.dataset.q === 'week'){ d.setDate(d.getDate()+7); d.setHours(9,0,0,0); }
    else d.setMinutes(d.getMinutes() + (+b.dataset.q));
    $('#remAt', s.el).value = new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  };
  $('#remSave', s.el).onclick = async () => {
    const v = $('#remAt', s.el).value;
    if (!v) return toast('Pick a time', 'err');
    const ts = new Date(v).getTime();
    if (ts < Date.now()) return toast('That time has already passed', 'err');
    if ('Notification' in window && Notification.permission === 'default')
      try { await Notification.requestPermission(); } catch(_){}
    n.reminder = ts; n.updated = Date.now();
    await DB.put('notes', n); s.close(); scheduleReminder(n);
    renderAll(); renderNoteChrome(n); toast('Reminder set for ' + fmtWhen(ts));
  };
  if (n.reminder) $('#remClear', s.el).onclick = async () => {
    n.reminder = null; n.updated = Date.now();
    await DB.put('notes', n); unschedule(n.id); s.close();
    renderAll(); renderNoteChrome(n); toast('Reminder removed');
  };
}

function scheduleAllReminders(){ st.notes.filter(n => n.reminder && !n.trashed).forEach(scheduleReminder); }
function unschedule(id){
  const t = st.reminderTimers.get(id);
  if (t){ clearTimeout(t); st.reminderTimers.delete(id); }
}
function scheduleReminder(n){
  unschedule(n.id);
  if (!n.reminder || n.trashed) return;
  const delay = n.reminder - Date.now();
  if (delay < -60000) return;                       // long past — leave it be
  if (delay > 24 * 3600 * 1000) return;             // re-checked next time the app opens
  st.reminderTimers.set(n.id, setTimeout(() => fireReminder(n.id), Math.max(0, delay)));
}
async function fireReminder(id){
  const n = st.notes.find(x => x.id === id);
  if (!n || n.trashed || !n.reminder) return;
  const title = n.title || 'Untitled note';
  const body = (n.plain || '').slice(0, 120) || 'Your reminder is due.';
  let shown = false;
  if ('Notification' in window && Notification.permission === 'granted'){
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.showNotification(title, { body, icon:'./icons/icon-192.png', tag:'note-'+id, data:{ id } }); shown = true; }
      else { new Notification(title, { body, icon:'./icons/icon-192.png' }); shown = true; }
    } catch(_){}
  }
  if (!shown) toast('⏰ ' + title);
  n.reminder = null; n.updated = Date.now();
  await DB.put('notes', n);
  renderAll();
  if (st.noteId === id) renderNoteChrome(n);
}

/* ── transfer sheet ────────────────────────────────────── */
function transferSheet(tab = 'file'){
  const s = openSheet({ title:'Transfer & Sync', wide:true, body:`
    <div class="seg" id="trTabs">
      <button data-t="file">File</button><button data-t="qr">QR</button>
      <button data-t="code">Code</button><button data-t="cloud">Cloud</button>
    </div>
    <div id="trBody" style="margin-top:14px"></div>` });

  const tabs = $('#trTabs', s.el);
  tabs.onclick = e => { const b = e.target.closest('[data-t]'); if (b) show(b.dataset.t); };
  show(tab);

  function show(t){
    $$('#trTabs button', s.el).forEach(b => b.classList.toggle('on', b.dataset.t === t));
    const host = $('#trBody', s.el);
    ({ file:tabFile, qr:tabQR, code:tabCode, cloud:tabCloud })[t](host, s);
  }

  /* — file — */
  function tabFile(host){
    const live = st.notes.filter(n => !n.trashed).length;
    host.innerHTML = `
      <p class="hint">A backup file holds every note, notebook, tag and attachment. Send it to your other phone however you like — AirDrop, WhatsApp, email, a cable — then import it there.</p>
      <div class="menu-list" style="margin-top:12px">
        <button class="menu-item" data-f="exp">${svg('down')}<span class="grow">Export backup file
          <span class="mi-sub">${live} note${live===1?'':'s'} · includes images and files</span></span></button>
        <button class="menu-item" data-f="imp">${svg('up')}<span class="grow">Import a backup file
          <span class="mi-sub">Adds notes — newer versions win, nothing is lost</span></span></button>
        <button class="menu-item danger" data-f="impr">${svg('up')}<span class="grow">Import and replace everything
          <span class="mi-sub">Wipes this device first, then imports</span></span></button>
      </div>`;
    host.onclick = async e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      if (b.dataset.f === 'exp'){
        const c = await Transfer.exportFile({});
        toast(`Backup saved — ${c} note${c===1?'':'s'}`, 'ok');
      } else {
        const replace = b.dataset.f === 'impr';
        if (replace && !await confirmSheet('Replace everything?',
          'Every note on this device is deleted first, then the backup is imported.', 'Replace', true)) return;
        const inp = $('#filePicker');
        inp.accept = '.json,application/json'; inp.multiple = false; inp.value = '';
        inp.onchange = async () => {
          const f = inp.files[0]; inp.value = ''; inp.multiple = true;
          if (!f) return;
          try {
            const data = await Transfer.readFile(f);
            const stats = await Transfer.applyBackup(data, replace ? 'replace' : 'merge');
            await reload(); s.close();
            toast(`Imported ${stats.notes} note${stats.notes===1?'':'s'}${stats.skipped?` · ${stats.skipped} already up to date`:''}`, 'ok');
          } catch (err){ toast(err.message, 'err'); }
        };
        inp.click();
      }
    };
  }

  /* — QR — */
  function tabQR(host){
    host.innerHTML = `
      <p class="hint">Show the code on one phone, scan it with the other. Best for a handful of notes — images and files are not included in a QR.</p>
      <div class="seg" style="margin-top:12px" id="qrMode">
        <button data-m="show" class="on">Show a code</button><button data-m="scan">Scan a code</button>
      </div>
      <div id="qrPane" style="margin-top:14px"></div>`;
    const pane = $('#qrPane', host);
    $('#qrMode', host).onclick = e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      $$('#qrMode button', host).forEach(x => x.classList.toggle('on', x === b));
      b.dataset.m === 'show' ? showQR() : scanQR();
    };
    showQR();

    async function showQR(){
      stopScan();
      const opts = [
        ['all','Everything'],
        st.noteId ? ['one','Just the open note'] : null,
        st.scope.type === 'notebook' ? ['scope','This notebook'] : null,
      ].filter(Boolean);
      pane.innerHTML = `
        <div class="field"><label>What to send</label>
          <select id="qrWhat">${opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select></div>
        <div id="qrHolder"></div>
        <div id="qrNav" style="display:flex;align-items:center;gap:10px;justify-content:center;margin-top:12px"></div>`;
      let chunks = [], idx = 0, timer = 0;
      $('#qrWhat', pane).onchange = build;
      await build();

      async function build(){
        clearInterval(timer);
        const what = $('#qrWhat', pane).value;
        const ids = what === 'one' ? [st.noteId]
                  : what === 'scope' ? scopedNotes().map(n => n.id) : null;
        try {
          const code = await Transfer.makeCode({ noteIds:ids });
          chunks = Transfer.chunkCode(code); idx = 0;
          paint();
          if (chunks.length > 1) timer = setInterval(() => { idx = (idx+1) % chunks.length; paint(); }, 2200);
        } catch (err){ pane.innerHTML = `<p class="hint">${esc(err.message)}</p>`; }
      }
      function paint(){
        try { Transfer.renderQR(chunks[idx], $('#qrHolder', pane)); }
        catch (err){ $('#qrHolder', pane).innerHTML = `<p style="color:#333;padding:10px">${esc(err.message)}</p>`; return; }
        $('#qrNav', pane).innerHTML = chunks.length > 1
          ? `<span class="hint">Part ${idx+1} of ${chunks.length} — keep scanning until all parts are picked up. It cycles automatically.</span>`
          : `<span class="hint">Scan this with your other phone.</span>`;
      }
      s.onClose = () => clearInterval(timer);
    }

    async function scanQR(){
      pane.innerHTML = `<video id="scanVideo" playsinline muted></video>
        <div class="progress"><i id="scanBar"></i></div>
        <p class="hint" id="scanMsg">Point the camera at the other phone's QR code.</p>`;
      const got = new Map(); let sessionId = null, total = 0;
      try {
        stopScan._fn = await Transfer.startScan($('#scanVideo', pane), onChunk,
          () => {});
      } catch (err){ pane.innerHTML = `<p class="hint">${esc(err.message)}</p>`; }

      async function onChunk(text){
        const c = Transfer.parseChunk(text);
        if (!c) return;
        if (sessionId && c.id !== sessionId){ got.clear(); }
        sessionId = c.id; total = c.total;
        if (got.has(c.idx)) return;
        got.set(c.idx, c.body);
        $('#scanBar', pane).style.width = Math.round(got.size / total * 100) + '%';
        $('#scanMsg', pane).textContent = `Picked up ${got.size} of ${total} part${total===1?'':'s'}…`;
        if (got.size < total) return;

        stopScan();
        try {
          const code = Array.from({ length: total }, (_, i) => got.get(i + 1)).join('');
          const data = await Transfer.readCode(code);
          const stats = await Transfer.applyBackup(data, 'merge');
          await reload(); s.close();
          toast(`Received ${stats.notes} note${stats.notes===1?'':'s'}`, 'ok');
        } catch (err){ $('#scanMsg', pane).textContent = err.message; }
      }
    }
  }

  /* — code — */
  function tabCode(host){
    host.innerHTML = `
      <p class="hint">Turn your notes into a block of text you can paste into any chat, then paste it in on the other phone. Images and files are not included.</p>
      <div class="seg" style="margin-top:12px" id="cdMode">
        <button data-m="make" class="on">Make a code</button><button data-m="use">Paste a code</button>
      </div>
      <div id="cdPane" style="margin-top:14px"></div>`;
    const pane = $('#cdPane', host);
    $('#cdMode', host).onclick = e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      $$('#cdMode button', host).forEach(x => x.classList.toggle('on', x === b));
      b.dataset.m === 'make' ? make() : use();
    };
    make();

    async function make(){
      pane.innerHTML = `<div class="field"><label>What to include</label>
          <select id="cdWhat"><option value="all">Everything</option>
          ${st.noteId ? '<option value="one">Just the open note</option>' : ''}</select></div>
        <div class="field"><label>Your code</label><textarea id="cdOut" readonly></textarea></div>
        <button class="btn primary block" id="cdCopy">${svg('copy')} Copy code</button>`;
      const build = async () => {
        const ids = $('#cdWhat', pane).value === 'one' ? [st.noteId] : null;
        $('#cdOut', pane).value = await Transfer.makeCode({ noteIds:ids });
      };
      $('#cdWhat', pane).onchange = build;
      await build();
      $('#cdCopy', pane).onclick = async () => {
        const v = $('#cdOut', pane).value;
        try { await navigator.clipboard.writeText(v); toast('Code copied', 'ok'); }
        catch(_){ $('#cdOut', pane).select(); document.execCommand('copy'); toast('Code copied', 'ok'); }
      };
    }
    function use(){
      pane.innerHTML = `<div class="field"><label>Paste the code here</label>
          <textarea id="cdIn" placeholder="MYNOTES1:…"></textarea></div>
        <button class="btn primary block" id="cdGo">Add these notes</button>`;
      $('#cdGo', pane).onclick = async () => {
        try {
          const data = await Transfer.readCode($('#cdIn', pane).value);
          const stats = await Transfer.applyBackup(data, 'merge');
          await reload(); s.close();
          toast(`Added ${stats.notes} note${stats.notes===1?'':'s'}`, 'ok');
        } catch (err){ toast(err.message, 'err'); }
      };
    }
  }

  /* — cloud — */
  function tabCloud(host){
    const cfg = Transfer.cloudCfg();
    host.innerHTML = `
      <p class="hint">Sync through your own free Firebase database. Everything is encrypted on this device with your passphrase before it is uploaded, so the database only ever holds scrambled data. Setup steps are in the README.</p>
      <div class="field"><label>Database URL</label>
        <input type="url" id="clUrl" placeholder="https://your-project-default-rtdb.firebaseio.com" value="${esc(cfg?.dbUrl||'')}"></div>
      <div class="field"><label>Sync name</label>
        <input type="text" id="clKey" placeholder="my-notes" value="${esc(cfg?.syncKey||'')}"></div>
      <div class="field"><label>Passphrase</label>
        <input type="password" id="clPass" placeholder="Something only you know" value="${esc(cfg?.pass||'')}">
        <p class="hint">Use the same three values on every phone. Lose the passphrase and the synced copy cannot be read.</p></div>
      <div class="menu-list" style="margin-top:6px">
        <button class="menu-item" data-c="push">${svg('up')}<span class="grow">Upload from this device
          <span class="mi-sub">Replaces what is stored in the cloud</span></span></button>
        <button class="menu-item" data-c="pull">${svg('down')}<span class="grow">Download to this device
          <span class="mi-sub">Merges in — newer versions win</span></span></button>
      </div>
      <p class="hint" id="clMsg" style="min-height:18px"></p>
      ${cfg ? `<button class="btn ghost block" data-c="forget" style="margin-top:6px">Forget these sync details</button>` : ''}`;

    host.onclick = async e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const msg = t => $('#clMsg', host).textContent = t;
      if (b.dataset.c === 'forget'){
        Transfer.clearCloudCfg(); tabCloud(host); toast('Sync details cleared'); return;
      }
      const conf = {
        dbUrl: $('#clUrl', host).value.trim(),
        syncKey: $('#clKey', host).value.trim(),
        pass: $('#clPass', host).value,
      };
      if (!conf.dbUrl || !conf.syncKey || !conf.pass) return toast('Fill in all three fields', 'err');
      Transfer.saveCloudCfg(conf);
      try {
        if (b.dataset.c === 'push'){
          const c = await Transfer.cloudPush(conf, msg);
          msg(''); toast(`Uploaded ${c} note${c===1?'':'s'}`, 'ok');
        } else {
          const r = await Transfer.cloudPull(conf, 'merge', msg);
          await reload(); msg('');
          toast(`Downloaded ${r.stats.notes} note${r.stats.notes===1?'':'s'} from ${r.device||'the cloud'}`, 'ok');
        }
      } catch (err){ msg(''); toast(err.message, 'err'); }
    };
  }
}
function stopScan(){ if (stopScan._fn){ try { stopScan._fn(); } catch(_){} stopScan._fn = null; } }

/* ── settings sheet ────────────────────────────────────── */
function settingsSheet(){
  const s = DB.S.all();
  const sh = openSheet({ title:'Settings', wide:true, body:`
    <div class="field"><label>Theme</label>
      <div class="seg" data-set="theme">
        ${['dark','light','auto'].map(t => `<button data-v="${t}" class="${s.theme===t?'on':''}">${
          t === 'auto' ? 'Match device' : t[0].toUpperCase()+t.slice(1)}</button>`).join('')}
      </div></div>

    <div class="field"><label>Accent colour</label>
      <div class="swatches" data-set="accent">${ACCENTS.map(c =>
        `<span class="swatch ${s.accent===c?'on':''}" data-v="${c}" style="background:${c}"></span>`).join('')}</div></div>

    <div class="field"><label>Note font</label>
      <select data-set="fontNote">${Editor.FONTS.map(f =>
        `<option value="${f[0]}" ${s.fontNote===f[0]?'selected':''}>${f[1]}</option>`).join('')}</select></div>

    <div class="field"><label>Text size — <b id="szVal">${s.noteSize}px</b></label>
      <input type="range" min="13" max="24" value="${s.noteSize}" data-set="noteSize" style="width:100%"></div>

    <div class="field"><label>Line spacing — <b id="lhVal">${s.lineHeight}</b></label>
      <input type="range" min="1.3" max="2.2" step="0.05" value="${s.lineHeight}" data-set="lineHeight" style="width:100%"></div>

    <div class="field"><label>Note list</label>
      <div class="seg" data-set="view">
        <button data-v="list" class="${s.view==='list'?'on':''}">List</button>
        <button data-v="grid" class="${s.view==='grid'?'on':''}">Grid</button>
      </div></div>

    <div class="field"><label>Sort by</label>
      <select data-set="sort">${[
        ['updated-desc','Last edited (newest first)'],['updated-asc','Last edited (oldest first)'],
        ['created-desc','Date created (newest first)'],['created-asc','Date created (oldest first)'],
        ['title-asc','Title A–Z'],['title-desc','Title Z–A'],
      ].map(o => `<option value="${o[0]}" ${s.sort===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select></div>

    <div class="menu-list" style="margin-top:8px">
      ${toggleRow('groupByDate','Group notes by date', s.groupByDate)}
      ${toggleRow('spellcheck','Spell check while typing', s.spellcheck)}
      ${toggleRow('autoTitle','Use the first line as the title', s.autoTitle)}
      ${toggleRow('confirmDelete','Ask before moving to trash', s.confirmDelete)}
    </div>

    <div class="field" style="margin-top:16px"><label>Keep trashed notes for</label>
      <select data-set="trashDays">${[7,30,90,365].map(d =>
        `<option value="${d}" ${+s.trashDays===d?'selected':''}>${d} days</option>`).join('')}</select></div>

    <div class="field"><label>Storage used</label>
      <p class="hint" id="storeInfo">Checking…</p></div>

    <div class="menu-list">
      <button class="menu-item" data-a="install">${svg('down')}<span class="grow">Install on this device
        <span class="mi-sub" id="instHint">Add to your Home Screen</span></span></button>
      <button class="menu-item" data-a="shortcuts">${svg('text')}<span class="grow">Keyboard shortcuts</span></button>
      <button class="menu-item" data-a="reset">${svg('history')}<span class="grow">Reset appearance settings</span></button>
      <button class="menu-item danger" data-a="wipe">${svg('trash')}<span class="grow">Delete everything on this device
        <span class="mi-sub">Notes, notebooks and files — export a backup first</span></span></button>
    </div>` });

  /* live bindings */
  sh.el.addEventListener('click', async e => {
    const seg = e.target.closest('.seg [data-v]');
    if (seg){
      const key = seg.closest('[data-set]').dataset.set;
      $$('[data-v]', seg.parentElement).forEach(b => b.classList.remove('on'));
      seg.classList.add('on');
      DB.S.set(key, seg.dataset.v); applySettings(); renderList(); return;
    }
    const sw = e.target.closest('.swatches [data-v]');
    if (sw){
      $$('[data-v]', sw.parentElement).forEach(b => b.classList.remove('on'));
      sw.classList.add('on');
      DB.S.set(sw.closest('[data-set]').dataset.set, sw.dataset.v); applySettings(); return;
    }
    const tg = e.target.closest('[data-toggle]');
    if (tg){
      const key = tg.dataset.toggle, val = !DB.S.get(key);
      DB.S.set(key, val);
      tg.querySelector('.tg').textContent = val ? 'On' : 'Off';
      tg.classList.toggle('checked', val);
      applySettings(); renderList(); return;
    }
    const act = e.target.closest('[data-a]');
    if (!act) return;
    const a = act.dataset.a;
    if (a === 'install'){ sh.close(); installFlow(); }
    if (a === 'shortcuts'){ sh.close(); shortcutsSheet(); }
    if (a === 'reset'){ DB.S.merge({ theme:'dark', accent:'#12a89d', fontNote:'system',
        noteSize:16, lineHeight:1.65, view:'list' }); applySettings(); sh.close(); settingsSheet(); toast('Appearance reset'); }
    if (a === 'wipe'){
      sh.close();
      if (!await confirmSheet('Delete everything?',
        'Every note, notebook and attachment on this device is erased. If you have not exported a backup, this cannot be undone.', 'Delete everything', true)) return;
      await DB.clear('notes'); await DB.clear('notebooks'); await DB.clear('files');
      localStorage.removeItem('mynotes.lastNote');
      st.notes = []; st.notebooks = []; closeNote();
      const nb = mkNotebook('My Notebook', '#12a89d', '📓');
      st.notebooks.push(nb); await DB.put('notebooks', nb); DB.S.set('defaultNotebook', nb.id);
      renderAll(); toast('Everything deleted');
    }
  });
  sh.el.addEventListener('input', e => {
    const r = e.target.closest('input[type=range][data-set]');
    if (!r) return;
    const key = r.dataset.set, v = key === 'lineHeight' ? +r.value : Math.round(+r.value);
    DB.S.set(key, v); applySettings();
    const lbl = $('#' + (key === 'noteSize' ? 'szVal' : 'lhVal'), sh.el);
    if (lbl) lbl.textContent = key === 'noteSize' ? v + 'px' : v;
  });
  sh.el.addEventListener('change', e => {
    const sel = e.target.closest('select[data-set]');
    if (!sel) return;
    DB.S.set(sel.dataset.set, sel.dataset.set === 'trashDays' ? +sel.value : sel.value);
    applySettings(); renderList();
  });

  if (navigator.storage?.estimate) navigator.storage.estimate().then(e => {
    const info = $('#storeInfo', sh.el);
    if (info) info.textContent =
      `${Editor.fmtBytes(e.usage||0)} used of about ${Editor.fmtBytes(e.quota||0)} available · ` +
      `${st.notes.filter(n=>!n.trashed).length} notes`;
  });
  const ih = $('#instHint', sh.el);
  if (ih && matchMedia('(display-mode: standalone)').matches) ih.textContent = 'Already installed ✓';
}

const toggleRow = (key, label, on) =>
  `<button class="menu-item ${on?'checked':''}" data-toggle="${key}">
     ${svg('check')}<span class="grow">${label}</span><span class="tg" style="color:var(--ink-3)">${on?'On':'Off'}</span>
   </button>`;

function shortcutsSheet(){
  const rows = [
    ['Ctrl / ⌘ + B','Bold'], ['Ctrl / ⌘ + I','Italic'], ['Ctrl / ⌘ + U','Underline'],
    ['Ctrl / ⌘ + K','Insert a link'], ['Ctrl / ⌘ + Enter','Checklist item'],
    ['Ctrl / ⌘ + N','New note'], ['Ctrl / ⌘ + F','Search'], ['Tab','Indent a list item'],
    ['Esc','Close a panel'],
  ];
  openSheet({ title:'Keyboard shortcuts', body:
    `<div class="menu-list">${rows.map(r =>
      `<div class="menu-item" style="cursor:default"><span class="grow">${r[1]}</span><kbd>${r[0]}</kbd></div>`).join('')}</div>` });
}

function installFlow(){
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  if (st.deferredInstall){
    st.deferredInstall.prompt();
    st.deferredInstall.userChoice.finally(() => st.deferredInstall = null);
    return;
  }
  openSheet({ title:'Install on this device', body: isIOS ? `
      <p class="hint">On iPhone and iPad:</p>
      <div class="menu-list">
        <div class="menu-item" style="cursor:default"><span class="grow">1. Tap the <b>Share</b> button in Safari</span></div>
        <div class="menu-item" style="cursor:default"><span class="grow">2. Scroll down and tap <b>Add to Home Screen</b></span></div>
        <div class="menu-item" style="cursor:default"><span class="grow">3. Tap <b>Add</b></span></div>
      </div>
      <p class="hint">It must be Safari — other iPhone browsers cannot add to the Home Screen.</p>` : `
      <p class="hint">On Android (Chrome):</p>
      <div class="menu-list">
        <div class="menu-item" style="cursor:default"><span class="grow">1. Tap the <b>⋮</b> menu</span></div>
        <div class="menu-item" style="cursor:default"><span class="grow">2. Tap <b>Install app</b> or <b>Add to Home screen</b></span></div>
      </div>
      <p class="hint">On a laptop, look for the install icon at the right of the address bar.</p>` });
}

/* ── sheets, toasts, confirm ───────────────────────────── */
function openSheet({ title, body, foot, wide }){
  const host = $('#sheetHost');
  const el = document.createElement('div');
  el.className = 'sheet' + (wide ? ' wide' : '');
  el.innerHTML = `
    <div class="sheet-head"><h2>${esc(title)}</h2>
      <button class="icon-btn" data-close title="Close">${svg('close')}</button></div>
    <div class="sheet-body">${body || ''}</div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  host.appendChild(el);
  $('#scrim').hidden = false;

  const api = {
    el,
    onClose:null,
    close(){
      if (api.closed) return;
      api.closed = true;
      if (api.onClose) try { api.onClose(); } catch(_){}
      stopScan();
      el.remove();
      const i = sheetStack.indexOf(api);
      if (i > -1) sheetStack.splice(i, 1);
      if (!host.children.length) $('#scrim').hidden = true;
    },
  };
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  sheetStack.push(api);
  return api;
}
const sheetStack = [];
function closeTopSheet(){
  const s = sheetStack[sheetStack.length - 1];
  if (s) s.close();
}

function confirmSheet(title, msg, okLabel = 'OK', danger = false){
  return new Promise(res => {
    const s = openSheet({ title, body:`<p class="hint" style="font-size:14px;color:var(--ink-2)">${esc(msg)}</p>`,
      foot:`<button class="btn ghost" data-no>Cancel</button>
            <button class="btn ${danger?'danger':'primary'}" data-yes>${esc(okLabel)}</button>` });
    s.el.addEventListener('click', e => {
      if (e.target.closest('[data-yes]')){ s.close(); res(true); }
      else if (e.target.closest('[data-no],[data-close]')){ s.close(); res(false); }
    });
  });
}

function toast(msg, kind = ''){
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ── wiring ────────────────────────────────────────────── */
function wire(){
  document.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]');
    if (act){
      const a = act.dataset.act;
      if (a === 'new-note')       return templatePick();
      if (a === 'open-sidebar')   return $('#app').classList.add('side-open');
      if (a === 'close-sidebar')  return $('#app').classList.remove('side-open');
      if (a === 'back-to-list'){  await flushSave(); Editor.stopSpeech();
                                  $('#app').dataset.pane = 'list'; return; }
      if (a === 'toggle-view'){   DB.S.set('view', DB.S.get('view') === 'grid' ? 'list' : 'grid');
                                  return renderList(); }
      if (a === 'open-sort')      return sortSheet();
      if (a === 'toggle-pin')     return togglePin();
      if (a === 'open-note-menu') return noteMenu();
      if (a === 'open-settings')  return settingsSheet();
      if (a === 'open-transfer')  return transferSheet();
      if (a === 'new-notebook')   return notebookSheet(null);
      if (a === 'add-tag'){       const n = curNote(); return n && tagSheet(n); }
      if (a === 'empty-trash')    return emptyTrash();
    }

    const nbMenu = e.target.closest('[data-nb-menu]');
    if (nbMenu){
      e.stopPropagation();
      const nb = st.notebooks.find(b => b.id === nbMenu.dataset.nbMenu);
      return nb && notebookSheet(nb);
    }
    const scope = e.target.closest('[data-scope]');
    if (scope) return setScope(scope.dataset.scope, scope.dataset.id || null);

    const cardEl = e.target.closest('[data-note]');
    if (cardEl) return openNote(cardEl.dataset.note);

    const untag = e.target.closest('[data-untag]');
    if (untag){
      const n = curNote(); if (!n) return;
      n.tags = (n.tags||[]).filter(t => t !== untag.dataset.untag); n.updated = Date.now();
      await DB.put('notes', n); renderAll(); renderNoteChrome(n);
    }
  });

  $('#scrim').addEventListener('click', closeTopSheet);

  $('#edTitle').addEventListener('input', onEditorChange);
  $('#edTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); $('#edBody').focus(); }
  });

  const searchEl = $('#search');
  let sTimer = 0;
  searchEl.addEventListener('input', () => {
    clearTimeout(sTimer);
    sTimer = setTimeout(() => {
      st.query = searchEl.value;
      $('#clearSearch').classList.toggle('hidden', !st.query);
      renderList();
    }, 130);
  });
  $('#clearSearch').addEventListener('click', () => {
    searchEl.value = ''; st.query = '';
    $('#clearSearch').classList.add('hidden'); renderList(); searchEl.focus();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape'){
      if (sheetStack.length && $('#sheetHost').children.length) return closeTopSheet();
      if ($('#app').classList.contains('side-open')) return $('#app').classList.remove('side-open');
    }
    const meta = e.ctrlKey || e.metaKey;
    if (!meta) return;
    if (e.key.toLowerCase() === 'n' && !e.shiftKey){ e.preventDefault(); templatePick(); }
    if (e.key.toLowerCase() === 'f'){ e.preventDefault(); $('#app').dataset.pane = 'list'; searchEl.focus(); searchEl.select(); }
  });

  document.addEventListener('selectionchange', syncToolbar);
  $('#toolbar').addEventListener('click', () => setTimeout(syncToolbar, 0));
  $('#edBody').addEventListener('keyup', syncToolbar);

  document.addEventListener('want-link', linkSheet);
  document.addEventListener('paste-image', e => addFile(e.detail.file, true));
  document.addEventListener('open-attachment', async e => {
    const f = await DB.get('files', e.detail.id);
    if (!f) return toast('That file is missing', 'err');
    Transfer.downloadBlob(f.blob, f.name || 'file');
  });
  document.addEventListener('open-link', e => {
    const href = e.detail.href || '';
    if (href.startsWith('note:')){
      const id = href.slice(5);
      if (st.notes.some(n => n.id === id && !n.trashed)) return openNote(id);
      return toast('That note no longer exists', 'err');
    }
    if (/^https?:/i.test(href)) open(href, '_blank', 'noopener');
  });

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); st.deferredInstall = e; });
  addEventListener('beforeunload', () => { if (st.dirty) saveNote(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){ flushSave(); Editor.stopSpeech(); }
    else scheduleAllReminders();
  });
}

function setScope(type, id){
  st.scope = { type, id };
  renderAll();
  if (innerWidth <= 720) $('#app').classList.remove('side-open');
}

function sortSheet(){
  const cur = DB.S.get('sort');
  const opts = [['updated-desc','Last edited — newest first'],['updated-asc','Last edited — oldest first'],
                ['created-desc','Created — newest first'],['created-asc','Created — oldest first'],
                ['title-asc','Title A–Z'],['title-desc','Title Z–A']];
  const s = openSheet({ title:'Sort notes', body:`<div class="menu-list">
    ${opts.map(o => `<button class="menu-item ${cur===o[0]?'checked':''}" data-s="${o[0]}">
      <span class="grow">${o[1]}</span>${cur===o[0]?svg('check'):''}</button>`).join('')}
    </div>${toggleRow('groupByDate','Group notes by date', DB.S.get('groupByDate'))}` });
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (b){ DB.S.set('sort', b.dataset.s); s.close(); renderList(); return; }
    const tg = e.target.closest('[data-toggle]');
    if (tg){
      const v = !DB.S.get('groupByDate');
      DB.S.set('groupByDate', v);
      tg.querySelector('.tg').textContent = v ? 'On' : 'Off';
      tg.classList.toggle('checked', v); renderList();
    }
  });
}

function templatePick(){
  const s = openSheet({ title:'New note', body:`<div class="tpl-grid">
    ${TEMPLATES.map((t, i) => `<button class="tpl" data-tpl="${i}">
      <div class="t-emoji">${t.emoji}</div><div class="t-name">${t.name}</div>
      <div class="t-desc">${t.desc}</div></button>`).join('')}</div>` });
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]'); if (!b) return;
    const t = TEMPLATES[+b.dataset.tpl];
    s.close();
    newNote(t.name === 'Blank' ? null : t);
  });
}

async function emptyTrash(){
  const gone = st.notes.filter(n => n.trashed);
  if (!gone.length) return;
  if (!await confirmSheet('Empty the trash?', `${gone.length} note${gone.length===1?'':'s'} will be deleted for good.`, 'Empty trash', true)) return;
  for (const n of gone) await DB.del('notes', n.id);
  st.notes = st.notes.filter(n => !n.trashed);
  if (st.noteId && !st.notes.some(n => n.id === st.noteId)) closeNote();
  renderAll(); toast('Trash emptied');
}

async function purgeTrash(){
  const days = +DB.S.get('trashDays') || 30;
  const cutoff = Date.now() - days * 86400000;
  const old = st.notes.filter(n => n.trashed && (n.trashedAt || 0) < cutoff);
  for (const n of old) await DB.del('notes', n.id);
  if (old.length) st.notes = st.notes.filter(n => !old.includes(n));
}

async function reload(){
  st.notes = await DB.all('notes');
  st.notebooks = await DB.all('notebooks');
  if (!st.notebooks.length){
    const nb = mkNotebook('My Notebook', '#12a89d', '📓');
    st.notebooks.push(nb); await DB.put('notebooks', nb); DB.S.set('defaultNotebook', nb.id);
  }
  renderAll();
  if (st.noteId){
    const n = st.notes.find(x => x.id === st.noteId);
    if (n) openNote(n.id); else closeNote();
  }
  scheduleAllReminders();
}

/* ── formatting helpers ────────────────────────────────── */
function fmtWhen(ts){
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  if (sameDay) return time;
  if (d.toDateString() === yest.toDateString()) return 'Yesterday ' + time;
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString([], { day:'numeric', month:'short' });
  return d.toLocaleDateString([], { day:'numeric', month:'short', year:'numeric' });
}
function dateGroup(ts){
  const d = new Date(ts), now = new Date();
  const day = 86400000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return 'Today';
  if (ts >= startToday - day) return 'Yesterday';
  if (ts >= startToday - 7 * day) return 'Earlier this week';
  if (ts >= startToday - 30 * day) return 'This month';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month:'long' });
  return String(d.getFullYear());
}
const words = t => (String(t||'').trim().match(/\S+/g) || []).length;
function htmlToText(html){
  const d = document.createElement('div'); d.innerHTML = html || '';
  return d.innerText.trim();
}

/* ── service worker ────────────────────────────────────── */
function registerSW(){
  if (!('serviceWorker' in navigator)) return;
  /* boot() awaits IndexedDB first, so 'load' has usually already fired by the
     time we get here — waiting for it again would never register anything */
  const go = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once:true });

  /* tapping a reminder notification asks us to open that note */
  navigator.serviceWorker.addEventListener('message', e => {
    const id = e.data && e.data.open;
    if (id && st.notes.some(n => n.id === id && !n.trashed)) openNote(id);
  });
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML =
    `<div style="padding:40px;font-family:system-ui;color:#e8edf5;background:#0f1115;height:100vh">
       <h2>Could not start</h2><p style="color:#9aa6b8">${esc(err.message)}</p></div>`;
});
})();
