// v5.37 时间文本识别 + 点击 chip 设提醒 单元测试
// 纯函数 parseTimeMatches/matchTimeAt：支持 2026-09-02 07:00 / 2026/9/2 7:05 / 9-2 07:00（补年进位）/
// 9月2日 07:00；过去时间不命中；短格式不与完整格式重叠命中。
// 集成：selectionchange 防抖后光标落在时间上 → #timeChip 浮出；点 chip → addReminder 走真实 PUT。
// 约束：绝不改正文 DOM（linkify 拍平 span），chip 是编辑器外浮层。
const test = require('node:test');
const assert = require('node:assert');
const { webcrypto } = require('node:crypto');
const { loadApp } = require('../helpers');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function futureDate(daysAhead, h, mi) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(h, mi, 0, 0);
  return d;
}

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
    if (m === 'PUT') { puts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: putV }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
  return puts;
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
async function remPayload(window, key, put) {
  const remObj = JSON.parse(put.rem);
  return JSON.parse(await window.decryptText(remObj.ct, remObj.iv, key));
}

// ── TC1：完整格式精确解析 ─────────────────────────────────
test('TC1 parseTimeMatches 完整格式 2026-09-02 07:00 精确解析', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const d = futureDate(1, 7, 5);
  const S = fmtDate(d);
  const res = window.parseTimeMatches('会议 ' + S + ' 开');
  assert.strictEqual(res.length, 1, '应命中 1 条');
  assert.strictEqual(res[0].at, d.getTime(), '解析出的时间戳必须精确');
  assert.strictEqual(res[0].index, 3, 'index 是匹配起点');
  assert.strictEqual(res[0].length, S.length, 'length 是匹配长度');
});

// ── TC2：斜杠 + 单数字格式 ────────────────────────────────
test('TC2 斜杠与单数字格式 2026/9/6 7:05 同样命中', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const d = futureDate(1, 7, 5);
  const S = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' 7:05';
  const res = window.parseTimeMatches('hi ' + S);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].at, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 5).getTime());
});

// ── TC3：无年份已过 → 自动进位明年 ────────────────────────
test('TC3 无年份 1-1 07:00 今年已过自动进位明年', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const now = new Date();
  const res = window.parseTimeMatches('1-1 07:00 记得做');
  assert.strictEqual(res.length, 1, '无年份格式必须命中（进位后）');
  const expSame = new Date(now.getFullYear(), 0, 1, 7, 0).getTime();
  const expNext = new Date(now.getFullYear() + 1, 0, 1, 7, 0).getTime();
  assert.strictEqual(res[0].at, expSame > Date.now() + 30000 ? expSame : expNext);
});

// ── TC4：过去时间不命中 ───────────────────────────────────
test('TC4 带年份的过去时间不命中（提醒没有提醒过去的意义）', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const yest = new Date(Date.now() - 86400e3);
  yest.setHours(7, 0, 0, 0);
  assert.strictEqual(window.parseTimeMatches('昨天 ' + fmtDate(yest) + ' 开过会').length, 0);
});

// ── TC5：非法值不命中 ─────────────────────────────────────
test('TC5 13月40日/25:61/2月30日 一律不命中', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  assert.strictEqual(window.parseTimeMatches('2026-13-40 25:61').length, 0);
  assert.strictEqual(window.parseTimeMatches('2026-02-30 07:00').length, 0);
  assert.strictEqual(window.parseTimeMatches('2026-02-29 07:00').length, 0); // 2026 非闰年
});

// ── TC6：完整格式不被短格式/中文格式重复命中 ──────────────
test('TC6 完整格式只命中一次（短格式与中文格式不重复计数）', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const S = fmtDate(futureDate(1, 7, 5));
  assert.strictEqual(window.parseTimeMatches(S).length, 1);
  assert.strictEqual(window.parseTimeMatches('纯文本没有时间').length, 0);
  assert.strictEqual(window.parseTimeMatches('2026-09-02').length, 0); // 缺时间部分不命中
});

// ── TC7：中文月日格式 ─────────────────────────────────────
test('TC7 中文格式 9月8日 08:30 命中', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const d = futureDate(3, 8, 30);
  const text = (d.getMonth() + 1) + '月' + d.getDate() + '日 08:30 交报告';
  const res = window.parseTimeMatches(text);
  assert.strictEqual(res.length, 1);
  const expThisYear = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 30).getTime();
  const expNext = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate(), 8, 30).getTime();
  assert.strictEqual(res[0].at, expThisYear > Date.now() + 30000 ? expThisYear : expNext);
});

