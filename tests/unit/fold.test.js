// v9.1.0 折叠列表守护（本仓铁律：行为优先于文本；新断言锚定补丁行；不写布局断言进 jsdom）
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');

function ed(w) { return w.document.getElementById('editor'); }
function blocks(w) { return Array.prototype.slice.call(ed(w).children); }

/* ── F1 行首 [折叠] 折叠其下到第一个空行，默认收起 ── */
test('F1 行首 [折叠] 生效：包标记+默认收起，正文折到第一个空行为止', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]标题</div><div>正文1</div><div>正文2</div><div><br></div><div>后面</div>';
  w.applyFolds();
  const b = blocks(w);
  assert.ok(b[0].classList.contains('ns-fold'), '把手块应带 ns-fold');
  assert.ok(b[0].classList.contains('ns-fold-collapsed'), '默认收起');
  assert.ok(!b[0].classList.contains('ns-fold-open'), '默认不得是展开');
  const mark = b[0].querySelector(':scope > .ns-fold-mark');
  assert.ok(mark && mark.textContent === '[折叠]', '行首 [折叠] 被包成 ns-fold-mark，文本仍是 [折叠]');
  assert.strictEqual(b[0].textContent, '[折叠]标题', '折叠不得吞字：把手行文本原样保留');
  assert.ok(b[1].classList.contains('ns-fold-hide'), '正文1 被折叠隐藏');
  assert.ok(b[2].classList.contains('ns-fold-hide'), '正文2 被折叠隐藏');
  assert.ok(!b[3].classList.contains('ns-fold-hide'), '空行是收束点，不隐藏');
  assert.ok(!b[4].classList.contains('ns-fold-hide'), '空行之后的正文不受影响');
});

/* ── F2 非行首的 [折叠] 不生效 ── */
test('F2 [折叠] 不在行首（前面有字）不折叠，当普通正文', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>前[折叠]后</div><div>正文</div>';
  w.applyFolds();
  const b = blocks(w);
  assert.ok(!b[0].classList.contains('ns-fold'), '非行首不得识别为折叠把手');
  assert.ok(!b[1].classList.contains('ns-fold-hide'), '后续正文不得被隐藏');
});

/* ── F3 幂等：多次 applyFolds 不重复包标记、不叠 [折叠] ── */
test('F3 applyFolds 幂等（先拆后建），连跑多次不产生双层标记或重复 [折叠]', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]标题</div><div>正文</div>';
  w.applyFolds(); w.applyFolds(); w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b[0].querySelectorAll('.ns-fold-mark').length, 1, '只能有一个 fold-mark');
  assert.strictEqual(b[0].textContent, '[折叠]标题', '多次重绘 [折叠] 不得翻倍');
});

/* ── F4 多处折叠：各自折到各自的空行 ── */
test('F4 一条笔记多处折叠互不串扰', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML =
    '<div>[折叠]甲</div><div>a1</div><div><br></div>' +
    '<div>[折叠]乙</div><div>b1</div><div><br></div><div>尾</div>';
  w.applyFolds();
  const b = blocks(w);
  assert.ok(b[0].classList.contains('ns-fold') && b[3].classList.contains('ns-fold'), '两处把手都被识别');
  assert.ok(b[1].classList.contains('ns-fold-hide') && !b[2].classList.contains('ns-fold-hide'), '甲折到其空行');
  assert.ok(b[4].classList.contains('ns-fold-hide') && !b[5].classList.contains('ns-fold-hide'), '乙折到其空行');
  assert.ok(!b[6].classList.contains('ns-fold-hide'), '尾部正文不隐藏');
});

