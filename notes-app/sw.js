/* Service worker — offline shell for My Notes */
const VERSION = 'my-notes-v1';
const SHELL = [
  './', './index.html', './manifest.json',
  './css/app.css',
  './js/db.js', './js/editor.js', './js/transfer.js', './js/app.js',
  './js/vendor/qrcode.min.js', './js/vendor/jsQR.min.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-180.png', './icons/favicon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch sync uploads
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // cloud sync goes straight to the network

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit){
        /* refresh in the background so updates land next launch */
        fetch(req).then(res => {
          if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req)
        .then(res => {
          if (res && res.ok && res.type === 'basic')
            caches.open(VERSION).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

/* tapping a reminder notification opens the note */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for (const c of list){ c.focus(); if (id) c.postMessage({ open:id }); return; }
      return self.clients.openWindow('./index.html');
    })
  );
});
