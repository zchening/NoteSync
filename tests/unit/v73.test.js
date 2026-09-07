// v7.3.0 单元测试——「保存冲突频繁」五根因修复的回归护栏：
//   P0-5 提醒系统解耦：persistReminders 的 409 走系统通道 handleReminderConflict，
//        只合并提醒列表，绝不弹用户冲突条（「没打字也弹条」根因）
//   P0-1 解密比较自动接受：409 后解密远端正文，与本机 lastHtml/编辑器当前内容
//        严格/装饰等价 → 静默采纳版本不弹条（AES-GCM 随机 IV，不能比 ct/iv）
//   P0-2 二次 409 收口：用户拍板「保留我的」后重传再 409 → 自动以最新 v 重试一次
//   P2-4 保存互斥：saveLocal/persistReminders 共享 busy，杜绝单设备并发 PUT 互 409
// 对抗审核修正（v7.3.0 定稿）：
//   HB2：handleReminderConflict 采纳 v 前解密比较——正文真实差异 → 挂起弹条，绝不静默覆盖
//   HB3：撤销 sseV 提升——baseV 一律 localVer（sseV 抬高会在 poll 打字 defer 窗口静默吞他端内容）
//   P1-4：persistReminders 入口 pendingRemoteNote 守卫（冲突条挂起期提醒保存不 PUT）
// 二轮对抗审核（v7.3.0 定稿，7 分打回后补修）：
//   HB6-P1-1：pendingRemPush 消费点移出 saveLocal finally——html===lastHtml 时 saveLocal 早退、
//        finally 不执行，挂起期提醒改动/合并结果只存内存重载即丢；remoteKeep 内显式补推
//   HB6-P1-2：REM_DRAFT_KEY 按 noteId 隔离，防多笔记 Tab 跨笔记草稿污染
//   HB6-P2-2：mergeRemoteReminders 合并产物重套 REM_MAX/REM_DONE_MAX（远端+本机可超限）
// 结构沿 v556.test.js：源码断言 + jsdom 行为测试（全程不碰真实服务器）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

function freshApp(extra, pageUrl) {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
    if (typeof extra === 'function') extra(w);
  }, pageUrl);
  return { dom, window: dom.window, editor: dom.window.document.getElementById('editor') };
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
function remoteBarOf(window) { return window.document.getElementById('remoteBar'); }

// ═══════════ 源码断言 ═══════════
test('V73-S1 HB3：baseV 一律 localVer——无 sseV/currentBaseV，SSE 不记录、三处 PUT/草稿带 baseV', () => {
  assert.ok(!/let sseV = 0;/.test(SRC), '不应再有 sseV 声明（SSE 已知版本不得提升 PUT baseV）');
  assert.ok(!SRC.includes('function currentBaseV'), '不应再有 currentBaseV（sseV 提升已撤销）');
  assert.ok(!/sseV = d\.v/.test(SRC), 'SSE onmessage 不应记录 sseV');
  assert.ok(/function writeDraft[\s\S]{0,400}baseV: localVer/.test(SRC), 'writeDraft 草稿应记录 baseV=localVer');
  assert.ok(/sseSource\.onmessage = \(\) => \{ poll\(\); \}/.test(SRC), 'SSE onmessage 应只触发 poll');
});

test('V73-S2 P2-4：saveLocal 入口 busy 守卫排队补挂 + persistReminders 等待互斥', () => {
  assert.ok(/function saveLocal[\s\S]{0,250}if \(busy\) \{ pendingResave = true; return; \}/.test(SRC), 'saveLocal 入口应排队补挂');
  assert.ok(/async function persistReminders[\s\S]{0,250}while \(busy\) await/.test(SRC), 'persistReminders 应等待上一轮保存收尾');
  assert.ok(/pendingResave = false;[\s\S]{0,120}saveTimer = setTimeout\(saveLocal, 300\)/.test(SRC), '互斥收尾应补挂正文保存');
});

test('V73-S3 P0-5：提醒 409 走系统通道 handleReminderConflict，绝不弹用户条', () => {
  assert.ok(SRC.includes('async function handleReminderConflict'), '应有 handleReminderConflict');
  assert.ok(SRC.includes('async function mergeRemoteReminders'), '应有 mergeRemoteReminders');
  assert.ok(/status === 409 && retryLeft > 0[\s\S]{0,200}handleReminderConflict\(retryLeft - 1\)/.test(SRC), 'persistReminders 409 应走系统通道');
  assert.ok(/mergeRemoteReminders[\s\S]{0,400}正文零触碰/.test(SRC), '合并提醒列表不得替换正文');
  assert.ok(/async function persistReminders[\s\S]{0,300}if \(pendingRemoteNote\)[\s\S]{0,120}return;/.test(SRC), 'persistReminders 入口应守 pendingRemoteNote（P1-4：冲突条挂起期提醒保存不 PUT）');
  assert.ok(/if \(nv > localVer\)[\s\S]{0,400}decryptText\(note\.ct, note\.iv, cryptoKey\)/.test(SRC), 'handleReminderConflict 采纳 v 前应解密远端正文（HB2）');
});

