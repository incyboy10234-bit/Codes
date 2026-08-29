import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
const ROOT = new URL('..', import.meta.url).pathname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=createServer(async(rq,rs)=>{try{let p=decodeURIComponent(rq.url.split('?')[0]);if(p==='/')p='/index.html';
const f=join(ROOT,normalize(p).replace(/^(\.\.[/\\])+/,''));const b=await readFile(f);
rs.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});rs.end(b);}catch{rs.writeHead(404);rs.end('x');}});
await new Promise(r=>server.listen(8101,r));
const br=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await br.newContext({viewport:{width:1280,height:880},deviceScaleFactor:2});
const pg=await ctx.newPage();
await pg.goto('http://localhost:8101/index.html');
await pg.waitForTimeout(600);

await pg.evaluate(async () => {
  const nbs = [
    { id:'nb1', name:'Personal', color:'#12a89d', emoji:'🏠', parentId:null, created:Date.now(), updated:Date.now() },
    { id:'nb2', name:'Work',     color:'#4aa3ff', emoji:'💼', parentId:null, created:Date.now(), updated:Date.now() },
    { id:'nb3', name:'Recipes',  color:'#f0b429', emoji:'🍳', parentId:null, created:Date.now(), updated:Date.now() },
  ];
  await DB.clear('notebooks'); await DB.clear('notes');
  for (const n of nbs) await DB.put('notebooks', n);
  DB.S.set('defaultNotebook','nb1');
  const hour = 3600000, day = 86400000;
  const mk = (o) => ({ id:o.id, title:o.title, html:o.html, plain:o.plain, notebookId:o.nb,
    tags:o.tags||[], pinned:!!o.pin, reminder:o.rem||null, trashed:false, trashedAt:null,
    created:Date.now()-o.age, updated:Date.now()-o.age, history:[] });
  const notes = [
    mk({ id:'n1', title:'Trip to Kerala — packing', nb:'nb1', tags:['travel','todo'], pin:true, age:hour*2,
      rem: Date.now()+day*2,
      html:`<p>Flight lands Friday evening, so pack light and keep the camera bag in hand luggage.</p>
        <h2>Bag</h2>
        <ul class="task"><li data-done="1">Passport &amp; tickets</li><li data-done="1">Chargers + power bank</li>
        <li data-done="0">Mosquito repellent</li><li data-done="0">Rain jacket</li></ul>
        <h2>Before leaving</h2><ul><li>Water the plants</li><li>Bin out Thursday night</li></ul>
        <blockquote>Backwaters houseboat is booked for Sunday — confirmation in email.</blockquote>`,
      plain:'Flight lands Friday evening, so pack light and keep the camera bag in hand luggage. Bag Passport & tickets Chargers + power bank Mosquito repellent Rain jacket Before leaving Water the plants Bin out Thursday night Backwaters houseboat is booked for Sunday.' }),
    mk({ id:'n2', title:'Standup notes — sprint 14', nb:'nb2', tags:['work'], age:hour*6,
      html:'<p>Shipping the search rewrite this week.</p>', plain:'Shipping the search rewrite this week.' }),
    mk({ id:'n3', title:'Dal tadka', nb:'nb3', tags:['recipes'], age:day*1.2,
      html:'<p>Toor dal, cumin, dried chilli, hing.</p>', plain:'Toor dal, cumin, dried chilli, hing. Pressure cook four whistles then temper in ghee.' }),
    mk({ id:'n4', title:'Books to read', nb:'nb1', tags:['reading'], age:day*3,
      html:'<p>Piranesi, The Overstory, Project Hail Mary.</p>', plain:'Piranesi, The Overstory, Project Hail Mary.' }),
    mk({ id:'n5', title:'Gym split', nb:'nb1', tags:['health'], age:day*9,
      html:'<p>Push / pull / legs, three days on one off.</p>', plain:'Push / pull / legs, three days on one off.' }),
    mk({ id:'n6', title:'Wifi and router logins', nb:'nb1', age:day*40,
      html:'<p>Admin panel at 192.168.1.1</p>', plain:'Admin panel at 192.168.1.1' }),
  ];
  for (const n of notes) await DB.put('notes', n);
});
await pg.reload(); await pg.waitForTimeout(800);
await pg.click('[data-note="n1"]'); await pg.waitForTimeout(500);
await pg.screenshot({ path:'/tmp/s1-desktop-dark.png' });

// light theme
await pg.evaluate(() => { DB.S.set('theme','light'); location.reload(); });
await pg.waitForTimeout(1000);
await pg.click('[data-note="n1"]'); await pg.waitForTimeout(500);
await pg.screenshot({ path:'/tmp/s2-desktop-light.png' });
await pg.evaluate(() => { DB.S.set('theme','dark'); location.reload(); });
await pg.waitForTimeout(1000);

// transfer sheet — QR tab
await pg.click('[data-act="open-transfer"]'); await pg.waitForSelector('#trTabs');
await pg.click('[data-t="qr"]'); await pg.waitForTimeout(1200);
await pg.screenshot({ path:'/tmp/s3-qr.png' });
await pg.click('.sheet-head [data-close]'); await pg.waitForTimeout(300);

// settings
await pg.click('[data-act="open-settings"]'); await pg.waitForTimeout(600);
await pg.screenshot({ path:'/tmp/s4-settings.png' });
await pg.click('.sheet-head [data-close]'); await pg.waitForTimeout(300);

// mobile
await pg.setViewportSize({ width:390, height:844 });
await pg.waitForTimeout(400);
if (await pg.getAttribute('#app','data-pane') === 'editor'){
  await pg.click('[data-act="back-to-list"]'); await pg.waitForTimeout(300);
}
await pg.screenshot({ path:'/tmp/s5-mobile-list.png' });
await pg.click('[data-note="n1"]'); await pg.waitForTimeout(500);
await pg.screenshot({ path:'/tmp/s6-mobile-note.png' });
await pg.click('[data-act="back-to-list"]'); await pg.waitForTimeout(400);
await pg.click('[data-act="open-sidebar"]'); await pg.waitForTimeout(500);
await pg.screenshot({ path:'/tmp/s7-mobile-sidebar.png' });

await br.close(); server.close();
console.log('shots done');