/* ── F5 折叠装饰不算内容改动（isDecorativelyEqual 豁免 ns-fold-mark + div class） ── */
test('F5 折叠标记/开合是纯显示层：与未加装饰的正文装饰等价，绝不误判为改动', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const clean = '<div>[折叠]标题</div><div>正文</div>';
  const decoratedCollapsed = '<div class="ns-fold ns-fold-collapsed"><span class="ns-fold-mark">[折叠]</span>标题</div><div class="ns-fold-hide">正文</div>';
  assert.ok(w.isDecorativelyEqual(clean, decoratedCollapsed), '加折叠装饰 + 收起 必须与原文装饰等价（不触 PUT/撤销/草稿冲突）');
  const decoratedOpen = '<div class="ns-fold ns-fold-open"><span class="ns-fold-mark">[折叠]</span>标题</div><div>正文</div>';
  assert.ok(w.isDecorativelyEqual(decoratedCollapsed, decoratedOpen), '开↔合切换必须装饰等价（记住状态不产生内容差异）');
  // 反证：真改一个字必须判不等
  const realEdit = '<div class="ns-fold ns-fold-collapsed"><span class="ns-fold-mark">[折叠]</span>标题X</div><div class="ns-fold-hide">正文</div>';
  assert.ok(!w.isDecorativelyEqual(decoratedCollapsed, realEdit), '真改正文必须判为不等（豁免不得吞掉真实差异）');
});

/* ── F6 护栏源码锚定：退格在标记边界整删 [折叠]，绝不逐字啃坏 ── */
test('F6 退格护栏锚定执法行（行首 [折叠] 原子整删 + 不吞 preventDefault + 无 :scope）', () => {
  assert.ok(SRC.includes("if (e.key !== 'Backspace') return;"), '护栏必须只拦 Backspace');
  assert.ok(SRC.includes('try { mark = foldMarkTouchedByCaret(sel.getRangeAt(0)); } catch (err) { return; }'),
    '边界判定必须套 try（老内核抛错时退回默认退格，绝不让监听器崩）');
  // 顺序锚：命中折叠边界→先 preventDefault 再整删（v9.3.5 #2 把「不在边界→return」扩成「图原子删分支+return」，此锚只钉折叠命中路径的 preventDefault→remove 顺序）
  assert.ok(/e\.preventDefault\(\);[\s\S]{0,60}const handle = mark\.closest\('\.ns-fold'\);[\s\S]{0,20}mark\.remove\(\);/.test(SRC),
    '命中边界必须先 e.preventDefault() 再整删整个 [折叠]（防逐字啃坏）');
  assert.ok(/function foldMarkTouchedByCaret\(range\)/.test(SRC), '边界判定函数存在');
  assert.ok(!SRC.includes(':scope > .ns-fold-mark'), '护栏不得用 :scope（老内核不支持会抛 SyntaxError 令护栏静默失效）');
});

