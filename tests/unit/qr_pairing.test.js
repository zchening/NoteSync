// NoteSync 单元测试（jsdom 加载真实 index.html）
// v5.20 二维码配对（快速档）静态层：
//   Q1 b64ToUrlSafe/urlSafeToB64 全字节往返 + URL-safe 字符集约束
//   Q2 parsePairingKey 合法/非法 hash 解析
//   Q3 配对弹层 DOM 结构齐全且默认隐藏
//   Q4 内联二维码库可用（真实配对 URL 能生成模块矩阵）
//   Q5 版本号 5.20
// 真实解锁链路（导入密钥→解密→进入编辑器）由 Playwright 探针 _probe_qr_pairing.js 覆盖。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

const dom = loadApp();
const { window } = dom;
const document = window.document;

after(() => { try { window.close(); } catch (e) {} });

// ── Q1：URL-safe base64 往返 ──────────────────────────────
test('b64ToUrlSafe/urlSafeToB64 全字节往返一致', () => {
  for (const len of [1, 2, 3, 16, 32, 33, 64]) {
    for (let round = 0; round < 20; round++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + round * 91 + len * 13) & 0xff;
      const b64 = Buffer.from(bytes).toString('base64');
      const safe = window.b64ToUrlSafe(b64);
      assert.ok(!/[+/=]/.test(safe), 'URL-safe 变体不应含 + / =：' + safe);
      assert.strictEqual(window.urlSafeToB64(safe), b64, '往返应还原 len=' + len + ' round=' + round);
    }
  }
});

test('urlSafeToB64 正确补齐 = 填充', () => {
  // "n+/" base64 -> safe "n-_"; 长度 3 -> 补一个 '='
  assert.strictEqual(window.urlSafeToB64('n-_'), 'n+/=');
  // 长度恰为 4 的倍数时不补
  assert.strictEqual(window.urlSafeToB64('YWJj'), 'YWJj');
});

// ── Q2：parsePairingKey 解析 ──────────────────────────────
test('parsePairingKey 从 #k= 解析并还原标准 base64', () => {
  const b64 = Buffer.from('0123456789abcdef0123456789abcdef', 'binary').toString('base64');
  window.location.hash = '#k=' + window.b64ToUrlSafe(b64);
  assert.strictEqual(window.parsePairingKey(), b64);
});

test('parsePairingKey 非法输入一律返回 null', () => {
  const cases = ['', '#', '#k=', '#k=abc+def', '#k=abc/def', '#k=abc=', '#x=abc', '#k=abc&junk', '#k=中文'];
  for (const h of cases) {
    window.location.hash = h;
    assert.strictEqual(window.parsePairingKey(), null, 'hash=' + JSON.stringify(h) + ' 应返回 null');
  }
  window.location.hash = '';
});

// ── Q3：配对弹层 DOM 结构 ──────────────────────────────
test('二维码配对弹层结构齐全且默认隐藏', () => {
  assert.ok(document.getElementById('qrBtn'), '顶栏应有 qrBtn');
  const m = document.getElementById('qrMask');
  assert.ok(m, '应有 qrMask 弹层');
  assert.ok(m.classList.contains('hidden'), '弹层默认应隐藏');
  assert.ok(document.getElementById('qrHolder'), '应有二维码容器');
  assert.ok(document.getElementById('qrUrl'), '应有配对链接展示行');
  assert.ok(document.getElementById('qrClose'), '应有关闭按钮');
});

// ── Q4：内联二维码库 ──────────────────────────────
test('内联 qrcode 库可为真实配对 URL 生成模块矩阵', () => {
  assert.strictEqual(typeof window.qrcode, 'function', 'qrcode-generator 应挂到 window');
  const url = 'https://note.example.com/zhangsan#k=' + window.b64ToUrlSafe(Buffer.alloc(32, 7).toString('base64'));
  const qr = window.qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  assert.ok(n >= 33 && n <= 61, '模块数应在合理区间（version 5~11），实际 ' + n);
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
  assert.ok(dark > n * n * 0.2 && dark < n * n * 0.8, '明暗模块比例应正常（防止空/全黑渲染）');
});

// ── Q5：版本号 ──────────────────────────────
test('APP_VERSION 为 5.20', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  assert.ok(src.includes("const APP_VERSION = '5.20';"), 'index.html 应声明 APP_VERSION = 5.20');
});
