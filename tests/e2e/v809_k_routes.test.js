// NoteSync E2E 回归 v8.0.9：§K1 HEAD 探活 + §K2 /.well-known/ 路由（行为级，不 grep 源码字面量）
// 背景（BUG_CHECKLIST §K）：
//   K1 server.js 只接 GET，HEAD 落末尾 404 → 监控探针/CDN 探活误判服务下线；
//   K2 assetlinks.json 被 SPA 兜底吞成整页 index.html（text/html）→ 安卓 App Links 校验永不过。
// 修法：handler 顶部 HEAD→GET 归一化 + 吞 body；SPA 兜底前加 /.well-known/ 精确分支。
// 本套全部真起 server.js 打真请求：状态码/头/body 逐条硬证，GET 主链路带正反对照防误伤。
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server.js');
const NODE = process.execPath;

function freePort() { return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
function startServer() {
  return new Promise(async (resolve) => {
    const port = await freePort();
    const child = spawn(NODE, [SERVER], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (d) => (stderr += d));
    const t0 = Date.now();
    const check = () => {
      const r = http.get(`http://localhost:${port}/healthz`, (res) => { res.resume(); res.on('end', () => resolve({ child, port })); });
      r.on('error', () => { if (Date.now() - t0 > 8000) { child.kill(); throw new Error('server boot fail: ' + stderr); } setTimeout(check, 120); });
    };
    check();
  });
}
function req(port, method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}
// 闸R2-P2-1：HTTP 客户端按规范会自己丢 HEAD body——裸 socket 才能硬证「服务端真没吐」。
function rawHead(port, p) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = '';
    s.setTimeout(2500, () => { s.destroy(); reject(new Error('raw HEAD 挂起超时: ' + p)); });
    s.on('data', d => { buf += d.toString('latin1'); });
    s.on('close', () => resolve(buf));
    s.on('error', reject);
    s.write('HEAD ' + p + ' HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  });
}

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.child.kill());

// ── K1：HEAD 与 GET 等效（只回头部不回 body）──────────────────
test('K1-1 HEAD /healthz 返回 200 且零 body（此前是 404）', async () => {
  const r = await req(srv.port, 'HEAD', '/healthz');
  assert.strictEqual(r.status, 200, 'HEAD 探活必须 200，不再被兜底 404 误杀');
  assert.strictEqual(r.body.length, 0, 'HEAD 响应体必须为空');
});
test('K1-2 HEAD / 返回 200 text/html 且零 body；GET / 正文对照仍在（防误伤 GET 主链路）', async () => {
  const h = await req(srv.port, 'HEAD', '/');
  assert.strictEqual(h.status, 200);
  assert.match(h.headers['content-type'] || '', /text\/html/);
  assert.strictEqual(h.body.length, 0, 'HEAD 不得吐 body');
  const g = await req(srv.port, 'GET', '/');
  assert.strictEqual(g.status, 200);
  assert.ok(g.body.startsWith('<!DOCTYPE html>'), 'GET / 仍须回真壳——HEAD 归一化不许动 GET');
});
test('K1-3 HEAD /api/note/:id 200 application/json 零 body；GET 对照返回合法 JSON', async () => {
  const h = await req(srv.port, 'HEAD', '/api/note/v809probe');
  assert.strictEqual(h.status, 200);
  assert.match(h.headers['content-type'] || '', /application\/json/);
  assert.strictEqual(h.body.length, 0);
  const g = await req(srv.port, 'GET', '/api/note/v809probe');
  assert.doesNotThrow(() => JSON.parse(g.body), 'GET API 回归：JSON 完好');
  assert.strictEqual(g.body.length > 0, true);
});
test('K1-4 非 GET/HEAD 语义不动：POST /api/fail 缺 content-type 仍 400 JSON', async () => {
  const r = await req(srv.port, 'HEAD', '/.well-known/assetlinks.json'); // 顺带证 HEAD 覆盖 well-known
  assert.strictEqual(r.status, 200);
  const p = await new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/fail/v809probe' }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    rq.on('error', reject); rq.end();
  });
  assert.strictEqual(p.status, 400, 'POST 分支不许被 HEAD→GET 归一化波及');
  assert.match(p.body, /bad content-type/);
});

test('K1-1b 裸 socket 硬证：HEAD /healthz 的 \\r\\n\\r\\n 之后零字节（吞 body 不靠客户端自觉）', async () => {
  const buf = await rawHead(srv.port, '/healthz');
  assert.match(buf, /^HTTP\/1\.1 200/);
  const i = buf.indexOf('\r\n\r\n');
  assert.ok(i >= 0, '必须有完整头部终止符');
  assert.strictEqual(buf.length, i + 4, '头部之后不许有任何 body 字节，实测多出 ' + (buf.length - i - 4));
});
test('K1-5 闸R2-P1：HEAD /api/note/:id/stream 不入 SSE 黑洞——快速 404 不挂起不占流名额', async () => {
  const buf = await rawHead(srv.port, '/api/note/v809probe/stream');
  assert.match(buf, /^HTTP\/1\.1 404/, 'SSE 路由对 HEAD 维持旧行为（归一化排除项），永挂=红');
});

// ── K2：/.well-known/ 先于 SPA 兜底出结论 ──────────────────────
test('K2-1 GET /.well-known/assetlinks.json 返回可解析 JSON（application/json，绝非 text/html）', async () => {
  const r = await req(srv.port, 'GET', '/.well-known/assetlinks.json');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['content-type'] || '', /application\/json/, 'content-type 若再是 text/html 即被 SPA 兜底吞了');
  const j = JSON.parse(r.body); // 旧 bug 下这里必炸（<!DOCTYPE）
  assert.ok(Array.isArray(j), 'assetlinks 语句必须是 JSON 数组');
  assert.strictEqual(r.headers['cache-control'], 'no-store', '校验文件必须 no-store，防 CDN 拿旧');
});
test('K2-2 其余 /.well-known/* 一律 404 JSON，不再伪装成 HTML 壳', async () => {
  const r = await req(srv.port, 'GET', '/.well-known/apple-app-site-association');
  assert.strictEqual(r.status, 404);
  assert.match(r.headers['content-type'] || '', /application\/json/);
  assert.ok(!r.body.includes('<!DOCTYPE'), '404 也必须是 JSON 结论，不许漏进 SPA 兜底');
});
test('K2-3 反证：普通 SPA 路径仍兜底成 index.html 壳（well-known 分支不许截胡）', async () => {
  const r = await req(srv.port, 'GET', '/v809randompage');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.startsWith('<!DOCTYPE html>'), 'SPA 兜底主链路不动');
});
