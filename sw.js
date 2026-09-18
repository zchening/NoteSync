// NoteSync Service Worker - 缓存 index.html 供离线打开
// v5.35：缓存名由注册 URL 的 ?v= 参数（= index.html 的 APP_VERSION）驱动——
// 版本号单一来源，发版即换名、activate 清理旧名，根治旧版缓存名硬编码、
// 发版后离线用户永远拿旧壳的隐患。
const VER = (new URL(self.location.href).searchParams.get('v')) || 'x';
const CACHE = 'notesync-' + VER;
const ASSETS = ['/index.html', '/manifest.json', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/apple-touch-icon.png']; // v7.9.0：+品牌图标三件（离线安装横幅/加桌面用）

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

// v5.36 提醒：点击通知聚焦已打开的笔记，没有则打开
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.focus) return c.focus(); }
    return clients.openWindow('/');
  }));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // v7.5.1：html2canvas 改为同源 /html2canvas.min.js（懒加载，点导出时才拉）。cache-first ——
  // 首次联网导出后即纳入缓存，之后离线「导出为图片」不再失效。同源普通响应（非 opaque），可整块缓存命中。
  if (url.pathname === '/html2canvas.min.js') {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return resp;
      }))
    );
    return;
  }
  // 只缓存同源 GET 请求
  if (url.origin !== self.location.origin) return;
  // API 请求不缓存
  if (url.pathname.startsWith('/api/')) return;
  // v9.5.5：网络分支统一 10s AbortController 超时——半死 keep-alive socket 下 fetch 永不 reject，
  // respondWith 无限挂起=冷启纯白屏（连「加载中」都不出）；笔记路由走下方 cache-first 分支的 fetch 同理。
  // 超时 abort 后按各自原兜底落缓存，白屏最长 10 秒必破。
  function fetchTO(req, ms) {
    var c = new AbortController();
    var t = setTimeout(function () { try { c.abort(); } catch (e) {} }, ms);
    return fetch(req, { signal: c.signal }).finally(function () { clearTimeout(t); });
  }
  // index.html：网络优先（10s 超时），失败/超时回退缓存（在线时顺带刷新缓存）
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetchTO(e.request, 10000).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('/index.html', copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('/index.html').then(r => r || new Response('', { status: 503 })))
    );
    return;
  }
  // 其他静态资源：缓存优先，网络兜底同样 10s 超时
  e.respondWith(
    caches.match(e.request).then(r => r || fetchTO(e.request, 10000).catch(() => caches.match('/index.html')))
  );
});
