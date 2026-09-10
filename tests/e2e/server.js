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
  const HIST = {}; // v8.0.5 桩内 history 存储（进程级，重启即清空）
  const server = http.createServer((req, res) => {
    const raw = req.url || '/';
    const p = raw.split('?')[0];

    // v8.0.5：e2e 桩补 history 环——响应形与 server.js 对齐（list {ts,v,manual,size} / 单条 {ts,ct,iv} /
    // PUT 追加与按 ts 覆写），M4 历史二级页全链实测依赖；其余 /api/* 行为原样返回 {} 不变。
    if (p.startsWith('/api/note/') && p.includes('/history')) {
      const hm = p.match(/^\/api\/note\/([^/]+)\/history(?:\/(\d+))?$/);
      if (hm) {
        let id; try { id = decodeURIComponent(hm[1]); } catch (e) { id = ''; }
        const ring = (HIST[id] = HIST[id] || []);
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          if (hm[2]) { const it = ring.find(x => String(x.ts) === hm[2]); res.end(it ? JSON.stringify({ ts: it.ts, ct: it.ct, iv: it.iv }) : '{}'); return; }
          res.end(JSON.stringify({ list: ring.map((x, i) => ({ ts: x.ts, v: i + 1, manual: !!x.manual, size: (x.ct || '').length })) })); return;
        }
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', c => { body += c; if (body.length > 2048 * 1024) req.destroy(); });
          req.on('end', () => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
            if (hm[2]) { const it = ring.find(x => String(x.ts) === hm[2]); if (it) { it.ct = b.ct || it.ct; it.iv = b.iv || it.iv; } }
            else ring.push({ ts: Date.now(), manual: !!b.manual, ct: b.ct || '', iv: b.iv || '' });
            res.end('{"ok":1}');
          });
          return;
        }
      }
    }
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

    // v7.5.1：懒加载库占位——e2e 不真引入 ~199KB html2canvas/jsQR。返回合法 JS（故意不定义全局），
    // 使 loadHtml2Canvas()/loadJsQR() 走「加载成功但库缺失 → 优雅降级」路径；
    // 否则会被下面 SPA 回退成 index.html(text/html)，作为经典 <script> 执行报 SyntaxError 污染 pageerror，令 V529 等用例非确定红。
    if (p === '/html2canvas.min.js' || p === '/jsQR.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end('/*e2e stub: ' + p + ' intentionally undefined*/');
      return;
    }

    // SPA 回退：任何非 api、非已知静态文件的路径都返回 index.html，
    // 让 '/<noteName>' 等笔记路径在刷新/直达时也能正确加载应用。
    sendFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

module.exports = { startServer };
