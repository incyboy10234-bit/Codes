/* ============================================================
   editor.js — rich text editing surface
   ============================================================ */
const ICONS = {
  undo:'M3 10h11a5 5 0 0 1 0 10h-2M3 10l4-4M3 10l4 4',
  redo:'M21 10H10a5 5 0 0 0 0 10h2M21 10l-4-4M21 10l-4 4',
  bold:'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic:'M19 5h-7M12 19H5M15 5l-4 14',
  underline:'M7 4v6a5 5 0 0 0 10 0V4M5 20h14',
  strike:'M5 12h14M8 8a3.2 3.2 0 0 1 3.3-3H13a3 3 0 0 1 3 2.6M16 16a3.2 3.2 0 0 1-3.4 3H11a3 3 0 0 1-3-2.6',
  color:'M12 3 6.5 14a6 6 0 1 0 11 0zM4 21h16',
  highlight:'M4 21h16M9.5 15 4 20l3 1 5-5M13 4l7 7-7.5 7.5-7-7z',
  ul:'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  ol:'M10 6h11M10 12h11M10 18h11M4 6V4H3M3 10h2l-2 3h2M3 16h2v4H3v-2h2',
  task:'M4 6.5 6 8.5 9.5 5M4 17.5l2 2 3.5-3.5M13 7h8M13 17h8',
  quote:'M7 15c-2 0-3-1.3-3-3.2C4 8.6 6 6.2 9 5l.7 1.6C7.8 7.4 6.7 8.6 6.6 10c1.6-.3 3 .7 3 2.4C9.6 13.9 8.6 15 7 15zm9 0c-2 0-3-1.3-3-3.2 0-3.2 2-5.6 5-6.8l.7 1.6c-1.9.8-3 2-3.1 3.4 1.6-.3 3 .7 3 2.4 0 1.5-1 2.6-2.6 2.6z',
  code:'m9 8-5 4 5 4M15 8l5 4-5 4',
  h1:'M4 6v12M12 6v12M4 12h8M17 18v-8l-2 1.4',
  h2:'M4 6v12M12 6v12M4 12h8M16 11a2 2 0 1 1 4 .3c0 1.5-4 2.9-4 6.7h4',
  h3:'M4 6v12M12 6v12M4 12h8M16 10.5a2 2 0 1 1 2.6 2.1A2 2 0 1 1 16 15.6',
  alignL:'M4 6h16M4 12h10M4 18h13',
  alignC:'M4 6h16M7 12h10M6 18h12',
  alignR:'M4 6h16M10 12h10M7 18h13',
  hr:'M4 12h16M7 7h10M7 17h10',
  link:'M10 13a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.4 1.4M14 11a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.4-1.4',
  table:'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  image:'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5h.01',
  clip:'M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8L9.7 17.3a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8',
  draw:'m14 5 5 5L9.5 19.5 4 21l1.5-5.5zM12.5 6.5l5 5',
  mic:'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  speak:'M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11',
  eraser:'M8 20H5l-2-2 9.5-9.5a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 20zM8 20h11M9 11l5 5',
  pin:'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z',
  trash:'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  star:'m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z',
  tag:'M3 12V4h8l9 9-8 8zM7.5 7.5h.01',
  book:'M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1-2-2zM8 3v18',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
  history:'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3.5 2',
  copy:'M9 9h11v11H9zM5 15H4V4h11v1',
  down:'M12 3v13M7 11l5 5 5-5M4 20h16',
  up:'M12 21V8M7 13l5-5 5 5M4 4h16',
  qr:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  cloud:'M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.6 3.6 0 0 1 17.5 18z',
  text:'M4 7V5h16v2M12 5v14M9 19h6',
  close:'M18 6 6 18M6 6l12 12',
  check:'M20 6 9 17l-5-5',
  plus:'M12 5v14M5 12h14',
};
const svg = (n, cls='') =>
  `<svg viewBox="0 0 24 24" class="${cls}"><path d="${ICONS[n]||''}"/></svg>`;

