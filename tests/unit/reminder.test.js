// v5.37 便签提醒 单元测试（多提醒 + 实底卡片 + 响铃）
// v5.37 变更：rem 明文 {at,text} → {list:[{at,text}...]}（升序、上限 10），旧格式读取自动迁移；
// v5.54：REM_DONE 退役（过期静默）；remCard 实底卡片（多条列表）保留为到点主通道；
// setReminder/clearReminder → addReminder/removeReminder；fireReminder 卡片无条件弹出。
// 不变项：rem 与正文同一把 key 加密、服务端存密文零知识不变；server.js 显式传参才更新、未传保留；
// 权限只在用户主动设提醒时申请；不上 Web Push。
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
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  });
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor'), localStorage: window.localStorage };
}

// PUT 请求全部捕获供断言；GET 返回 note
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
const DK = 'notesync_draft_';
const DONE = 'notesync_remdone_';

// 解密 PUT 里的 rem 密文字段，返回明文对象
async function remPayload(window, key, put) {
  const remObj = JSON.parse(put.rem);
  return JSON.parse(await window.decryptText(remObj.ct, remObj.iv, key));
}

// ── R1：设提醒 → PUT 带 rem 密文（list 结构）、按钮高亮 ─────
test('R1 addReminder 上传 rem 密文字段（list 结构）并更新状态', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('<div>买牛奶</div>', key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>买牛奶</div>';
  const at = Date.now() + 3600e3;
  await window.addReminder(at, '买牛奶');

  const last = puts[puts.length - 1];
  assert.ok(last.rem, 'PUT 必须携带 rem 字段');
  assert.ok(JSON.parse(last.rem).ct && JSON.parse(last.rem).iv, 'rem 必须是 {ct,iv} 密文结构');
  const payload = await remPayload(window, key, last);
  assert.ok(Array.isArray(payload.list) && payload.list.length === 1, '明文必须是 {list:[...]} 结构');
  assert.strictEqual(payload.list[0].at, at, 'list[0].at 必须是原提醒时间');
  assert.strictEqual(payload.list[0].text, '买牛奶', 'list[0].text 必须是提醒文案');
  assert.ok(window.document.getElementById('remBtn').classList.contains('on'), '有提醒时闹钟按钮应高亮');
});

// ── R2：解锁恢复新格式 list 未来提醒 → 不弹卡片、按钮高亮 ──
test('R2 解锁时从服务端密文恢复 list 未来提醒并重新调度', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const at = Date.now() + 3600e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: at, text: '开会' }] }), key);
  const note = { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  mockCapture(window, note, 5);
  await window.applyUnlocked(key, note);

  assert.ok(window.document.getElementById('remCard').classList.contains('hidden'), '未来提醒绝不弹卡片');
  assert.ok(window.document.getElementById('remBtn').classList.contains('on'), '按钮应高亮（提醒已从密文恢复为未来时间）');
});

// ── R3：旧格式 {at,text} 自动迁移 + 迁移后写回 list 结构 ────
test('R3 旧格式单提醒自动迁移：可恢复、再新增时 PUT 变 list 两条', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const atOld = Date.now() + 3600e3;
  const remEnc = await window.encryptText(JSON.stringify({ at: atOld, text: '旧格式' }), key);
  const note = { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  const puts = mockCapture(window, note, 6);
  await window.applyUnlocked(key, note);
  assert.ok(window.document.getElementById('remBtn').classList.contains('on'), '旧格式提醒应正常恢复并高亮');

  editor.innerHTML = '<div>y</div>';
  await window.addReminder(Date.now() + 7200e3, '新格式');
  const payload = await remPayload(window, key, puts[puts.length - 1]);
  assert.strictEqual(payload.list.length, 2, '旧条目 + 新条目共存于 list');
  assert.ok(payload.list.some(r => r.at === atOld && r.text === '旧格式'), '旧格式条目迁移无损');
  assert.ok(payload.list.every((r, i, a) => i === 0 || a[i - 1].at <= r.at), 'list 必须按时间升序');
});