// ── TC8：matchTimeAt 光标边界 ─────────────────────────────
test('TC8 matchTimeAt 边界：贴前后沿命中，出界不命中', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const S = fmtDate(futureDate(1, 7, 5));
  const text = 'abc ' + S + 'xyz';
  const idx = 4;
  assert.ok(window.matchTimeAt(text, idx), 'offset==index（点第一个字符）命中');
  assert.ok(window.matchTimeAt(text, idx + 2), '串中间命中');
  assert.ok(window.matchTimeAt(text, idx + S.length), 'offset==index+len（刚输完）命中');
  assert.strictEqual(window.matchTimeAt(text, idx - 1), null, '串前一格不命中');
  assert.strictEqual(window.matchTimeAt(text, idx + S.length + 1), null, '串后一格不命中');
});

// ── TC9：多个时间各自命中 ─────────────────────────────────
test('TC9 一段文本多个时间全部命中且按序排列', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const d1 = futureDate(1, 7, 5), d2 = futureDate(2, 9, 0);
  const text = 'A ' + fmtDate(d1) + ' B ' + fmtDate(d2);
  const res = window.parseTimeMatches(text);
  assert.strictEqual(res.length, 2);
  assert.ok(res[0].index < res[1].index, '按出现顺序');
  assert.strictEqual(res[0].at, d1.getTime());
  assert.strictEqual(res[1].at, d2.getTime());
});

// ── TC10：caretInfoInEditor 文本节点锚点 ──────────────────
test('TC10 caretInfoInEditor 文本节点锚点返回块内偏移', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 5);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const S = fmtDate(futureDate(1, 7, 5));
  editor.innerHTML = '<div>会议 ' + S + ' 开</div>';
  const tn = editor.querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf(S);
  const range = document.createRange();
  range.setStart(tn, idx + 2); range.setEnd(tn, idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  const info = window.caretInfoInEditor();
  assert.ok(info, '光标在编辑器内必须返回信息');
  assert.strictEqual(info.text, tn.nodeValue, 'text 必须是所在块全文');
  assert.strictEqual(info.offset, idx + 2, 'offset 必须是块内文本偏移');
  assert.ok(window.matchTimeAt(info.text, info.offset), '该偏移必须命中时间');
});

// ── TC11：caretInfoInEditor 元素锚点 ──────────────────────
test('TC11 caretInfoInEditor 元素锚点（块级选区）偏移正确', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 5);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>abc</div><div>def</div>';
  const div2 = editor.children[1];
  const range = document.createRange();
  range.setStart(div2, 0); range.setEnd(div2, 0);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  assert.strictEqual(window.caretInfoInEditor().offset, 0, '第二块开头偏移 0');

  range.setStart(div2, 1); range.setEnd(div2, 1);
  sel.removeAllRanges(); sel.addRange(range);
  assert.strictEqual(window.caretInfoInEditor().offset, 3, '第一子节点后偏移 = "def".length');
});

// ── TC12：集成：光标落时间上 → chip 浮出；移开 → 隐藏 ─────
test('TC12 selectionchange 后光标在时间上浮出 chip，移开隐藏', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 5);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const S = fmtDate(futureDate(1, 7, 5));
  editor.innerHTML = '<div>会议 ' + S + ' 开</div>';
  const tn = editor.querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf(S);
  const chip = document.getElementById('timeChip');

  const place = off => {
    const range = document.createRange();
    range.setStart(tn, off); range.setEnd(tn, off);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
  };

  place(idx + 2);
  await sleep(400);
  assert.ok(!chip.classList.contains('hidden'), '光标落在时间上 chip 必须浮出');
  assert.ok(chip.textContent.includes('设提醒'), 'chip 文案应含「设提醒」');

  place(0);
  await sleep(400);
  assert.ok(chip.classList.contains('hidden'), '光标移到非时间处 chip 必须隐藏');
});

// ── TC13：集成：点 chip → addReminder 走真实 PUT ──────────
test('TC13 chip 点击触发 addReminder（PUT 带 rem）并显示已设反馈', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const S = fmtDate(futureDate(1, 7, 5));
  editor.innerHTML = '<div>会议 ' + S + ' 开</div>';
  const tn = editor.querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf(S);
  const chip = document.getElementById('timeChip');

  const range = document.createRange();
  range.setStart(tn, idx + 2); range.setEnd(tn, idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  assert.ok(!chip.classList.contains('hidden'), '前置：chip 已浮出');

  chip.dispatchEvent(new window.Event('mousedown')); // jsdom 无 PointerEvent，页面只挂了 touchstart/mousedown
  await sleep(50);
  const expectedAt = window.parseTimeMatches(S)[0].at;
  const last = puts[puts.length - 1];
  assert.ok(last.rem, '点 chip 必须走 addReminder 完整保存');
  const payload = await remPayload(window, key, last);
  assert.strictEqual(payload.list[0].at, expectedAt, '提醒时间必须来自被点的时间文本');
  assert.ok(chip.textContent.indexOf('✓ 已设') === 0, 'chip 应显示已设反馈');
});
