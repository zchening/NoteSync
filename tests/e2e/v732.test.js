// NoteSync E2E v7.3.2 —— jsdom 行为验证（不启真实浏览器，全程 loadApp 模拟）。
// 覆盖 v7.3.2 四个修复：
//   bug a：PC 新建提醒后「弹窗未关闭」实为已添加展示卡常驻——showChipForMatch 已添加分支
//         补 chipAutoHideTimer = setTimeout(hideTimeChip, 3000) 3 秒自动关闭；hideTimeChip 清定时器。
//   bug b：行首回车提醒行回跳——unwrapMark 空文本+br 占位拆子节点保 <br>，非空走 textContent 替换，
//         linkifyEditor 拆包统一走 unwrapMark。
//   bug c：光标消失——blur 复位 isComposing；linkifyEditor 入口 isComposing 守卫；compositionend
//         补调 scheduleRemMarkRefresh；模态/浮层关闭路径 PC 端 editor.focus()+ensureCaret。
//   需求 d：新建提醒后光标自动换行——insertRemLine 末尾 placeCaretAfterReminderLine()，
//         提醒行块后插含 br 空 div 并 placeCaretInBlock 定位。
// 结构沿 tests/unit/v73.test.js：源码断言 + jsdom 行为测试（loadApp 来自 ../helpers）。
// 回归：node --test "tests/e2e/*.test.js" 全量必须通过。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

function freshApp(extra) {
  const dom = loadApp(w => {
    // 对齐 tests/unit/v73.test.js 的 jsdom 环境修补（crypto/Range 打桩，防止 jsdomError 噪音）
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
    if (typeof extra === 'function') extra(w);
  });
  return { dom, window: dom.window, editor: dom.window.document.getElementById('editor') };
}

