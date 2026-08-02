// 极简静态服务器：只服务于 index.html（及 /api/* 桩），让 E2E 在真实浏览器里加载真实代码。
// 用根路径 '/' 访问 -> noteId 为空 -> init() 走 landing 分支，不触发任何 fetch/SSE。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // notesync 仓库根（含 index.html）

function startServer() {
  const server = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];
    if (p === '/' || p === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(ROOT, 'index.html')));
      return;
    }
    if (p.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
      return;
    }
    res.statusCode = 404;
    res.end('');
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

module.exports = { startServer };
