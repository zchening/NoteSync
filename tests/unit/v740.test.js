// v7.4.0 单元测试：占位等价（冲突根治）+ 提醒删除联动 + 移动端键盘/笔记名 + 冲突文案
// 覆盖：
//   P1-P4 isPlaceholderEqual 行为（格式克隆空块等价 / 真实空行绝不吞 / 带文本壳不剥 / 三壳形态）
//   P5 对账：删 chip → 提醒联动删除（rem 置 null 广播清除）
//   P6 对账：改时间 → 更新 at 不丢提醒（审核 P0 修正）
//   P7-P9 源码形态：A1'/A2'/A3/B 四路堵截 + 对账挂点/闸门 + 键盘守卫/笔记名条件 + 文案
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
function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}

// ── P1：回车格式克隆空块（空占位壳）与已同步版本占位等价 ──
test('P1 isPlaceholderEqual：Blink 格式克隆空块（<u.rem-mark><br></u> 新块）判等', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const pe = window.isPlaceholderEqual;
  assert.strictEqual(typeof pe, 'function', 'isPlaceholderEqual 应挂 window');
  const last = '<div><u class="rem-mark">2026-9-15 19:35</u>　你好</div>';
  const afterEnter = '<div><u class="rem-mark"><br></u></div><div><u class="rem-mark">2026-9-15 19:35</u>　你好</div>';
  assert.strictEqual(pe(afterEnter, last), true, '回车中间态（占位壳空块）应与已同步版本等价');
  assert.strictEqual(pe(last, last), true, '严格相等短路');
  assert.strictEqual(window.isDecorativelyEqual(afterEnter, last), false, 'isDecorativelyEqual 应仍判不等（br 不在装饰白名单——这正是冲突根因）');
});

// ── P2：真实空行绝不吞（审核 P0-1 修正的验收）──
test('P2 isPlaceholderEqual：用户真实空行（裸 br）绝不判等', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const pe = window.isPlaceholderEqual;
  const last = '<div>正文</div>';
  assert.strictEqual(pe('<div><br></div><div>正文</div>', last), false, '真实空行（裸 br 块）必须不等——绝不吞用户空行');
  assert.strictEqual(pe('<div></div><div>正文</div>', last), false, '空 div 块同理不等');
});

// ── P3：带文本的克隆壳（<u>foo<br></u>）不剥，文本参与比较 ──
test('P3 isPlaceholderEqual：带文本混合占位壳不剥（绝不丢字）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const pe = window.isPlaceholderEqual;
  assert.strictEqual(pe('<div><u>foo<br></u></div>', '<div></div>'), false, '带文本壳的块不等价');
  assert.strictEqual(pe('<div><u>foo<br></u>bar</div>', '<div>foobar</div>'), false, '壳文本保留参与比较（结构差异仍不等）');
  assert.strictEqual(window.normPlaceholderHtml('<div><u>foo<br></u></div>').indexOf('foo') !== -1, true, '归一输出必须包含壳内文本');
});

// ── P4：三种空占位壳形态全部剥掉 ──
test('P4 isPlaceholderEqual：u.rem-mark / a[data-url] / s.rem-done 空壳块全等价', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const pe = window.isPlaceholderEqual;
  const last = '<div>正文行</div>';
  assert.strictEqual(pe('<div><u class="rem-mark"><br></u></div><div>正文行</div>', last), true, 'rem-mark 空壳');
  assert.strictEqual(pe('<div><a data-url="1"><br></a></div><div>正文行</div>', last), true, '自动链接空壳');
  assert.strictEqual(pe('<div><s class="rem-done"><br></s></div><div>正文行</div>', last), true, '删除线空壳');
  assert.strictEqual(pe('<div>x<br></div>', '<div>x</div>'), false, '块内带文本+裸 br：br 参与比较，不等价');
});

