// v8.1.6 单元测试：正文→提醒删除联动的「出处指纹（src）」通道
// 根因回归：三条判据全建立在「按当天重算的时间戳」上，相对说法（明天/后天/周X/裸时刻/中文数字）
// 跨天算不出存量 at → 判删③「曾被见过」恒不成立 → 正文删掉后幽灵条目留在列表里到点照推。
// 覆盖：
//   A1 src 原文仍在正文 → 保留、不滚 at、不弹「提醒时间已更新」
//   A2 同会话内删掉正文那句（lastHtml 已推进，只剩会话指纹登记）→ 联动删除 + rem 置 null
//   A3 重开 App 后立刻删（loadReminder 的 seedRemSrcBaseline 路径 + normalizeRemList src 透传）→ 联动删除
//   A4 无 src 旧数据（跨天漂移 at）→ 维持 v7.4.0 保护面，绝不新增误删
//   A5 面板/绝对串回归（addReminder 三参、src 与回写正文行同串）→ 删行即删提醒
//   A6 改时间（同事项）→ at 更新且 src 随新串更新
//   A7 normalizeRemList 纯函数透传 src
//   A8 源码静态守护：判活/判见过两行 + 三处 seed 挂点 + MCP 侧同构
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const MCP_SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'notesync-mcp-server.js'), 'utf8');
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

// 「明天下午3点」按今天解析出的 at（真机 = 昨天写入时解析值的次日漂移形态）
function tomorrowAt(h, mi) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, mi || 0, 0, 0).getTime();
}

// ── A1：src 原文仍在正文 → 保留、不滚、不弹改时间 toast ──
test('A1 相对时间跨天漂移：src 仍在正文 → 提醒保留且 at 不被滚到明天', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const bodyHtml = '<div>明天下午3点　接橙子</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  assert.ok(editor.textContent.indexOf('明天下午3点') !== -1, '前置：正文应含相对时间原句');

  // 存量 at = 昨天写下这句话时解析出的「明天15:00」，今天再解析同一句得到的是新一天 → 时间戳口径必失配
  const atDrift = tomorrowAt(15) + 86400e3;
  window.eval('reminders = [{ at: ' + atDrift + ", text: '接橙子', fired: false, src: '明天下午3点' }];");
  const putsBefore = puts.length;
  await window.reconcileRemindersFromBody(window.htmlToRemText(bodyHtml));
  await sleep(150);

  const list = remList(window);
  assert.strictEqual(list.length, 1, 'src 原文仍在正文 → 一条都不能删');
  assert.strictEqual(list[0].at, atDrift, 'at 不得被逐日滚动改时间（旧实现会把它滚到明天 15:00）');
  assert.strictEqual(puts.length, putsBefore, '未发生变化时不得再推 rem（无删除、无滚动）');
  const toastEl = window.document.getElementById('versionToast');
  assert.ok(!toastEl || String(toastEl.textContent).indexOf('提醒时间已更新') === -1, '不得弹「提醒时间已更新」');
  assert.strictEqual(window.eval('remSeenSrc.has("明天下午3点")'), true, '对账应把确在正文的指纹登记为见过');
});

// ── A2：同会话删掉那句（lastHtml 已推进，只剩会话指纹登记）→ 联动删除 ──
test('A2 同会话内删正文相对句 → 提醒联动删除 + rem 显式置 null', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const bodyHtml = '<div>明天下午3点　接橙子</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const atDrift = tomorrowAt(15) + 86400e3;
  window.eval('reminders = [{ at: ' + atDrift + ", text: '接橙子', fired: false, src: '明天下午3点' }];");
  await window.reconcileRemindersFromBody(window.htmlToRemText(bodyHtml)); // 第一次：正文仍在 → 登记指纹
  assert.strictEqual(remList(window).length, 1, '前置：第一次对账应保留');

  // 用户删掉整句并保存：saveLocal 已把 lastHtml 推进为删后正文（旧实现因此丢尽「见过」证据）
  const newHtml = '<div>接橙子</div>';
  editor.innerHTML = newHtml;
  window.eval("lastHtml = '<div>接橙子</div>';");
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);

  assert.strictEqual(remList(window).length, 0, '正文原句已删 → 条目应被联动移除');
  const last = puts[puts.length - 1];
  assert.ok(last, '应发出对账后的 rem PUT');
  assert.strictEqual(last.rem, null, 'rem 应显式置 null（服务端清除字段）');
  const btn = window.document.getElementById('remBtn');
  assert.ok(btn && !btn.classList.contains('on'), '列表清空后闹钟按钮不应高亮');
});

