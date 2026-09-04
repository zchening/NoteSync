// v5.36 便签提醒 单元测试（L1+L2 本地方案）
// 方案要点（用户已拍板）：rem 与正文同一把 key 加密、服务端存密文零知识不变；
// server.js 对 PUT 的 rem 显式传参才更新、未传则保留（否则正文保存会抹掉提醒）；
// 触发三通道：页内定时器/SW 通知 + 下次打开补弹（唯一 100% 兜底）+ Triggers 探测；
// 权限只在用户主动设提醒时申请；多设备重复弹接受、REM_DONE 防同机重复。
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
async function unlock(window, key, note) { await window.applyUnlocked(key, note); }
const DK = 'notesync_draft_';
const DONE = 'notesync_remdone_';

// ── R1：设置提醒 → PUT 带 rem 密文、按钮高亮 ─────────────
test('R1 setReminder 上传 rem 密文字段并更新状态', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('<div>买牛奶</div>', key);
  const puts = mockCapture(window, {}, 6);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>买牛奶</div>';
  const at = Date.now() + 3600e3;
  await window.setReminder(at, '买牛奶');

  const last = puts[puts.length - 1];
  assert.ok(last.rem, 'PUT 必须携带 rem 字段');
  const remObj = JSON.parse(last.rem);
  assert.ok(remObj.ct && remObj.iv, 'rem 必须是 {ct,iv} 密文结构');
  const payload = JSON.parse(await window.decryptText(remObj.ct, remObj.iv, key));
  assert.strictEqual(payload.at, at, 'rem 解密后必须是原提醒时间');
  assert.strictEqual(payload.text, '买牛奶', 'rem 解密后必须是提醒文案');
  assert.ok(window.document.getElementById('remBtn').classList.contains('on'), '有提醒时闹钟按钮应高亮');
});

// ── R2：解锁恢复未来提醒 → 不弹条、按钮高亮 ───────────────
test('R2 解锁时从服务端密文恢复未来提醒并重新调度', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const at = Date.now() + 3600e3;
  const remEnc = await window.encryptText(JSON.stringify({ at: at, text: '开会' }), key);
  mockCapture(window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) }, 5);

  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) });

  assert.ok(window.document.getElementById('remBar').classList.contains('hidden'), '未来提醒绝不弹条');
  assert.ok(window.document.getElementById('remBtn').classList.contains('on'), '按钮应高亮（提醒已从密文恢复为未来时间）');
});

// ── R3：过期提醒 → 解锁即补弹（唯一 100% 兜底）────────────
test('R3 过期且未确认的提醒在解锁时补弹提示条', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const past = Date.now() - 7200e3; // 2 小时前
  const remEnc = await window.encryptText(JSON.stringify({ at: past, text: '过期的事' }), key);
  mockCapture(window, {}, 5);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) });

  const bar = window.document.getElementById('remBar');
  assert.ok(!bar.classList.contains('hidden'), '过期提醒必须补弹');
  assert.ok(window.document.getElementById('remMsg').textContent.includes('过期的事'), '提示条应显示提醒文案');
  assert.ok(window.document.getElementById('remMsg').textContent.includes('小时'), '应显示已过期时长');
});

// ── R4：补弹确认后不再重复弹（REM_DONE 去重）──────────────
test('R4 确认后记录时间戳，重开不再弹', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, localStorage } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const past = Date.now() - 600e3;
  const remEnc = await window.encryptText(JSON.stringify({ at: past, text: '旧事' }), key);
  const note = { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  mockCapture(window, note, 5);
  await unlock(window, key, note);

  window.document.getElementById('remAck').click();
  assert.strictEqual(localStorage.getItem(DONE), String(past), '确认必须写入 REM_DONE');
  assert.ok(window.document.getElementById('remBar').classList.contains('hidden'), '确认后收起');

  await unlock(window, key, note); // 模拟重开
  assert.ok(window.document.getElementById('remBar').classList.contains('hidden'), '已确认的过期提醒不再弹');
});

// ── R5：取消提醒 → PUT 显式 rem:null（服务端据此清除）─────
test('R5 clearReminder 显式上传 rem:null', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  const puts = mockCapture(window, {}, 6);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>y</div>';
  await window.setReminder(Date.now() + 3600e3, 't');
  await window.clearReminder();

  const last = puts[puts.length - 1];
  assert.strictEqual(last.rem, null, '取消必须显式传 null（undefined 是保留语义）');
  assert.ok(!window.document.getElementById('remBtn').classList.contains('on'), '取消后按钮熄灭');
});