test('V73-S4 P0-1：409 后解密比较，等价自动采纳版本', () => {
  assert.ok(/handleWriteConflict[\s\S]{0,600}decryptText\(note\.ct, note\.iv, cryptoKey\)/.test(SRC), 'handleWriteConflict 应解密远端正文');
  assert.ok(/remoteHtml === lastHtml \|\| isDecorativelyEqual\(remoteHtml, lastHtml\)/.test(SRC), '应比较 lastHtml 严格/装饰等价');
  assert.ok(/remoteHtml === pendingHtml \|\| isDecorativelyEqual\(remoteHtml, pendingHtml\)/.test(SRC), '应比较编辑器当前内容');
  assert.ok(/localVer = note\.v \|\| localVer;[\s\S]{0,300}pendingResave = true;/.test(SRC), '等价时应采纳版本并补挂重传');
});

test('V73-S5 P0-2：keepMineArmed 声明 + 三处生命周期', () => {
  assert.ok(/let keepMineArmed = false;/.test(SRC), '应有 keepMineArmed 声明');
  assert.ok(/remoteKeep[\s\S]{0,2500}keepMineArmed = true/.test(SRC), '拍板「保留我的」应置位');
  assert.ok(/saveLocal[\s\S]{0,3000}keepMineArmed = false; \/\/ P0-2：保存成功/.test(SRC), '保存成功应清除标记');
  assert.ok(/retryKeepMineSave[\s\S]{0,1500}pendingResave = true/.test(SRC), '二次 409 应补挂重传');
  assert.ok(/keepMineArmed = false; \/\/ P0-2：锁定清/.test(SRC), '退出锁定应清除标记');
});

test('V73-S6 新函数均顶层声明（window 可调）+ 409 分支不自动退避重试', () => {
  for (const fn of ['handleReminderConflict', 'mergeRemoteReminders', 'retryKeepMineSave']) {
    assert.ok(new RegExp('(async )?function ' + fn + '\\(').test(SRC), '应有顶层函数 ' + fn);
  }
  assert.ok(/status === 409[\s\S]{0,300}keepMineArmed\)[\s\S]{0,80}retryKeepMineSave\(\)[\s\S]{0,80}handleWriteConflict\(\)/.test(SRC), 'saveLocal 409 应先查 keepMineArmed 收口，未接线时走 handleWriteConflict 挂起且不自动退避重试');
});