/* ── F7 normDecorHtml 豁免补丁行 + CSS 作用域锁在 #editor（保证导出副本按全文渲染） ── */
test('F7 normDecorHtml 拍平 ns-fold-mark 且折叠 CSS 锁在 #editor 下（导出/打印仍全文）', () => {
  assert.ok(SRC.includes("if (tag === 'SPAN' && child.classList.contains('ns-fold-mark')) { out += walk(child); continue; }"),
    'normDecorHtml 必须显式拍平折叠标记（锚定执法行）');
  assert.ok(SRC.includes('#editor .ns-fold-hide{display:none}'), '隐藏正文规则必须作用域锁在 #editor');
  assert.ok(!/^\s*\.ns-fold-hide\{/m.test(SRC), '不得出现脱离 #editor 作用域的裸 .ns-fold-hide（否则离屏导出副本也会被隐藏丢字）');
  assert.ok(/@media print\{#editor \.ns-fold-hide\{display:block\}/.test(SRC),
    '必须有 @media print 展开折叠（浏览器 Ctrl+P 直打活的 #editor，否则收起正文打印丢字，违反「打印仍全文」）');
});

/* ── F8 折叠态本机持久化（按序号、按 noteId 分区），点三角走真实 click 处理器展开 ── */
test('F8 折叠态存本机 localStorage（序号身份，按 noteId 分区），默认折叠、点三角展开', t => {
  const app = loadApp(null, 'http://localhost/mynote'); t.after(() => app.window.close());
  const w = app.window;
  assert.strictEqual(w.eval('noteId'), 'mynote');
  ed(w).innerHTML = '<div>[折叠]标题</div><div>正文</div>';
  w.applyFolds();
  let st = w.__foldState();
  assert.strictEqual(st.count, 1, '识别到一处折叠');
  assert.strictEqual(JSON.stringify(st.open), '[]', '默认折叠（无展开序号）');
  assert.strictEqual(st.hidden, 1, '一处正文被隐藏');
  // 点三角 → 走真实 click 委托处理器，序号 0 记为展开
  const mark = ed(w).querySelector('.ns-fold-mark');
  mark.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  st = w.__foldState();
  assert.strictEqual(JSON.stringify(st.open), '[0]', '点开后序号 0 展开');
  assert.strictEqual(st.hidden, 0, '展开后正文不再隐藏');
  assert.strictEqual(JSON.stringify(st.store), '[0]', '本机 localStorage 落的是展开序号数组');
});

/* ── F9 改标题不换身份：展开态改把手文字后仍展开（序号身份，防 P1「一改标题就收起」） ── */
test('F9 展开后编辑把手标题不会被重置收起（折叠身份按序号，不按文字）', t => {
  const app = loadApp(null, 'http://localhost/mynote'); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1</div><div><br></div>';
  w.applyFolds();
  // 点开
  ed(w).querySelector('.ns-fold-mark').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(JSON.stringify(w.__foldState().open), '[0]', '已展开');
  // 模拟改标题：把把手块标题文本改掉（序号不变）
  const handle = blocks(w)[0];
  const titleNode = handle.querySelector('.ns-fold-mark').nextSibling;
  titleNode.nodeValue = '甲改了很多字';
  w.applyFolds();
  const st = w.__foldState();
  assert.strictEqual(JSON.stringify(st.open), '[0]', '改标题后仍记住展开（身份是第几处折叠，不是文字）');
  assert.strictEqual(st.hidden, 0, '改标题不误收起正文');
});

/* ── F10 占位等价也豁免折叠装饰（两大归一化口径对齐，防只过 isPlaceholderEqual 的保存误判） ── */
test('F10 isPlaceholderEqual 也忽略折叠标记/收起类，与 isDecorativelyEqual 同口径', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const clean = '<div>[折叠]标题</div><div>正文</div>';
  const decorated = '<div class="ns-fold ns-fold-collapsed"><span class="ns-fold-mark">[折叠]</span>标题</div><div class="ns-fold-hide">正文</div>';
  assert.ok(w.isPlaceholderEqual(clean, decorated), '折叠装饰不得被占位等价判成真实差异（否则残留标记会被 PUT 进同步内容）');
});

/* ── F11 折叠正文始终带 ns-fold-body（缩进+引导线靠它），把手/空行不带 ── */
test('F11 正文块打 ns-fold-body（收起/展开都打），把手与空行不打', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1</div><div>a2</div><div><br></div><div>尾</div>';
  w.applyFolds(); // 默认收起
  let b = blocks(w);
  assert.ok(!b[0].classList.contains('ns-fold-body'), '把手块不是正文');
  assert.ok(b[1].classList.contains('ns-fold-body') && b[2].classList.contains('ns-fold-body'), '收起态正文仍带 ns-fold-body');
  assert.ok(!b[3].classList.contains('ns-fold-body'), '空行（收束点）不带 ns-fold-body');
  assert.ok(!b[4].classList.contains('ns-fold-body'), '空行之后的正文不带');
  // 展开后仍带
  ed(w).querySelector('.ns-fold-mark').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  b = blocks(w);
  assert.ok(b[1].classList.contains('ns-fold-body'), '展开态正文仍带 ns-fold-body');
  assert.ok(!b[1].classList.contains('ns-fold-hide'), '展开后正文不再隐藏');
});

/* ── F12 v9.1.1 源码锚定：缩进引导线 CSS + 移动端点三角不弹键盘 ── */
test('F12 折叠正文缩进引导线 CSS 与移动端不聚焦护栏锚定执法行', () => {
  assert.ok(SRC.includes("#editor .ns-fold-body{margin-left:.5em;padding-left:1em;border-left:2px solid var(--line)}"),
    '正文缩进 + 左引导线内缩到三角下方（--line 令牌，非新色）规则必须在');
  assert.ok(SRC.includes("if (e.target && e.target.closest && e.target.closest('span.ns-fold-mark')) { e.preventDefault(); return; }"),
    'mousedown 必须在点折叠三角时 preventDefault（阻止 contenteditable 聚焦→移动端不弹键盘）');
  assert.ok(SRC.includes('try { dismissKeyboardForTouch(); } catch (err) {}'),
    '开合处理器必须补一次 dismissKeyboardForTouch（触屏 touchstart 早聚焦的兜底）');
});

