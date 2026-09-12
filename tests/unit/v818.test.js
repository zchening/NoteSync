// v8.1.8 单元测试：正文→提醒删除联动三修的确定性回归（用户报障①②③）
//   C1（②「删了要好几秒才消失」）：整句干净删除（原文指纹连同 ≥2 字前缀一并消失）时，
//      即使在打字热态（末次击键 2.2s 内）也当场联动删除、不再挂 2.5s 延迟重试；
//      与 B1（半截改写仍被守卫跳过）形成正反对照。
//   C2（①「删了正文列表却还在」）：相对漂移 + remSeenSrc 未登记时，saveLocal 留存的
//      「落库前正文」指纹集合 remPrevSrcs 兜底，让 ③ 放行联动删除，且用后即清。
//      反证：无 remPrevSrcs、无 remSeenSrc 且漂移时，③ 仍保守挡住（绝不新增误删面）。
//   C3（③「加提醒后日期下两条下划线」）：源码静态守护——linkify 拆打字延续克隆裸 u、
//      装饰等价归一化把任意 <u> 视为噪声（本 App 无手动下划线，用户拍板）。视觉双层下划线由真机验证。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
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
  return { dom, window, editor: window.document.getElementById('editor') };
}
function mockCapture(window, note, putV) {
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') {
      if (String(url).indexOf('/history') !== -1) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: putV }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
function remList(window) { return window.eval('reminders'); }
function driftAt(h) { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, 0, 0, 0).getTime() + 86400e3; }

// ── C1：整句干净删除在热态内当场联动删除（bug② 修复；与 v817.B1 半截态正反对照）──
test('C1 热态内「整句干净删除」当场联动删除，不再挂 2.5s 延迟重试', async t => {
  const at = driftAt(15);
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window } = app; const key = await makeKey();
  const bodyHtml = '<div>明天下午3点　接橙子</div>';
  const ct = await window.encryptText(bodyHtml, key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: ct.ct, iv: ct.iv, salt: 'x' });
  window.eval('reminders = [{ at: ' + at + ", text: '接橙子', fired: false, src: '明天下午3点' }];");
  // 先跑一轮让指纹登记进 remSeenSrc（模拟提醒在正文里被“见过”）
  await window.reconcileRemindersFromBody(window.htmlToRemText(bodyHtml));
  await sleep(120);
  assert.strictEqual(window.eval('remSeenSrc.has("明天下午3点")'), true, '前置：指纹应登记为见过');

  // 用户把整句连时间带事项删干净（正文无任何 ≥2 字前缀残留），且仍处热态
  window.eval('lastTypeAt = Date.now();');
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>今天天气不错</div>'));
  await sleep(120);
  assert.strictEqual(remList(window).length, 0, '整句干净删除：热态内也应当场删掉（旧版会白等 2.5s）');
  assert.strictEqual(window.eval('remReconcileRetryTimer'), null, '当场删除即落定，不应再挂延迟重试');
});

// ── C2：漂移 + 未登记时，remPrevSrcs 兜底放行联动删除（bug① 修复）──
test('C2 存量指纹漏登记时 remPrevSrcs 兜底放行联动删除，用后即清', async t => {
  const at = driftAt(15);
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window } = app; const key = await makeKey();
  const ct = await window.encryptText('<div>后天下午3点　接橙子</div>', key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: ct.ct, iv: ct.iv, salt: 'x' });
  // 故意不跑首轮对账：remSeenSrc 里【没有】这条指纹；at 也按今天重算漂移（seenBase 不含）。
  // 关键：saveLocal 已把 lastHtml 推进成【删除后正文】，reconcile 从 lastHtml 现算的 prevSrcs 与当前同源、不含指纹。
  window.eval('reminders = [{ at: ' + at + ", text: '接橙子', fired: false, src: '后天下午3点' }];");
  window.eval("lastHtml = '<div>接橙子</div>';");
  assert.strictEqual(window.eval('remSeenSrc.has("后天下午3点")'), false, '前置：本条指纹未登记见过');
  // 反证支：没有 remPrevSrcs → ③ 保守挡住，绝不删（无新增误删面）
  window.eval('lastTypeAt = 0;');
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>接橙子</div>'));
  await sleep(120);
  assert.strictEqual(remList(window).length, 1, '无上一版证据时保持保守：不误删他端/面板新条目');
  // 正证支：saveLocal 兜底留存了「落库前正文」的指纹集合 → 本轮 prevSrcs 并入后放行删除
  window.eval("remPrevSrcs = new Set(['后天下午3点']);");
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>接橙子</div>'));
  await sleep(120);
  assert.strictEqual(remList(window).length, 0, 'remPrevSrcs 兜底应放行整句删除的联动');
  assert.strictEqual(window.eval('remPrevSrcs'), null, '兜底证据单发即用即清，不作过夜证据');
});