test('V73-S7 对抗审核二轮：HB1/HB2/HB3/HB4/HB5 接线齐全', () => {
  // HB1：remoteKeep 拍板前合并远端提醒 + 置 pendingRemPush
  assert.ok(/remoteKeep[\s\S]{0,900}mergeRemoteReminders\(note, cryptoKey\)[\s\S]{0,150}pendingRemPush = true/.test(SRC), 'remoteKeep 应先合并远端提醒并置 pendingRemPush（HB1：他端提醒不被后续整表覆盖抹掉）');
  // HB2：用户通道等价采纳分支补推 rem（与系统通道 handleReminderConflict 对称）
  assert.ok(/let pendingRemPush = false;/.test(SRC), '应有 pendingRemPush 声明');
  assert.ok(/localVer = note\.v \|\| localVer;[\s\S]{0,400}mergeRemoteReminders\(note, cryptoKey\); pendingRemPush = true/.test(SRC), 'handleWriteConflict 等价采纳+合并后应置 pendingRemPush');
  assert.ok(/finally \{[\s\S]{0,250}if \(pendingRemPush\)[\s\S]{0,250}persistReminders\(2\)/.test(SRC), 'saveLocal finally 应消费 pendingRemPush 补推 rem（HB2 通道收尾）');
  // HB3：服务端 v ≤ 本机（回滚/并发窗口闭合）先对齐 baseV 再补挂（防无限 409 循环）
  assert.ok(/if \(\(note\.v \|\| 0\) < localVer\) \{ localVer = note\.v \|\| 0; setStatus/.test(SRC), 'handleWriteConflict 兜底分支应先对齐 baseV（HB3）');
  // HB5：retryKeepMineSave GET 失败 → pendingResave（不依赖可能已耗尽的退避计数）
  assert.ok(/retryKeepMineSave[\s\S]*?catch[\s\S]{0,150}pendingResave = true/.test(SRC), 'retryKeepMineSave 失败应补挂重传而非仅退避（HB5）');
  // HB4：挂起期提醒草稿 stash/take + P1-4 早退落草稿 + remoteTake 拍板后补入
  assert.ok(/function stashReminderDraft/.test(SRC) && /function takeReminderDraft/.test(SRC), '应有提醒草稿 stash/take 函数（HB4）');
  assert.ok(/if \(pendingRemoteNote\)[\s\S]{0,200}stashReminderDraft\(\); return;/.test(SRC), 'persistReminders P1-4 早退应落草稿');
  assert.ok(/remoteTake[\s\S]{0,1400}takeReminderDraft\(\)/.test(SRC), 'remoteTake 拍板后应补入挂起期提醒草稿');
});

test('V73-S8 二轮审核：草稿键按 noteId 隔离 + remoteKeep 补推消费点移出 finally', () => {
  // HB6-P1-2：REM_DRAFT_KEY 带 noteId 后缀（对齐 DRAFT_KEY/CACHE_KEY），防多笔记 Tab 跨笔记污染
  assert.ok(/REM_DRAFT_KEY = 'notesync_rem_draft_' \+ noteId/.test(SRC), '提醒草稿键应带 noteId 后缀（P1-2 跨笔记污染修复）');
  // HB6-P1-1：remoteKeep 内取草稿 → 统一 needRemPush 判断 → saveLocal 后显式 persistReminders 补推
  assert.ok(/const needRemPush = !!\(pendingRemPush \|\| \(draft && draft\.length\)\);/.test(SRC), 'remoteKeep 应以 pendingRemPush/草稿非空合成补推意图（P1-1：挂起期提醒改动零丢失）');
  assert.ok(/if \(needRemPush\) pendingRemPush = false;[\s\S]{0,200}await saveLocal\(\);[\s\S]{0,200}if \(needRemPush\)[\s\S]{0,120}persistReminders\(2\)/.test(SRC), '应先在 remoteKeep 清 pendingRemPush 防双 PUT，再 saveLocal 后显式补推（P1-1 消费点移出 finally）');
  // HB6-P2-2：mergeRemoteReminders 合并产物重套 REM_MAX/REM_DONE_MAX
  assert.ok(/reminders = normalizeRemList\(\{ list: merged \}\);/.test(SRC), '合并产物应重套提醒上限（P2-2 契约漂移修复）');
});

test('V73-S9 三轮对抗审核：P1-A/P1-B/P1-C + P2-a/b/d 补丁接线', () => {
  // P1-A：poll 级0/级1 挂起期守卫（挂起期不消费版本、不应用远端 rem）——必须出现两处（级0+级1）
  const guardCount = (SRC.match(/if \(pendingRemoteNote\) \{ pendingRemoteNote = note; return; \}/g) || []).length;
  assert.ok(guardCount >= 2, 'poll 级0/级1 都应有挂起守卫（P1-A：远端提醒整表替换不得清掉挂起期本机提醒），实际 ' + guardCount + ' 处');
  // P1-A(b)：remoteKeep 草稿内容真正并入列表（对称 remoteTake，非仅布尔信号）
  assert.ok(/remoteKeep[\s\S]{0,2500}for \(const d of draft\) if \(!seen\.has\(d\.at\)\)/.test(SRC), 'remoteKeep 应把草稿内容并入提醒列表（P1-A 最后防线）');
  // P1-B：restoreReminderDraft 定义 + applyUnlocked 调用 + take/restore 新鲜度校验
  assert.ok(/async function restoreReminderDraft/.test(SRC), '应有 restoreReminderDraft（P1-B read-back）');
  assert.ok(/await restoreReminderDraft\(\);/.test(SRC), 'applyUnlocked 应调用草稿恢复（P1-B 重载不丢）');
  assert.ok(/REM_DRAFT_TTL = 24 \* 3600 \* 1000/.test(SRC), '应有草稿 24h 新鲜度常量（P1-B）');
  assert.ok(/Date\.now\(\) - obj\.at > REM_DRAFT_TTL/.test(SRC), 'take/restore 应校验草稿新鲜度（P1-B 防陈旧注入）');
  // P1-C：retryKeepMineSave 收口前解密比较 + remoteKeep finally 无条件清武装
  assert.ok(/retryKeepMineSave[\s\S]{0,900}decryptText\(n2\.ct, n2\.iv, cryptoKey\)/.test(SRC), '二次 409 收口前应解密比较（P1-C：武装只作自动采纳许可，不跳过比较）');
  assert.ok(/finally \{[\s\S]{0,150}keepMineArmed = false; \/\/ P1-C/.test(SRC), 'remoteKeep 应 finally 无条件清武装（P1-C：武装限本次交互）');
  // P2-a：提醒草稿密文落盘（零知识）
  assert.ok(/JSON\.stringify\(\{ ct: enc\.ct, iv: enc\.iv, at: Date\.now\(\) \}\)\)/.test(SRC), '提醒草稿应密文落盘（P2-a 明文不落盘）');
  // P2-b：合并未来条目超限时优先保本机独有条目
  assert.ok(/const locals = future\.filter\(r => r\._local\)/.test(SRC), '合并超限应优先保本机独有条目（P2-b 契约）');
  // P2-d：同刻条目本机文案优先
  assert.ok(/m\.text = l\.text \|\| m\.text;/.test(SRC), '同刻条目应以本机文案为准（P2-d）');
});

// ═══════════ jsdom 行为 ═══════════
test('V73-B1 HB3：PUT baseV 恒为 localVer，SSE 已知更高版本不得提升', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  let lastBaseV = null;
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    if (m === 'PUT' && u.includes('/api/note/') && !u.includes('/history')) {
      lastBaseV = JSON.parse(opts.body).baseV;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 9 }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 9 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  editor.innerHTML = '<div>base</div><div>新内容</div>';
  await window.saveLocal(); // 即便 SSE 已广播更高版本（旧 P1-7 会提升），PUT baseV 必须仍为 localVer
  assert.equal(lastBaseV, 5, 'PUT baseV 应为 localVer=5，不得被 SSE 已知版本抬高（HB3 静默覆盖根修）');
});

test('V73-B2 P0-1：409 后远端正文与 lastHtml 严格一致 → 静默采纳版本，不弹条', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const sameCt = await window.encryptText('<div>base</div>', key); // 同明文不同 IV（AES-GCM 特性，ct 必不同）
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  const bar = remoteBarOf(window);
  // 用户已打字（编辑器 ≠ lastHtml），但远端正文与 lastHtml 严格一致（他端仅 rem/装饰 bump）
  editor.innerHTML = '<div>base</div><div>新输入</div>';
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6, ct: sameCt.ct, iv: sameCt.iv, salt: 'x', rem: null }) });
  await window.handleWriteConflict();
  assert.equal(bar.classList.contains('hidden'), true, '等价内容不得弹冲突条');
  assert.equal(window.eval('localVer'), 6, '应采纳远端版本');
  assert.equal(window.eval('pendingResave'), true, '应标记补挂重传');
  assert.equal(window.eval('pendingRemoteNote'), null, '不得挂起远端快照');
});

