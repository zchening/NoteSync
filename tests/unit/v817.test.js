// v8.1.7 单元测试：正文→提醒删除联动的「打字热态」守卫（堵 v8.1.6 挂账残余①）
// 残余①原状：用户把「明天下午3点」删到只剩「明天下午3」时恰好撞上 800ms 自动保存 →
// 半截串不再是独立时间匹配 → 被判成「原文已从正文消失」→ 有「见过」证据 → 误删提醒。
// 本版修法：末次真实击键 2.2s 内跳过「删除」这一支（保留判定与改时间分支照常），并挂一次
// 延迟重试，等手停下用当前正文补一轮对账，不要求用户再敲一次键。
// 覆盖：
//   B1 热态跳过删除 + 停手后重试轮自动完成联动删除（rem 显式置 null）
//   B2 热态只挡删除：非破坏性的「改时间」分支仍即时生效（不等重试、不丢提醒）
//   B3 源码静态守护：守卫在删除三条件之前、grace 常量、单发重试句柄各恰 1 处
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freshApp() {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  });
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor') };
}
function mockCapture(window, note, putV) {
  const puts = [];
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') {
      if (String(url).indexOf('/history') !== -1) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      puts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: putV }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
  return puts;
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
function remList(window) { return window.eval('reminders'); }
function tomorrowAt(h, mi) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, mi || 0, 0, 0).getTime();
}
// 前置：正文含完整原句 + 一条带指纹的漂移态提醒，并先跑一轮对账把指纹登记进 remSeenSrc
async function armedApp(t, bodyHtml, srcLit, atDrift) {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  window.eval('reminders = [{ at: ' + atDrift + ", text: '接橙子', fired: false, src: '" + srcLit + "' }];");
  await window.reconcileRemindersFromBody(window.htmlToRemText(bodyHtml));
  await sleep(150);
  assert.strictEqual(remList(window).length, 1, '前置：原句仍在正文时一条都不能删');
  assert.strictEqual(window.eval('remSeenSrc.has("' + srcLit + '")'), true, '前置：指纹应已按正文登记为见过');
  return { app, window, editor, puts };
}

// 条件等待（本仓库红线：等异步 UI/定时器一律等真实条件，禁定值 sleep——并发下余量会被 CPU 饿死成漂移红）
async function waitUntil(label, fn, limitMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (limitMs || 8000)) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error('waitUntil 超时: ' + label);
}

// ── B1：热态跳过删除，停手后重试轮自动补删 ──
test('B1 打字热态（末次击键 2.2s 内）跳过删除 → 停手后延迟重试完成联动删除', async t => {
  const atDrift = tomorrowAt(15) + 86400e3;
  const { window, editor, puts } = await armedApp(t, '<div>明天下午3点　接橙子</div>', '明天下午3点', atDrift);
  const putsBefore = puts.length;

  // 用户把时间串删掉尾巴（半截态）并触发保存；此刻距末次击键 <2.2s
  editor.innerHTML = '<div>明天下午3　接橙子</div>';
  window.eval("lastHtml = '<div>明天下午3　接橙子</div>'; lastTypeAt = Date.now();");
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>明天下午3　接橙子</div>'));
  await sleep(150);
  assert.strictEqual(remList(window).length, 1, '热态内不得删除（半截串不等于用户放弃了提醒）');
  assert.strictEqual(puts.length, putsBefore, '跳过轮不得推 rem');
  assert.strictEqual(window.eval('remReconcileRetryTimer != null'), true, '跳过删除必须挂一次待发重试（不能等用户再敲键）');

  // 用户停手（grace 窗口过后）→ 重试轮用编辑器当前正文补对账；等真条件而非定值 sleep
  window.eval('lastTypeAt = Date.now() - 9000;');
  await waitUntil('热态跳过后延迟重试应完成联动删除', () => remList(window).length === 0);
  assert.strictEqual(remList(window).length, 0, '停手后重试轮应完成联动删除');
  assert.strictEqual(puts[puts.length - 1].rem, null, 'rem 应显式置 null');
  assert.strictEqual(window.eval('remReconcileRetryTimer'), null, '重试句柄应自清（单发不叠加）');
});

// ── B2：热态只挡删除，改时间分支仍即时生效 ──
test('B2 热态不挡「改时间」：同事项换时间串仍当场更新 at 与指纹', async t => {
  const atDrift = tomorrowAt(15) + 86400e3;
  const { window, editor, puts } = await armedApp(t, '<div>明天下午3点　接橙子</div>', '明天下午3点', atDrift);
  editor.innerHTML = '<div>明天下午4点　接橙子</div>';
  window.eval("lastHtml = '<div>明天下午4点　接橙子</div>'; lastTypeAt = Date.now();");
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>明天下午4点　接橙子</div>'));
  await sleep(150);
  const list = remList(window);
  assert.strictEqual(list.length, 1, '改时间不得丢提醒');
  assert.strictEqual(list[0].at, tomorrowAt(16), 'at 应当场更新（热态守卫只管删除，不拖非破坏性分支）');
  assert.strictEqual(list[0].src, '明天下午4点', '指纹随新串更新');
  assert.ok(puts.length && puts[puts.length - 1].rem, '改时间应随即落库');
});

// ── B3：源码形态守护（锚定补丁行，防守卫被挪到删除之后而失效）──
test('B3 源码守护：热态守卫位于删除三条件之前 + 单发重试句柄', () => {
  const iGuard = SRC.indexOf('if (editHot && (!srcOld || srcPrefixLingers(srcOld, bodyText) || itemStillInBody)) { editHotSkipped = true; continue; }');
  const iDelete = SRC.indexOf('const srcSeen = !!srcOld &&');
  assert.ok(iGuard > 0, '应有热态守卫行');
  assert.ok(iDelete > 0, '删除三条件行应在（v8.1.6 既有）');
  assert.ok(iGuard < iDelete, '守卫必须在删除判定之前——挪到后面等于没挡');
  assert.strictEqual((SRC.match(/const editHot = Date\.now\(\) - lastTypeAt < REM_EDIT_GRACE_MS;/g) || []).length, 1, '热态判据应恰一处（复用 v7.2.0 的 lastTypeAt，且只认真实击键）');
  assert.strictEqual((SRC.match(/let remReconcileRetryTimer = null;/g) || []).length, 1, '重试句柄声明恰一处');
  assert.ok(SRC.includes('}, REM_EDIT_GRACE_MS + 300);'), '重试应排在 grace 之后（给保存防抖与落库留窗口）');
  assert.strictEqual((SRC.match(/clearTimeout\(remReconcileRetryTimer\);/g) || []).length, 2, '待发重试单发不叠加：reconcile 尾部先清再挂 + loadReminder 整表重载作废（各恰一处）');
});