// ── P5：对账——正文删 chip → 提醒联动删除（rem 置 null 广播清除）──
test('P5 reconcileRemindersFromBody：删时间文本 → 提醒删除 + rem 置 null', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  // 真实链路 at 恒为分钟精度（面板 new Date(y,m,d,h,m) / 正文解析同理），seen 基线按分钟对齐
  const at = Math.floor((Date.now() + 7 * 86400e3) / 60000) * 60000;
  const bodyHtml = '<div>' + window.fmtRemInsert(at) + '　买牛奶</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  await window.addReminder(at, '买牛奶');
  assert.ok(puts.some(p => p.rem), '前置：addReminder 应已推 rem');

  // 用户在正文中删掉时间串（chip），只留事项
  const newHtml = '<div>买牛奶</div>';
  editor.innerHTML = newHtml;
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150); // 等 50ms 延迟挂点内 persistReminders PUT
  const last = puts[puts.length - 1];
  assert.ok(last, '应发出对账后的 rem PUT');
  assert.strictEqual(last.rem, null, 'rem 应显式置 null（服务端清除字段=列表已清）');
  const btn = window.document.getElementById('remBtn');
  assert.ok(!btn || !btn.classList.contains('on'), '列表清空后闹钟按钮不应高亮');
});

// ── P6：对账——改时间 → 更新 at，绝不静默丢提醒（审核 P0 修正）──
test('P6 reconcileRemindersFromBody：改时间（同事项）→ 更新 at 不删条目', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  // 分钟精度（同 P5）；对账更新后的 at = 正文解析值 = 分钟精度，可与 atNew 严格相等比对
  const atOld = Math.floor((Date.now() + 7 * 86400e3) / 60000) * 60000;
  const atNew = Math.floor((Date.now() + 8 * 86400e3) / 60000) * 60000;
  const bodyHtml = '<div>' + window.fmtRemInsert(atOld) + '　买牛奶</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  await window.addReminder(atOld, '买牛奶');

  // 用户把时间改成新时间（事项不变）
  const newHtml = '<div>' + window.fmtRemInsert(atNew) + '　买牛奶</div>';
  editor.innerHTML = newHtml;
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  const remBtn = window.document.getElementById('remBtn');
  assert.ok(remBtn && remBtn.classList.contains('on'), '改时间后提醒仍在（按钮保持高亮）');
  // 通过 rem PUT 密文验证 at 已更新为新时间
  const puts = window.fetch.__puts || null;
  const list = await (async () => {
    // 从 localStorage 提醒草稿/直接再触发一次 persistReminders 读流量
    const p2 = [];
    const oldFetch = window.fetch;
    window.fetch = (url, opts) => {
      const m = (opts && opts.method) || 'GET';
      if (m === 'PUT' && String(url).indexOf('/history') === -1) p2.push(JSON.parse(opts.body));
      return oldFetch(url, opts);
    };
    await window.persistReminders(2);
    window.fetch = oldFetch;
    return p2;
  })();
  const withRem = list.filter(p => p.rem);
  assert.ok(withRem.length >= 1, '应有 rem PUT 流量');
  const enc = JSON.parse(withRem[withRem.length - 1].rem);
  const payload = JSON.parse(await window.decryptText(enc.ct, enc.iv, key));
  assert.strictEqual(payload.list.length, 1, '仍应只有 1 条提醒（改时间≠删除）');
  assert.strictEqual(payload.list[0].at, atNew, 'at 应更新为新时间');
  assert.strictEqual(payload.list[0].text, '买牛奶', '事项文本不变');
});

