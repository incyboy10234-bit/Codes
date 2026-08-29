import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(8099, r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport:{ width:1280, height:860 } });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8099/index.html');
await page.waitForTimeout(700);

const STEP_TIMEOUT = 45000;
const step = async (name, fn) => {
  try {
    await Promise.race([fn(), new Promise((_, rej) =>
      setTimeout(() => rej(new Error('step timed out after ' + STEP_TIMEOUT + 'ms')), STEP_TIMEOUT))]);
    console.log('  PASS  ' + name);
  } catch (e) { console.log('  FAIL  ' + name + ' :: ' + e.message); process.exitCode = 1; }
};

console.log('\n— boot —');
await step('sidebar rendered', async () => {
  const n = await page.locator('#smartList .side-item').count();
  if (n !== 4) throw new Error('smart list items = ' + n);
});
await step('default notebook created', async () => {
  const n = await page.locator('#notebookList .side-item').count();
  if (n < 1) throw new Error('no notebook');
});
await step('toolbar built', async () => {
  const n = await page.locator('#toolbar [data-tb]').count();
  if (n < 25) throw new Error('toolbar buttons = ' + n);
});

console.log('\n— create a note —');
await step('new note via FAB + template', async () => {
  await page.click('.fab');
  await page.waitForSelector('.tpl-grid');
  await page.click('[data-tpl="1"]');           // To-do list template
  await page.waitForSelector('#edWrap:not(.hidden)');
});
await step('template content landed', async () => {
  const items = await page.locator('#edBody ul.task li').count();
  if (items !== 3) throw new Error('checklist items = ' + items);
});
await step('title typing + autosave', async () => {
  await page.fill('#edTitle', 'Groceries for the week');
  await page.waitForTimeout(900);
  const t = await page.locator('.note-card h3').first().textContent();
  if (!t.includes('Groceries')) throw new Error('card title = ' + t);
});
await step('checklist toggles by tapping the box', async () => {
  const li = page.locator('#edBody ul.task li').first();
  const box = await li.boundingBox();
  await page.mouse.click(box.x + 8, box.y + 10);
  await page.waitForTimeout(200);
  const done = await li.getAttribute('data-done');
  if (done !== '1') throw new Error('data-done = ' + done);
});

console.log('\n— editing —');
await step('body typing persists', async () => {
  await page.click('#edBody');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Remember the oat milk');
  await page.waitForTimeout(900);
  const snip = await page.locator('.note-card .snip').first().textContent();
  if (!snip.includes('oat milk')) throw new Error('snippet = ' + snip);
});
await step('bold via toolbar', async () => {
  await page.keyboard.down('Shift');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.click('[data-tb="bold"]');
  await page.waitForTimeout(400);
  const html = await page.locator('#edBody').innerHTML();
  if (!/<b>|<strong>/i.test(html)) throw new Error('no bold tag');
});
await step('heading via block select', async () => {
  await page.selectOption('[data-tb="block"]', 'h2');
  await page.waitForTimeout(300);
  const h = await page.locator('#edBody h2').count();
  if (!h) throw new Error('no h2');
});
await step('divider inserts', async () => {
  await page.click('#edBody');
  await page.keyboard.press('Control+End');
  await page.click('[data-tb="hr"]');
  await page.waitForTimeout(300);
  if (!await page.locator('#edBody hr').count()) throw new Error('no hr');
});
await step('table sheet inserts a table', async () => {
  await page.click('[data-tb="table"]');
  await page.waitForSelector('#tGo');
  await page.fill('#tRows', '2'); await page.fill('#tCols', '3');
  await page.click('#tGo');
  await page.waitForTimeout(400);
  const cells = await page.locator('#edBody table td, #edBody table th').count();
  if (cells !== 6) throw new Error('cells = ' + cells);
});
await step('code block inserts', async () => {
  await page.click('[data-tb="code"]');
  await page.waitForTimeout(300);
  if (!await page.locator('#edBody pre code').count()) throw new Error('no pre>code');
});

console.log('\n— organisation —');
await step('tags add and show', async () => {
  await page.click('[data-act="add-tag"]');
  await page.waitForSelector('#tagIn');
  await page.fill('#tagIn', 'shopping');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.click('.sheet-foot [data-close]');
  await page.waitForTimeout(300);
  const tags = await page.locator('#tagList .side-item').first().textContent();
  if (!tags.includes('shopping')) throw new Error('tag list = ' + tags);
});
await step('pin toggles + sorts first', async () => {
  await page.click('#pinBtn');
  await page.waitForTimeout(400);
  if (!await page.locator('.note-card .pin').count()) throw new Error('no pin icon on card');
});
await step('new notebook can be created', async () => {
  await page.click('[data-act="new-notebook"]');
  await page.waitForSelector('#nbName');
  await page.fill('#nbName', 'Work');
  await page.click('[data-e="💼"]');
  await page.click('#nbSave');
  await page.waitForTimeout(400);
  const n = await page.locator('#notebookList .side-item').count();
  if (n !== 2) throw new Error('notebooks = ' + n);
});
await step('search filters', async () => {
  try {
    await page.fill('#search', 'zzzznomatch');
    await page.waitForTimeout(350);
    if (await page.locator('#listEmpty.hidden').count()) throw new Error('empty state not shown');
    await page.fill('#search', 'Groceries');
    await page.waitForTimeout(350);
    const c = await page.locator('.note-card').count();
    if (c !== 1) throw new Error('search results = ' + c);
  } finally {
    await page.fill('#search', '');
    await page.waitForTimeout(300);
  }
});