// ── R6：权限被拒 → 降级页面内提示条（不静默丢）────────────
test('R6 无通知权限时触发降级为页面内提示条', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 5);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  window.Notification = function () {};
  window.Notification.permission = 'denied';
  // 注意：reminder 是页面顶层 let（词法绑定，不挂 window），测试必须走真实
  // setReminder 路径建立状态，不能直接改 window.reminder（那是无效属性）
  await window.setReminder(Date.now() + 1000, '降级测试');
  await window.fireReminder();

  assert.ok(!window.document.getElementById('remBar').classList.contains('hidden'), '权限被拒必须用提示条兜底');
});

// ── R7：有权限 + SW → 走 showNotification ─────────────────
test('R7 有权限时通过 ServiceWorker 弹系统通知', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 5);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  const swNotifs = [];
  window.Notification = function () {};
  window.Notification.permission = 'granted';
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({ active: {}, showNotification: (ti, o) => { swNotifs.push({ ti: ti, o: o }); return Promise.resolve(); } }) }
  });
  await window.setReminder(Date.now() + 1000, '开会提醒');
  await window.fireReminder();

  assert.strictEqual(swNotifs.length, 1, '应通过 SW showNotification 弹出');
  assert.ok(swNotifs[0].ti.includes('开会提醒'), '通知标题应含提醒文案');
  assert.strictEqual(swNotifs[0].o.tag, 'notesync-rem', 'tag 固定便于系统去重');
  assert.ok(window.document.getElementById('remBar').classList.contains('hidden'), '通知成功后无需提示条');
});

// ── R8：默认提醒文案取笔记首行（截 20 字）─────────────────
test('R8 noteFirstLine 取首行文字并截断 20 字', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 5);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>这是第一行</div><div>第二行</div>';
  assert.strictEqual(window.noteFirstLine(), '这是第一行', '只取首行');
  editor.innerHTML = '<div>' + '很'.repeat(30) + '</div>';
  const s = window.noteFirstLine();
  assert.ok(s.length === 21 && s.endsWith('…'), '超长应截断 20 字加省略号');
});

// ── R9：面板渲染快捷时间（今晚 8 点过点自动变明晚）────────
test('R9 面板未设状态渲染快捷时间按钮', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockCapture(window, {}, 5);
  await unlock(window, key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  window.toggleRemPanel(true);
  const html = window.document.getElementById('remPanel').textContent;
  assert.ok(html.includes('1 小时后'), '快捷按钮：1 小时后');
  assert.ok(html.includes('今晚 8 点') || html.includes('明晚 8 点'), '快捷按钮：今晚/明晚 8 点（过 20:00 自动切换）');
  assert.ok(html.includes('明天上午 9 点'), '快捷按钮：明天上午 9 点');
  window.toggleRemPanel(false);
  assert.ok(window.document.getElementById('remPanel').classList.contains('hidden'), '关闭后收起');
});

// ── R10：server.js 的 rem 透传语义（显式更新/未传保留）────
test('R10 server.js 对 rem 显式传参才更新、未传保留旧值', () => {
  const src = fs.readFileSync(path.resolve(INDEX_PATH, '..', 'server.js'), 'utf8');
  assert.ok(src.includes('obj.rem !== undefined'), '必须用 !== undefined 判断（null 是显式取消，不能混淆）');
  assert.ok(src.includes('rem = obj.rem'), '显式传参时采用新值');
  assert.ok(src.includes('let rem = cur.rem || null'), '未传时必须保留原值，否则正文保存会抹掉提醒');
});

// ── R11：sw.js 有通知点击处理；index 注册带版本 ────────────
test('R11 sw.js 含 notificationclick，提醒不引入 Web Push', () => {
  const sw = fs.readFileSync(path.resolve(INDEX_PATH, '..', 'sw.js'), 'utf8');
  assert.ok(sw.includes('notificationclick'), '点击通知应聚焦/打开笔记');
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(!src.includes('pushManager'), '本地方案不引入 Web Push（零知识不让渡）');
  assert.ok(src.includes("register('/sw.js?v=' + encodeURIComponent(APP_VERSION))"), 'SW 注册仍带版本参数');
});
