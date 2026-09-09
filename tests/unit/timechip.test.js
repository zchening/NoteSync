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

// v6.0：addReminder 会经 scheduleRemMarkRefresh 在 400ms 后跑 linkifyEditor 重建正文 DOM
// （时间文本包进 u.rem-mark），旧的文本节点引用随之失效——先等它跑完再重新定位，
// 否则设到死节点上的 selection 拿不到 caret，chip 永远不弹（TC14 全量三连挂的根因）。
function findTimeNode(root, S) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && n.nodeValue.indexOf(S) !== -1) return { node: n, idx: n.nodeValue.indexOf(S) };
  }
  return null;
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
// v6.0：历史快照（/history PUT）是新增合法流量，不计入主保存 PUT 断言
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

// ── TC3：无年份已过 → 一律按今年解析并标 expired（v6.3：顺延明年的兜底退役——
// 它让过去日期被当成未来、悬停弹「添加提醒」，用户红线是过去时间不给任何入口）──
test('TC3-v63 无年份已过时间不再进位明年，直接标 expired', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const now = new Date();
  const res = window.parseTimeMatches('1-1 07:00 记得做');
  assert.strictEqual(res.length, 1, '无年份格式仍必须命中');
  const expSame = new Date(now.getFullYear(), 0, 1, 7, 0).getTime();
  assert.strictEqual(res[0].at, expSame, '必须按今年解析，绝不进位明年');
  if (expSame <= Date.now() + 30000) {
    assert.strictEqual(res[0].expired, true, '今年已过的短格式必须标 expired（不给添加入口）');
  }
  // 未来日期不受影响：明天的 07:05 仍解析为今年、未过期
  const tomorrow = new Date(Date.now() + 86400e3);
  const fut = window.parseTimeMatches((tomorrow.getMonth() + 1) + '-' + tomorrow.getDate() + ' 07:05 记得做');
  assert.strictEqual(fut.length, 1, '未来短格式必须命中');
  assert.strictEqual(fut[0].expired, false, '未来短格式不得误标 expired');
});

// ── TC4：过去时间 → 过期标记（v5.39：仍返回但标 expired，chip 显示灰态）──
test('TC4 带年份的过去时间标 expired，不作为可设提醒命中', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const yest = new Date(Date.now() - 86400e3);
  yest.setHours(7, 0, 0, 0);
  const res = window.parseTimeMatches('昨天 ' + fmtDate(yest) + ' 开过会');
  assert.strictEqual(res.length, 1, 'v5.39 起过期时间仍返回（供 chip 显示「已过期」）');
  assert.strictEqual(res[0].expired, true, '必须带 expired 标记');
  assert.strictEqual(res[0].at, yest.getTime(), '时间戳精确');
  // 未来时间不得带 expired
  const fu = window.parseTimeMatches(fmtDate(futureDate(1, 7, 5)));
  assert.strictEqual(fu[0].expired, false, '未来时间 expired 必须为 false');
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
  assert.ok(chip.textContent.includes('添加提醒'), 'v5.45 chip 文案必须含 CTA「添加提醒」（「设提醒」退役）');
  assert.ok(chip.querySelector('.chip-cta'), 'CTA 必须是独立元素（实底伪按钮需要）');
  // v7.8.0：单行胶囊 → 三行小卡，事项独立成行（不再与时间挤在同一行用全角空格分隔），
  // 布局截断只落在事项行——旧断言 chip.textContent.includes('　开') 随该结构退役
  const when = chip.querySelector('.chip-when');
  assert.ok(when && /7:05/.test(when.textContent), '首行必须是时间（v5.39 时间后文提取口径不变）: ' + (when && when.textContent));
  const what = chip.querySelector('.chip-what');
  assert.ok(what && what.textContent === '开', '事项必须独占 .chip-what 行: ' + (what && what.textContent));
  assert.ok(chip.querySelector('.chip-sep'), 'CTA 卡必须带分隔线');
  const day = chip.querySelector('.chip-day');
  assert.ok(day && day.textContent === '明天', '明天的时间必须带相对日标签「明天」: ' + (day && day.textContent));
  assert.ok(!chip.classList.contains('feedback'), '未添加的时间弹的必须是 CTA 卡，不是展示卡');
  assert.ok(!chip.textContent.includes('设提醒'), '旧文案「设提醒」不得再出现');

  place(0);
  await sleep(400);
  assert.ok(chip.classList.contains('hidden'), '光标移到非时间处 chip 必须隐藏');
});

