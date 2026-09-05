// v5.49 离线正文缓存单元测试
// 核心：每次成功加载/保存都把正文密文落 localStorage；离线时 loadCachedBody 用缓存解密展示并浮出状态条。
// 仅存密文：与服务器、与离线草稿同理，密钥不出浏览器，零知识属性不变。
// 复用 pwa.test.js 的 jsdom 注入（webcrypto / TextEncoder / Range 兜底）。
const test = require('node:test');
const assert = require('node:assert');
const { webcrypto } = require('node:crypto');
const { loadApp } = require('../helpers');

function freshApp() {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); } catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  });
  return {
    dom, window: dom.window, document: dom.window.document,
    editor: dom.window.document.getElementById('editor'),
    localStorage: dom.window.localStorage
  };
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

// ── C1：缓存密文可写可读，且不存明文 ───────────────────────
test('C1 缓存密文可写可读且不含明文', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, localStorage } = app;
  const key = await makeKey();
  const ct = await window.encryptText('服务端内容', key);
  window.cachePut({ ct: ct.ct, iv: ct.iv, v: 7, savedAt: 1700000000000 });

  const c = window.cacheGet();
  assert.strictEqual(c.ct, ct.ct, '应读回密文 ct');
  assert.strictEqual(c.iv, ct.iv, '应读回密文 iv');
  assert.strictEqual(c.v, 7, '应读回版本号');
  assert.strictEqual(c.savedAt, 1700000000000, '应读回同步时间戳');
  assert.ok(!localStorage.getItem('notesync_cache_').includes('服务端内容'), '明文绝不能落盘');
});

// ── C2：离线回退用缓存解密填充编辑器并浮出状态条 ──────────
test('C2 离线回退解密缓存正文并展示状态条', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, editor, document } = app;
  const key = await makeKey();
  const ct = await window.encryptText('这是上次同步的正文', key);
  window.cachePut({ ct: ct.ct, iv: ct.iv, v: 9, savedAt: 1700000000000 });

  const ok = await window.loadCachedBody(key);
  assert.ok(ok, '有缓存时应回退成功');
  assert.ok(editor.innerHTML.includes('这是上次同步的正文'), '编辑器应展示缓存正文');
  const bar = document.getElementById('offlineBar');
  assert.ok(!bar.classList.contains('hidden'), '离线状态条应可见');
  assert.ok(document.getElementById('offlineTime').textContent.length > 0, '状态条应显示上次同步时间');
});

// ── C3：无缓存时离线回退返回 false 且不改动编辑器 ────────
test('C3 无缓存时离线回退失败且不改动编辑器', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, editor } = app;
  editor.innerHTML = '<div>原有内容</div>';
  const ok = await window.loadCachedBody(await makeKey());
  assert.strictEqual(ok, false, '无缓存应回退失败');
  assert.ok(editor.innerHTML.includes('原有内容'), '编辑器不应被改动');
  assert.ok(window.document.getElementById('offlineBar').classList.contains('hidden'), '状态条应保持隐藏');
});

// ── C4：重新联网后状态条收起 ───────────────────────────────
test('C4 hideOfflineBar 收起离线状态条', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, document } = app;
  const key = await makeKey();
  const ct = await window.encryptText('正文', key);
  window.cachePut({ ct: ct.ct, iv: ct.iv, v: 1, savedAt: 1700000000000 });
  await window.loadCachedBody(key);
  assert.ok(!document.getElementById('offlineBar').classList.contains('hidden'), '前置：离线条应可见');
  window.hideOfflineBar();
  assert.ok(document.getElementById('offlineBar').classList.contains('hidden'), 'hideOfflineBar 应收起状态条');
});
