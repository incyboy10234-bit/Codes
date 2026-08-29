/* ============================================================
   db.js — IndexedDB storage layer + settings
   Stores: notes, notebooks, files (attachment blobs), meta
   ============================================================ */
const DB = (() => {
  const NAME = 'mynotes', VER = 1;
  let _db = null;

  function open(){
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open(NAME, VER);
      rq.onupgradeneeded = e => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('notes')){
          const s = db.createObjectStore('notes', { keyPath:'id' });
          s.createIndex('updated', 'updated');
          s.createIndex('notebookId', 'notebookId');
        }
        if (!db.objectStoreNames.contains('notebooks'))
          db.createObjectStore('notebooks', { keyPath:'id' });
        if (!db.objectStoreNames.contains('files'))
          db.createObjectStore('files', { keyPath:'id' });
        if (!db.objectStoreNames.contains('meta'))
          db.createObjectStore('meta', { keyPath:'k' });
      };
      rq.onsuccess = () => { _db = rq.result; res(_db); };
      rq.onerror = () => rej(rq.error);
    });
  }

  function tx(store, mode, fn){
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }

  const put  = (store, val) => tx(store, 'readwrite', s => s.put(val)).then(() => val);
  const del  = (store, id)  => tx(store, 'readwrite', s => s.delete(id));
  const get  = (store, id)  => tx(store, 'readonly',  s => s.get(id));
  const all  = store        => tx(store, 'readonly',  s => s.getAll());
  const clear= store        => tx(store, 'readwrite', s => s.clear());

  function putMany(store, arr){
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      arr.forEach(v => s.put(v));
      t.oncomplete = () => res(arr.length);
      t.onerror = () => rej(t.error);
    }));
  }

  /* ── settings (localStorage: tiny + synchronous at boot) ── */
  const SKEY = 'mynotes.settings';
  const DEFAULTS = {
    theme:'dark', accent:'#12a89d',
    fontUi:'system', fontNote:'system', noteSize:16, lineHeight:1.65,
    view:'list', sort:'updated-desc', groupByDate:true,
    spellcheck:true, confirmDelete:true, autoTitle:true,
    defaultNotebook:null, trashDays:30,
  };
  let settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch(_){}

  const S = {
    get: k => settings[k],
    all: () => ({ ...settings }),
    set(k, v){
      settings[k] = v;
      try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch(_){}
      return v;
    },
    merge(obj){
      Object.assign(settings, obj);
      try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch(_){}
    },
    reset(){ settings = { ...DEFAULTS }; localStorage.removeItem(SKEY); },
    DEFAULTS,
  };

  /* ── ids ── */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,10));

  return { open, tx, put, del, get, all, clear, putMany, S, uid };
})();
