// NoteSync Service Worker - 缓存 index.html 供离线打开
// v5.35：缓存名由注册 URL 的 ?v= 参数（= index.html 的 APP_VERSION）驱动——
// 版本号单一来源，发版即换名、activate 清理旧名，杜绝旧版「CACHE 硬编码 notesync-v1、
// 发版后离线用户永远拿旧壳」的隐患。
const VER = (new URL(self.location.href).searchParams.get('v')) || 'x';
const CACHE = 'notesync-' + VER;
const ASSETS = ['/index.html', '/manifest.json', '/favicon.svg'];

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
  if (e.request.method !== 'GET') return;
  // html2canvas（CDN 版本固定 1.4.1）：内容不变，cache-first —— 离线时「导出为图片」不再失效。
  // <script> 标签加载为 no-cors 请求，缓存的是 opaque response（状态 0），可整体缓存与命中。
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('html2canvas')) {
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
  // index.html：网络优先，失败回退缓存（在线时顺带刷新缓存）
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