test('V73-B3 P0-2：「保留我的」后二次 409 自动收口重试一次，不再二次弹条（判别性：远端正文等价——收口成功路径）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const mineHtml = '<div>base</div><div>我的内容</div>';
  const mineCt = await window.encryptText(mineHtml, key); // 收口时远端正文与本机待存内容严格一致 → P1-C 解密比较放行，自动采纳 v 收口（真实差异场景由 V73-B11 判别）
  let notePuts = 0;
  // 远端状态机：解锁期 v5（startSync 立即 poll 静默），keepMineArmed 前置推进 v6 + 等价正文
  let remoteNote = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    const isNote = u.includes('/api/note/') && !u.includes('/history'); // history 快照 PUT 排除
    if (m === 'PUT' && isNote) {
      notePuts++;
      if (notePuts === 1) return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ v: 6 }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 7 }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 7 }) }); // history 等附属 PUT 放行
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(remoteNote) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  await sleep(50); // 等 startSync 立即 poll（GET v5 静默）收尾
  remoteNote = { v: 6, ct: mineCt.ct, iv: mineCt.iv, salt: 'x' }; // 他端也提交了相同正文（等价）——收口前解密比较放行，采纳 v6 重传
  window.eval('keepMineArmed = true;'); // 模拟用户已拍板「保留我的」
  editor.innerHTML = mineHtml;
  await window.saveLocal(); // 首 PUT 409 → keepMineArmed 门控 → retryKeepMineSave（GET v6 解密等价采纳）→ finally 补挂重传
  await sleep(500); // 等 finally 补挂的 saveLocal（300ms）完成
  assert.equal(notePuts, 2, '应恰好两次笔记 PUT（一次 409 拒写 + 一次收口成功）: notePuts=' + notePuts);
  assert.equal(window.eval('keepMineArmed'), false, '保存成功后收口标记应清除');
  assert.equal(window.eval('localVer'), 7, '应采纳最新服务端版本');
  assert.equal(remoteBarOf(window).classList.contains('hidden'), true, '收口成功不得再弹冲突条');
});

