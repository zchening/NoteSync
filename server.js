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

// noteId 校验：仅允许英文/数字（前端已禁止中文输入，后端同步收紧），1-64 字符
const ID_RE = /^[A-Za-z0-9]{1,64}$/;

// --- 限流参数 ---
const FAIL_LIMIT = 10;                   // 失败阈值
const FAIL_WINDOW = 10 * 60 * 1000;      // 计数窗口 10 分钟
const LOCK_DURATION = 30 * 60 * 1000;    // 锁定 30 分钟
// Map<key, { count, firstFail, lockedAt }>
const failMap = new Map();

function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
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
    if (!sseClients.has(id)) sseClients.set(id, new Set());
    sseClients.get(id).add(res);
    // SSE 心跳：每 15 秒发送 ping，防止代理/运营商中断长连接
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); }
    }, 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      const clients = sseClients.get(id);
      if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(id); }
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
      const next = { v: (cur.v || 0) + 1, ct: obj.ct, iv: obj.iv, salt: obj.salt, updatedAt: Date.now() };
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
    if (url === '/icon-maskable-192.png') {
      const f = path.join(APP_DIR, 'icon-maskable-192.png');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    if (url === '/icon-maskable-512.png') {
      const f = path.join(APP_DIR, 'icon-maskable-512.png');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
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
