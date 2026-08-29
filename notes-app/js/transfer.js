/* ============================================================
   transfer.js — moving notes between devices
     1. backup file  (.notes.json)
     2. QR code      (chunked, camera scan)
     3. paste code   (gzip + base64 text blob)
     4. cloud sync   (Firebase Realtime DB REST, end-to-end encrypted)
   ============================================================ */
const Transfer = (() => {
  const FORMAT = 1;
  const CODE_PREFIX = 'MYNOTES1:';
  const QR_PREFIX = 'MNQR';
  const QR_CHUNK = 700;              // chars per QR — stays scannable on a phone

  /* ── build / apply the payload ─────────────────────── */
  async function buildBackup({ includeFiles = true, noteIds = null } = {}){
    let notes = await DB.all('notes');
    const notebooks = await DB.all('notebooks');
    if (noteIds) notes = notes.filter(n => noteIds.includes(n.id));

    let files = [];
    if (includeFiles){
      const used = new Set();
      notes.forEach(n => {
        const html = n.html || '';
        for (const m of html.matchAll(/data-file="([^"]+)"/g)) used.add(m[1]);
        for (const m of html.matchAll(/src="file:([^"]+)"/g)) used.add(m[1]);
      });
      const raw = await DB.all('files');
      files = await Promise.all(raw.filter(f => used.has(f.id)).map(async f => ({
        id:f.id, name:f.name, type:f.type, size:f.size, data: await blobToB64(f.blob),
      })));
    }
    return {
      app:'my-notes', format:FORMAT, exportedAt:Date.now(),
      device: deviceName(), notes, notebooks, files,
    };
  }

  /* mode: 'merge' (newest wins) | 'replace' (wipe first) */
  async function applyBackup(data, mode = 'merge'){
    if (!data || data.app !== 'my-notes') throw new Error('That file is not a My Notes backup.');
    if (data.format > FORMAT) throw new Error('That backup came from a newer version of the app.');

    if (mode === 'replace'){
      await DB.clear('notes'); await DB.clear('notebooks'); await DB.clear('files');
    }
    const stats = { notes:0, notebooks:0, files:0, skipped:0 };

    const existingNb = new Map((await DB.all('notebooks')).map(n => [n.id, n]));
    for (const nb of (data.notebooks || [])){
      const cur = existingNb.get(nb.id);
      if (!cur || (nb.updated || 0) >= (cur.updated || 0)){ await DB.put('notebooks', nb); stats.notebooks++; }
    }

    const existing = new Map((await DB.all('notes')).map(n => [n.id, n]));
    for (const n of (data.notes || [])){
      const cur = existing.get(n.id);
      if (cur && (cur.updated || 0) >= (n.updated || 0)){ stats.skipped++; continue; }
      await DB.put('notes', n); stats.notes++;
    }

    for (const f of (data.files || [])){
      if (await DB.get('files', f.id)) continue;
      await DB.put('files', { id:f.id, name:f.name, type:f.type, size:f.size, blob: b64ToBlob(f.data, f.type) });
      stats.files++;
    }
    return stats;
  }

  /* ── 1. backup file ────────────────────────────────── */
  async function exportFile(opts){
    const data = await buildBackup(opts);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `my-notes-${stamp}.notes.json`);
    return data.notes.length;
  }

  function readFile(file){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { try { res(JSON.parse(r.result)); } catch(e){ rej(new Error('That file could not be read as a backup.')); } };
      r.onerror = () => rej(new Error('Could not read that file.'));
      r.readAsText(file);
    });
  }

  /* ── 2 + 3. text code (also the QR payload) ────────── */
  async function makeCode(opts){
    /* attachments are far too big for a text code or a QR */
    const data = await buildBackup({ ...opts, includeFiles:false });
    const json = JSON.stringify(data);
    const packed = await gzip(json);
    return CODE_PREFIX + packed;
  }

  async function readCode(code){
    code = String(code || '').trim().replace(/\s+/g, '');
    if (!code.startsWith(CODE_PREFIX)) throw new Error('That does not look like a My Notes code.');
    const json = await gunzip(code.slice(CODE_PREFIX.length));
    return JSON.parse(json);
  }

  const chunkCode = code => {
    const id = Math.random().toString(36).slice(2, 7);
    const total = Math.ceil(code.length / QR_CHUNK) || 1;
    const out = [];
    for (let i = 0; i < total; i++)
      out.push(`${QR_PREFIX}|${id}|${i + 1}/${total}|${code.substr(i * QR_CHUNK, QR_CHUNK)}`);
    return out;
  };

  function parseChunk(text){
    const m = /^MNQR\|([^|]+)\|(\d+)\/(\d+)\|([\s\S]*)$/.exec(text || '');
    if (!m) return null;
    return { id:m[1], idx:+m[2], total:+m[3], body:m[4] };
  }

  function renderQR(text, host){
    host.innerHTML = '';
    /* step up through QR versions until the payload fits */
    let last = null;
    for (let v = 6; v <= 40; v++){
      try {
        const q = qrcode(v, 'L');
        q.addData(text); q.make();
        host.innerHTML = q.createImgTag(4, 8);
        return true;
      } catch (e){ last = e; }
    }
    throw last || new Error('Could not build a QR code for that much data.');
  }

  /* camera scanning — jsQR is fetched only when it is actually needed */
  let jsqrLoaded = null;
  function loadScanner(){
    if (jsqrLoaded) return jsqrLoaded;
    jsqrLoaded = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './js/vendor/jsQR.min.js';
      s.onload = () => res(window.jsQR);
      s.onerror = () => rej(new Error('Could not load the QR scanner.'));
      document.head.appendChild(s);
    });
    return jsqrLoaded;
  }

  async function startScan(video, onChunk, onErr){
    const jsQR = await loadScanner();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:'environment' }, audio:false });
    } catch (e){
      throw new Error('Camera access was blocked. Allow the camera, or use the paste-code option.');
    }
    video.srcObject = stream; video.setAttribute('playsinline', ''); await video.play();

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently:true });
    let raf = 0, stopped = false;

    (function tick(){
      if (stopped) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA){
        cv.width = video.videoWidth; cv.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, cv.width, cv.height);
        try {
          const img = ctx.getImageData(0, 0, cv.width, cv.height);
          const hit = jsQR(img.data, img.width, img.height, { inversionAttempts:'dontInvert' });
          if (hit && hit.data) onChunk(hit.data);
        } catch (e){ onErr && onErr(e); }
      }
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true; cancelAnimationFrame(raf);
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    };
  }

  /* ── 4. cloud sync (Firebase RTDB REST + AES-GCM) ──── */
  const CFG_KEY = 'mynotes.cloud';
  const cloudCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch(_){ return null; } };
  const saveCloudCfg = c => localStorage.setItem(CFG_KEY, JSON.stringify(c));
  const clearCloudCfg = () => localStorage.removeItem(CFG_KEY);

  function endpoint(cfg){
    let u = String(cfg.dbUrl || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(u)) throw new Error('The database URL must start with https://');
    const key = encodeURIComponent(String(cfg.syncKey || '').trim());
    if (!key) throw new Error('Pick a sync name first.');
    return `${u}/mynotes/${key}.json`;
  }

  async function cloudPush(cfg, onProgress){
    onProgress && onProgress('Packing notes…');
    const payload = await buildBackup({ includeFiles:true });
    onProgress && onProgress('Encrypting…');
    const armoured = await encrypt(JSON.stringify(payload), cfg.pass);
    onProgress && onProgress('Uploading…');
    const r = await fetch(endpoint(cfg), {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ v:1, at:Date.now(), device:deviceName(), blob:armoured }),
    });
    if (!r.ok) throw new Error(cloudErr(r.status));
    return payload.notes.length;
  }

  async function cloudPull(cfg, mode, onProgress){
    onProgress && onProgress('Downloading…');
    const r = await fetch(endpoint(cfg), { cache:'no-store' });
    if (!r.ok) throw new Error(cloudErr(r.status));
    const wrap = await r.json();
    if (!wrap || !wrap.blob) throw new Error('Nothing has been synced to that name yet.');
    onProgress && onProgress('Decrypting…');
    let json;
    try { json = await decrypt(wrap.blob, cfg.pass); }
    catch(e){ throw new Error('Wrong passphrase for this sync name.'); }
    onProgress && onProgress('Merging…');
    const stats = await applyBackup(JSON.parse(json), mode || 'merge');
    return { stats, at:wrap.at, device:wrap.device };
  }

  async function cloudInfo(cfg){
    const r = await fetch(endpoint(cfg) + '?shallow=true', { cache:'no-store' });
    if (!r.ok) throw new Error(cloudErr(r.status));
    const j = await r.json();
    return j ? true : false;
  }

  function cloudErr(status){
    if (status === 401 || status === 403)
      return 'The database rejected the request (401/403). Check the database rules allow reads and writes.';
    if (status === 404) return 'That database URL was not found (404). Check the URL.';
    return 'Sync failed (HTTP ' + status + ').';
  }

  /* ── crypto ────────────────────────────────────────── */
  async function keyFrom(pass, salt){
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass),
      'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations:150000, hash:'SHA-256' },
      base, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  }
  async function encrypt(text, pass){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await keyFrom(pass, salt);
    const ct   = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key,
      new TextEncoder().encode(text));
    return [b64(salt), b64(iv), b64(new Uint8Array(ct))].join('.');
  }
  async function decrypt(armoured, pass){
    const [s, i, c] = String(armoured).split('.');
    const key = await keyFrom(pass, unb64(s));
    const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:unb64(i) }, key, unb64(c));
    return new TextDecoder().decode(pt);
  }

  /* ── compression + base64 ──────────────────────────── */
  async function gzip(str){
    const bytes = new TextEncoder().encode(str);
    if (typeof CompressionStream === 'undefined') return 'r' + b64(bytes);
    const cs = new CompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
    return 'z' + b64(new Uint8Array(buf));
  }
  async function gunzip(packed){
    const flag = packed[0], body = unb64(packed.slice(1));
    if (flag === 'r') return new TextDecoder().decode(body);
    if (typeof DecompressionStream === 'undefined')
      throw new Error('This browser cannot unpack that code.');
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([body]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buf));
  }

  function b64(u8){
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s){
    const bin = atob(String(s).trim());
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  const blobToB64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });
  const b64ToBlob = (data, type) => new Blob([unb64(data)], { type: type || 'application/octet-stream' });

  function downloadBlob(blob, name){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function deviceName(){
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android phone';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'This device';
  }

  return { buildBackup, applyBackup, exportFile, readFile,
           makeCode, readCode, chunkCode, parseChunk, renderQR, startScan,
           cloudCfg, saveCloudCfg, clearCloudCfg, cloudPush, cloudPull, cloudInfo,
           downloadBlob, blobToB64, deviceName };
})();