// ── A3：重开 App 立刻删（loadReminder 尾的 seedRemSrcBaseline 是唯一证据来源）──
test('A3 重开即删：loadReminder 登记指纹后，删正文原句仍能联动删除', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const bodyHtml = '<div>明天下午3点　接橙子</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const atDrift = tomorrowAt(15) + 86400e3;
  const remObj = JSON.stringify({ list: [{ at: atDrift, text: '接橙子', fired: false, src: '明天下午3点' }] });
  const remEnc = await window.encryptText(remObj, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify({ ct: remEnc.ct, iv: remEnc.iv }) });

  // 快照先取：重开后、任何对账之前的内存列表（真实链路 = 密文 → normalizeRemList）
  const loaded = JSON.parse(JSON.stringify(remList(window)));
  assert.strictEqual(loaded.length, 1, '前置：重开后提醒应从密文恢复出 1 条');

  // 行为优先断言（旧实现在此掩蔽主症状）：重开后一次对账即须删，不依赖会话内先跑过一次对账
  const newHtml = '<div>接橙子</div>';
  editor.innerHTML = newHtml;
  window.eval("lastHtml = '<div>接橙子</div>';"); // 模拟保存已完成、基线正文同为删后版本
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  assert.strictEqual(remList(window).length, 0, '重开即删场景下也必须联动删除（用户实测症状：正文没了还照推）');
  assert.strictEqual(puts[puts.length - 1].rem, null, 'rem 应显式置 null');

  assert.strictEqual(window.eval('remSeenSrc.has("明天下午3点")'), true, 'loadReminder 尾应按当前正文登记指纹');
  assert.deepStrictEqual(loaded, [{ at: atDrift, text: '接橙子', fired: false, src: '明天下午3点' }], '密文恢复链路应把出处指纹原样带进内存列表（归一化透传的真实链路证据）');
});

// ── A4：无 src 旧数据 → 保持 v7.4.0 保护面，绝不新增误删 ──
test('A4 旧数据无出处指纹 → 判删保护面不放宽（与 v7.4.0 同结果）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('<div>接橙子</div>', key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const atDrift = tomorrowAt(15) + 86400e3;
  window.eval('reminders = [{ at: ' + atDrift + ", text: '接橙子', fired: false, src: '' }];");
  const putsBefore = puts.length;
  await window.reconcileRemindersFromBody('接橙子');
  await sleep(150);
  assert.strictEqual(remList(window).length, 1, '无指纹 + 时间戳从未见过 → 维持不删（宁可留，绝不新增误删面）');
  assert.strictEqual(puts.length, putsBefore, '未删未滚 → 不推 rem');
});

// ── A5：面板/绝对串回归（src 与写回正文行同串）──
test('A5 面板添加：src = fmtRemInsert 同串，删掉回写行即联动删除', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const at = Math.floor((Date.now() + 7 * 86400e3) / 60000) * 60000;
  const bodyHtml = '<div>' + window.fmtRemInsert(at) + '　买牛奶</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  assert.strictEqual(await window.addReminder(at, '买牛奶', window.fmtRemInsert(at)), true, 'addReminder 应成功');
  assert.strictEqual(remList(window)[0].src, window.fmtRemInsert(at), 'src 应与写回正文的时间串逐字同串');

  const newHtml = '<div>买牛奶</div>';
  editor.innerHTML = newHtml;
  window.eval("lastHtml = " + JSON.stringify(bodyHtml) + ";"); // 基线仍是写回后的那一行（saveLocal 推进前的窗口）
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  assert.strictEqual(remList(window).length, 0, '删掉回写行 → 绝对串提醒照旧联动删除（v7.4.0 行为不回归）');
  assert.strictEqual(puts[puts.length - 1].rem, null, 'rem 应显式置 null');
});

// ── A6：改时间随动更新 src ──
test('A6 改时间（同事项）→ at 更新且出处指纹随新串更新', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const oldHtml = '<div>明天下午3点　接橙子</div>';
  const noteCt = await window.encryptText(oldHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const atOld = tomorrowAt(15);
  window.eval('reminders = [{ at: ' + atOld + ", text: '接橙子', fired: false, src: '明天下午3点' }];");

  const newHtml = '<div>明天下午4点　接橙子</div>';
  editor.innerHTML = newHtml;
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  const list = remList(window);
  assert.strictEqual(list.length, 1, '同事项改时间 → 不得丢提醒');
  assert.strictEqual(list[0].at, tomorrowAt(16), 'at 应更新为新时间串解析值');
  assert.strictEqual(list[0].src, '明天下午4点', '出处指纹必须随新串更新（留旧串会永久失联）');
});