console.log('\n— transfer —');
await step('paste-code round trip', async () => {
  const code = await page.evaluate(async () => {
    const c = await Transfer.makeCode({});
    // wipe, then read it back in
    await DB.clear('notes');
    const data = await Transfer.readCode(c);
    const stats = await Transfer.applyBackup(data, 'merge');
    const back = await DB.all('notes');
    return { len:c.length, notes:stats.notes, restored:back.length, title:back[0]?.title };
  });
  if (code.restored < 1) throw new Error('nothing restored');
  if (!code.title.includes('Groceries')) throw new Error('title lost: ' + code.title);
  if (!code.len) throw new Error('empty code');
});
await step('backup JSON round trip incl. attachment', async () => {
  const r = await page.evaluate(async () => {
    const blob = new Blob(['hello file'], { type:'text/plain' });
    await DB.put('files', { id:'f1', name:'a.txt', type:'text/plain', size:blob.size, blob });
    const notes = await DB.all('notes');
    notes[0].html += '<a class="att" data-file="f1">x</a>';
    await DB.put('notes', notes[0]);
    const backup = await Transfer.buildBackup({});
    await DB.clear('notes'); await DB.clear('files');
    const stats = await Transfer.applyBackup(backup, 'merge');
    const f = await DB.get('files', 'f1');
    return { files:stats.files, text: f ? await f.blob.text() : null };
  });
  if (r.files !== 1) throw new Error('files restored = ' + r.files);
  if (r.text !== 'hello file') throw new Error('blob content = ' + r.text);
});
await step('QR chunking + render', async () => {
  const r = await page.evaluate(async () => {
    const code = await Transfer.makeCode({});
    const chunks = Transfer.chunkCode(code);
    const holder = document.createElement('div');
    Transfer.renderQR(chunks[0], holder);
    const parsed = Transfer.parseChunk(chunks[0]);
    const rejoined = chunks.map(c => Transfer.parseChunk(c).body).join('');
    return { n:chunks.length, img: holder.querySelector('img') ? 1 : 0,
             ok: rejoined === code, idx:parsed.idx, total:parsed.total };
  });
  if (!r.img) throw new Error('no QR image');
  if (!r.ok) throw new Error('chunks do not rejoin');
  if (r.total !== r.n) throw new Error('chunk header mismatch');
});
await step('cloud sync encrypts, uploads and merges back', async () => {
  const r = await page.evaluate(async () => {
    const cfg = { dbUrl:'https://fake-rtdb.example.com', syncKey:'test', pass:'hunter2' };
    let stored = null;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).includes('fake-rtdb')){
        if (opts && opts.method === 'PUT'){ stored = JSON.parse(opts.body); return new Response('{}', { status:200 }); }
        return new Response(JSON.stringify(stored), { status:200 });
      }
      return realFetch(url, opts);
    };
    const pushed = await Transfer.cloudPush(cfg);
    const looksEncrypted = !JSON.stringify(stored).includes('Groceries');
    await DB.clear('notes');
    const back = await Transfer.cloudPull(cfg, 'merge');
    let wrongPass = 'no error';
    try { await Transfer.cloudPull({ ...cfg, pass:'wrong' }, 'merge'); }
    catch (e){ wrongPass = e.message; }
    window.fetch = realFetch;
    const notes = await DB.all('notes');
    return { pushed, looksEncrypted, pulled:back.stats.notes, restored:notes.length, wrongPass };
  });
  if (!r.looksEncrypted) throw new Error('payload was uploaded in the clear');
  if (r.restored < 1) throw new Error('nothing came back from the cloud');
  if (!/passphrase/i.test(r.wrongPass)) throw new Error('wrong passphrase not rejected: ' + r.wrongPass);
});