const Editor = (() => {
  let body = null, onChange = null, recog = null, speaking = false;

  const FONTS = [
    ['system','Default'], ['serif','Serif'], ['mono','Mono'],
    ['rounded','Rounded'], ['georgia','Georgia'], ['verdana','Verdana'],
  ];
  const FONT_CSS = {
    system:'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    serif:'Georgia,"Times New Roman",serif',
    mono:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    rounded:'ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif',
    georgia:'Georgia,serif',
    verdana:'Verdana,Geneva,sans-serif',
  };
  const SIZES = [12,13,14,15,16,17,18,20,22,26,30,36];
  const TEXT_COLORS = ['#e8edf5','#12a89d','#4aa3ff','#f4677d','#f0b429','#8b5cf6','#22c55e','#94a3b8','#111827'];
  const HL_COLORS   = ['#fff3a3','#b8f2c9','#bfe3ff','#ffc9d4','#e2d4ff','transparent'];

  /* ── setup ─────────────────────────────────────────── */
  function init(el, changeCb){
    body = el; onChange = changeCb;
    body.dataset.ph = 'Start writing…';
    try { document.execCommand('styleWithCSS', false, false); } catch(_){}

    body.addEventListener('input', () => { normalise(); fire(); });
    body.addEventListener('blur', fire);
    body.addEventListener('click', onBodyClick);
    body.addEventListener('keydown', onKey);
    body.addEventListener('paste', onPaste);
  }
  const fire = () => onChange && onChange();

  /* ── toolbar ───────────────────────────────────────── */
  function buildToolbar(host, api){
    const b = (icon, title, fn, id) =>
      `<button class="icon-btn tb-btn" data-tb="${id||''}" title="${title}" aria-label="${title}">${svg(icon)}</button>`;
    const sep = '<span class="sep"></span>';

    host.innerHTML = [
      b('undo','Undo','', 'undo'),
      b('redo','Redo','', 'redo'),
      sep,
      `<select class="tb-select" data-tb="block" title="Text style">
         <option value="p">Body</option><option value="h1">Heading 1</option>
         <option value="h2">Heading 2</option><option value="h3">Heading 3</option>
       </select>`,
      `<select class="tb-select" data-tb="font" title="Font">${
         FONTS.map(f => `<option value="${f[0]}">${f[1]}</option>`).join('')}</select>`,
      `<select class="tb-select" data-tb="size" title="Text size">${
         SIZES.map(s => `<option value="${s}">${s}</option>`).join('')}</select>`,
      sep,
      b('bold','Bold','','bold'), b('italic','Italic','','italic'),
      b('underline','Underline','','underline'), b('strike','Strikethrough','','strike'),
      b('color','Text colour','','color'), b('highlight','Highlight','','highlight'),
      sep,
      b('ul','Bulleted list','','ul'), b('ol','Numbered list','','ol'),
      b('task','Checklist','','task'),
      b('alignL','Align left','','alignL'), b('alignC','Centre','','alignC'),
      b('alignR','Align right','','alignR'),
      sep,
      b('quote','Quote','','quote'), b('code','Code block','','code'),
      b('table','Table','','table'), b('hr','Divider','','hr'),
      b('link','Link','','link'),
      sep,
      b('image','Insert image','','image'), b('clip','Attach file','','file'),
      b('draw','Draw a sketch','','draw'),
      b('mic','Dictate (speech to text)','','mic'),
      b('speak','Read aloud','','speak'),
      sep,
      b('eraser','Clear formatting','','clearfmt'),
    ].join('');

    host.addEventListener('mousedown', e => {
      if (e.target.closest('.tb-btn')) e.preventDefault();   // keep the caret
    });
    host.addEventListener('click', e => {
      const btn = e.target.closest('[data-tb]');
      if (btn && btn.tagName === 'BUTTON') api(btn.dataset.tb, btn);
    });
    host.addEventListener('change', e => {
      const s = e.target.closest('select[data-tb]');
      if (s) api(s.dataset.tb, s);
    });
  }

  /* ── command dispatch ──────────────────────────────── */
  function cmd(name, val){
    body.focus();
    try { document.execCommand(name, false, val); } catch(_){}
    normalise(); fire();
  }

  function block(tag){
    body.focus();
    document.execCommand('formatBlock', false, tag.toUpperCase());
    normalise(); fire();
  }

  /* Apply an inline CSS property to the selection.
     execCommand('fontSize') is the only reliable way to wrap a selection,
     so we tag with size=7 then rewrite those nodes into styled spans. */
  function applyInline(prop, value){
    body.focus();
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed){ return; }
    document.execCommand('fontSize', false, '7');
    body.querySelectorAll('font[size="7"]').forEach(f => {
      const span = document.createElement('span');
      span.style[prop] = value;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    normalise(); fire();
  }

  const setFont = key => applyInline('fontFamily', FONT_CSS[key] || FONT_CSS.system);
  const setSize = px  => applyInline('fontSize', px + 'px');

  function insertHTML(html){
    body.focus();
    try { document.execCommand('insertHTML', false, html); }
    catch(_){
      const sel = getSelection();
      if (sel.rangeCount){
        const r = sel.getRangeAt(0); r.deleteContents();
        const tpl = document.createElement('template'); tpl.innerHTML = html;
        r.insertNode(tpl.content);
      }
    }
    normalise(); fire();
  }

  /* ── blocks ────────────────────────────────────────── */
  function checklist(){
    body.focus();
    const li = currentLi();
    if (li && li.parentElement.classList.contains('task')){
      document.execCommand('insertUnorderedList');       // toggle off
      normalise(); fire(); return;
    }
    document.execCommand('insertUnorderedList');
    const li2 = currentLi();
    if (li2){ li2.parentElement.classList.add('task'); li2.dataset.done = '0'; }
    normalise(); fire();
  }

  function codeBlock(){
    body.focus();
    const sel = getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : '';
    insertHTML(`<pre><code>${esc(text || 'code')}</code></pre><p><br></p>`);
  }

  function table(rows = 3, cols = 3){
    let h = '<table><tbody>';
    for (let r = 0; r < rows; r++){
      h += '<tr>';
      for (let c = 0; c < cols; c++)
        h += r === 0 ? '<th>&nbsp;</th>' : '<td>&nbsp;</td>';
      h += '</tr>';
    }
    insertHTML(h + '</tbody></table><p><br></p>');
  }

  const divider = () => insertHTML('<hr><p><br></p>');

  function link(url, label){
    if (!/^[a-z]+:/i.test(url) && !url.startsWith('note:')) url = 'https://' + url;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && !label) cmd('createLink', url);
    else insertHTML(`<a href="${esc(url)}">${esc(label || url)}</a>&nbsp;`);
  }

  const image = (src, alt='') => insertHTML(`<img src="${esc(src)}" alt="${esc(alt)}">`);

  function attachment(id, name, size, mime){
    insertHTML(
      `<a class="att" data-file="${esc(id)}" href="#" contenteditable="false">
         <span class="att-ico">${svg('clip')}</span>
         <span><span class="att-name">${esc(name)}</span>
         <span class="att-sz">${fmtBytes(size)} · ${esc((mime||'file').split('/').pop())}</span></span>
       </a><p><br></p>`);
  }

  function clearFormat(){
    body.focus();
    document.execCommand('removeFormat');
    document.execCommand('formatBlock', false, 'P');
    const sel = getSelection();
    if (sel.rangeCount){
      const frag = sel.getRangeAt(0).cloneContents();
      frag.querySelectorAll && frag.querySelectorAll('[style]').forEach(n => n.removeAttribute('style'));
    }
    normalise(); fire();
  }

  /* ── behaviour ─────────────────────────────────────── */
  function currentLi(){
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) n = n.parentElement;
    return n && n.closest ? n.closest('li') : null;
  }

  function onBodyClick(e){
    const li = e.target.closest('li');
    if (li && li.parentElement.classList.contains('task')){
      const r = li.getBoundingClientRect();
      if (e.clientX - r.left < 26){                   // clicked the checkbox zone
        li.dataset.done = li.dataset.done === '1' ? '0' : '1';
        fire(); e.preventDefault(); return;
      }
    }
    const att = e.target.closest('.att');
    if (att){ e.preventDefault(); document.dispatchEvent(
      new CustomEvent('open-attachment', { detail:{ id:att.dataset.file } })); return; }

    const a = e.target.closest('a[href]');
    if (a && !att){
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('open-link', { detail:{ href:a.getAttribute('href') } }));
    }
  }

  function onKey(e){
    const meta = e.ctrlKey || e.metaKey;
    if (meta){
      const k = e.key.toLowerCase();
      const map = { b:'bold', i:'italic', u:'underline' };
      if (map[k]){ e.preventDefault(); cmd(map[k]); return; }
      if (k === 'k'){ e.preventDefault();
        document.dispatchEvent(new CustomEvent('want-link')); return; }
      if (k === 'enter'){ e.preventDefault(); checklist(); return; }
    }
    /* Tab inside a list indents rather than leaving the field */
    if (e.key === 'Tab' && currentLi()){
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      normalise(); fire(); return;
    }
    /* Escape a code block with ArrowDown at its end */
    if (e.key === 'ArrowDown'){
      const sel = getSelection();
      if (sel.rangeCount){
        let n = sel.getRangeAt(0).endContainer;
        if (n.nodeType === 3) n = n.parentElement;
        const pre = n && n.closest ? n.closest('pre') : null;
        if (pre && !pre.nextElementSibling){
          const p = document.createElement('p'); p.innerHTML = '<br>';
          pre.after(p); placeIn(p); e.preventDefault(); fire();
        }
      }
    }
  }

  function onPaste(e){
    const items = e.clipboardData && e.clipboardData.items;
    if (items){
      for (const it of items){
        if (it.type && it.type.startsWith('image/')){
          const f = it.getAsFile();
          if (f){ e.preventDefault();
            document.dispatchEvent(new CustomEvent('paste-image', { detail:{ file:f } }));
            return; }
        }
      }
    }
    /* plain-text paste keeps the note clean */
    const txt = e.clipboardData && e.clipboardData.getData('text/plain');
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html && txt){
      e.preventDefault();
      insertHTML(esc(txt).replace(/\n/g, '<br>'));
    }
  }

  /* keep new list items unchecked + strip anything unsafe that got pasted */
  function normalise(){
    body.querySelectorAll('ul.task > li:not([data-done])').forEach(li => li.dataset.done = '0');
    body.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n => n.remove());
    body.querySelectorAll('*').forEach(n => {
      [...n.attributes].forEach(a => {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        if (a.name === 'href' && /^\s*javascript:/i.test(a.value)) n.setAttribute('href', '#');
      });
    });
  }

  function placeIn(node){
    const r = document.createRange(); r.selectNodeContents(node); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  /* ── speech ────────────────────────────────────────── */
  function dictate(onState){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return { ok:false, msg:'Dictation is not supported in this browser.' };
    if (recog){ recog.stop(); recog = null; onState(false); return { ok:true }; }
    recog = new SR();
    recog.continuous = true; recog.interimResults = false; recog.lang = navigator.language || 'en-US';
    recog.onresult = ev => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++)
        if (ev.results[i].isFinal) txt += ev.results[i][0].transcript;
      if (txt) insertHTML(esc(txt.trim()) + ' ');
    };
    recog.onend = () => { recog = null; onState(false); };
    recog.onerror = () => { recog = null; onState(false); };
    recog.start(); onState(true);
    return { ok:true };
  }

  function readAloud(text, onState){
    if (!('speechSynthesis' in window))
      return { ok:false, msg:'Read-aloud is not supported in this browser.' };
    if (speaking){ speechSynthesis.cancel(); speaking = false; onState(false); return { ok:true }; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || 'en-US';
    u.onend = u.onerror = () => { speaking = false; onState(false); };
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    speaking = true; onState(true);
    return { ok:true };
  }
  const stopSpeech = () => { try { speechSynthesis.cancel(); } catch(_){} speaking = false; };

  /* ── helpers ───────────────────────────────────────── */
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtBytes(n){
    if (!n && n !== 0) return '';
    const u = ['B','KB','MB','GB']; let i = 0;
    while (n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
    return (i ? n.toFixed(1) : n) + ' ' + u[i];
  }

  return { init, buildToolbar, cmd, block, setFont, setSize, applyInline,
           insertHTML, checklist, codeBlock, table, divider, link, image,
           attachment, clearFormat, dictate, readAloud, stopSpeech, normalise,
           esc, fmtBytes, FONTS, FONT_CSS, SIZES, TEXT_COLORS, HL_COLORS };
})();