test('V73-B4 mergeRemoteReminders：远端为准 + 保留本机独有 + 已发 OR + 时间升序', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  const now = Date.now();
  const atSame = now + 3600e3, atRemote = now + 7200e3, atLocal = now + 10800e3;
  window.eval('reminders = [{ at: ' + atSame + ", text: '同刻', fired: false }, { at: " + atLocal + ", text: '本机独有', fired: false }];");
  // 远端：同刻条目已 fired（他端到点发过）+ 一条本机没有的
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atSame, text: '同刻', fired: true }, { at: atRemote, text: '远端独有', fired: false }] }), key);
  await window.mergeRemoteReminders({ v: 6, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: JSON.stringify(remEnc) }, key);
  const merged = window.eval('reminders');
  assert.equal(merged.length, 3, '合并后 3 条（同刻 1 + 远端 1 + 本机 1）: ' + JSON.stringify(merged));
  assert.equal(merged.find(r => r.at === atSame).fired, true, '同刻条目任一端已发 → 已发');
  assert.ok(merged.some(r => r.at === atRemote && r.text === '远端独有'), '远端独有条目应保留');
  assert.ok(merged.some(r => r.at === atLocal && r.text === '本机独有' && !r.fired), '本机独有条目不丢且未发');
  assert.deepEqual([...merged.map(r => r.at)], [...merged.map(r => r.at)].sort((a, b) => a - b), '按时间升序');
});

test('V73-B5 P0-5：提醒保存 409 走系统通道——合并列表 + 限次重传，绝不弹用户条', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  let puts = 0;
  const now = Date.now();
  const atLocal = now + 3600e3, atRemote = now + 7200e3;
  let note = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: null };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') {
      puts++;
      if (puts === 1) return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ v: 6 }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 7 }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
  await window.applyUnlocked(key, note);
  window.eval('reminders = [{ at: ' + atLocal + ", text: '本机提醒', fired: false }];");
  // 远端推进 v6：正文与 lastHtml 一致（版本 bump 场景）+ 带一条本机没有的提醒
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atRemote, text: '远端提醒', fired: false }] }), key);
  note = { v: 6, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  await window.persistReminders(); // 409 → 系统通道合并 → 采纳 v 后重传
  const merged = window.eval('reminders');
  assert.equal(puts, 2, '应限次重传（首 PUT 409 + 采纳 v 后重传）: puts=' + puts);
  assert.equal(window.eval('localVer'), 7, '重传成功后应采纳服务端 v');
  assert.ok(merged.some(r => r.text === '本机提醒'), '本机提醒保留');
  assert.ok(merged.some(r => r.text === '远端提醒'), '远端提醒并入');
  assert.equal(remoteBarOf(window).classList.contains('hidden'), true, 'P0-5：提醒 409 绝不弹用户冲突条');
  assert.equal(window.document.getElementById('statustext').textContent, '已同步', '收口后状态应为已同步');
});

test('V73-B6 HB2：提醒 409 且远端正文真实差异——挂起弹条，绝不静默覆盖', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const remoteCt = await window.encryptText('<div>base</div><div>他端新内容</div>', key); // 远端真实差异
  let puts = 0;
  // 远端状态机：解锁期 v5（applyUnlocked 内 startSync 的立即 poll GET v5 静默），
  // persistReminders 前推进 v6 + 真实差异正文（poll 的 2s 轮询来不及再跑）
  let remoteNote = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: null };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') {
      puts++;
      return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ v: 6 }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(remoteNote) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  await sleep(50); // 等 startSync 的立即 poll（GET v5）收尾，避免抢先应用远端
  remoteNote = { v: 6, ct: remoteCt.ct, iv: remoteCt.iv, salt: 'x', rem: null };
  window.eval('reminders = [{ at: ' + (Date.now() + 3600e3) + ", text: '本机提醒', fired: false }];");
  await window.persistReminders(); // PUT baseV=5 → 409 → 系统通道 → 正文真实差异 → 挂起，不重传
  assert.equal(puts, 1, '真实差异不得以本机旧正文重传覆盖（puts=' + puts + '）');
  assert.equal(window.eval('pendingRemoteNote') !== null, true, '应挂起远端快照');
  assert.equal(remoteBarOf(window).classList.contains('hidden'), false, '应弹冲突条让用户拍板');
  assert.equal(window.eval('localVer'), 5, '真实差异时不得采纳远端 v（挂起等拍板）');
  const merged = window.eval('reminders');
  assert.ok(merged.some(r => r.text === '本机提醒'), '本机提醒列表不受影响');
});