// ═══════════ 源码断言 ═══════════
test('V732-S1 bug a：showChipForMatch 已添加分支 3 秒自动关闭（冷却包装）+ hideTimeChip 清定时器', () => {
  assert.ok(/function showChipForMatch\(m, text\) \{[\s\S]{0,120}clearTimeout\(chipAutoHideTimer\)/.test(SRC),
    'showChipForMatch 入口应作废旧自动关闭定时器（防「已添加」残留定时器误收后续 CTA 卡）');
  assert.ok(/chipAutoHideTimer = setTimeout\(autoHideTimeChip, 3000\)/.test(SRC),
    '「已添加」展示卡应挂 3 秒自动关闭（bug a：浮卡常驻被误认弹窗未关闭）');
  assert.ok(/function autoHideTimeChip\(\) \{ chipFeedbackUntil = Date\.now\(\) \+ 2000; hideTimeChip\(\); \}/.test(SRC),
    '自动隐藏应走冷却包装（收卡后 2s 内不重弹，防闪烁循环）');
  assert.ok(/function hideTimeChip\(\) \{[\s\S]{0,150}clearTimeout\(chipAutoHideTimer\)[\s\S]{0,120}clearTimeout\(chipTimer\)/.test(SRC),
    'hideTimeChip 应清自动关闭定时器与 pending selectionchange 防抖');
  assert.ok(/let chipAutoHideTimer = null;/.test(SRC), '应有 chipAutoHideTimer 声明（v7.3.2）');
});

test('V732-S2 bug b：unwrapMark 空占位拆子节点保 <br> + 行内空标记不插 br + linkifyEditor 拆包统一走 unwrapMark', () => {
  assert.ok(/function unwrapMark\(el, stripZwsp\) \{[\s\S]{0,500}el\.removeChild\(c\);[\s\S]{0,200}if \(c\.nodeType === 3\) el\.parentNode\.insertBefore\(document\.createTextNode/.test(SRC),
    'unwrapMark 非空分支应遍历子节点（文本按 stripZwsp 处理，先摘出再插防「非子节点」报错）');
  assert.ok(/else if \(c\.tagName === 'BR'\) el\.parentNode\.insertBefore\(c, el\);/.test(SRC),
    '非空分支应保 BR 原样前移（「文本+br」混合占位不塌缩）');
  assert.ok(/if \(hasContent\) \{ el\.remove\(\); return; \}[\s\S]{0,120}el\.parentNode\.insertBefore\(document\.createElement\('br'\), el\);[\s\S]{0,120}while \(el\.firstChild\) el\.parentNode\.insertBefore\(el\.firstChild, el\);[\s\S]{0,40}el\.remove\(\);/.test(SRC),
    'unwrapMark 空文本分支：行内空标记直接移除、块级空占位拆子节点保住 <br>（空行不塌缩，bug b 根修）');
  assert.ok(/autoLinks\.forEach\(a => unwrapMark\(a, true\)\)/.test(SRC), '自动链接拆包应走 unwrapMark');
  assert.ok(/remMarks\.forEach\(u => unwrapMark\(u, false\)\)/.test(SRC), '提醒标记拆包应走 unwrapMark');
  assert.ok(/remDones\.forEach\(s => unwrapMark\(s, false\)\)/.test(SRC), '删除线拆包应走 unwrapMark');
});

test('V732-S3 bug c：linkifyEditor 入口 isComposing 守卫 + blur/compositionend 复位链 + 浮层关闭归还焦点', () => {
  assert.ok(/function linkifyEditor\(opts\) \{[\s\S]{0,600}if \(isComposing\) return;/.test(SRC),
    'linkifyEditor 入口应有 isComposing 守卫（组字中不 detach 节点，bug c 根修1）');
  assert.ok(/editor\.addEventListener\('blur', \(\) => \{ isComposing = false; \}\);/.test(SRC),
    'blur 应复位 isComposing（组字中失焦不卡死，bug c 根修1 最后防线）');
  assert.ok(/editor\.addEventListener\('compositionend', \(\) => \{[\s\S]{0,600}try \{ scheduleRemMarkRefresh\(\); \} catch \(e\) \{\}/.test(SRC),
    'compositionend 应补调 scheduleRemMarkRefresh（组字期间被守卫拦掉的打标重调度）');
  assert.ok(/remMask\.classList\.add\('hidden'\);[\s\S]{0,240}v7\.3\.2：面板关闭后 PC 端把焦点还给编辑器[\s\S]{0,200}if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/.test(SRC),
    '提醒面板关闭路径 PC 端应 editor.focus()+ensureCaret（光标消失根因2）');
  assert.ok(/menuMask\.addEventListener\('click', e => \{ if \(e\.target === menuMask\) \{[\s\S]{0,160}editor\.focus\(\); ensureCaret\(\)/.test(SRC),
    '菜单遮罩关闭路径 PC 端应 editor.focus()+ensureCaret');
});

test('V732-S4 需求 d：doAdd 成功路径接线 + placeCaretAfterReminderLine 插空块落光标', () => {
  assert.ok(/addReminder\(at, text\)\.then\(ok => \{[\s\S]{0,80}toggleRemPanel\(false\);[\s\S]{0,80}insertRemLine\(at, text\)/.test(SRC),
    '面板 doAdd 成功路径应「收面板 → insertRemLine 回写正文」');
  assert.ok(/function insertRemLine\(at, item\) \{[\s\S]{0,500}insertNodeAtCaret\(document\.createTextNode\(text\)\);[\s\S]{0,200}placeCaretAfterReminderLine\(\);/.test(SRC),
    'insertRemLine 末尾应调用 placeCaretAfterReminderLine（需求 d 光标自动换行）');
  assert.ok(/function placeCaretAfterReminderLine\(\) \{[\s\S]{0,600}nb\.appendChild\(document\.createElement\('br'\)\);[\s\S]{0,200}placeCaretInBlock\(nb\)/.test(SRC),
    'placeCaretAfterReminderLine 应在提醒行块后插含 br 空 div 并 placeCaretInBlock（空块无 br 则零高且光标无法绘制）');
});

// ═══════════ jsdom 行为 ═══════════
test('V732-B1 bug a 行为：已添加展示卡弹 3 秒自动关闭（setTimeout 打桩模拟时间前进）', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const chip = window.document.getElementById('timeChip');
  const future = Date.now() + 3600e3;
  window.eval('reminders = [{ at: ' + future + ", text: '事项', fired: false }];");

  // 打桩 window.setTimeout：捕获「已添加」分支挂的自动关闭定时器，直接触发模拟 3 秒流逝
  const origSetTimeout = window.setTimeout;
  const origClearTimeout = window.clearTimeout;
  const scheduled = [];
  window.setTimeout = (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; };
  window.clearTimeout = () => {};
  try {
    const shown = window.showChipForMatch({ at: future, index: 0, length: 11, expired: false }, '2026-9-9 10:00　事项');
    assert.equal(shown, true, '已添加分支应返回 true（展示成功）');
    assert.equal(chip.classList.contains('hidden'), false, '展示卡应可见');
    assert.ok(chip.textContent.indexOf('提醒已添加') >= 0, '应为「✅ 提醒已添加」两行卡: ' + chip.textContent);
    const auto = scheduled.filter(e => e.fn === window.autoHideTimeChip && e.ms === 3000);
    assert.equal(auto.length, 1, '应恰好挂一个 3000ms 的 autoHideTimeChip 自动关闭定时器，实际 ' + scheduled.length + ' 个');
    auto[0].fn(); // 模拟 3 秒后触发（冷却包装：chipFeedbackUntil + hideTimeChip）
    assert.equal(chip.classList.contains('hidden'), true, '3 秒后展示卡必须自动关闭（bug a：不再常驻被误认弹窗未关闭）');
    assert.equal(window.eval('chipData'), null, '自动关闭后应清 chip 数据');
    assert.ok(window.eval('chipFeedbackUntil') > Date.now(), '冷却包装应设 chipFeedbackUntil（收卡后 2s 内不重弹）');
  } finally {
    window.setTimeout = origSetTimeout;
    window.clearTimeout = origClearTimeout;
  }
});

test('V732-B2 bug b 行为：空行占位标记解包后 <br> 保留、空行不塌缩', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;

  // 场景1：<u class="rem-mark"><br></u> 占位空行（行首/行尾回车 Blink 格式克隆产物）
  editor.innerHTML = '<div>提醒行</div><div><u class="rem-mark"><br></u></div>';
  window.linkifyEditor();
  assert.ok(!editor.querySelector('u.rem-mark'), '占位标记应被解包拆除');
  assert.ok(/<div><br><\/div>/.test(editor.innerHTML), '空行块应保留 <br>（未塌缩成零高 div）: ' + editor.innerHTML);
  assert.equal(editor.innerHTML, '<div>提醒行</div><div><br></div>', '解包后结构应为「提醒行块 + 含 br 空块」');

  // 场景2：<a data-url="1"><br></a> 链接占位空行（同 bug b 根因的另一标记形态）
  editor.innerHTML = '<div>下一行</div><div><a data-url="1"><br></a></div>';
  window.linkifyEditor();
  assert.ok(!editor.querySelector('a[data-url="1"]'), '链接占位标记应被解包拆除');
  assert.ok(/<div><br><\/div>/.test(editor.innerHTML), '链接占位空行同样必须保留 <br>: ' + editor.innerHTML);

  // 场景3：非空占位（textContent 替换路径）——文本保留且不再包标记
  editor.innerHTML = '<div><u class="rem-mark">占位文本</u></div>';
  window.linkifyEditor();
  assert.ok(!editor.querySelector('u.rem-mark'), '非空占位应拆回纯文本');
  assert.equal(editor.textContent, '占位文本', '非空解包不得丢文本');
});

test('V732-B3 bug c 行为：组字中 linkify 手术被 isComposing 守卫拦下，DOM 未被手术', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  editor.innerHTML = '<div>提醒行</div><div><u class="rem-mark"><br></u></div>';
  const before = editor.innerHTML;
  window.eval('isComposing = true;'); // 模拟 IME 组字中（拼音未上屏）
  try {
    window.linkifyEditor(); // 组字中调用 linkify 路径
    assert.equal(editor.innerHTML, before, '组字期间不得 detach/重建任何节点（HTML 原样）');
    assert.equal(window.eval('isLinkifying'), false, '守卫应在置 isLinkifying 前返回');
  } finally {
    window.eval('isComposing = false;');
  }
});

test('V732-B4 bug c 行为：blur 复位 isComposing——组字中失焦后 linkify 可正常执行', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  editor.innerHTML = '<div><u class="rem-mark">占位文本</u></div>';
  window.eval('isComposing = true;');
  editor.dispatchEvent(new window.Event('blur')); // 组字中失焦（DOM 手术 detach 组字节点、compositionend 不再冒泡的兜底）
  assert.equal(window.eval('isComposing'), false, 'blur 必须复位 isComposing（否则卡死拦截 ensureCaret/repaintCaret）');
  window.linkifyEditor(); // 复位后同轮 linkify 必须放行
  assert.ok(!editor.querySelector('u.rem-mark'), 'blur 复位后 linkify 应正常执行手术');
});

test('V732-B5 bug c 行为：compositionend 复位 isComposing + 兜底重调度打标刷新', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  window.eval('cryptoKey = {};'); // scheduleRemMarkRefresh 需要 cryptoKey 才真正挂定时器
  window.eval('isComposing = true;');
  editor.dispatchEvent(new window.Event('compositionend'));
  assert.equal(window.eval('isComposing'), false, 'compositionend 必须复位 isComposing');
  assert.notEqual(window.eval('remMarkTimer'), null, 'compositionend 应补调 scheduleRemMarkRefresh（组字期间被守卫拦掉的打标重调度）');
});

test('V732-B6 bug c 行为：PC 端浮层关闭后焦点归还编辑器（toggleRemPanel/menuMask）', t => {
  const app = freshApp(w => {
    w.matchMedia = () => ({ matches: true }); // 模拟 PC 指针环境 → CHIP_HOVER_OK=true
  });
  t.after(() => app.dom.window.close());
  const { window } = app;
  const editor = window.document.getElementById('editor');
  const remMask = window.document.getElementById('remMask');
  const menuMask = window.document.getElementById('menuMask');
  assert.equal(window.eval('CHIP_HOVER_OK'), true, '模拟 PC 环境前置：CHIP_HOVER_OK 应为 true');

  // 提醒面板：打开 → 关闭 → 焦点归还编辑器
  editor.focus();
  assert.equal(window.document.activeElement, editor, '前置：编辑器应聚焦');
  window.toggleRemPanel(true);
  assert.equal(window.eval('remPanelOpen'), true, '面板应打开');
  window.toggleRemPanel(false);
  assert.equal(window.eval('remPanelOpen'), false, '面板应关闭');
  assert.equal(remMask.classList.contains('hidden'), true, '遮罩应收起');
  assert.equal(window.document.activeElement, editor, 'PC 端面板关闭后焦点必须归还编辑器（光标消失根因2）');

  // 菜单遮罩：打开 → 点遮罩空白关闭 → 焦点归还编辑器
  menuMask.classList.remove('hidden');
  menuMask.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // e.target === menuMask
  assert.equal(menuMask.classList.contains('hidden'), true, '菜单遮罩应关闭');
  assert.equal(window.document.activeElement, editor, 'PC 端菜单关闭后焦点必须归还编辑器');
});

test('V732-B7 需求 d 行为：添加提醒成功路径回写后光标自动换行到新空块', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  window.eval('cryptoKey = {};'); // insertRemLine 需要 cryptoKey 放行
  editor.innerHTML = '<div>base</div>';
  // 先聚焦编辑器（模拟真实编辑会话）——jsdom 的 editor.focus() 在元素未聚焦时会
  // 把选区折叠到块首（insertNodeAtCaret 内部调用 focus），预聚焦后为 no-op，选区保持
  editor.focus();
  // 光标落第一块末尾（模拟面板打开前编辑器选区）
  const r = window.document.createRange();
  r.selectNodeContents(editor.firstChild);
  r.collapse(false);
  window.setSel(r);

  const future = Date.now() + 7200e3;
  window.insertRemLine(future, '写周报'); // doAdd 成功路径的续段（toggleRemPanel(false) 之后调用）

  const expectedLine = window.fmtRemInsert(future) + '　写周报';
  assert.equal(editor.innerHTML, '<div>base' + expectedLine + '</div><div><br></div>',
    '提醒行回写后编辑器末尾应新增「含 br 的空 div」: ' + editor.innerHTML);

  const blocks = Array.from(editor.children);
  const last = blocks[blocks.length - 1];
  assert.equal(last.tagName, 'DIV', '末尾应为空块 div');
  assert.equal(last.childNodes.length, 1, '空块应恰含一个子节点');
  assert.equal(last.firstChild.tagName, 'BR', '空块必须带 <br>（否则零高且光标无法绘制）');

  const sel = window.getSelection();
  assert.equal(sel.rangeCount > 0, true, '应有选区');
  const sc = sel.getRangeAt(0).startContainer;
  assert.equal(sc, last, '光标应落在新空块上（placeCaretInBlock 定位）');
  assert.equal(sel.getRangeAt(0).startOffset, 0, '光标应在空块行首（可直接继续输入）');
});
