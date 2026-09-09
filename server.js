'use strict';
// NoteSync — 极简端到端加密便签后端（多笔记 + 限流，零依赖 Node.js）
// 只做一件事：按 URL 路径存/取多段密文。所有加解密都在浏览器完成，服务器从不见明文、不见口令、不见密钥。

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const NOTES_DIR = path.join(DATA_DIR, 'notes');
const INDEX_FILE = path.join(APP_DIR, 'index.html');

if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });

const EMPTY = { v: 0, ct: '', iv: '', salt: '', updatedAt: 0 };

// noteId 校验：英文/数字/下划线/短横线，1-64 字符（v5.19 恢复 _ 与 -：
// v5.15 为禁中文收紧成纯字母数字，误伤了早期带 _/- 的旧笔记；中文仍被拒绝）
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// --- 限流参数 ---
const FAIL_LIMIT = 10;                   // 失败阈值
const FAIL_WINDOW = 10 * 60 * 1000;      // 计数窗口 10 分钟
const LOCK_DURATION = 30 * 60 * 1000;    // 锁定 30 分钟
// Map<key, { count, firstFail, lockedAt }>
const failMap = new Map();

function getClientIP(req) {
  // v5.52：Caddy 反代把真实客户端 IP 追加在 XFF 末尾，首段是客户端可伪造的。
  // 取首段等于任何人都能靠轮换 XFF 头绕过失败锁定，必须取末段。
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function checkLimit(ip, noteId) {
  const key = ip + ':' + noteId;
  const now = Date.now();
  const rec = failMap.get(key);
  if (rec && rec.lockedAt) {
    if (now - rec.lockedAt < LOCK_DURATION) {
      return { locked: true, retryAfter: Math.ceil((LOCK_DURATION - (now - rec.lockedAt)) / 1000) };
    } else {
      failMap.delete(key); // 锁定过期，清除
    }
  }
  return { locked: false };
}

function recordFail(ip, noteId) {
  const key = ip + ':' + noteId;
  const now = Date.now();
  let rec = failMap.get(key);
  // 已锁定，直接返回
  if (rec && rec.lockedAt) {
    return checkLimit(ip, noteId);
  }
  // 无记录或窗口过期，重置
  if (!rec || (now - rec.firstFail > FAIL_WINDOW)) {
    rec = { count: 0, firstFail: now, lockedAt: null };
  }
  rec.count++;
  if (rec.count >= FAIL_LIMIT) {
    rec.lockedAt = now;
  }
  failMap.set(key, rec);
  return checkLimit(ip, noteId);
}

// 定期清理过期记录（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of failMap) {
    if (rec.lockedAt) {
      if (now - rec.lockedAt >= LOCK_DURATION) failMap.delete(key);
    } else if (now - rec.firstFail >= FAIL_WINDOW) {
      failMap.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// --- SSE 推送 ---
// Map<noteId, Set<res>> 存所有 SSE 连接
const sseClients = new Map();
let sseActive = 0;                  // v5.52：当前活跃 SSE 连接数
const MAX_SSE = 2000;               // 上限，超出返回 429

function sseBroadcast(noteId, data) {
  const clients = sseClients.get(noteId);
  if (!clients) return;
  const msg = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) {
    try { res.write(msg); } catch (e) {}
  }
}

function notePath(id) {
  return path.join(NOTES_DIR, id + '.json');
}

function readNote(id) {
  try {
    return JSON.parse(fs.readFileSync(notePath(id), 'utf8'));
  } catch {
    return { ...EMPTY };
  }
}

function writeNote(id, obj) {
  const tmp = notePath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, notePath(id));
}