// ── P7：源码形态——冲突根治四路堵截 + 对账挂点/闸门 ──
test('P7 源码形态：A1 草稿先行 / A2 挂起守卫 / A3 bodyChanged / B 等价集 / 对账挂点', () => {
  const src = readSrc();
  // A1'：占位早退必须在 writeDraft 之后（草稿先行，关页零丢失）
  const saveIdx = src.indexOf('async function saveLocal');
  const phIdx = src.indexOf('if (!force && isPlaceholderEqual(html, lastHtml)) {', saveIdx);
  const wdIdx = src.indexOf('writeDraft(enc.ct, enc.iv);', saveIdx);
  assert.ok(phIdx > -1 && wdIdx > -1 && wdIdx < phIdx, 'saveLocal 占位早退应在 writeDraft 草稿落盘之后（审核 P0-1 修正）');
  // A2'：poll 级1.5 占位分支必须带挂起守卫（绝不静默消费挂起期版本）
  const lvl15 = src.indexOf('if (isPlaceholderEqual(html, lastHtml)) {');
  assert.ok(lvl15 > -1, 'poll 应有级1.5 占位分支');
  const seg = src.slice(lvl15, lvl15 + 400);
  assert.ok(seg.includes('if (pendingRemoteNote) { pendingRemoteNote = note; return; }'), '级1.5 必须带挂起守卫（铁律）');
  assert.ok(seg.includes('localVer = note.v || localVer;'), '级1.5 静默消费版本');
  assert.ok(!seg.includes('applyRemoteBody'), '级1.5 不应用内容（免空块闪现）');
  // A3：persistReminders bodyChanged 双豁免
  assert.ok(src.includes('const bodyChanged = !isDecorativelyEqual(html, lastHtml) && !isPlaceholderEqual(html, lastHtml);'), 'persistReminders bodyChanged 应占位豁免（第三条 PUT 路径堵截）');
  // B：409 等价采纳集两处都补占位
  assert.ok((src.match(/isPlaceholderEqual\(remoteHtml, lastHtml\) \|\| isPlaceholderEqual\(remoteHtml, pendingHtml\)/g) || []).length === 2, 'handleWriteConflict + retryKeepMineSave 等价集都应补占位');
  // 草稿清理 + flushDirtySave
  assert.ok(src.includes('(isDecorativelyEqual(html, lastHtml) || isPlaceholderEqual(html, lastHtml)) && (d.baseV === localVer)'), '草稿清理应占位豁免（免假草稿条）');
  assert.ok(src.includes('if (isPlaceholderEqual(editor.innerHTML, lastHtml)) return; // v7.4.0'), 'flushDirtySave 应占位豁免');
  // 对账闸门 + 四个挂点
  assert.ok(src.includes('if (pendingRemoteNote) return; // 挂起期绝不对账'), '对账必须有挂起期闸门（审核 P0 修正）');
  assert.ok((src.match(/reconcileRemindersFromBody\(htmlToRemText\(/g) || []).length === 5, '对账挂点应 5 处（saveLocal/poll/remoteTake/autoMergeSave/409 自动采纳）');
  assert.ok(src.includes('function parseTimeMatchesLong(text)'), '长文分段解析应存在（B 层 P1 修复）');
  assert.ok((src.match(/parseTimeMatchesLong\(/g) || []).length >= 3, 'reconcile 两处解析点（bodyText/lastHtml 基线）都应换长文版');
  assert.ok(src.includes('if (remTombstoneLive(r.at)) continue;'), 'mergeRemoteReminders 应 tombstone 过滤（防救尸）');
});

// ── P8：源码形态——移动端键盘守卫 + 笔记名条件 ──
test('P8 源码形态：ensureCaret 守卫 + POINTER_FINE + 品牌位条件扩展', () => {
  const src = readSrc();
  assert.ok(src.includes('if ((CHIP_HOVER_OK || POINTER_FINE()) && document.activeElement !== editor)'), 'ensureCaret 非法分支应带移动端守卫（2780 单点）');
  assert.ok(src.includes('function POINTER_FINE()'), 'POINTER_FINE 兜底函数应存在');
  assert.ok(src.includes('if (noteId && (isNativeApp() || !CHIP_HOVER_OK)) {'), '品牌位笔记名应扩展到移动网页端');
  // v732 既有守卫行不得被误改（抽取核对）
  assert.ok((src.match(/if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/g) || []).length >= 10, '既有 CHIP_HOVER_OK 门控 focus 行应保持原样');
});

// ── P9：源码形态——冲突弹窗文案 v7.4.0 ──
test('P9 源码形态：冲突弹窗新文案（检测到同步冲突 / 使用云端）', () => {
  const src = readSrc();
  assert.ok((src.match(/>检测到同步冲突<\/div>/g) || []).length === 2, '两卡标题应为「检测到同步冲突」');
  assert.ok((src.match(/其他设备上有更新，与本地改动冲突。/g) || []).length === 4, '正文应 4 处（两卡 HTML + 3109 注释 + draftMsg 动态分支）');
  assert.ok((src.match(/>使用云端<\/button>/g) || []).length === 2, '两卡次按钮应为「使用云端」');
  assert.ok(!src.includes('发现冲突：选哪边'), '旧标题退役');
  assert.ok(!src.includes('使用新版本') && !src.includes('发现另一台设备'), '旧按钮/正文退役');
});

// ── P10：B 层 P1 修复——长文（>4000 字）下改时间仍更新 at，绝不误删 ──
test('P10 长文改时间：parseTimeMatchesLong 分段解析 → 更新 at 不删条目', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const atOld = Math.floor((Date.now() + 7 * 86400e3) / 60000) * 60000;
  const atNew = Math.floor((Date.now() + 8 * 86400e3) / 60000) * 60000;
  const filler = Array.from({ length: 45 }, (_, i) => '<div>填充' + i + '好'.repeat(90) + '</div>').join('');
  const bodyHtml = filler + '<div>' + window.fmtRemInsert(atOld) + '　买牛奶</div>';
  const bodyText = window.htmlToRemText(bodyHtml);
  assert.ok(bodyText.length > 4000, '前置：正文纯文本须超 4000 字符硬上限');
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  await window.addReminder(atOld, '买牛奶');
  // 长文中把时间改成新时间（事项不变）
  const newHtml = filler + '<div>' + window.fmtRemInsert(atNew) + '　买牛奶</div>';
  editor.innerHTML = newHtml;
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  const withRem = puts.filter(p => p.rem && puts.indexOf(p) > 0);
  assert.ok(withRem.length >= 1, '应有对账后的 rem PUT 流量');
  const enc = JSON.parse(withRem[withRem.length - 1].rem);
  const payload = JSON.parse(await window.decryptText(enc.ct, enc.iv, key));
  assert.strictEqual(payload.list.length, 1, '长文改时间≠删除（旧版会误删+tombstone）');
  assert.strictEqual(payload.list[0].at, atNew, 'at 应更新为新时间');
  assert.strictEqual(payload.list[0].text, '买牛奶', '事项文本不变');
});

// ── P11：B 层 P1 修复——长文下删 chip 仍联动删除 ──
test('P11 长文删时间：parseTimeMatchesLong 基线解析 → 提醒删除 + rem 置 null', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const at = Math.floor((Date.now() + 7 * 86400e3) / 60000) * 60000;
  const filler = Array.from({ length: 45 }, (_, i) => '<div>填充' + i + '好'.repeat(90) + '</div>').join('');
  const bodyHtml = filler + '<div>' + window.fmtRemInsert(at) + '　买牛奶</div>';
  const noteCt = await window.encryptText(bodyHtml, key);
  const puts = mockCapture(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  await window.addReminder(at, '买牛奶');
  assert.ok(puts.some(p => p.rem), '前置：addReminder 应已推 rem');
  // 用户删掉时间串（chip），只剩长文填充
  const newHtml = filler + '<div>买牛奶</div>';
  editor.innerHTML = newHtml;
  await window.reconcileRemindersFromBody(window.htmlToRemText(newHtml));
  await sleep(150);
  const last = puts[puts.length - 1];
  assert.ok(last, '应发出对账后的 rem PUT');
  assert.strictEqual(last.rem, null, '长文下删 chip 也应联动删除（rem 显式置 null）');
  const btn = window.document.getElementById('remBtn');
  assert.ok(!btn || !btn.classList.contains('on'), '列表清空后闹钟按钮不应高亮');
});

// ── P12：B 层 P2 修复——空壳内藏 img 不判空壳（绝不吞图） ──
test('P12 壳内 img 防御：isEmptyShell 排除含 img/iframe 的壳', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const np = window.normPlaceholderHtml;
  const pe = window.isPlaceholderEqual;
  const out = np('<div><u class="rem-mark"><img src="a.png"></u></div>');
  assert.ok(out.indexOf('img') !== -1, '壳内 img 必须保留（绝不吞图）');
  assert.strictEqual(pe('<div><u class="rem-mark"><img src="a.png"></u></div>', '<div><u class="rem-mark"><img src="b.png"></u></div>'), false, '不同图的壳不等价');
  assert.strictEqual(pe('<div><u class="rem-mark"><br></u></div>', '<div></div>'), false, '空壳块整块剥成空串，<div></div> 是真实空行——两者必须不等（P2 镜像）');
  assert.strictEqual(pe('<div><u class="rem-mark"><br></u></div><div>正文</div>', '<div>正文</div>'), true, '普通空壳行为不回归（跟随真实块剥除）');
});
