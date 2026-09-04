// v5.35 PWA 基础：离线草稿 + 安装引导 单元测试
// 草稿是本轮的核心数据保护：此前"离线能写"是假的——保存失败只有退避重试，页面一关内容蒸发。
// 现在加密成功即落盘 localStorage（密文），本组测试锁死四条生命线：
//   ① 保存失败 → 草稿在（密文）② 保存成功 → 草稿清
//   ③ 无冲突重开 → 静默恢复并补传 ④ 有冲突 → 弹条让用户选，绝不自动覆盖
// jsdom 无 Web Crypto（http 非 secure context）、无 TextEncoder，注入 Node 的等价实现走真实加解密。
// ⚠ 所有用例必须 t.after(close)：测试中途 throw 时若不关 jsdom 实例，其内部定时器会让
//   事件循环永不排空，整个测试进程挂死到超时（todo.test.js 曾踩过同一坑）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function freshApp() {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    // jsdom 的 Range 未实现布局 API，而 ensureCaret 依赖 getClientRects 判定光标可见性。
    // 返回空集合 → ensureCaret 恒走"重建选区"分支（addRange 是 jsdom 支持的），行为安全。
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  });
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor'), localStorage: window.localStorage };
}

// GET 正常返回 note；PUT 一律 400（fetchRetry 对 4xx 不重试，秒回失败）
function mockOfflinePut(window, note) {
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
}
function mockOnline(window, putV) {
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: putV }) });
}

// 直接走 applyUnlocked（跳过口令派生 PBKDF2 20 万次迭代，jsdom 里太慢）
async function unlock(window, key, note) {
  await window.applyUnlocked(key, note);
}

async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

// url 为根路径时 noteId 为空串，DRAFT_KEY 实为 'notesync_draft_'
const DK = 'notesync_draft_';
function draftOf(localStorage) {
  const s = localStorage.getItem(DK);
  return s ? JSON.parse(s) : null;
}

// ── P1：保存失败 → 密文草稿落盘 ─────────────────────────
test('P1 保存失败后密文草稿落盘，含 baseV 版本号', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOfflinePut(window, {});
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>离线写的重要内容</div>';
  await window.saveLocal();

  const d = draftOf(localStorage);
  assert.ok(d, '保存失败必须留下草稿');
  assert.strictEqual(typeof d.ct, 'string', '草稿必须存密文 ct');
  assert.strictEqual(typeof d.iv, 'string', '草稿必须存密文 iv');
  assert.strictEqual(d.baseV, 5, '草稿必须记录基于的服务端版本号');
  assert.ok(!localStorage.getItem(DK).includes('离线写的重要内容'), '明文绝不能落盘');
});

// ── P2：保存成功 → 草稿清除 ─────────────────────────────
test('P2 保存成功后草稿被清除', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOfflinePut(window, {});
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>先离线写一笔</div>';
  await window.saveLocal();
  assert.ok(draftOf(localStorage), '前置：失败后草稿应在');

  mockOnline(window, 6); // 网络恢复
  editor.innerHTML = '<div>先离线写一笔（已补充）</div>';
  await window.saveLocal();
  assert.strictEqual(draftOf(localStorage), null, '上传成功后草稿必须清除');
});

// ── P3：无冲突重开 → 静默恢复 + 自动补传 ─────────────────
test('P3 无冲突时解锁自动恢复草稿内容并调度补传', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOfflinePut(window, {});
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  // 构造草稿：用户离线写过、关页前的残留
  const d = await window.encryptText('<div>离线写的草稿</div>', key);
  window.writeDraft(d.ct, d.iv);

  // 模拟重开：服务端版本没变（baseV=5 == note.v=5）
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  assert.ok(editor.innerHTML.includes('离线写的草稿'), '解锁后应静默恢复草稿到编辑器');
  // 补传失败（仍离线）时草稿必须保留——这是再下次打开还能恢复的保证
  await sleep(600); // scheduleDraftResave 400ms 后 saveLocal（失败，重新写草稿）
  assert.ok(draftOf(localStorage), '补传失败时草稿不能被清掉');
});

// ── P4：有冲突 → 弹条让用户选，绝不自动覆盖 ──────────────
test('P4 服务端有新版本时弹冲突条，编辑器保持服务端内容', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOnline(window, 6);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  // 草稿基于 v5；随后另一台设备把服务端推到 v6
  const d = await window.encryptText('<div>本机的离线修改</div>', key);
  window.writeDraft(d.ct, d.iv);
  const newCt = await window.encryptText('另一台设备的更新内容', key);

  await unlock(window, key, { v: 6, ct: newCt.ct, iv: newCt.iv, salt: 'x' });

  const bar = window.document.getElementById('draftBar');
  assert.ok(!bar.classList.contains('hidden'), '冲突时必须显示提示条');
  assert.ok(!editor.innerHTML.includes('本机的离线修改'), '冲突时绝不自动覆盖编辑器');
  assert.ok(editor.innerHTML.includes('另一台设备的更新内容'), '编辑器应先展示服务端最新内容');
});