// v6.0：历史版本快照环——FIFO 上限 HISTORY_MAX 条，独立文件 <id>.hist.json。
// 只存密文（零知识不变）；手动打点不参与挤出（优先挤自动），相同密文不重复入栈。
const HISTORY_MAX = 10;
function histPath(id) { return path.join(NOTES_DIR, id + '.hist.json'); }
function readHist(id) {
  try {
    const h = JSON.parse(fs.readFileSync(histPath(id), 'utf8'));
    if (h && Array.isArray(h.list)) return h;
  } catch {}
  return { list: [] };
}
function writeHist(id, h) {
  const tmp = histPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(h));
  fs.renameSync(tmp, histPath(id));
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function extractId(url, prefix) {
  // /api/note/abc123 → abc123（路径段可能含中文等，需先 decodeURIComponent）
  const m = url.match(new RegExp('^' + prefix + '/([^/]+)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const ip = getClientIP(req);

  // --- API: SSE 流 ---
  if (req.method === 'GET' && url.startsWith('/api/note/') && url.endsWith('/stream')) {
    const id = decodeURIComponent(url.replace(/\/stream$/, '').replace(/^\/api\/note\//, ''));
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    // v5.52：全局连接上限，防恶意客户端开大量长连接耗尽 fd / 内存
    if (sseActive >= MAX_SSE) return sendJSON(res, 429, { error: 'too many streams' });
    if (!sseClients.has(id)) sseClients.set(id, new Set());
    sseClients.get(id).add(res);
    sseActive++;
    // SSE 心跳：每 15 秒发送 ping，防止代理/运营商中断长连接
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); }
    }, 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      if (sseActive > 0) sseActive--;
      const clients = sseClients.get(id);
      if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(id); }
    });
    return;
  }

  // --- API: 历史版本（v6.0，必须先于主 /api/note/ 分支——ID_RE 不含斜杠，放后面会被主分支吃掉）---
  // GET  /api/note/:id/history      → 元数据列表（ts/v/manual/size，不含密文，省流量）
  // GET  /api/note/:id/history/:ts  → 单条密文（预览/恢复时才取）
  // PUT  /api/note/:id/history      → 追加快照 {ct, iv, manual}
  if (req.method === 'GET' && url.startsWith('/api/note/') && url.includes('/history')) {
    const m = url.match(/^\/api\/note\/([^/]+)\/history(?:\/(\d+))?$/);
    if (!m) return sendJSON(res, 404, { error: 'not found' });
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return sendJSON(res, 400, { error: 'bad id' }); }
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    const hist = readHist(id);
    if (m[2]) {
      const item = hist.list.find(x => String(x.ts) === m[2]);
      if (!item) return sendJSON(res, 404, { error: 'no such snapshot' });
      return sendJSON(res, 200, { ts: item.ts, ct: item.ct, iv: item.iv });
    }
    return sendJSON(res, 200, { list: hist.list.map(x => ({ ts: x.ts, v: x.v, manual: !!x.manual, size: (x.ct || '').length })) });
  }
  // v6.3：PUT /api/note/:id/history/:ts —— 按 ts 覆写单条快照的密文。
  // 用途：改口令时前端把历史快照逐条「旧钥解→新钥重加」写回，历史不再因换钥集体失效。
  // 只允许替换 ct/iv，ts/v/manual 原样保留——换钥不改变历史的时序语义。
  if (req.method === 'PUT' && /^\/api\/note\/[^/]+\/history\/\d+$/.test(url)) {
    const m = url.match(/^\/api\/note\/([^/]+)\/history\/(\d+)$/);
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return sendJSON(res, 400, { error: 'bad id' }); }
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!obj || typeof obj.ct !== 'string' || !obj.ct || typeof obj.iv !== 'string' || !obj.iv) {
        return sendJSON(res, 400, { error: 'missing fields' });
      }
      const hist = readHist(id);
      const item = hist.list.find(x => String(x.ts) === m[2]);
      if (!item) return sendJSON(res, 404, { error: 'no such snapshot' });
      item.ct = obj.ct;
      item.iv = obj.iv;
      writeHist(id, hist);
      return sendJSON(res, 200, { ok: true, ts: item.ts });
    });
    return;
  }
  if (req.method === 'PUT' && url.startsWith('/api/note/') && url.endsWith('/history')) {
    let id;
    try { id = decodeURIComponent(url.slice('/api/note/'.length, -'/history'.length)); } catch { return sendJSON(res, 400, { error: 'bad id' }); }
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!obj || typeof obj.ct !== 'string' || !obj.ct || typeof obj.iv !== 'string' || !obj.iv) {
        return sendJSON(res, 400, { error: 'missing fields' });
      }
      const cur = readNote(id);
      const hist = readHist(id);
      let ts = Date.now();
      while (hist.list.some(x => x.ts === ts)) ts++; // v6.0：同毫秒去重，否则 GET /:ts 永远只命中第一条
      const item = { ts: ts, v: cur.v || 0, ct: obj.ct, iv: obj.iv, manual: !!obj.manual };
      const last = hist.list[hist.list.length - 1];
      if (!last || last.ct !== item.ct || last.iv !== item.iv) {
        hist.list.push(item);
        while (hist.list.length > HISTORY_MAX) {
          let idx = hist.list.findIndex(x => !x.manual); // 手动打点优先保留，先挤自动
          if (idx === -1) idx = 0;
          hist.list.splice(idx, 1);
        }
        writeHist(id, hist);
      }
      return sendJSON(res, 200, { ok: true, ts: item.ts, count: hist.list.length });
    });
    return;
  }

  // --- API: 读取笔记 ---
  if (req.method === 'GET' && url.startsWith('/api/note/')) {
    const id = extractId(url, '/api/note');
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    return sendJSON(res, 200, readNote(id));
  }

  // --- API: 写入笔记 ---
  if (req.method === 'PUT' && url.startsWith('/api/note/')) {
    const id = extractId(url, '/api/note');
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!obj || typeof obj.ct !== 'string' || typeof obj.iv !== 'string' || typeof obj.salt !== 'string') {
        return sendJSON(res, 400, { error: 'missing fields' });
      }
      const cur = readNote(id);
      // v6.3：opt-in 乐观并发控制——写入带 baseV 时，版本不符返回 409（附当前 v），
      // 客户端重读-改-重写；v7.2.0 起 web 端也带 baseV（baseV=localVer），
      // 不带 baseV 的旧客户端行为完全不变（不破坏任何现有客户端）。
      if (typeof obj.baseV === 'number' && (cur.v || 0) !== obj.baseV) {
        return sendJSON(res, 409, { error: 'version conflict', v: cur.v || 0 });
      }
      // v5.36 提醒字段（rem）：与正文同为密文，服务端零知识不变。
      // 客户端显式传 rem（含 null=取消提醒）时采用之；未传（普通正文保存）时保留原值——
      // 否则任何一台设备的正文保存都会抹掉另一台设备刚设的提醒。
      let rem = cur.rem || null;
      if (obj.rem !== undefined) rem = obj.rem; // null 也是显式意图（取消提醒）
      // v5.58 空盐不覆写（数据级止血）：客户端 serverSalt 为空时 bufToB64(null) 产出空串，
      // 此前服务端无条件采用 obj.salt → 笔记盐被冲成 '' → 下次解锁走随机盐推导 →
      // 正确口令恒定「解密失败」。空值一律保留原盐，盐只由首次初始化写入。
      const saltIn = (typeof obj.salt === 'string' && obj.salt) ? obj.salt : (cur.salt || '');
      // v6.0：空 ct/iv 不覆写（与 v5.58 空盐同理）。旧版客户端落盐时硬发 ct:''/iv:''，
      // 会把并发端刚写入的正文清空——这是数据级破坏，服务端必须无条件兜住（线上仍有旧版在跑）。
      // 真实「清空笔记」经 AES-GCM 后 ct 仍含 16 字节 tag，不为空串，故此保护不会误伤。
      const ctIn = (typeof obj.ct === 'string' && obj.ct) ? obj.ct : (cur.ct || '');
      const ivIn = (typeof obj.iv === 'string' && obj.iv) ? obj.iv : (cur.iv || '');
      const next = { v: (cur.v || 0) + 1, ct: ctIn, iv: ivIn, salt: saltIn, rem: rem, updatedAt: Date.now() };
      writeNote(id, next);
      sseBroadcast(id, { v: next.v, updatedAt: next.updatedAt });
      return sendJSON(res, 200, { ok: true, v: next.v, updatedAt: next.updatedAt });
    });
    return;
  }

  // --- API: 上报解密失败 ---
  if (req.method === 'POST' && url.startsWith('/api/fail/')) {
    const id = extractId(url, '/api/fail');
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    // v5.52：强制要求 JSON content-type，逼浏览器发预检。
    // 否则这是个 simple 请求，任意恶意网页都能连发 10 次锁死别人的笔记，
    // 而 CORS 白名单对 simple 请求无效（预检才拦得住）。
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return sendJSON(res, 400, { error: 'bad content-type' });
    const limit = recordFail(ip, id);
    if (limit.locked) return sendJSON(res, 429, { locked: true, retryAfter: limit.retryAfter });
    const rec = failMap.get(ip + ':' + id);
    return sendJSON(res, 200, { locked: false, count: rec ? rec.count : 0 });
  }

  // --- 健康检查 ---
  if (req.method === 'GET' && url === '/healthz') {
    res.writeHead(200); res.end('ok'); return;
  }

  // --- 静态文件 ---
  if (req.method === 'GET' && !url.startsWith('/api/')) {
    // manifest.json 和 sw.js 返回对应文件
    if (url === '/manifest.json') {
      const f = path.join(APP_DIR, 'manifest.json');
      if (fs.existsSync(f)) {
        // 支持 ?start=/noteId 参数，动态设置 start_url 让每个笔记的快捷方式打开正确页面
        const query = req.url.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const start = params.get('start') || '/';
        let manifest = JSON.parse(fs.readFileSync(f, 'utf8'));
        manifest.start_url = encodeURI(start);
        manifest.id = start;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        res.end(JSON.stringify(manifest));
        return;
      }
    }
    if (url === '/sw.js') {
      const f = path.join(APP_DIR, 'sw.js');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    if (url === '/favicon.svg') {
      const f = path.join(APP_DIR, 'favicon.svg');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v6.0：jsQR 纯 JS 解码库（扫码兜底）——桌面 Chrome/Edge 与 iOS Safari 无 BarcodeDetector 时动态加载。
    // 独立文件不内联进 index.html：127KB 只在真正扫码时才拉一次（immutable 缓存）。
    if (url === '/jsQR.js') {
      const f = path.join(APP_DIR, 'jsQR.js');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v7.5.1：html2canvas 自托管（导出图片用）——替代公共 CDN jsdelivr（大陆常不可达→「图片导出组件未加载」）。
    // 独立文件不内联进 index.html：约 199KB 只在点导出时懒加载一次（immutable 缓存，离线经 SW cache-first 兜底）。
    if (url === '/html2canvas.min.js') {
      const f = path.join(APP_DIR, 'html2canvas.min.js');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v6.3：MCP 工具公开下载（零知识不破——这两个文件不含任何秘密，口令走调用端 env）。
    // 新机器接入：curl 拿 setup 脚本 → 跑一条命令自动写 mcp.json，免 clone 免手工配置。
    // 精确文件名白名单（url 完全匹配才命中），无路径穿越面；no-cache 保证拿到最新版。
    if (url === '/mcp/notesync-mcp-server.js' || url === '/mcp/setup-notesync-mcp.js') {
      const f = path.join(APP_DIR, 'tools', url.split('/').pop());
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    if (url === '/bridge.html') {
      const f = path.join(APP_DIR, 'bridge.html');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // SPA：其他都返回 index.html（必须 no-cache 防止移动端浏览器缓存旧版）
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    fs.createReadStream(INDEX_FILE).pipe(res);
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log('[notesync] listening on :' + PORT));