// ── R4：过期提醒解锁时彻底静默（v5.54 拍板 A：不再补弹）────
test('R4 过期提醒解锁时不补弹卡片（v5.54 过期静默）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const past1 = Date.now() - 7200e3; // 2 小时前
  const past2 = Date.now() - 600e3;  // 10 分钟前
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: past1, text: '过期的事' }, { at: past2, text: '另一件事' }] }), key);
  const note = { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  mockCapture(window, note, 5);
  await window.applyUnlocked(key, note);

  const card = window.document.getElementById('remCard');
  assert.ok(card.classList.contains('hidden'), 'v5.54 起过期提醒不再补弹卡片');
});

// ── R5：「知道了」收起确认卡（正常触发路径的确认卡仍工作）──
test('R5 正常触发弹卡后「知道了」收起卡片', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const future = Date.now() + 3600e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: future, text: '未来事' }] }), key);
  const note = { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  mockCapture(window, note, 5);
  await window.applyUnlocked(key, note);

  // 模拟到点正常触发（时间已到，卡片无条件弹——页内主通道）
  await window.fireReminder(future);
  const card = window.document.getElementById('remCard');
  assert.ok(!card.classList.contains('hidden'), '到点触发的卡片必须弹出');
  window.document.getElementById('remCardAck').click();
  assert.ok(card.classList.contains('hidden'), '确认后收起');
});

// ── R6：旧 REM_DONE 数据留置无害，过期判断一律按时间 ────────
test('R6 旧格式 REM_DONE localStorage 数据不影响 v5.54 静默判断', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const past = Date.now() - 600e3;
  const remEnc = await window.encryptText(JSON.stringify({ at: past, text: '旧事' }), key); // 旧格式顺带覆盖
  const note = { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  mockCapture(window, note, 5);
  localStorage.setItem(DONE, String(past)); // v5.36 遗留格式
  await window.applyUnlocked(key, note);

  assert.ok(window.document.getElementById('remCard').classList.contains('hidden'), '旧数据留置无害：过期按时间判断不弹');
});

// ── R7：取消最后一条 → PUT 显式 rem:null ───────────────────
test('R7 removeReminder 清空后显式上传 rem:null', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>y</div>';
  const at = Date.now() + 3600e3;
  await window.addReminder(at, 't');
  await window.removeReminder(at);

  const last = puts[puts.length - 1];
  assert.strictEqual(last.rem, null, '取消必须显式传 null（undefined 是保留语义）');
  assert.ok(!window.document.getElementById('remBtn').classList.contains('on'), '取消后按钮熄灭');
});

// ── R8：多条管理：排序 / 上限 10 / 同刻覆盖 ────────────────
test('R8 多条排序、上限 10 条拒绝、同刻再设覆盖', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>y</div>';
  const base = Date.now() + 3600e3;
  await window.addReminder(base + 2000e3, 'b');
  await window.addReminder(base, 'a');
  let payload = await remPayload(window, key, puts[puts.length - 1]);
  assert.strictEqual(payload.list.length, 2, '两条共存');
  assert.deepStrictEqual(payload.list.map(r => r.at), [base, base + 2000e3], 'list 按时间升序');

  // 同刻再设：覆盖文案不新增
  await window.addReminder(base, 'a2');
  payload = await remPayload(window, key, puts[puts.length - 1]);
  assert.strictEqual(payload.list.length, 2, '同刻再设不得产生重复');
  assert.strictEqual(payload.list.find(r => r.at === base).text, 'a2', '同刻再设应更新文案');

  // 填满到 10 条后第 11 条拒绝
  for (let i = 0; i < 8; i++) await window.addReminder(base + 3000e3 + i * 1000e3, 'f' + i);
  const putCountBefore = puts.length;
  await window.addReminder(Date.now() + 9e6, '第11条');
  assert.strictEqual(puts.length, putCountBefore, '超上限必须拒绝且不发 PUT');
  assert.ok(window.document.getElementById('uploadStatus').textContent.includes('提醒最多'), '超上限应有提示');
});

// ── R9：fireReminder 只弹对应一条 + 卡片无条件弹 ───────────
test('R9 多条中触发一条：卡片只含该条，权限被拒也有卡片兜底', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  window.Notification = function () {};
  window.Notification.permission = 'denied'; // 无通知能力
  const at1 = Date.now() + 1000;
  const at2 = Date.now() + 60000;
  await window.addReminder(at1, '第一条事');
  await window.addReminder(at2, '第二条事');

  await window.fireReminder(at1);
  const card = window.document.getElementById('remCard');
  assert.ok(!card.classList.contains('hidden'), '触发后卡片必须弹出（页内兜底不依赖权限）');
  const listText = window.document.getElementById('remCardList').textContent;
  assert.ok(listText.includes('第一条事'), '卡片应含被触发的条目');
  assert.ok(!listText.includes('第二条事'), '卡片不得含未触发的条目');
});

