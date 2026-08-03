// 极简静态服务器：服务于 index.html（及 /api/* 桩）+ SPA 回退 + PWA 静态资源。
// 让 E2E 在真实浏览器里加载真实代码。
// 用根路径 '/' 访问 -> noteId 为空 -> init() 走 landing 分支，不触发任何 fetch/SSE。
// 访问 '/<noteName>' -> SPA 回退返回 index.html，init() 解码 noteId 走笔记路径。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // notesync 仓库根（含 index.html）

// 已知静态资源（不带查询串匹配）。均 no-cache。
const STATIC = {
  '/manifest.json': { file: 'manifest.json', type: 'application/json' },
  '/favicon.svg': { file: 'favicon.svg', type: 'image/svg+xml' },
  '/icon-maskable-192.png': { file: 'icon-maskable-192.png', type: 'image/png' },
  '/icon-maskable-512.png': { file: 'icon-maskable-512.png', type: 'image/png' },
  '/sw.js': { file: 'sw.js', type: 'application/javascript' },
};

function sendFile(res, filePath, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-cache');
  try {
    res.end(fs.readFileSync(filePath));
  } catch {
    res.statusCode = 404;
    res.end('');
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const raw = req.url || '/';
    const p = raw.split('?')[0];

    // API 桩：任何 /api/* 都返回 {}
    if (p.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
      return;
    }

    // 首页
    if (p === '/' || p === '/index.html') {
      sendFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    // 已知静态资源
    if (STATIC[p]) {
      const s = STATIC[p];
      sendFile(res, path.join(ROOT, s.file), s.type);
      return;
    }

    // SPA 回退：任何非 api、非已知静态文件的路径都返回 index.html，
    // 让 '/<noteName>' 等笔记路径在刷新/直达时也能正确加载应用。
    sendFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

module.exports = { startServer };
