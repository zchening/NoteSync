// v7.3.2 单元测试——四个修复点回归护栏（全部在 index.html）：
//   a. 提醒浮卡自动关闭：showChipForMatch「已添加」分支 3 秒自动隐藏（chipAutoHideTimer），
//      新展示前清理旧定时器——浮卡常驻被误认「弹窗未关闭」；
//   b. 行首/行尾回车提醒行回跳：unwrapMark 拆包保住占位标记内的 <br>（旧按 textContent
//      整体替换会连 <br> 一起销毁、空行塌缩），linkifyEditor 三路（autoLinks/remMarks/remDones）
//      统一走 unwrapMark；
//   c. 光标消失：blur 复位 isComposing（组字卡死最后防线）+ linkifyEditor 入口 isComposing
//      守卫（组字中绝不 DOM 手术）+ compositionend 补调 scheduleRemMarkRefresh 兜底重跑；
//   d. 新建提醒后光标自动换行：insertRemLine 末尾 placeCaretAfterReminderLine() 在提醒行后
//      插含 br 的空 div 并落光标。
// 结构沿 v74.test.js：源码断言 + jsdom 行为测试（全程不碰真实服务器）。
// 注意：index.html 是 CRLF 换行，多行源码断言一律用正则 [\s\S]/\r?\n，不用 \n 字面量（v71 先例）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadApp, INDEX_PATH, ZWSP } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

function freshApp(extra, pageUrl) {
  const dom = loadApp(w => {
    if (typeof extra === 'function') extra(w);
  }, pageUrl);
  return { dom, window: dom.window, document: dom.window.document, editor: dom.window.document.getElementById('editor') };
}

// ═══════════ 源码断言 ═══════════
test('V732-S1 修复b：unwrapMark 函数存在（拆包保住占位标记内的 <br>）', () => {
  assert.ok(SRC.includes('function unwrapMark(el, stripZwsp)'), '应存在 unwrapMark 函数');
  // 空占位拆包路径：块级占位（父块无其他非空白内容）补 <br>；行内空标记直接移除（对抗审 P2 补丁）
  assert.ok(SRC.includes('if (hasContent) { el.remove(); return; }'), '行内空标记（父块有其他内容）应直接移除不补 br');
  assert.ok(SRC.includes("el.parentNode.insertBefore(document.createElement('br'), el);"),
    '块级空占位（父块无其他内容）应补 <br>');
  assert.ok(SRC.includes('while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);'),
    '非空占位应逐子节点前移（<br> 必须存活）');
  assert.ok(SRC.includes("if (c.nodeType === 3) el.parentNode.insertBefore(document.createTextNode(stripZwsp ? c.nodeValue.replace(/\\u200B/g, '') : c.nodeValue), el);"),
    '非空分支应遍历子节点处理文本（stripZwsp 口径）');
  assert.ok(SRC.includes("else if (c.tagName === 'BR') el.parentNode.insertBefore(c, el);"),
    '非空分支应保 BR 原样前移（「文本+br」混合占位不塌缩）');
});

test('V732-S2 修复b：linkifyEditor 三路拆包统一走 unwrapMark', () => {
  assert.ok(SRC.includes('autoLinks.forEach(a => unwrapMark(a, true));'), 'autoLinks 应 unwrapMark(a, true)（链接路剥零宽空格）');
  assert.ok(SRC.includes('remMarks.forEach(u => unwrapMark(u, false));'), 'remMarks 应 unwrapMark(u, false)');
  assert.ok(SRC.includes('remDones.forEach(s => unwrapMark(s, false));'), 'remDones 应 unwrapMark(s, false)');
});

test('V732-S3 修复a：已添加展示卡 3 秒自动关闭（走冷却包装）+ 新展示前清理旧定时器', () => {
  assert.ok(SRC.includes('let chipAutoHideTimer = null;'), '应声明 chipAutoHideTimer');
  assert.ok(SRC.includes('chipAutoHideTimer = setTimeout(autoHideTimeChip, 3000);'),
    '「已添加」分支应 setTimeout(autoHideTimeChip, 3000) 3 秒自动关闭');
  assert.ok(SRC.includes('function autoHideTimeChip() { chipFeedbackUntil = Date.now() + 2000; hideTimeChip(); }'),
    '自动隐藏应走冷却包装（收卡后 2s 内不重弹，防闪烁循环）');
  assert.ok(SRC.includes('clearTimeout(chipAutoHideTimer); // v7.3.2：先清旧——防此前「已添加」卡残留定时器 3s 后误收这张 CTA 确认卡'),
    'chipActivate 确认卡应先清旧定时器再挂新的（防残留定时器误收新卡）');
  const clears = (SRC.match(/clearTimeout\(chipAutoHideTimer\);/g) || []).length;
  assert.ok(clears >= 2, '入口与「已添加」分支均应 clearTimeout 旧定时器，实测 ' + clears);
  assert.ok(SRC.includes('clearTimeout(chipTimer); // v7.3.2：pending selectionchange 防抖若不收，3s 自动隐藏后卡会立刻复活'),
    'hideTimeChip 应清 pending 的 selectionchange 防抖定时器（否则 3s 收卡后立刻复活）');
});