// ── R10：有权限 + SW → showNotification，tag 固定 ──────────
test('R10 有权限时通过 ServiceWorker 弹系统通知且卡片同步弹出', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const swNotifs = [];
  window.Notification = function () {};
  window.Notification.permission = 'granted';
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({ active: {}, showNotification: (ti, o) => { swNotifs.push({ ti: ti, o: o }); return Promise.resolve(); } }) }
  });
  const at = Date.now() + 1000;
  await window.addReminder(at, '开会提醒');
  await window.fireReminder(at);

  assert.strictEqual(swNotifs.length, 1, '应通过 SW showNotification 弹出');
  assert.ok(swNotifs[0].ti.includes('开会提醒'), '通知标题应含提醒文案');
  assert.strictEqual(swNotifs[0].o.tag, 'notesync-rem', 'tag 固定便于系统去重');
  assert.ok(!window.document.getElementById('remCard').classList.contains('hidden'), '通知成功后页内卡片仍应弹出');
});

// ── R11：itemAfterMatch 提取时间同行后文作事项（v5.39 取代 noteFirstLine）──
test('R11 itemAfterMatch 取时间后文作事项，无后文为空（不再用笔记首行）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 5);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const m = { index: 3, length: 16 }; // '会议 ' 之后 16 字的时间串
  assert.strictEqual(window.itemAfterMatch('会议 2026-09-06 07:00 开会讨论', m), '开会讨论', '取时间同行后文');
  assert.strictEqual(window.itemAfterMatch('会议 2026-09-06 07:00   ', m), '', '后文只有空白 → 空');
  assert.strictEqual(window.itemAfterMatch('会议 2026-09-06 07:00', m), '', '无后文 → 空（不再退回笔记首行）');
  const long = window.itemAfterMatch('会议 2026-09-06 07:00 ' + '很'.repeat(30), m);
  assert.ok(long.length === 21 && long.endsWith('…'), '超长截断 20 字加省略号');
});

// ── R12：v5.40 模态面板：设置行固定首行、时间默认 +5 分钟、事项留空、条目排后 ──
test('R12 模态面板：复用 .box+qr-box 居中、设置行首行、时间默认当前+5分钟、无废话文案', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  window.toggleRemPanel(true);
  const mask = window.document.getElementById('remMask');
  const panel = window.document.getElementById('remPanel');
  assert.ok(!mask.classList.contains('hidden'), '打开后模态可见');
  assert.ok(panel.classList.contains('box'), '面板必须复用 .box 视觉（与扫码配对一致）');
  assert.ok(panel.classList.contains('qr-box'), 'v5.42 面板必须挂 qr-box（标题/列表文字居中，与配对弹窗一致）');
  let text = panel.textContent;
  assert.ok(!text.includes('1 小时后') && !text.includes('8 点') && !text.includes('明天上午 9 点'), '快捷按钮已删');
  assert.ok(!text.includes('提示：') && !text.includes('提醒我：') && !text.includes('再加：'), '标签与提示语已删');
  assert.ok(text.includes('添加提醒'), '按钮名必须是「添加提醒」');
  const timeRow = panel.querySelector('.rem-time-row');
  assert.ok(timeRow, 'v5.45 时间行必须存在（日期 + 时:分 自建控件，datetime-local 退役）');
  const dateInp = timeRow.querySelector('input[type="date"]');
  const hhInp = timeRow.querySelector('input.rem-hh');
  const mmInp = timeRow.querySelector('input.rem-mm');
  assert.ok(dateInp && dateInp.value, '日期框必须存在且有默认值（今天）');
  assert.ok(hhInp && mmInp && /^\d{2}$/.test(hhInp.value) && /^\d{2}$/.test(mmInp.value), '时/分框必须存在且默认两位（当前 +5 分钟）');
  const picked = new Date(+dateInp.value.slice(0, 4), +dateInp.value.slice(5, 7) - 1, +dateInp.value.slice(8, 10), +hhInp.value, +mmInp.value).getTime();
  assert.ok(Math.abs(Date.now() + 300000 - picked) < 120000, 'v5.42 默认时间必须是当前 +5 分钟（±2 分钟容差）');
  const itemInput = panel.querySelector('input.rem-item');
  assert.ok(itemInput && itemInput.value === '' && itemInput.placeholder === '事项', 'v5.44 事项框留空且 placeholder 精简为「事项」（括号补语已按用户要求删除）');
  const form = window.document.getElementById('remBoxForm');
  const list = window.document.getElementById('remBoxList');
  assert.ok(!!(form.compareDocumentPosition(list) & window.Node.DOCUMENT_POSITION_FOLLOWING), '设置行必须固定在已设条目区之前');
  window.toggleRemPanel(false);
  assert.ok(mask.classList.contains('hidden'), '关闭后模态收起');

  editor.innerHTML = '<div>y</div>';
  const at = Date.now() + 3600e3;
  await window.addReminder(at, '要办的事');
  window.toggleRemPanel(true);
  const row = list.querySelector('.rem-row');
  assert.ok(row && row.textContent.includes('要办的事'), '已设条目应含事项文案');
  assert.strictEqual(row.querySelector('span'), null, 'v5.42 行内文字必须是裸文本节点（span 元素盒会被内核夜间模块吃字）');
  const cancelBtn = row.querySelector('button');
  assert.strictEqual(cancelBtn.textContent, '×', '取消按钮为独立 ×');
  cancelBtn.click();
  await sleep(30);
  assert.ok(!window.document.getElementById('remBtn').classList.contains('on'), '逐条取消后按钮熄灭');
  assert.ok(window.document.getElementById('remMask').classList.contains('hidden'), '取消最后一条后模态自动收起');
});