test('V73-B7 HB1：拍板「保留我的」合并远端提醒并补推 rem——他端提醒不丢', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const now = Date.now();
  const atRemote = now + 7200e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atRemote, text: '他端提醒', fired: false }] }), key);
  let puts = 0, remPushSeen = false;
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    if (m === 'PUT' && u.includes('/api/note/') && !u.includes('/history')) {
      puts++;
      const body = JSON.parse(opts.body);
      if (body.rem !== undefined) remPushSeen = true; // rem 是加密密文 {ct,iv}，只能判存在性，明文列表由 reminders 断言
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6 + puts }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 99 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  // 模拟冲突挂起：远端 v6 正文=本机 lastHtml（无真实差异）+ 带他端提醒
  window.eval('pendingRemoteNote = ' + JSON.stringify({ v: 6, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: JSON.stringify(remEnc) }) + ';');
  window.eval('showRemoteBar();');
  editor.innerHTML = '<div>base</div><div>我的内容</div>'; // 本机有未存输入（「保留我的」语义前提）
  await window.document.getElementById('remoteKeep').dispatchEvent(new window.Event('click'));
  await sleep(800); // 等 merge（async）+ saveLocal + finally 300ms 补推 persistReminders
  const merged = window.eval('reminders');
  assert.ok(merged.some(r => r.text === '他端提醒'), '拍板保留后他端提醒应并入本机列表');
  assert.equal(window.eval('pendingRemoteNote'), null, '拍板后应清挂起');
  assert.ok(remoteBarOf(window).classList.contains('hidden'), '拍板后冲突条应隐藏');
  assert.ok(remPushSeen, '应有带 rem 的 PUT 补推合并结果（HB2 通道收尾）');
  assert.equal(window.eval('keepMineArmed'), false, '保存成功后收口标记应清除');
});

test('V73-B8 HB3：服务端版本回滚（v < localVer）——对齐 baseV 重传收敛，不无限 409 循环', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  let notePuts = 0, secondBaseV = null;
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    const isNote = u.includes('/api/note/') && !u.includes('/history');
    if (m === 'PUT' && isNote) {
      notePuts++;
      const body = JSON.parse(opts.body);
      if (notePuts === 1) return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ v: 3 }) });
      secondBaseV = body.baseV;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 4 }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 4 }) });
    // GET：服务端已回滚到 v3（< 本机 localVer=5）——409 后 GET 见低版本必须对齐而非无限循环
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 3, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  editor.innerHTML = '<div>base</div><div>新内容</div>';
  await window.saveLocal(); // PUT#1 baseV=5 → 409(v3) → handleWriteConflict → GET v3 < localVer → 对齐 v3 → 补挂重传
  await sleep(500); // 等 finally 补挂的 saveLocal（300ms）
  assert.equal(notePuts, 2, '应恰好两次 PUT（一次 409 + 一次对齐后重传收敛），不得死循环: notePuts=' + notePuts);
  assert.equal(secondBaseV, 3, '重传应带对齐后的 baseV=3');
  assert.equal(window.eval('localVer'), 4, '重传成功后应采纳服务端 v');
  assert.ok(remoteBarOf(window).classList.contains('hidden'), '收敛路径不弹冲突条');
});

test('V73-B9 HB2：409 后正文等价采纳 + 远端带提醒——采纳后补推 rem 落库', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const sameCt = await window.encryptText('<div>base</div>', key); // 远端正文与 lastHtml 严格一致（同明文不同 IV）
  const now = Date.now();
  const atRemote = now + 7200e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atRemote, text: '远端提醒', fired: false }] }), key);
  let puts = 0, remPushSeen = false;
  // 远端状态机：解锁期 v5（立即 poll 静默），saveLocal 前推进 v6 + 正文一致 + 带他端提醒
  let remoteNote = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: null };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    if (m === 'PUT' && u.includes('/api/note/') && !u.includes('/history')) {
      puts++;
      const body = JSON.parse(opts.body);
      if (body.rem !== undefined) remPushSeen = true; // rem 是加密密文 {ct,iv}，只判存在性
      if (puts === 1) return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ v: 6 }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6 + puts }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 99 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(remoteNote) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  await sleep(50); // 等 startSync 立即 poll（GET v5 静默）收尾，避免抢先应用远端
  remoteNote = { v: 6, ct: sameCt.ct, iv: sameCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  editor.innerHTML = '<div>base</div><div>新输入</div>';
  await window.saveLocal(); // PUT#1 baseV=5 → 409(v6) → handleWriteConflict → 解密比较（严格一致）→ 采纳 v6 + 合并 rem + pendingRemPush
  await sleep(900); // 等 finally：pendingRemPush→persistReminders(300ms) + pendingResave→saveLocal(300ms)
  assert.equal(puts, 2, '恰好两次 note PUT（409 一次 + 补推 rem 一次），无多余重传: puts=' + puts);
  assert.ok(window.eval('localVer') >= 8, '最终应采纳服务端版本（补推后的 v）');
  assert.ok(remPushSeen, '应有带 rem 的 PUT 推送合并结果（HB2 通道）');
  const merged = window.eval('reminders');
  assert.ok(merged.some(r => r.text === '远端提醒'), '远端提醒应并入本机列表');
  assert.ok(remoteBarOf(window).classList.contains('hidden'), '等价采纳不弹条');
});