// ── P5：冲突条「恢复我的修改」→ 覆盖编辑器并推送 ─────────
test('P5 点击恢复后草稿内容进编辑器并触发保存', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOnline(window, 6);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const d = await window.encryptText('<div>本机的离线修改</div>', key);
  window.writeDraft(d.ct, d.iv);
  const newCt = await window.encryptText('另一台设备的更新内容', key);
  await unlock(window, key, { v: 6, ct: newCt.ct, iv: newCt.iv, salt: 'x' });

  mockOnline(window, 7); // 恢复后保存应成功
  window.document.getElementById('draftRestore').click();
  await sleep(80); // handler 是 async：click() 返回时 decryptText 尚未完成，等一拍再断言

  assert.ok(editor.innerHTML.includes('本机的离线修改'), '恢复后编辑器应是草稿内容');
  assert.ok(window.document.getElementById('draftBar').classList.contains('hidden'), '操作后提示条应收起');
  await sleep(300); // saveLocal fire-and-forget
  assert.strictEqual(draftOf(localStorage), null, '保存成功后草稿清除');
});

// ── P6：冲突条「丢弃」→ 草稿删除 ─────────────────────────
test('P6 点击丢弃后草稿删除且提示条收起', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOnline(window, 6);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const d = await window.encryptText('<div>本机的离线修改</div>', key);
  window.writeDraft(d.ct, d.iv);
  const newCt = await window.encryptText('另一台设备的更新内容', key);
  await unlock(window, key, { v: 6, ct: newCt.ct, iv: newCt.iv, salt: 'x' });

  window.document.getElementById('draftDiscard').click();
  assert.strictEqual(draftOf(localStorage), null, '丢弃后草稿必须删除');
  assert.ok(window.document.getElementById('draftBar').classList.contains('hidden'), '提示条应收起');
  assert.ok(editor.innerHTML.includes('另一台设备的更新内容'), '编辑器保持服务端内容不动');
});

// ── P7：解不开的草稿（口令换过/数据损坏）→ 静默丢弃 ──────
test('P7 草稿解密失败时静默清除，不阻塞解锁', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('服务端内容', key);
  mockOnline(window, 5);
  localStorage.setItem(DK, JSON.stringify({ ct: 'garbage-not-valid!!', iv: 'AAAA', baseV: 5, at: Date.now() }));

  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  assert.strictEqual(draftOf(localStorage), null, '解不开的草稿应被清除');
  assert.ok(editor.innerHTML.includes('服务端内容'), '解锁流程不应被坏草稿阻断');
});

// ── P8：SW 注册 URL 携带版本号（缓存名单一来源）──────────
test('P8 SW 注册带 ?v=APP_VERSION，sw.js 缓存名从 URL 读版本', () => {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(src.includes("register('/sw.js?v=' + encodeURIComponent(APP_VERSION))"),
    'SW 注册必须携带版本参数，否则缓存名无法跟随发版');
  const sw = fs.readFileSync(path.resolve(INDEX_PATH, '..', 'sw.js'), 'utf8');
  assert.ok(sw.includes("searchParams.get('v')"), 'sw.js 必须从自身 URL 读取版本号');
  assert.ok(!sw.includes("notesync-v1'"), '旧硬编码缓存名必须移除');
  assert.ok(sw.includes("'/favicon.svg'"), '预缓存清单应包含 favicon.svg');
  assert.ok(sw.includes('html2canvas'), 'html2canvas CDN 必须纳入缓存策略（离线导出图片）');
});

// ── P9：iOS 未安装 → 提示「添加到主屏幕」，无一键安装按钮 ──
test('P9 iOS 设备显示添加到主屏幕引导且不显示一键安装', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
  window.tryShowInstallBar();
  const bar = window.document.getElementById('installBar');
  const go = window.document.getElementById('installGo');
  assert.ok(!bar.classList.contains('hidden'), 'iOS 应显示安装引导条');
  assert.ok(go.classList.contains('hidden'), 'iOS 无 beforeinstallprompt，不能显示一键安装按钮');
  assert.ok(window.document.getElementById('installMsg').textContent.includes('添加到主屏幕'), '文案必须如实告知操作路径');
});

// ── P10：用户点 × 后记住选择，同会话不再弹 ────────────────
test('P10 点击不再提示后记住选择且不再弹出', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, localStorage } = app;
  // iOS UA：tryShowInstallBar 需要 deferredInstall（Android）或 iOS 身份才会走显示分支
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockOnline(window, 5);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const bar = window.document.getElementById('installBar');
  assert.ok(!bar.classList.contains('hidden'), '解锁后应弹一次安装引导');

  window.document.getElementById('installDismiss').click();
  assert.ok(bar.classList.contains('hidden'), '点击后应收起');
  assert.strictEqual(localStorage.getItem('notesync_install_dismissed'), '1', '必须记住用户的选择');

  window.tryShowInstallBar();
  assert.ok(bar.classList.contains('hidden'), '之后重复调用绝不重弹');
});

// ── P11：standalone 模式（已安装）不弹引导 ────────────────
test('P11 已安装（standalone）时不弹安装引导', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  window.matchMedia = q => ({ matches: q.includes('standalone'), addEventListener() {}, removeEventListener() {} });
  window.tryShowInstallBar();
  assert.ok(window.document.getElementById('installBar').classList.contains('hidden'),
    'standalone 模式下绝不能弹安装引导');
});