// ── R12b：「定时」对已过时刻加重提示且不设；留空事项正常入库 ──
test('R12b 定时已过时刻红边拦截；留空事项按空入库', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>y</div>';
  window.toggleRemPanel(true);
  const panel = window.document.getElementById('remPanel');
  const dateInp = panel.querySelector('input[type="date"]');
  const hhInp = panel.querySelector('input.rem-hh');
  const mmInp = panel.querySelector('input.rem-mm');
  const itemInput = panel.querySelector('input.rem-item');

  dateInp.value = '2020-01-01'; hhInp.value = '08'; mmInp.value = '00'; // 已过时刻
  [...panel.querySelectorAll('button')].find(b => b.textContent === '添加提醒').click();
  await sleep(30);
  assert.ok(dateInp.classList.contains('bad') && mmInp.classList.contains('bad'), '已过时刻必须加重提示（日期/时分框同标）');
  assert.strictEqual(puts.length, 0, '已过时刻不得发出 PUT');
  assert.strictEqual(window.document.getElementById('remBtn').classList.contains('on'), false, '已过时刻不得点亮提醒按钮（未入库）');

  // 重建面板（摆脱上一场景 bad 类的 900ms 消退窗口），填未来时刻
  window.toggleRemPanel(false);
  window.toggleRemPanel(true);
  const panel2 = window.document.getElementById('remPanel');
  const dateInp2 = panel2.querySelector('input[type="date"]');
  const hhInp2 = panel2.querySelector('input.rem-hh');
  const mmInp2 = panel2.querySelector('input.rem-mm');
  const future = new Date(Date.now() + 3600e3);
  const pad2 = n => String(n).padStart(2, '0');
  dateInp2.value = future.getFullYear() + '-' + pad2(future.getMonth() + 1) + '-' + pad2(future.getDate());
  hhInp2.value = pad2(future.getHours());
  mmInp2.value = pad2(future.getMinutes());
  // 留空事项直接点「添加提醒」
  [...panel2.querySelectorAll('button')].find(b => b.textContent === '添加提醒').click();
  await sleep(50);
  assert.strictEqual(dateInp2.classList.contains('bad'), false, '未来时刻不得触发红边');
  assert.strictEqual(puts.length, 1, '未来时刻 + 留空事项应正常保存');
  const remObj = JSON.parse(puts[0].rem);
  const list = JSON.parse(await window.decryptText(remObj.ct, remObj.iv, key)).list;
  assert.strictEqual(list.length, 1, '应入库 1 条');
  assert.strictEqual(list[0].text, '', '留空事项按空字符串入库，不取笔记首行');
  // v5.45：面板添加成功后正文必须回写完整时间行（留空事项只写时间）
  const d = new Date(list[0].at);
  const expectLine = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + pad2(d.getMinutes());
  assert.ok(editor.textContent.includes(expectLine), '正文必须回写时间行: ' + expectLine);
  assert.ok(!editor.textContent.includes('undefined'), '不得写入 undefined');
});