// ── A7：normalizeRemList 纯函数透传 ──
test('A7 normalizeRemList 透传 src（含跨端合并/草稿恢复共用的同一归一化）', () => {
  const app = freshApp();
  const { window } = app;
  try {
    const at = Date.now() + 3600e3;
    const out = window.normalizeRemList({ list: [{ at: at, text: 'a', fired: false, src: '明天上午10点' }, { at: at + 1000, text: 'b' }] });
    assert.strictEqual(out[0].src, '明天上午10点', '有指纹须原样带过');
    assert.strictEqual(out[1].src, '', '无指纹归一为空串（不是 undefined，防 JSON 丢字段后语义漂移）');
  } finally { window.close(); }
});

// ── A8：源码形态静态守护（锚定补丁行，防回潮）──
test('A8 源码守护：判活/判见过两行 + 三处 seed 挂点 + MCP 侧同构', () => {
  assert.ok(/async function addReminder\(at, text, src\) \{/.test(SRC), 'addReminder 应带第三参 src');
  assert.ok(SRC.includes("const srcSeen = !!srcOld &&"), '无指纹时 srcSeen 必须恒 false（保护面不放宽）');
  assert.ok(SRC.includes('if (liveAt.has(r.at) || srcAlive) continue;'), '判活须含原文通道');
  assert.ok(SRC.includes('if (!seenBase.has(r.at) && !srcSeen) continue;'), '判删③须接受指纹证据');
  assert.strictEqual((SRC.match(/seedRemSrcBaseline\(\);/g) || []).length, 3, '三处挂点：loadReminder / mergeRemoteReminders / restoreReminderDraft');
  assert.strictEqual((SRC.match(/backfillRemSrcFromBody\(\);/g) || []).length, 3, '存量回填与三处挂点同位（列表落定处先补再登记）');
  assert.ok(SRC.includes('const srcAlive = !!srcOld && liveSrcs.has(srcOld);'), '判活必须走全词命中集合，不得退回裸 indexOf');
  assert.ok(SRC.includes('remSeenSrc.has(srcOld) || !!(prevSrcs && prevSrcs.has(srcOld))'), '判删③指纹证据同样必须全词命中');
  assert.ok(!/bodyText\.indexOf\(srcOld\)|prevText\.indexOf\(srcOld\)/.test(SRC), '短指纹裸子串比对已退役（会双向失真：误续命/误放行删）');
  assert.ok(SRC.includes('const usedCand = new Set();'), '回填必须做匹配去重（一条时间匹配只发给一条条目）');
  assert.ok(/if \(cand\.length === 1\) \{[\s\S]{0,120}usedCand\.add\(cand\[0\]\);/.test(SRC), '存量回填必须「未占用候选恰好一个」才补并消费该候选');
  assert.ok(SRC.includes("chipData = { at: m.at, item: item, src: remSanitize(text.slice(m.index, m.index + m.length)) }"), 'chip 侧须记录命中的原始时间串');
  assert.ok(SRC.includes('addReminder(at, text, fmtRemInsert(at))'), '面板侧 src 与写回正文同串');
  assert.ok(MCP_SRC.includes('src: fmtRemLine(at)'), 'MCP note_remind add 应带指纹');
  assert.ok(/\.map\(r => \(\{ at: r\.at, text: typeof r\.text === 'string' \? r\.text : '', fired: !!r\.fired, src: typeof r\.src === 'string' \? r\.src : '' \}\)\)/.test(MCP_SRC), 'MCP normRemList 应与 web 同构透传 src');
  assert.ok(MCP_SRC.includes("src: typeof r.src === 'string' ? r.src : '' }))); // v8.1.6：恢复备份必须带出处指纹"), 'MCP 备份恢复路径不得洗掉指纹');
});

// ── A9：短指纹裸子串不得充当「见过」证据（绝新增误删面）──
test('A9 正文只有更长匹配「今天下午3点」时，src=「下午3点」不算见过 → 维持不删', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const oldHtml = '<div>今天下午3点开会</div>';
  const noteCt = await window.encryptText(oldHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  const atDrift = tomorrowAt(15) + 86400e3; // 与正文那条「今天下午3点」解析值不同刻，且从未被解析见过
  window.eval('reminders = [{ at: ' + atDrift + ", text: '接橙子', fired: false, src: '下午3点' }];");
  const putsBefore = puts.length;
  editor.innerHTML = '<div>接橙子</div>'; // 用户删掉了自己那句；正文里另有一行含「下午3点」子串
  await window.reconcileRemindersFromBody('接橙子');
  await sleep(150);
  assert.strictEqual(remList(window).length, 1, '子串巧合不得放行删除（他端 merge 来的条目保护面必须保住）');
  assert.strictEqual(puts.length, putsBefore, '未删未滚 → 不推 rem');
});

// ── A10：存量无指纹条目按唯一同事项时间匹配回填 → 老提醒也自愈 ──
test('A10 升级前的历史提醒（无 src）回填指纹后，删正文原句即联动删除', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const bodyHtml = '<div>明天上午10点　接橙子</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const atLegacy = tomorrowAt(10) + 86400e3; // 前天写下这句话时算出的「明天10:00」
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atLegacy, text: '接橙子', fired: false }] }), key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify({ ct: remEnc.ct, iv: remEnc.iv }) });
  const loaded = JSON.parse(JSON.stringify(remList(window)));
  assert.strictEqual(loaded[0].src, '明天上午10点', 'loadReminder 尾应把正文里唯一的同事项时间匹配补成指纹');
  assert.strictEqual(window.eval('remSeenSrc.has("明天上午10点")'), true, '回填出的指纹须随即登记为见过');

  const newHtml = '<div>接橙子</div>';
  editor.innerHTML = newHtml;
  window.eval("lastHtml = '<div>接橙子</div>';");
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  assert.strictEqual(remList(window).length, 0, '历史提醒删正文后同样联动删除（用户手机里那条幽灵的自愈路径）');
  assert.strictEqual(puts[puts.length - 1].rem, null, 'rem 应显式置 null');
});