test('V732-S4 修复c：blur 复位 isComposing（组字卡死最后防线）', () => {
  assert.ok(SRC.includes("editor.addEventListener('blur', () => { isComposing = false; });"),
    'blur 应复位 isComposing（DOM 手术 detach 组字目标后 compositionend 不再冒泡）');
});

test('V732-S5 修复c：linkifyEditor 入口 isComposing 守卫（组字中绝不 DOM 手术）', () => {
  // 全文件共 3 处 if (isComposing) return;（input 粘贴 1695/1775、linkify 2422）——
  // 断言必须锚定到 linkifyEditor 函数体，防止「别处守卫」假绿。
  assert.ok(/function linkifyEditor\(opts\) \{[\s\S]{0,500}if \(isComposing\) return;/.test(SRC),
    'linkifyEditor 入口应带 isComposing 守卫');
  // 对抗审 P2：守卫必须先于 isLinkifying = true——若被误移到其后（isLinkifying 永真死锁）应红
  assert.ok(/function linkifyEditor\(opts\) \{[\s\S]{0,300}if \(isComposing\) return;[\s\S]{0,300}isLinkifying = true;/.test(SRC),
    'isComposing 守卫必须先于 isLinkifying = true（顺序锚定，防死锁形态假绿）');
});

test('V732-S6 修复c：compositionend 补调 scheduleRemMarkRefresh（守卫拦下的手术兜底重跑）', () => {
  assert.ok(/compositionend[\s\S]{0,800}try \{ scheduleRemMarkRefresh\(\); \} catch \(e\) \{\}/.test(SRC),
    'compositionend 应补调 scheduleRemMarkRefresh');
});

test('V732-S7 修复d：insertRemLine 末尾调用 placeCaretAfterReminderLine（新提醒后自动换行）', () => {
  assert.ok(/function insertRemLine\(at, item\) \{[\s\S]{0,1200}placeCaretAfterReminderLine\(\);\r?\n\}/.test(SRC),
    'insertRemLine 末尾应调用 placeCaretAfterReminderLine');
});

test('V732-S8 修复d：placeCaretAfterReminderLine 定义——提醒行后插含 br 的空块并落光标', () => {
  assert.ok(SRC.includes('function placeCaretAfterReminderLine() {'), '应存在 placeCaretAfterReminderLine');
  assert.ok(SRC.includes("const nb = document.createElement('div');"), '新块应为 div（块结构与回车/currentBlock 预期一致）');
  assert.ok(SRC.includes("nb.appendChild(document.createElement('br'));"), '空块必须含 <br>（无 br 则零高、光标无法绘制）');
  assert.ok(SRC.includes('if (blk.nextSibling) blk.parentNode.insertBefore(nb, blk.nextSibling);') &&
    SRC.includes('else blk.parentNode.appendChild(nb);'), '应插到提醒行之后（有后续块则前插，否则追加到末尾）');
  assert.ok(SRC.includes('placeCaretInBlock(nb);'), '应 placeCaretInBlock 把光标落进新空块');
});

test('V732-S9 修复c：全部模态/浮层关闭路径 PC 端焦点归还（CHIP_HOVER_OK 门控，不含跳转/接力路径）', () => {
  // 关闭后回到编辑器且不跳页/不开新模态的路径，都应归还焦点——独立验证 agent 发现的规格「等」字缺口全量补齐
  // 注意：index.html 为 CRLF，多行片段一律用正则 [\s\S]/\r?\n（v71 先例）
  const targets = [
    ['qrClose', /resetQrHolder\(\); qrMask\.classList\.add\('hidden'\); if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
    ['aboutMask 点击关闭', /e\.target === aboutMask\) \{ aboutMask\.classList\.add\('hidden'\); if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
    ['diagMask 点击关闭', /e\.target === diagMask\) \{ diagMask\.classList\.add\('hidden'\); (?:hideUploadStatus\(\); )?if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
    ['menuTheme', /menuMask\.classList\.add\('hidden'\); themeBtn\.click\(\); if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
    ['cpCancel', /cpMask\.classList\.add\('hidden'\); if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
    ['cpRotate 成功', /cpMask\.classList\.add\('hidden'\); cpReset\(\);\r?\n\s{8}if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
    ['恢复历史版本', /menuMask\.classList\.add\('hidden'\);\r?\n\s{8}if \(CHIP_HOVER_OK\) \{ try \{ editor\.focus\(\); ensureCaret\(\); \} catch \(e\) \{\} \}/],
  ];
  for (const [name, re] of targets) {
    assert.ok(re.test(SRC), name + ' 关闭路径应归还焦点（缺漏会再次触发光标消失）');
  }
  // 跳转/接力路径不得误补（menuHome 跳首页、menuAbout 开关于、menuLock 开锁定、scanBtn/landingScan 开扫码（v7.7.0 menuScan 退役）、aboutTitle 彩蛋开诊断）
  // 对抗审补丁：正则必须兼容 async () => 形态（menuAbout 是 async），否则死断言假绿
  const mustNot = ['menuHome', 'menuAbout', 'menuLock', 'scanBtn', 'landingScan', 'aboutTitle'];
  for (const id of mustNot) {
    const m = new RegExp("\\$\\('#" + id + "'\\)\\.addEventListener\\('click', (?:async )?\\(\\) => \\{[\s\S]{0,250}?editor\\.focus\\(\\)");
    assert.ok(!m.test(SRC), '#' + id + ' 是跳转/接力路径，不应误补 editor.focus()');
  }
  // openChangePass 是命名函数引用：焦点应交给 cpOld 输入框而非编辑器
  assert.ok(/function openChangePass\(\) \{[\s\S]{0,200}?cpOld\.focus\(\)/.test(SRC), 'openChangePass 应把焦点交给 cpOld 输入框');
  assert.ok(!/function openChangePass\(\) \{[\s\S]{0,300}?editor\.focus\(\)/.test(SRC), 'openChangePass 不应误补 editor.focus()');
});

// ═══════════ jsdom 行为测试 ═══════════
test('V732-B1 修复b行为：空占位 <u class="rem-mark"><br></u> 拆包后 br 保留（行首回车空行不塌缩）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;
  const wrap = document.createElement('div');
  wrap.innerHTML = '<u class="rem-mark"><br></u>';
  window.unwrapMark(wrap.querySelector('u.rem-mark'), false);
  assert.strictEqual(wrap.querySelector('u'), null, '拆包后占位标记应移除');
  assert.ok(wrap.firstChild && wrap.firstChild.nodeName === 'BR', '空占位内的 <br> 必须保留（否则空行塌缩、提醒行回跳）');
  assert.strictEqual(wrap.innerHTML, '<br>', '拆包结果应为裸 <br>');
});

test('V732-B2 修复b行为：无子节点空占位自动补 <br>；非空文本拆包保文本（含 stripZwsp 口径）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;
  // 空占位无 <br>（防御路径：应补 br，保证空行高度）
  const w1 = document.createElement('div');
  w1.innerHTML = '<u class="rem-mark"></u>';
  window.unwrapMark(w1.querySelector('u.rem-mark'), false);
  assert.ok(w1.firstChild && w1.firstChild.nodeName === 'BR', '无子节点的空占位应补 <br>');
  // 非空文本标记：拆包后文本保留
  const w2 = document.createElement('div');
  w2.innerHTML = '<u class="rem-mark">明天10点</u>';
  window.unwrapMark(w2.querySelector('u.rem-mark'), false);
  assert.strictEqual(w2.innerHTML, '明天10点', '非空文本标记拆包后文本应保留');
  // stripZwsp=true 剥零宽空格（链接路）；false 保留（提醒路）
  const w3 = document.createElement('div');
  w3.innerHTML = '<u class="rem-mark">明天10点' + ZWSP + '</u>';
  window.unwrapMark(w3.querySelector('u.rem-mark'), true);
  assert.strictEqual(w3.textContent, '明天10点', 'stripZwsp=true 应剥零宽空格');
  const w4 = document.createElement('div');
  w4.innerHTML = '<u class="rem-mark">明天10点' + ZWSP + '</u>';
  window.unwrapMark(w4.querySelector('u.rem-mark'), false);
  assert.ok(w4.textContent.indexOf(ZWSP) !== -1, 'stripZwsp=false 应保留零宽空格');
});

test('V732-B3 修复d行为：提醒行后插含 br 的空块并落光标（中间插入场景）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  editor.innerHTML = '<div>2026-9-8 14:00　开会</div><div>第二行</div>';
  const first = editor.children[0];
  const range = document.createRange();
  range.setStart(first, 1); range.setEnd(first, 1); // 光标在第一块内
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  window.placeCaretAfterReminderLine();

  assert.strictEqual(editor.children.length, 3, '应新增一个空 div');
  const nb = editor.children[1];
  assert.strictEqual(nb.tagName, 'DIV', '新增块应为 div');
  assert.strictEqual(nb.childNodes.length, 1, '空块应恰含 1 个子节点');
  assert.strictEqual(nb.firstChild.nodeName, 'BR', '空块必须含 <br>（零高块光标无法绘制）');
  assert.strictEqual(editor.children[2].textContent, '第二行', '原后续块顺序不变');
  const cur = window.getSelection();
  assert.ok(cur.rangeCount > 0, '选区应存在');
  assert.strictEqual(cur.getRangeAt(0).startContainer, nb, '光标应落在新空块内（可直接继续输入）');
});

test('V732-B4 修复d行为：仅提醒行一个块时，新空块追加到编辑器末尾', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  editor.innerHTML = '<div>2026-9-8 14:00　开会</div>';
  const first = editor.children[0];
  const range = document.createRange();
  range.setStart(first, 0); range.setEnd(first, 0);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  window.placeCaretAfterReminderLine();

  assert.strictEqual(editor.children.length, 2, '应追加一个新空 div');
  const nb = editor.children[1];
  assert.strictEqual(nb.tagName, 'DIV', '新增块应为 div');
  assert.strictEqual(nb.firstChild.nodeName, 'BR', '空块必须含 <br>');
  const cur = window.getSelection();
  assert.ok(cur.rangeCount > 0 && cur.getRangeAt(0).startContainer === nb, '光标应落在追加的空块内');
});

// ═══════ 对抗审补测（第二轮）═══════
test('V732-B5 修复b行为：行内空标记不插 <br>（<div>abc<u></u>def</div> 不得断成两行）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;
  const w = document.createElement('div');
  w.innerHTML = '<div>abc<u class="rem-mark"></u>def</div>';
  window.unwrapMark(w.querySelector('u.rem-mark'), false);
  assert.strictEqual(w.innerHTML, '<div>abcdef</div>', '行内空标记应直接移除，不得插入 <br>（否则一行硬断两行）');
});

test('V732-B6 修复b行为：无子节点空占位且父块仅有该标记时仍补 <br>（块级占位）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;
  const w = document.createElement('div');
  w.innerHTML = '<div><u class="rem-mark"></u></div>';
  window.unwrapMark(w.querySelector('u.rem-mark'), false);
  assert.strictEqual(w.innerHTML, '<div><br></div>', '块级空占位（父块无其他内容）应补 <br> 保空行高度');
});

test('V732-B7 修复b行为：「文本+br」混合占位拆包后 br 保留（<u>foo<br></u> 不塌缩）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;
  const w = document.createElement('div');
  w.innerHTML = '<u class="rem-mark">foo<br></u>';
  window.unwrapMark(w.querySelector('u.rem-mark'), false);
  assert.strictEqual(w.querySelector('u'), null, '占位标记应移除');
  assert.ok(w.querySelector('br'), '混合占位内的 <br> 必须保留（整体替换会销毁它）');
  assert.strictEqual(w.textContent, 'foo', '文本保留');
});

test('V732-B8 修复d行为：连续两次提醒后空行复用不堆积（placeCaretAfterReminderLine 空块守卫）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  editor.innerHTML = '<div>提醒A</div><div><br></div>';
  const first = editor.children[0];
  const range = document.createRange();
  range.setStart(first, 1); range.setEnd(first, 1); // 光标在提醒A块内
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  window.placeCaretAfterReminderLine(); // 光标在提醒A内 → 下一块已是空块 → 应复用，不新增

  assert.strictEqual(editor.children.length, 2, 'nextSibling 已是空块时不得再插新空块（连续添加不堆积空行）');
  const cur = window.getSelection();
  assert.ok(cur.rangeCount > 0 && cur.getRangeAt(0).startContainer === editor.children[1], '光标应落在被复用的空块内');
});