// ── R12c：v5.40 Esc / 遮罩空白点击关闭模态；事项框 Enter 直接确认 ──
test('R12c Esc 与遮罩点击关闭模态；事项框 Enter 等价点「添加提醒」', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>y</div>';
  window.toggleRemPanel(true);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(20);
  assert.ok(window.document.getElementById('remMask').classList.contains('hidden'), 'Esc 必须关闭模态');

  window.toggleRemPanel(true);
  const mask = window.document.getElementById('remMask');
  mask.dispatchEvent(new window.Event('click'));
  await sleep(20);
  assert.ok(mask.classList.contains('hidden'), '点遮罩空白处必须关闭模态');

  window.toggleRemPanel(true);
  const panel = window.document.getElementById('remPanel');
  const dateInp = panel.querySelector('input[type="date"]');
  const hhInp = panel.querySelector('input.rem-hh');
  const mmInp = panel.querySelector('input.rem-mm');
  const itemInput = panel.querySelector('input.rem-item');
  const future = new Date(Date.now() + 3600e3);
  const pad2 = n => String(n).padStart(2, '0');
  dateInp.value = future.getFullYear() + '-' + pad2(future.getMonth() + 1) + '-' + pad2(future.getDate());
  hhInp.value = pad2(future.getHours());
  mmInp.value = pad2(future.getMinutes());
  itemInput.value = '开会';
  itemInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(50);
  assert.strictEqual(puts.length, 1, 'Enter 必须等价于点「添加提醒」并完整保存');
  const remObj = JSON.parse(puts[0].rem);
  const listData = JSON.parse(await window.decryptText(remObj.ct, remObj.iv, key)).list;
  assert.strictEqual(listData[0].text, '开会', 'Enter 确认走真实入库，事项随行');
});

// ── R13：server.js 的 rem 透传语义（显式更新/未传保留）────
test('R13 server.js 对 rem 显式传参才更新、未传保留旧值', () => {
  const src = fs.readFileSync(path.resolve(INDEX_PATH, '..', 'server.js'), 'utf8');
  assert.ok(src.includes('obj.rem !== undefined'), '必须用 !== undefined 判断（null 是显式取消，不能混淆）');
  assert.ok(src.includes('rem = obj.rem'), '显式传参时采用新值');
  assert.ok(src.includes('let rem = cur.rem || null'), '未传时必须保留原值，否则正文保存会抹掉提醒');
});

// ── R14：sw.js 有通知点击处理；index 注册带版本；无 Web Push ─
test('R14 sw.js 含 notificationclick，提醒不引入 Web Push', () => {
  const sw = fs.readFileSync(path.resolve(INDEX_PATH, '..', 'sw.js'), 'utf8');
  assert.ok(sw.includes('notificationclick'), '点击通知应聚焦/打开笔记');
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!src.includes('pushManager'), '本地方案不引入 Web Push（零知识不让渡）');
  assert.ok(src.includes("register('/sw.js?v=' + encodeURIComponent(APP_VERSION))"), 'SW 注册仍带版本参数');
});

// ── R15：退出锁定清提醒态（卡片/chip/面板全收，按钮熄灭）──
test('R15 退出锁定后提醒态全部清空', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const at = Date.now() + 3600e3;
  await window.addReminder(at, '要办的事');
  assert.ok(window.document.getElementById('remBtn').classList.contains('on'), '前置：按钮已高亮');

  window.document.getElementById('lock').click();
  assert.ok(!window.document.getElementById('remBtn').classList.contains('on'), '锁定后按钮熄灭');
  assert.ok(window.document.getElementById('remCard').classList.contains('hidden'), '锁定后卡片收起');
  assert.ok(window.document.getElementById('remMask').classList.contains('hidden'), '锁定后提醒模态收起');
  assert.ok(window.document.getElementById('timeChip').classList.contains('hidden'), '锁定后 chip 收起');
});
