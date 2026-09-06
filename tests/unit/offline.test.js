// v5.50 运行时断网感知单元测试
// 核心：offline 事件 0 秒感知（页脚「离线」+ 底部弹「离线 · 上次同步于 X」条）、
// online 恢复自动回「已同步」并收条、锁定态零噪声、lastSyncAt 只在真实服务端成功点更新。
// 复用 cache.test.js 的 jsdom 注入（webcrypto / TextEncoder / Range 兜底）+ fetch 桩走真实 unlock。
const test = require('node:test');
const assert = require('node:assert');
const { webcrypto } = require('node:crypto');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

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
    statusText: dom.window.document.getElementById('statustext'),
    localStorage: dom.window.localStorage
  };
}
function setOnLine(w, v) {
  Object.defineProperty(w.navigator, 'onLine', { value: v, configurable: true });
}

// 用 fetch 桩喂真实 note（盐+密文），走真实 unlock 流程让内部 cryptoKey 就位
async function unlockWithStub(app, pass) {
  const { window } = app;
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const saltB64 = Buffer.from(salt).toString('base64'); // bufToB64 是 const 箭头函数不挂 window，测试侧自算
  const key = await window.deriveKey(pass, salt);
  const enc = await window.encryptText('正文内容', key);
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ v: 3, ct: enc.ct, iv: enc.iv, salt: saltB64 }) });
  await window.unlock(pass);
}

// ── O1：已解锁页面开着断网 → 0 秒「离线」+弹条；恢复 → 自动回「已同步」+收条 ──
test('O1 offline 事件立即感知，online 恢复自动收条', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, statusText, document } = app;
  await unlockWithStub(app, 'testpass');
  await new Promise(r => setTimeout(r, 50)); // 等 startSync 的首轮 poll 写入 lastSyncAt
  assert.strictEqual(statusText.textContent, '已同步', '前置：应已同步');

  window.dispatchEvent(new window.Event('offline'));
  assert.strictEqual(statusText.textContent, '离线', '断网应立即变「离线」（不等轮询失败）');
  const bar = document.getElementById('offlineBar');
  assert.ok(!bar.classList.contains('hidden'), '断网应立即弹出离线条');
  const shown = document.getElementById('offlineTime').textContent;
  assert.ok(shown && shown !== '—', '离线条应显示真实同步时刻，实际: ' + shown);

  window.dispatchEvent(new window.Event('online'));
  await new Promise(r => setTimeout(r, 800)); // 400ms 削抖 + poll
  assert.strictEqual(statusText.textContent, '已同步', '恢复联网应自动回「已同步」');
  assert.ok(bar.classList.contains('hidden'), '恢复联网应自动收起离线条');
});

// ── O2：锁定态 offline 事件零噪声 ──────────────────────────
test('O2 锁定态断网不弹条不改页脚', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, statusText, document } = app;
  window.dispatchEvent(new window.Event('offline'));
  assert.ok(document.getElementById('offlineBar').classList.contains('hidden'), '锁定态不应弹离线条');
  assert.strictEqual(statusText.textContent, '连接中…', '锁定态页脚不应被改写');
});

// ── O3：currentSyncTime 回退链（真实同步时刻 > 缓存时刻 > 0）──
test('O3 currentSyncTime 优先运行时同步时刻，回退缓存时刻', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window } = app;
  assert.strictEqual(window.currentSyncTime(), 0, '无同步无缓存应为 0');
  window.cachePut({ ct: 'x', iv: 'y', v: 1, savedAt: 1700000000000 });
  assert.strictEqual(window.currentSyncTime(), 1700000000000, '无运行时同步时刻应回退缓存 savedAt');
});

// ── O4：showOfflineBar(0) 显示「—」而不是 1970 假时间 ───────
test('O4 无同步时刻时离线条显示占位符', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, document } = app;
  window.showOfflineBar(0);
  assert.strictEqual(document.getElementById('offlineTime').textContent, '—', '0 时刻应显示占位符');
  window.showOfflineBar(1700000000000);
  assert.ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(document.getElementById('offlineTime').textContent), '有时刻应显示格式化时间');
});

// ── O5：poll 失败分支——本机离线挂条，服务器问题不挂条 ──────
test('O5 poll 失败按 onLine 区分「离线」与「同步中断」', async t => {
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window, statusText, document } = app;
  await unlockWithStub(app, 'testpass');
  await new Promise(r => setTimeout(r, 50));
  window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

  setOnLine(window, true);
  await window.poll();
  assert.strictEqual(statusText.textContent, '同步中断', '本机在线但服务器不可达应为「同步中断」');
  assert.ok(document.getElementById('offlineBar').classList.contains('hidden'), '服务器问题不应弹离线条');

  setOnLine(window, false);
  await window.poll();
  assert.strictEqual(statusText.textContent, '离线', '本机离线应为「离线」');
  assert.ok(!document.getElementById('offlineBar').classList.contains('hidden'), '本机离线应挂离线条');
});

// ── O6：源码形态断言（lastSyncAt 语义 + 守卫齐全）────────────
test('O6 v5.50 源码形态：lastSyncAt 语义与守卫', () => {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.strictEqual((src.match(/lastSyncAt = Date\.now\(\)/g) || []).length, 5,
    'lastSyncAt 写入点应为 5 处（解锁/在线加载/保存/轮询/提醒保存）');
  assert.ok(src.includes('lastSyncAt = 0; hideOfflineBar()'), '退出锁定应清时刻并收条');
  assert.ok(src.includes('if (!navigator.onLine) retries = 0;'), 'fetchRetry 应有离线快败');
  const m = src.match(/async function loadCachedBody\(key\) \{[\s\S]*?\n\}/);
  assert.ok(m, '应能截取 loadCachedBody 函数体');
  assert.ok(!m[0].includes('lastSyncAt'), 'loadCachedBody 不得更新 lastSyncAt（缓存时刻≠同步时刻）');
  assert.ok(src.includes("window.addEventListener('offline'"), '应有 offline 监听');
  assert.ok(src.includes("window.addEventListener('online'"), '应有 online 监听');
  // v5.58：离线条移入页脚状态栏——悬浮胶囊条与其让位规则一并退役
  assert.ok(!src.includes('.offlinebar:not(.hidden)+.upload-status'), '悬浮条错位规则应退役（离线条已并入页脚）');
  assert.ok(!/\.offlinebar\{position:fixed/.test(src), 'offlinebar 不应再是 fixed 悬浮条');
});
