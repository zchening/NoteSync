// NoteSync 服务端集成测试（针对真实 server.js）
// 验证 Bug 1（笔记名仅允英文数字 / ID 校验收紧）与 Bug 4（maskable 图标 + 黑色 favicon 静态路由）。
// 约定：spawn 真实 server.js 子进程于测试端口，等待 "listening on" 行后跑测试，after() 杀掉子进程。
// 只创建本测试文件并运行；不修改任何应用代码或其它测试。
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');

// 用当前运行时的 node 绝对路径（受管 node 版本目录会带后缀漂移，如 22.22.2 → 22.22.2-2，硬编码必挂）
const NODE = process.execPath;
const REPO = path.join(__dirname, '..', '..');
const SERVER = path.join(REPO, 'server.js');
const PORT = '8137';
const BASE = 'http://localhost:' + PORT;

let child;
let serverReady;

before(async () => {
  serverReady = new Promise((resolve, reject) => {
    child = spawn(NODE, [SERVER], {
      cwd: REPO,
      env: { ...process.env, PORT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const onOut = (d) => {
      const s = d.toString();
      if (!started && s.includes('[notesync] listening on :' + PORT)) {
        started = true;
        resolve();
      }
    };
    child.stdout.on('data', onOut);
    child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    child.on('error', (e) => reject(e));
    child.on('exit', (code) => { if (!started) reject(new Error('server exited early, code=' + code)); });
    setTimeout(() => { if (!started) reject(new Error('server did not start within 10s')); }, 10000);
  });
  await serverReady;
});

after(() => {
  if (child) child.kill('SIGKILL');
});

// --- Bug 1: 中文笔记名 PUT 应被 bad id 拒绝（笔记名仅允英文数字）---
test('Bug1 PUT /api/note/<中文名> 应被 400 bad id 拒绝', async () => {
  const name = encodeURIComponent('我的笔记');
  const res = await fetch(`${BASE}/api/note/${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ct: '', iv: '', salt: '' }),
  });
  assert.strictEqual(res.status, 400, '中文名应被拒绝');
  const b = await res.json().catch(() => null);
  assert.strictEqual(b && b.error, 'bad id', '错误应为 bad id');
});

// --- Bug 1: 名称中的斜杠应被拒（bad id）---
test('Bug1 GET /api/note/a%2Fb（含斜杠）返回 400 bad id', async () => {
  const res = await fetch(`${BASE}/api/note/a%2Fb`);
  assert.strictEqual(res.status, 400);
  const b = await res.json();
  assert.strictEqual(b.error, 'bad id');
});

// --- Bug 1: 控制字符应被拒 ---
test('Bug1 GET /api/note/%00（控制字符）返回 400', async () => {
  const res = await fetch(`${BASE}/api/note/%00`);
  assert.strictEqual(res.status, 400);
});

// --- v5.19: 恢复 _ 与 - 的笔记名支持（v5.15 收紧时误伤的旧笔记名重新可用）---
test('v5.19 GET /api/note/ab-c 与 my_note 带 -/_ 的笔记名应被接受（200）', async () => {
  const r1 = await fetch(`${BASE}/api/note/ab-c`);
  assert.strictEqual(r1.status, 200, '带短横线的笔记名应被接受');
  const r2 = await fetch(`${BASE}/api/note/my_note`);
  assert.strictEqual(r2.status, 200, '带下划线的笔记名应被接受');
});

// --- Bug 1: SSE /stream 的 id 也需通过收紧后的校验 → 中文应 400 ---
test('Bug1 GET /api/note/<中文名>/stream 应返回 400 bad id', async () => {
  const name = encodeURIComponent('我的笔记');
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/note/${name}/stream`, { signal: ac.signal });
  assert.strictEqual(res.status, 400, '中文名 SSE 也应被拒绝');
  ac.abort(); // 立即断开，避免悬挂长连接
});

// --- v7.9.0（原 Bug4）：manifest 图标清单——favicon.svg maskable 条目保留 + icon-512 maskable PNG 上线 ---
test('v7.9.0 GET /manifest.json：favicon.svg maskable 条目 + icon-512 maskable PNG', async () => {
  const res = await fetch(`${BASE}/manifest.json`);
  assert.strictEqual(res.status, 200);
  const m = await res.json();
  const icons = Array.isArray(m.icons) ? m.icons : [];
  const faviconMaskable = icons.find(
    (i) => (i.src || '').includes('favicon.svg') && (i.purpose || '').includes('maskable')
  );
  assert.ok(faviconMaskable, 'manifest 缺少 favicon.svg 的 maskable 条目；icons=' + JSON.stringify(icons));
  const png512 = icons.find(
    (i) => (i.src || '').includes('icon-512.png') && (i.purpose || '').split(/\s+/).includes('maskable')
  );
  assert.ok(png512, 'v7.9.0 manifest 应含 icon-512.png 的 maskable 条目；icons=' + JSON.stringify(icons));
  assert.ok(String(m.theme_color).toUpperCase() === '#FBFBF8', 'theme_color 应为纸白 #FBFBF8（蓝色遗留已清）');
  assert.ok(String(m.background_color).toUpperCase() === '#FBFBF8', 'background_color 应为纸白 #FBFBF8');
});

// --- v7.9.0：品牌 PNG 三件静态路由（apple-touch / icons）+ 路径穿越防护 ---
test('v7.9.0 品牌图标路由：200 + PNG 魔数；穿越路径不得命中白名单', async () => {
  for (const u of ['/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png']) {
    const res = await fetch(BASE + u);
    assert.strictEqual(res.status, 200, u + ' 应 200');
    assert.ok((res.headers.get('content-type') || '').includes('image/png'), u + ' 应为 image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000, u + ' 应有实际内容');
    assert.ok(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, u + ' 应为 PNG 魔数');
  }
  const trav = await fetch(`${BASE}/icons/not-in-whitelist.png`);
  const ct = trav.headers.get('content-type') || '';
  assert.ok(!ct.includes('image/'), '白名单外路径不得命中品牌静态路由（精确匹配，穿越面为零）');
});

// --- Bug 4: favicon.svg 透明金 logo（无黑色背景）---
test('Bug4 GET /favicon.svg → 200 且为透明金 logo（无 fill="#0F0F11"）', async () => {
  const res = await fetch(`${BASE}/favicon.svg`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('stroke="#8F7126"'), 'favicon 缺少金色描边 #8F7126');
  assert.ok(!text.includes('fill="#0F0F11"'), 'favicon 不应含黑色填充 #0F0F11（备案前透明）');
});
