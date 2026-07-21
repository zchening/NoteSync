// NoteSync Service Worker - 缓存 index.html 供离线打开
const CACHE = 'notesync-v1';
const ASSETS = ['/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 只缓存同源 GET 请求
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API 请求不缓存
  if (url.pathname.startsWith('/api/')) return;
  // index.html：网络优先，失败回退缓存
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('/index.html', copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('/index.html').then(r => r || new Response('', { status: 503 })))
    );
    return;
  }
  // 其他静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/index.html')))
  );
});