// ── C3：源码静态守护（③/②/① 三修的落地锚点）──
test('C3 源码守护：保节点拆克隆裸 u + 装饰等价拍平任意 <u> + 事项在位仍跳删除 + 重载清 remPrevSrcs', () => {
  assert.ok(SRC.includes("querySelectorAll('u:not(.rem-mark)')"), '应收集非 rem-mark 的克隆裸 u');
  assert.ok(SRC.includes('strayU.forEach(u => unwrapStrayU(u));'), '裸 u 应用【保节点】的 unwrapStrayU 拆，而非毁内容的 unwrapMark');
  assert.ok(!/strayU\.forEach\(u => unwrapMark/.test(SRC), '禁止再对裸 u 用有损 unwrapMark（评审 R3 探针：img/s/a 会被压没）');
  assert.ok(/function unwrapStrayU\(el\)\s*\{[\s\S]*?if \(!el\.parentNode\) return;[\s\S]*?while \(el\.firstChild\) el\.parentNode\.insertBefore\(el\.firstChild, el\);/.test(SRC), 'unwrapStrayU 应保 parentNode 判空 + 原样上移子节点');
  assert.ok(SRC.includes("if (tag === 'U') { out += walk(child); continue; }"), 'normDecorHtml 应把任意 <u> 拍平为噪声（防术后假脏多存一版）');
  assert.ok(SRC.includes('if (editHot && (!srcOld || srcPrefixLingers(srcOld, bodyText) || itemStillInBody)) { editHotSkipped = true; continue; }'), '热态守卫须同时挡「事项文本仍在」的改时间中间态');
  assert.ok(/remSeenSrc\.clear\(\);[\s\S]{0,120}remPrevSrcs = null;/.test(SRC), 'loadReminder 须与 remSeenSrc 同位清 remPrevSrcs，堵跨笔记泄漏');
  assert.ok(/remMarks\.length === 0 && strayU\.length === 0/.test(SRC), '早退闸须纳入 strayU，否则「有裸 u 无有效提醒」时逃过重建仍留双层');
  assert.ok(SRC.includes("remMarks.forEach(u => unwrapMark(u, false));"), 'rem-mark 既有拆包应保留');
});

// ── C4：②收窄过头的反证——留事项改时间时热态内不得当场删（评审 R3 P1）──
test('C4 热态内「删旧时间留事项」不判为整句删除：不当场删，挂延迟重试保护改时间', async t => {
  const at = driftAt(15);
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window } = app; const key = await makeKey();
  const bodyHtml = '<div>明天下午3点　接橙子</div>';
  const ct = await window.encryptText(bodyHtml, key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: ct.ct, iv: ct.iv, salt: 'x' });
  window.eval('reminders = [{ at: ' + at + ", text: '接橙子', fired: false, src: '明天下午3点' }];");
  await window.reconcileRemindersFromBody(window.htmlToRemText(bodyHtml)); // 登记 remSeenSrc
  await sleep(120);
  assert.strictEqual(window.eval('remSeenSrc.has("明天下午3点")'), true, '前置：指纹已见过');
  // 用户删掉时间 token、但事项「接橙子」仍在正文（典型改时间动作），且仍在热态
  window.eval('lastTypeAt = Date.now();');
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>接橙子</div>'));
  await sleep(120);
  assert.strictEqual(remList(window).length, 1, '事项仍在=改时间中间态，热态内不得当场删（否则回退 v8.1.7 前的误删）');
  assert.strictEqual(window.eval('remReconcileRetryTimer != null'), true, '应挂延迟重试，等用户敲完新时间走改时间分支');
});

// ── C5：chip 截断事项存成带「…」尾的切片，剥 … 前整串永不命中正文 → 仍须判为「事项在位」不误删（评审复核 P1）──
test('C5 长事项被 chip 截断成「…」切片时，删时间留事项仍不当场删（rtKey 须剥尾 …）', async t => {
  const at = driftAt(15);
  const app = freshApp(); t.after(() => app.dom.window.close());
  const { window } = app; const key = await makeKey();
  const bodyHtml = '<div>明天下午3点　接橙子顺便驿站拿快递买咖啡三明治和面包片</div>';
  const ct = await window.encryptText(bodyHtml, key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: ct.ct, iv: ct.iv, salt: 'x' });
  // 模拟 chip：事项截 20 字 + 省略号入库（正文里带 … 的整串永不可能命中，但去掉 … 的前缀在）
  const stored = '接橙子顺便驿站拿快递买咖啡三明治和面包' + '\u2026';
  window.eval('reminders = [{ at: ' + at + ", text: " + JSON.stringify(stored) + ", fired: false, src: '明天下午3点' }];");
  await window.reconcileRemindersFromBody(window.htmlToRemText(bodyHtml)); // 登记 remSeenSrc
  await sleep(120);
  assert.strictEqual(window.eval('remSeenSrc.has("明天下午3点")'), true, '前置：指纹已见过');
  // 删掉时间 token、事项整段（无 …）仍在正文，且仍在热态
  window.eval('lastTypeAt = Date.now();');
  await window.reconcileRemindersFromBody(window.htmlToRemText('<div>接橙子顺便驿站拿快递买咖啡三明治和面包片</div>'));
  await sleep(120);
  assert.strictEqual(remList(window).length, 1, '事项前缀仍在正文（仅 … 不在），热态内不得当场删——守 rtKey 剥 … 修复');
  assert.strictEqual(window.eval('remReconcileRetryTimer != null'), true, '应挂延迟重试，等改时间落定或事项也删净再定夺');
});

