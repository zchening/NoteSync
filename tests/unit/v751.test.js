// v7.5.0 单元测试：自冲突幻影根治（F1'/A1'）+ 占位等价加固（修5/修6）+ 合并互斥（修7）+ 键盘守卫（修8）
// 覆盖：
//   Q1-Q3 restoreDraftIfNeeded 三态（等价+版本漂移→静默清 / 等价+版本同→静默清 / 真差异→弹条）
//   Q4 A1' 占位早退同步清草稿 + 零 PUT + 探针计数
//   Q5-Q6 normPlaceholderHtml 修6：壳内 ZWSP / 裸 span 透传 / 带样式 span 不拍平
//   Q7 blocksEqual（修5）占位等价并入 + 缓存函数存在
//   Q8-Q9 源码形态：autoMergeSave busy 互斥（修7）+ 键盘守卫移除 POINTER_FINE（修8）+ 探针（修10）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

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
  return { dom, window, document: window.document, editor: window.document.getElementById('editor'), localStorage: window.localStorage };
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
function readSrc() { return fs.readFileSync(INDEX_PATH, 'utf8'); }

// ── Q1-Q3：restoreDraftIfNeeded 三态（F1' 自冲突幻影根修）──
test('Q1 F1\'：等价草稿（占位壳态）+ baseV 漂移 → 静默清，不弹条', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const baseHtml = '<div>2026-9-15 19:35　你好</div>';
  const noteCt = await window.encryptText(baseHtml, key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  // 模拟 A1' 留雷：writeDraft 落壳态草稿（baseV=当时 localVer=5），随后 localVer 漂移到 99（PUT in-flight 页面被杀/他端 bump）
  const shellHtml = '<div><u class="rem-mark"><br></u></div><div>2026-9-15 19:35　你好</div>';
  const dCt = await window.encryptText(shellHtml, key);
  window.writeDraft(dCt.ct, dCt.iv);
  window.eval('localVer = 99');
  assert.ok(window.readDraft(), '前置：草稿应存在');
  await window.restoreDraftIfNeeded(key);
  assert.strictEqual(window.readDraft(), null, '等价草稿应被静默清（F1\' 不再要求 baseV 相同）');
  assert.ok(window.document.getElementById('draftBar').classList.contains('hidden'), '不得弹「检测到同步冲突」条');
  assert.ok(window.__f1DraftCleared >= 1, '?diag 探针应计数');
});

test('Q2 F1\'：等价草稿（装饰差异）→ 静默清', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const baseHtml = '<div>2026-9-15 19:35　你好</div>';
  const noteCt = await window.encryptText(baseHtml, key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  // 草稿=打标装饰差异（u.rem-mark 包时间串），语义与云端全等
  const markedHtml = '<div><u class="rem-mark">2026-9-15 19:35</u>　你好</div>';
  const dCt = await window.encryptText(markedHtml, key);
  window.writeDraft(dCt.ct, dCt.iv);
  window.eval('localVer = 77');
  await window.restoreDraftIfNeeded(key);
  assert.strictEqual(window.readDraft(), null, '装饰等价草稿应静默清');
  assert.ok(window.document.getElementById('draftBar').classList.contains('hidden'), '装饰差异不弹条');
});

test('Q3 F1\'：真实差异草稿（多一个真实空行）→ 照旧弹条（绝不静默覆盖）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor, localStorage } = app;
  const key = await makeKey();
  const baseHtml = '<div>2026-9-15 19:35　你好</div>';
  const noteCt = await window.encryptText(baseHtml, key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  // 草稿=裸 br 真实空行版（用户有意敲的空行）——语义差异，绝不静默清
  const realBlankHtml = '<div><br></div><div>2026-9-15 19:35　你好</div>';
  const dCt = await window.encryptText(realBlankHtml, key);
  window.writeDraft(dCt.ct, dCt.iv);
  await window.restoreDraftIfNeeded(key);
  assert.ok(window.readDraft(), '真实差异草稿必须保留（等拍板）');
  assert.ok(!window.document.getElementById('draftBar').classList.contains('hidden'), '真实差异应弹条交用户确认');
});

// ── Q4：A1' 占位早退同步清草稿（留雷根修）+ 零 PUT ──
test('Q4 A1' + "'" + '：壳态早退应 clearDraft + 零 PUT 流量 + 探针计数', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseHtml = '<div>2026-9-15 19:35　你好</div>';
  const noteCt = await window.encryptText(baseHtml, key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  // 模拟行首回车：编辑器出现壳态中间块（视觉零差异）
  editor.innerHTML = '<div><u class="rem-mark"><br></u></div><div>2026-9-15 19:35　你好</div>';
  await window.saveLocal();
  await sleep(50);
  assert.strictEqual(window.readDraft(), null, 'A1' + "'" + ' 早退必须清草稿（v7.5.0 留雷根修）');
  assert.strictEqual(puts.length, 0, '占位等价不得产生 PUT 流量');
  assert.ok((window.__a1PrimeSkips || 0) >= 1, '?diag 探针应计数');
});

// ── Q5-Q6：normPlaceholderHtml 修6（ZWSP / 裸 span）──
test('Q5 修6：壳内 ZWSP 不再阻断空壳判定（\\u200B 非 Unicode 空白，旧 .trim() 剥不掉）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const pe = window.isPlaceholderEqual;
  assert.strictEqual(
    pe('<div><u class="rem-mark">\u200B<br></u></div><div>正文</div>', '<div>正文</div>'),
    true, 'ZWSP 壳块应整块剥（v7.4.0 因 trim() 剥不掉 \\u200B 而失效）');
  assert.strictEqual(
    pe('<div><u class="rem-mark"><br></u>\u200B</div><div>正文</div>', '<div>正文</div>'),
    true, '壳外 ZWSP 文本节点同样剥除');
});

