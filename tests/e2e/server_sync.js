// 同步专用 E2E 服务器：真实内存笔记存储 + SSE 广播，服务于真实 index.html。
// 与共享 server.js（/api/* 返回 {} 桩）区分，用于验证两端自动同步。
// 支持 disableSSE：关闭 SSE 端点，用以证明“仅靠无条件轮询基线也能自愈”（v5.17 核心修复）。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // notesync 仓库根（含 index.html）
const INDEX = path.join(ROOT, 'index.html');

const EMPTY = { v: 0, ct: '', iv: '', salt: '', updatedAt: 0 };
const ID_RE = /^[A-Za-z0-9]{1,64}$/;
const notes = new Map();
const sseClients = new Map();

function readNote(id) { return notes.get(id) || { ...EMPTY }; }
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function sseBroadcast(id, data) {
  const cs = sseClients.get(id);
  if (!cs) return;
  const msg = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const res of cs) { try { res.write(msg); } catch (e) {} }
}

function startServer(opts = {}) {
  const disableSSE = !!opts.disableSSE;
  const server = http.createServer((req, res) => {
    const raw = req.url || '/';
    const url = raw.split('?')[0];

    // SSE 流
    if (req.method === 'GET' && url.startsWith('/api/note/') && url.endsWith('/stream')) {
      if (disableSSE) { res.writeHead(404); res.end('sse disabled'); return; }
      const id = decodeURIComponent(url.replace(/\/stream$/, '').replace(/^\/api\/note\//, ''));
      if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      if (!sseClients.has(id)) sseClients.set(id, new Set());
      sseClients.get(id).add(res);
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { clearInterval(hb); } }, 15000);
      req.on('close', () => {
        clearInterval(hb);
        const cs = sseClients.get(id);
        if (cs) { cs.delete(res); if (cs.size === 0) sseClients.delete(id); }
      });
      return;
    }

    // 读取
    if (req.method === 'GET' && url.startsWith('/api/note/')) {
      const id = decodeURIComponent(url.replace(/^\/api\/note\//, ''));
      if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
      return sendJSON(res, 200, readNote(id));
    }

    // 写入
    if (req.method === 'PUT' && url.startsWith('/api/note/')) {
      const id = decodeURIComponent(url.replace(/^\/api\/note\//, ''));
      if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        let obj;
        try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
        if (!obj || typeof obj.ct !== 'string' || typeof obj.iv !== 'string' || typeof obj.salt !== 'string') {
          return sendJSON(res, 400, { error: 'missing fields' });
        }
        const cur = readNote(id);
        const next = { v: (cur.v || 0) + 1, ct: obj.ct, iv: obj.iv, salt: obj.salt, updatedAt: Date.now() };
        notes.set(id, next);
        sseBroadcast(id, { v: next.v, updatedAt: next.updatedAt });
        return sendJSON(res, 200, { ok: true, v: next.v, updatedAt: next.updatedAt });
      });
      return;
    }

    if (req.method === 'POST' && url.startsWith('/api/fail/')) return sendJSON(res, 200, { locked: false, count: 0 });
    if (req.method === 'GET' && url === '/healthz') { res.writeHead(200); res.end('ok'); return; }

    // SPA 回退 / 静态
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      try { res.end(fs.readFileSync(INDEX)); } catch { res.statusCode = 404; res.end(''); }
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

module.exports = { startServer };