// ── TC12b：过期时间 → chip 完全不浮出（v5.45 定案；v5.46 正文也不再有任何标识，移上去零打扰）──
test('TC12b 光标落过期时间上 chip 不出现（v5.45 零打扰，旧「已过期」灰态退役）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const past = new Date(Date.now() - 3600e3);
  const S = fmtDate(past);
  editor.innerHTML = '<div>昨天开会 ' + S + '</div>';
  const tn = editor.querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf(S);
  const chip = document.getElementById('timeChip');

  const range = document.createRange();
  range.setStart(tn, idx + 2); range.setEnd(tn, idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  assert.ok(chip.classList.contains('hidden'), 'v5.45 过期时间必须完全不浮 chip（零打扰）');
  assert.ok(!chip.textContent.includes('已过期'), '旧「已过期」文案不得再出现');

  chip.dispatchEvent(new window.Event('mousedown'));
  await sleep(50);
  assert.strictEqual(puts.length, 0, '过期时间不得发出 PUT');
});

// ── TC12c：提醒模态打开时 chip 不浮出（v5.40 模态互斥回归）──
test('TC12c 提醒模态打开时 chip 不浮出（遮罩互斥，below-panel 退役）', async t => {
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

  window.toggleRemPanel(true);
  assert.ok(!document.getElementById('remMask').classList.contains('hidden'), '前置：模态已开');

  const range = document.createRange();
  range.setStart(tn, idx + 2); range.setEnd(tn, idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  assert.ok(chip.classList.contains('hidden'), '模态开着 chip 必须隐藏（真实浏览器中遮罩挡正文，光标不会落进时间）');
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
  assert.strictEqual(payload.list[0].text, '开', '事项必须取时间同行后文（「会议 … 开」→ 开），不再用笔记首行');
  assert.ok(chip.classList.contains('feedback'), 'v5.45 确认反馈必须挂两行卡片态');
  assert.ok(chip.textContent.includes('✅ 提醒已添加'), '第一行必须是「✅ 提醒已添加」');
  assert.ok(chip.querySelector('.chip-del'), 'v5.47 确认卡必须带「删除」伪按钮');
  assert.ok(chip.textContent.includes('　开'), '第二行必须是「时间　事项」（v5.47 分隔符=全角空格）');
});

// ── TC12d：已添加的未来时间 → 两行展示卡（v5.46：不可点/移开即消失）──
test('TC12d 光标落已添加的未来时间上显示两行展示卡，点击不重复添加，移开立即消失', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const S = fmtDate(futureDate(1, 7, 5));
  editor.innerHTML = '<div>会议 ' + S + ' · 开会</div>';
  const chip = document.getElementById('timeChip');

  // 直接把提醒加进列表（绕过 chip 点击路径）
  const expectedAt = window.parseTimeMatches(S)[0].at;
  await window.addReminder(expectedAt, '开会');
  const putsBefore = puts.length;
  await sleep(560); // v6.0：等 400ms 的 linkifyEditor 重建完成，避免 selection 设到死节点（曾与它赛跑导致偶发挂）
  const hit = findTimeNode(editor, S);
  assert.ok(hit, 'linkify 后正文应仍含时间文本');

  const range = document.createRange();
  range.setStart(hit.node, hit.idx + 2); range.setEnd(hit.node, hit.idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  assert.ok(!chip.classList.contains('hidden'), '已添加的未来时间必须浮出两行展示卡');
  assert.ok(chip.classList.contains('feedback'), '展示卡必须复用两行卡片样式');
  assert.ok(chip.textContent.includes('✅ 提醒已添加'), '第一行「✅ 提醒已添加」');
  assert.ok(chip.querySelector('.chip-del'), 'v5.47 展示卡必须带「删除」伪按钮');
  assert.ok(chip.textContent.includes('　开会'), '第二行「时间　事项」（v5.47 分隔符=全角空格）');
  assert.ok(!chip.querySelector('.chip-cta'), '展示卡不得带「添加提醒」CTA（纯展示）');

  chip.dispatchEvent(new window.Event('mousedown'));
  await sleep(50);
  assert.strictEqual(puts.length, putsBefore, '展示卡不可点：点击不得再发 PUT');

  // v6.0：linkify 后 div.firstChild 是「会议 」等非时间文本（时间已包进 u.rem-mark），
  // 原写法 setStart(hit.node, 0) 光标仍在时间上，chip 不会消失
  const walker2 = document.createTreeWalker(editor, 4);
  let away = null, n2;
  while ((n2 = walker2.nextNode())) {
    if (n2.nodeValue && n2.nodeValue.indexOf(S) === -1 && n2.nodeValue.trim()) { away = n2; break; }
  }
  assert.ok(away, '应有非时间文本节点可移');
  const range2 = document.createRange();
  range2.setStart(away, 0); range2.setEnd(away, 0);
  sel.removeAllRanges(); sel.addRange(range2);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  assert.ok(chip.classList.contains('hidden'), '光标移开展示卡必须立即消失（无 3 秒定时器拖尾）');
});

// ── TC14：v5.47 临近触发 30 秒窗口差修复 ─────────────────
// 旧逻辑：expired（at<=now+30s）先把 chip 拦掉，但下划线阈值是 at<=now →
// 「有下划线却不弹卡」。新逻辑：已添加分支优先，口径与下划线一致。
// 为保证分钟对齐的解析值落在 (now, now+30s] 窗口内，把 Date.now 钉在秒数≥30 的时刻。
test('TC14 已添加提醒处于临近触发 30 秒窗口内，光标落时间上仍必须弹展示卡', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  // 把页面世界的 Date.now 钉在「秒数=35」的时刻：下一分钟边界恒落在 (now, now+30s] 窗口内，
  // 且 P-fixedNow=25s 远离危险区——原「秒数≥30 即可」在秒数接近 59 时 P-fixedNow≈1s，
  // setTimeout(fireReminder) 走真实时钟，全量慢跑下会抢在断言前弹 remCard 藏掉 chip（v6.0 全量三连挂实锤）
  const realNow = Date.now();
  const d0 = new Date(realNow);
  d0.setSeconds(35, 0);
  const fixedNow = d0.getTime();
  const origDateNow = window.Date.now;
  window.Date.now = () => fixedNow;
  t.after(() => { window.Date.now = origDateNow; });

  const boundary = new Date(fixedNow);
  boundary.setSeconds(0, 0);
  boundary.setMinutes(boundary.getMinutes() + 1);
  const S = fmtDate(boundary);
  const P = window.parseTimeMatches(S)[0].at;
  assert.ok(P > fixedNow && P - fixedNow <= 30000, '前置：解析值必须落在 (now, now+30s] 过期窗口内');

  editor.innerHTML = '<div>马上 ' + S + ' 开会</div>';
  await window.addReminder(P, '开会'); // 提醒已添加（真实 PUT 路径）
  await sleep(560); // v6.0：等 400ms 的 linkifyEditor 重建完成再定位节点（旧写法把 selection 设到死节点）
  const hit = findTimeNode(editor, S);
  assert.ok(hit, 'linkify 后正文应仍含时间文本');

  const chip = document.getElementById('timeChip');
  const range = document.createRange();
  range.setStart(hit.node, hit.idx + 2); range.setEnd(hit.node, hit.idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  assert.ok(!chip.classList.contains('hidden'), '已添加且未到点的提醒：即使处于 30 秒过期判定窗口，也必须弹展示卡');
  assert.ok(chip.classList.contains('feedback'), '弹的必须是两行展示卡，不是「添加提醒」按钮');
  assert.ok(chip.querySelector('.chip-del'), 'v5.47 展示卡必须带「删除」按钮');
});

// ── TC15：v5.47 展示卡「删除」按钮 → 彻底移除该提醒 ──────
test('TC15 点展示卡「删除」→ 提醒彻底移除（PUT rem=null）、chip 收起', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const S = fmtDate(futureDate(1, 7, 5));
  editor.innerHTML = '<div>会议 ' + S + ' · 开会</div>';
  const chip = document.getElementById('timeChip');

  const expectedAt = window.parseTimeMatches(S)[0].at;
  await window.addReminder(expectedAt, '开会');
  await sleep(560); // v6.0：等 linkifyEditor 重建完成再定位节点（同 TC12d 死节点竞态）
  const putsAfterAdd = puts.length;
  assert.ok(putsAfterAdd >= 1, '前置：添加提醒已持久化');
  const hit = findTimeNode(editor, S);
  assert.ok(hit, 'linkify 后正文应仍含时间文本');

  const range = document.createRange();
  range.setStart(hit.node, hit.idx + 2); range.setEnd(hit.node, hit.idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  const del = chip.querySelector('.chip-del');
  assert.ok(del, '前置：展示卡带「删除」按钮');

  del.dispatchEvent(new window.Event('mousedown')); // jsdom 无 PointerEvent，走 mousedown
  await sleep(600);
  assert.ok(chip.classList.contains('hidden'), '点删除后 chip 必须立即收起');
  const last = puts[puts.length - 1];
  assert.ok(puts.length > putsAfterAdd, '删除必须触发持久化');
  assert.strictEqual(last.rem, null, '提醒清空后 rem 字段必须显式置 null（服务端清除，多端同步）');
});