// ── A11：srcLiteralSet 全词命门口径（纯函数）──
test('A11 srcLiteralSet 只产时间匹配原文，长匹配不产出短指纹', () => {
  const app = freshApp();
  const { window } = app;
  try {
    const s = window.srcLiteralSet('今天下午3点开会，另外记一句 2026-9-20 10:00');
    assert.strictEqual(s.has('今天下午3点'), true, '独立时间匹配应在集合里');
    assert.strictEqual(s.has('下午3点'), false, '更长匹配的裸子串不得进集合（A9 的判据来源）');
    assert.strictEqual(s.has('2026-9-20 10:00'), true, '绝对串同样按解析原文入集合');
    assert.strictEqual(window.srcLiteralSet('').size, 0, '空正文不得产出任何指纹');
  } finally { window.close(); }
});

// ── A12：回填去重——多条同事项历史条目不得共指纹（闸复验 P1 连坐误删回归）──
test('A12 两条同事项历史条目面对唯一时间匹配 → 只近的一条拿指纹，另一条维持不删保护', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const bodyHtml = '<div>明天上午10点　接橙子</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const atNear = tomorrowAt(10) + 86400e3;      // 与正文匹配差 1 天
  const atFar = tomorrowAt(10) + 2 * 86400e3;   // 与正文匹配差 2 天（同样落在 ≤2 天窗口内）
  const remEnc = await window.encryptText(JSON.stringify({ list: [
    { at: atNear, text: '接橙子', fired: false }, { at: atFar, text: '接橙子', fired: false },
  ] }), key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x', rem: JSON.stringify({ ct: remEnc.ct, iv: remEnc.iv }) });
  const loaded = JSON.parse(JSON.stringify(remList(window)));
  assert.strictEqual(loaded.length, 2, '前置：两条历史条目都应从密文恢复');
  assert.strictEqual(loaded[0].src, '明天上午10点', '离匹配时刻更近的条目先取指纹');
  assert.strictEqual(loaded[1].src, '', '该匹配已被消费 → 另一条绝不共指纹');

  const newHtml = '<div>接橙子</div>';
  editor.innerHTML = newHtml;
  window.eval("lastHtml = '<div>接橙子</div>';");
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  const left = remList(window);
  assert.strictEqual(left.length, 1, '删正文只准带走有出处的那条（共指纹会连坐全删）');
  assert.strictEqual(left[0].at, atFar, '剩下的必须是无证据的远条目（v7.4.0「从未见过→绝不删」保护面）');
});