test('V73-B10 HB6-P1-1：拍板「保留我的」且正文无改动——挂起期新增提醒经 remoteKeep 显式补推落库', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const now = Date.now();
  const atRemote = now + 7200e3, atLocal = now + 10800e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atRemote, text: '他端提醒', fired: false }] }), key);
  let puts = 0, remPushSeen = false;
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    if (m === 'PUT' && u.includes('/api/note/') && !u.includes('/history')) {
      puts++;
      const body = JSON.parse(opts.body);
      if (body.rem !== undefined) remPushSeen = true; // rem 是加密密文 {ct,iv}，只判存在性
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6 + puts }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 99 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  // 模拟冲突挂起：远端 v6 正文=本机 lastHtml（无真实差异）+ 带他端提醒
  window.eval('pendingRemoteNote = ' + JSON.stringify({ v: 6, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: JSON.stringify(remEnc) }) + ';');
  window.eval('showRemoteBar();');
  // 挂起期用户加了一条提醒（P1-4 守卫只改内存 + 落草稿）
  window.eval('reminders = [{ at: ' + atLocal + ", text: '挂起期提醒', fired: false }];");
  await window.stashReminderDraft(); // P2-a：草稿密文落盘（async 加密，需 await 防 take 竞态）
  editor.innerHTML = '<div>base</div>'; // 正文无改动（html === lastHtml）——saveLocal 必在 try 前早退
  await window.document.getElementById('remoteKeep').dispatchEvent(new window.Event('click'));
  await sleep(300); // remoteKeep 内 await saveLocal（早退）+ 显式 persistReminders 补推（无 300ms 延迟）
  const merged = window.eval('reminders');
  assert.ok(merged.some(r => r.text === '他端提醒'), '他端提醒应并入（HB1 合并）');
  assert.ok(merged.some(r => r.text === '挂起期提醒'), '挂起期新增提醒应保留在列表');
  assert.equal(puts, 1, '正文无改动不应有正文 PUT，应恰好一次带 rem 的补推 PUT: puts=' + puts);
  assert.ok(remPushSeen, '应有带 rem 的 PUT 补推合并结果+挂起期提醒（P1-1：不再依赖 saveLocal finally）');
  assert.equal(window.eval('pendingRemoteNote'), null, '拍板后应清挂起');
  assert.ok(remoteBarOf(window).classList.contains('hidden'), '拍板后冲突条应隐藏');
  assert.equal(window.eval('keepMineArmed'), false, '补推成功后收口标记应清除');
  assert.equal(window.eval('pendingRemPush'), false, '补推后 pendingRemPush 应清');
});

test('V73-B11 P1-C：武装期他端真实修改——收口前解密比较，挂起弹条绝不静默覆盖（判别性）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const remoteCt = await window.encryptText('<div>base</div><div>他端新内容</div>', key); // 真实差异
  let notePuts = 0;
  let remoteNote = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    const isNote = u.includes('/api/note/') && !u.includes('/history');
    if (m === 'PUT' && isNote) {
      notePuts++;
      return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ v: 6 }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 99 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(remoteNote) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  await sleep(50); // 等 startSync 立即 poll（GET v5 静默）收尾
  remoteNote = { v: 6, ct: remoteCt.ct, iv: remoteCt.iv, salt: 'x' }; // 武装期他端真实修改（v+1 真实差异 = 新争端）
  window.eval('keepMineArmed = true;'); // 模拟上一交互遗留的武装（P1-C：不得跨时长以旧拍板静默覆盖）
  editor.innerHTML = '<div>base</div><div>我的内容</div>';
  await window.saveLocal(); // PUT#1 409 → armed → retryKeepMineSave → GET v6 解密比较发现真实差异 → 挂起弹条，绝不重传覆盖
  await sleep(500); // 确认 finally 不补挂重传
  assert.equal(notePuts, 1, '真实差异不得以旧拍板重传覆盖: notePuts=' + notePuts);
  assert.equal(window.eval('keepMineArmed'), false, '武装应已消费清除');
  assert.equal(window.eval('localVer'), 5, '真实差异不得采纳远端 v（挂起等用户对新争端重新拍板）');
  assert.ok(window.eval('pendingRemoteNote') !== null, '应挂起新争端快照');
  assert.equal(remoteBarOf(window).classList.contains('hidden'), false, '应弹冲突条让用户对新争端重新拍板');
});