console.log('\n— settings —');
await step('theme switches to light', async () => {
  await page.click('[data-act="open-settings"]');
  await page.waitForSelector('[data-set="theme"]');
  await page.click('[data-set="theme"] [data-v="light"]');
  await page.waitForTimeout(300);
  const t = await page.getAttribute('html', 'data-theme');
  if (t !== 'light') throw new Error('theme = ' + t);
});
await step('accent colour applies', async () => {
  await page.click('[data-set="accent"] [data-v="#8b5cf6"]');
  await page.waitForTimeout(200);
  const v = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  if (v !== '#8b5cf6') throw new Error('accent = ' + v);
});
await step('text size slider applies', async () => {
  await page.evaluate(() => {
    const r = document.querySelector('input[data-set="noteSize"]');
    r.value = 20; r.dispatchEvent(new Event('input', { bubbles:true }));
  });
  await page.waitForTimeout(200);
  const v = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--note-size').trim());
  if (v !== '20px') throw new Error('note size = ' + v);
});
await step('grid view toggles', async () => {
  await page.click('[data-set="view"] [data-v="grid"]');
  await page.waitForTimeout(250);
  if (!await page.locator('#notes.grid').count()) throw new Error('grid class missing');
  await page.click('[data-set="view"] [data-v="list"]');
  await page.click('.sheet-head [data-close]');
  await page.waitForTimeout(200);
});
await step('theme back to dark', async () => {
  await page.click('[data-act="open-settings"]');
  await page.waitForSelector('[data-set="theme"]');
  await page.click('[data-set="theme"] [data-v="dark"]');
  await page.click('[data-set="accent"] [data-v="#12a89d"]');
  await page.click('.sheet-head [data-close]');
  await page.waitForTimeout(300);
});

console.log('\n— trash —');
await step('trash + restore', async () => {
  await page.click('.note-card');
  await page.waitForTimeout(300);
  await page.click('[data-act="open-note-menu"]');
  await page.waitForSelector('[data-m="trash"]');
  await page.click('[data-m="trash"]');
  await page.waitForSelector('[data-yes]');
  await page.click('[data-yes]');
  await page.waitForTimeout(400);
  await page.click('[data-scope="trash"]');
  await page.waitForTimeout(300);
  const c = await page.locator('.note-card').count();
  if (c !== 1) throw new Error('trash count = ' + c);
  await page.click('.note-card');
  await page.waitForTimeout(300);
  await page.click('[data-act="open-note-menu"]');
  await page.waitForSelector('[data-m="restore"]');
  await page.click('[data-m="restore"]');
  await page.waitForTimeout(400);
  await page.click('[data-scope="all"]');
  await page.waitForTimeout(300);
  if (!await page.locator('.note-card').count()) throw new Error('not restored');
});

console.log('\n— persistence —');
await step('survives a reload', async () => {
  await page.reload();
  await page.waitForTimeout(900);
  const c = await page.locator('.note-card').count();
  if (c < 1) throw new Error('cards after reload = ' + c);
  const t = await page.locator('.note-card h3').first().textContent();
  if (!t.includes('Groceries')) throw new Error('title after reload = ' + t);
});

console.log('\n— responsive —');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
if (await page.getAttribute('#app', 'data-pane') === 'editor'){
  await page.click('[data-act="back-to-list"]');
  await page.waitForTimeout(300);
}
await step('mobile: sidebar is a drawer', async () => {
  const vis = await page.locator('[data-act="open-sidebar"]').first().isVisible();
  if (!vis) throw new Error('hamburger not visible');
});
await step('mobile: note opens full screen', async () => {
  await page.click('.note-card');
  await page.waitForTimeout(400);
  const pane = await page.getAttribute('#app', 'data-pane');
  if (pane !== 'editor') throw new Error('pane = ' + pane);
  await page.click('[data-act="back-to-list"]');
  await page.waitForTimeout(300);
});

await page.setViewportSize({ width: 1280, height: 860 });
await page.click('.note-card');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shot-desktop.png' });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/shot-mobile.png' });
await page.click('[data-act="back-to-list"]');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/shot-mobile-list.png' });

console.log('\n— offline / PWA —');
await step('service worker registers', async () => {
  const ok = await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active, () => false));
  if (!ok) throw new Error('no active service worker');
});
await step('app still loads with the network cut', async () => {
  await page.waitForTimeout(1200);                 // let the shell finish caching
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1200);
  const cards = await page.locator('.note-card').count();
  const title = await page.title();
  await ctx.setOffline(false);
  if (title !== 'My Notes') throw new Error('offline page title = ' + title);
  if (cards < 1) throw new Error('notes not readable offline: ' + cards);
});
await step('manifest is valid and complete', async () => {
  const m = await page.evaluate(async () => (await fetch('./manifest.json')).json());
  for (const k of ['name','short_name','start_url','display','icons'])
    if (!m[k]) throw new Error('manifest missing ' + k);
  if (m.display !== 'standalone') throw new Error('display = ' + m.display);
  if (!m.icons.some(i => i.sizes === '512x512')) throw new Error('no 512 icon');
});

console.log('\n— console errors —');
if (errors.length){ console.log(errors.join('\n')); process.exitCode = 1; }
else console.log('  none');

await browser.close();
server.close();
