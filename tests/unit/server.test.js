// NoteSync 服务端集成测试（针对真实 server.js）
// 验证 Bug 1（中文笔记名路由 / ID 校验）与 Bug 4（maskable 图标 + cream favicon 静态路由）。
// 约定：spawn 真实 server.js 子进程于测试端口，等待 "listening on" 行后跑测试，after() 杀掉子进程。
// 只创建本测试文件并运行；不修改任何应用代码或其它测试。
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');

const NODE = 'C:/Users/zchen/.workbuddy/binaries/node/versions/22.22.2/node.exe';
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

// --- Bug 1: 中文笔记名 PUT 不应被当作 bad id 拒绝 ---
test('Bug1 PUT /api/note/<中文名> 不被 bad id 拒绝', async () => {
  const name = encodeURIComponent('我的笔记');
  const res = await fetch(`${BASE}/api/note/${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ct: '', iv: '', salt: '' }),
  });
  let body = null;
  if (res.status === 400) body = await res.json().catch(() => null);
  // 修复要点：合法中文 id 绝不能是 400 bad id；若因其它原因 400 也需 error !== 'bad id'
  assert.ok(
    res.status !== 400 || (body && body.error !== 'bad id'),
    `中文名 PUT 不应是 bad id；status=${res.status} body=${JSON.stringify(body)}`
  );
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

// --- Bug 1: SSE /stream 的 id 提取需在 decodeURIComponent 后通过校验 → 200 ---
test('Bug1 GET /api/note/<中文名>/stream 返回 200', async () => {
  const name = encodeURIComponent('我的笔记');
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/note/${name}/stream`, { signal: ac.signal });
  assert.strictEqual(res.status, 200);
  ac.abort(); // 立即断开，避免悬挂长连接
});

// --- Bug 4: maskable 192 图标 ---
test('Bug4 GET /icon-maskable-192.png → 200 image/png 且 >100 字节', async () => {
  const res = await fetch(`${BASE}/icon-maskable-192.png`);
  assert.strictEqual(res.status, 200);
  const ct = res.headers.get('content-type') || '';
  assert.ok(ct.startsWith('image/png'), 'content-type=' + ct);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100, 'body length=' + buf.length);
});

// --- Bug 4: maskable 512 图标 ---
test('Bug4 GET /icon-maskable-512.png → 200 image/png 且 >100 字节', async () => {
  const res = await fetch(`${BASE}/icon-maskable-512.png`);
  assert.strictEqual(res.status, 200);
  const ct = res.headers.get('content-type') || '';
  assert.ok(ct.startsWith('image/png'), 'content-type=' + ct);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100, 'body length=' + buf.length);
});

// --- Bug 4: manifest.json 含 maskable 512 图标 ---
test('Bug4 GET /manifest.json 含 purpose=maskable 且 src 含 icon-maskable-512.png 的图标', async () => {
  const res = await fetch(`${BASE}/manifest.json`);
  assert.strictEqual(res.status, 200);
  const m = await res.json();
  const icons = Array.isArray(m.icons) ? m.icons : [];
  const hit = icons.find(
    (i) => (i.purpose || '').includes('maskable') && (i.src || '').includes('icon-maskable-512.png')
  );
  assert.ok(hit, 'manifest 缺少 maskable 512 图标；icons=' + JSON.stringify(icons));
});

// --- Bug 4: favicon.svg 含奶油色填充 ---
test('Bug4 GET /favicon.svg → 200 且含 fill="#FBFBF8"', async () => {
  const res = await fetch(`${BASE}/favicon.svg`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('fill="#FBFBF8"'), 'favicon 缺少奶油色填充 #FBFBF8');
});