test('V73-B12 P1-A：挂起期 poll 级0（rem-only bump）不得整表替换本机提醒——拍板后合并不丢', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const now = Date.now();
  const atRemote = now + 7200e3, atLocal = now + 10800e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: atRemote, text: '远端提醒', fired: false }] }), key);
  let puts = 0, remPushSeen = false;
  let remoteNote = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: null };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    const u = String(url);
    if (m === 'PUT' && u.includes('/api/note/') && !u.includes('/history')) {
      puts++;
      const body = JSON.parse(opts.body);
      if (body.rem !== undefined) remPushSeen = true; // rem 是加密密文 {ct,iv}，只判存在性
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6 + puts }) });
    }
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 99 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(remoteNote) });
  };
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  await sleep(50); // 等 startSync 立即 poll（GET v5 无 rem）收尾
  // 冲突挂起：远端 v6 正文=lastHtml（级0 场景）+ 带他端提醒；本机挂起期加了一条提醒（内存 + 草稿）
  remoteNote = { v: 6, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: JSON.stringify(remEnc) };
  window.eval('pendingRemoteNote = ' + JSON.stringify({ v: 6, ct: baseCt.ct, iv: baseCt.iv, salt: 'x', rem: JSON.stringify(remEnc) }) + ';');
  window.eval('showRemoteBar();');
  window.eval('reminders = [{ at: ' + atLocal + ", text: '挂起期提醒', fired: false }];");
  await window.stashReminderDraft();
  editor.innerHTML = '<div>base</div>'; // 正文无改动
  await window.poll(); // 级0：html===lastHtml，旧缺陷会用远端 rem 整表替换清掉本机提醒
  const afterPoll = window.eval('reminders');
  assert.ok(afterPoll.some(r => r.text === '挂起期提醒'), '挂起期 poll 级0 不得清掉本机提醒（P1-A 守卫）');
  assert.ok(window.eval('pendingRemoteNote') !== null, '挂起快照应保留（随 poll 刷新）');
  // 拍板「保留我的」：合并远端 + 草稿内容一并落库
  await window.document.getElementById('remoteKeep').dispatchEvent(new window.Event('click'));
  await sleep(300);
  const merged = window.eval('reminders');
  assert.ok(merged.some(r => r.text === '远端提醒'), '拍板后远端提醒应并入');
  assert.ok(merged.some(r => r.text === '挂起期提醒'), '挂起期本机提醒应保留');
  assert.ok(remPushSeen, '应有带 rem 的 PUT 补推合并结果');
  assert.equal(window.eval('keepMineArmed'), false, '拍板后武装应清');
});

test('V73-B13 P1-B：解锁 read-back 恢复挂起期提醒草稿 + 陈旧草稿（>24h）直接清除不注入', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' }) });
  await window.applyUnlocked(key, { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' });
  const now = Date.now();
  const atLocal = now + 7200e3;
  // 模拟上次挂起期留下的草稿（含一条本机提醒，密文落盘）
  window.eval('reminders = [{ at: ' + atLocal + ", text: '挂起期提醒', fired: false }];");
  await window.stashReminderDraft();
  window.eval('reminders = [];'); // 等效重载后内存清空（未提交即关页）
  await window.restoreReminderDraft();
  let restored = window.eval('reminders');
  assert.ok(restored.some(r => r.text === '挂起期提醒'), 'read-back 应恢复挂起期提醒草稿（P1-B 重载不丢）');
  assert.ok(restored.every(r => typeof r.text === 'string'), '恢复条目应为规范结构');
  // 陈旧草稿（>24h）不得恢复、应被清除——重新落一份草稿再回拨时间戳。
  // 草稿键是页面顶层 const，jsdom 下不可经 window.eval 作用域取到（CLAUDE.md 坑：顶层 const 不挂 window），
  // 改从测试侧经 localStorage 键前缀发现 + 直读写，避开 eval 作用域。
  window.eval('reminders = [{ at: ' + (Date.now() + 7200e3) + ", text: '挂起期提醒', fired: false }];");
  await window.stashReminderDraft();
  const draftKey = Object.keys(window.localStorage).find(k => k.indexOf('notesync_rem_draft_') === 0);
  assert.ok(draftKey, '草稿键应存在');
  const staled = JSON.parse(window.localStorage.getItem(draftKey));
  staled.at = Date.now() - 25 * 3600e3;
  window.localStorage.setItem(draftKey, JSON.stringify(staled));
  window.eval('reminders = [];');
  await window.restoreReminderDraft();
  assert.equal(window.eval('reminders').length, 0, '陈旧草稿不得恢复（P1-B 新鲜度）');
  assert.equal(Object.keys(window.localStorage).some(k => k.indexOf('notesync_rem_draft_') === 0), false, '陈旧草稿应被清除');
});