test('Q6 修6：裸 span 透传/拍平；带样式 span 保留', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const pe = window.isPlaceholderEqual;
  assert.strictEqual(
    pe('<div><span><u class="rem-mark"><br></u></span></div><div>正文</div>', '<div>正文</div>'),
    true, '裸 span 包壳应透传判定（Blink 变体）');
  assert.strictEqual(
    pe('<div><span>正文</span></div>', '<div>正文</div>'),
    true, '无属性 span 应拍平（对齐 normDecorHtml 口径）');
  assert.strictEqual(
    pe('<div><span style="color:red">正文</span></div>', '<div>正文</div>'),
    false, '带样式 span 绝不拍平（用户格式保留）');
  assert.strictEqual(
    pe('<div><u class="rem-mark"><br></u></div>', '<div><span></span></div>'),
    true, '空 span 判空壳（修6 新等价对）');
});

// ── Q7：blocksEqual 占位等价并入（修5）+ 缓存 ──
test('Q7 修5：blocksEqual 占位等价 + cachedNormPlaceholderHtml 缓存存在', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const be = window.blocksEqual;
  assert.strictEqual(typeof be, 'function', 'blocksEqual 应挂 window');
  assert.strictEqual(be('<div>正文</div>', '<div>正文</div>'), true, '严格相等直通');
  assert.strictEqual(be('<u class="rem-mark">\u200B<br></u>', '<u class="rem-mark"><br></u>'), true, '块级占位等价（ZWSP 壳）');
  // 裸 br 真实空行 vs 壳块：isPlaceholderEqual 层不等（P2 镜像，绝不吞空行）；
  // 但 blocksEqual 走装饰等价（normDecorHtml 剥壳保 br）→ 视觉零差异判等是 v7.1.0 既有正确行为
  assert.strictEqual(be('<div><br></div>', '<div><u class="rem-mark"><br></u></div>'), true, '装饰层视觉等价（壳块渲染同为空行）');
  assert.strictEqual(typeof window.cachedNormPlaceholderHtml, 'function', '缓存函数应挂 window（lcsPairs O(n·m) 防爆）');
  // 缓存一致性：同串两次归一化结果相同
  const s1 = window.cachedNormPlaceholderHtml('<div><span><u class="rem-mark"><br></u></span></div>');
  const s2 = window.cachedNormPlaceholderHtml('<div><span><u class="rem-mark"><br></u></span></div>');
  assert.strictEqual(s1, s2, '缓存命中应返回同一结果');
});

// ── Q8-Q9：源码形态（修7 / 修8 / 修10）──
test('Q8 修7：autoMergeSave 应在 PUT 期间占住 busy 互斥（finally 必释放）', () => {
  const src = readSrc();
  const fnIdx = src.indexOf('async function autoMergeSave');
  const tryIdx = src.indexOf('busy = true;', fnIdx);
  const encIdx = src.indexOf('const enc = await encryptText(mergedHtml, cryptoKey);', fnIdx);
  assert.ok(fnIdx > -1 && tryIdx > -1 && encIdx > -1, 'autoMergeSave 应置 busy');
  assert.ok(tryIdx < encIdx, 'busy 置位应在加密/PUT 之前（覆盖整个在途窗口）');
  const tail = src.slice(fnIdx, src.indexOf('}', src.indexOf('finally { busy = false; }', fnIdx)) + 1);
  assert.ok(tail.includes('finally { busy = false; }'), 'finally 必须释放 busy（失败/成功一致）');
  // 不加入口拦截：handleWriteConflict 在 saveLocal catch 内（busy=true）合法重入
  const body = src.slice(fnIdx, fnIdx + 400);
  assert.ok(!body.includes('if (busy) return false;'), 'autoMergeSave 不得入口拦截（会误杀 409 合并路径）');
});

test('Q9 修8+修10：键盘守卫移除 POINTER_FINE；探针与延条 helper 落位', () => {
  const src = readSrc();
  assert.ok(src.includes('if (CHIP_HOVER_OK && document.activeElement !== editor) { try { editor.focus(); } catch (e) {} }'), 'ensureCaret 守卫应只认 CHIP_HOVER_OK（修8）');
  assert.ok(!src.includes('CHIP_HOVER_OK || POINTER_FINE()'), 'POINTER_FINE 不应再参与守卫（触屏笔/蓝牙鼠标/WebView 误报源）');
  assert.ok(src.includes('function showRemoteBarWhenIdle()'), '延条 helper 应存在（修9）');
  assert.ok(src.includes("if (pendingRemoteNote) { setStatus(false, '远端有更新，待处理'); showRemoteBar(); }"), '延条必须守卫 pendingRemoteNote（拍板后不复活旧条，亮条同帧恢复状态文案）');
  // 延条语义：状态先落（pendingRemoteNote 先赋值），仅条延迟——四处新挂起点应使用 showRemoteBarWhenIdle
  const uses = (src.match(/showRemoteBarWhenIdle\(\)/g) || []).length;
  assert.ok(uses >= 5, 'helper 定义+至少 4 处新挂起点应使用延条（实际 ' + uses + '）');
  // 探针
  for (const k of ['__a1PrimeSkips', '__f1DraftCleared', '__reminderConflictBar', '__wconBar', '__remoteBarDeferred']) {
    assert.ok(src.includes(k), '探针 ' + k + ' 应存在（修10）');
  }
  assert.ok(src.includes("conflict: a1='"), '?diag 输出段应含冲突探针行');
});
