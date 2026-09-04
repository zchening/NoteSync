// 待办（v5.34）单元测试
// 覆盖三条最容易出事的路径：
//   1. 折叠光标下工具栏是否生效（lastRange 只在非折叠选区更新，是这里最大的陷阱）
//   2. 状态只挂 class + data-done，能否被 innerHTML 完整序列化（决定跨端同步是否成立）
//   3. linkifyEditor 会拍平全部 <span>，待办挂在根级块的 class 上是否安全
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

function freshApp() {
  const dom = loadApp();
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor') };
}

// 折叠光标放进指定节点（offset 默认 0）
function caretIn(window, node, offset = 0) {
  const sel = window.getSelection();
  const r = window.document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  window.document.dispatchEvent(new window.Event('selectionchange'));
}

// 跨块选中：从 startNode 的 0 选到 endNode 末尾
function selectAcross(window, startNode, endNode) {
  const sel = window.getSelection();
  const r = window.document.createRange();
  r.setStart(startNode, 0);
  r.setEnd(endNode, endNode.nodeType === 3 ? endNode.length : endNode.childNodes.length);
  sel.removeAllRanges();
  sel.addRange(r);
  window.document.dispatchEvent(new window.Event('selectionchange'));
}

function click(window, target, clientX) {
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, clientX }));
}

// ── T1：工具栏存在待办按钮 ────────────────────────────
test('T1 顶栏存在 todoBtn 且与删除线按钮并列', () => {
  const { dom, document } = freshApp();
  const btn = document.getElementById('todoBtn');
  const strike = document.getElementById('strikeBtn');
  assert.ok(btn, 'index.html 应存在 #todoBtn');
  assert.ok(btn.querySelector('svg'), '待办按钮应有 SVG 图标');
  assert.strictEqual(btn.previousElementSibling, strike, '待办按钮应紧跟在删除线按钮之后');
  dom.window.close();
});

// ── T2：折叠光标下点一下就把该行变待办（核心场景）──────
test('T2 折叠光标停在行内，applyTodo 把该行变成待办', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div>买牛奶</div><div>交电费</div>';
  const blocks = editor.children;
  caretIn(window, blocks[0].firstChild, 1);

  window.applyTodo();

  assert.ok(blocks[0].classList.contains('todo'), '光标所在行应变待办');
  assert.strictEqual(blocks[0].getAttribute('data-done'), '0', '新建待办默认未完成');
  assert.ok(!blocks[1].classList.contains('todo'), '未涉及的行不应受影响');
  dom.window.close();
});

// ── T3：再点一次取消待办 ──────────────────────────────
test('T3 已是待办的行，再次 applyTodo 取消待办且清掉 data-done', async () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div>买牛奶</div>';
  const b = editor.children[0];
  caretIn(window, b.firstChild, 1);

  window.applyTodo();
  assert.ok(b.classList.contains('todo'));

  // todoBusy 有 300ms 防抖守卫（拦截 pointerdown/touchstart/mousedown 三重事件重复触发，
  // 与删除线同一套设计），这里等守卫解除，模拟用户间隔点击
  await new Promise(r => setTimeout(r, 350));
  window.applyTodo();
  assert.ok(!b.classList.contains('todo'), '再次操作应取消待办');
  assert.strictEqual(b.getAttribute('data-done'), null, '取消时应一并移除 data-done，不留垃圾属性');
  dom.window.close();
});

// ── T4：跨行选区批量转换 ──────────────────────────────
test('T4 选中多行时整批变待办', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div>A</div><div>B</div><div>C</div>';
  const kids = editor.children;
  selectAcross(window, kids[0].firstChild, kids[2].firstChild);

  window.applyTodo();

  assert.ok(kids[0].classList.contains('todo'), '第一行应变待办');
  assert.ok(kids[1].classList.contains('todo'), '中间行应变待办');
  assert.ok(kids[2].classList.contains('todo'), '末行应变待办');
  dom.window.close();
});

// ── T5：混合态（部分已是待办）应整批统一为待办，不产生反复 ──
test('T5 混合态：只要有一块不是待办，整批统一变成待办', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div>A</div><div>B</div>';
  const kids = editor.children;
  kids[0].classList.add('todo');
  kids[0].setAttribute('data-done', '0');
  selectAcross(window, kids[0].firstChild, kids[1].firstChild);

  window.applyTodo();

  assert.ok(kids[1].classList.contains('todo'), '非待办行应被拉齐为待办');
  assert.ok(kids[0].classList.contains('todo'), '已是待办的行不应被误取消');
  dom.window.close();
});

// ── T6：状态可被 innerHTML 完整序列化（跨端同步的生命线）──
test('T6 data-done 与 class 能被 innerHTML 完整序列化', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div>买牛奶</div>';
  const b = editor.children[0];
  caretIn(window, b.firstChild, 1);

  window.applyTodo();
  window.toggleTodoDone(b);

  const html = editor.innerHTML;
  assert.ok(html.includes('class="todo"'), '同步出去的 HTML 必须带 todo class');
  assert.ok(html.includes('data-done="1"'), '同步出去的 HTML 必须带 data-done 属性');
  assert.ok(html.includes('买牛奶'), '正文内容不应丢失');
  dom.window.close();
});

// ── T7：点击方框区切换完成态（jsdom 中 rect.left 为 0）──
test('T7 点击待办行左侧方框区切换完成态', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div class="todo" data-done="0">买牛奶</div>';
  const b = editor.children[0];

  click(window, b, 5);
  assert.strictEqual(b.getAttribute('data-done'), '1', '点方框应从 0 切到 1');

  click(window, b, 5);
  assert.strictEqual(b.getAttribute('data-done'), '0', '再点应切回 0');
  dom.window.close();
});

// ── T8：点击行内文字区不触发切换（不能影响正常编辑）──
test('T8 点击待办行的文字区不触发完成态切换', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div class="todo" data-done="0">买牛奶</div>';
  const b = editor.children[0];

  click(window, b, 100);
  assert.strictEqual(b.getAttribute('data-done'), '0', '点文字区不应改变完成态');
  dom.window.close();
});

// ── T9：linkify 拍平 span 后，根级块的 todo class 必须存活 ──
test('T9 linkifyEditor 执行后待办行仍保留 class 与 data-done', () => {
  const { dom, window, editor } = freshApp();
  editor.innerHTML = '<div class="todo" data-done="0">买 https://example.com 的牛奶</div>';
  const b = editor.children[0];

  window.linkifyEditor({ keepSelection: false });

  assert.ok(editor.contains(b), '待办行不应被重建或移除');
  assert.ok(b.classList.contains('todo'), 'linkify 不得吃掉根级块的 todo class');
  assert.strictEqual(b.getAttribute('data-done'), '0', 'linkify 不得吃掉 data-done 属性');
  dom.window.close();
});

// ── T10：待办样式不引入任何新颜色值（反色对抗安全）──
// 全站有三处覆盖块专门对抗小米/QQ 浏览器的强制反色，只覆盖显式 color 声明。
// 待办若引入新颜色就必须同步进那三处，否则日间态颜色会错。这里锁死「只用 currentColor + opacity」。
test('T10 待办 CSS 只使用 currentColor 与 opacity，不引入新颜色值', () => {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  const rules = src.split('\n').filter(l => /#editor \.todo/.test(l));
  assert.ok(rules.length >= 6, '应存在 #editor .todo 系列样式规则');
  rules.forEach(line => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(line), `待办样式不应出现十六进制颜色：${line}`);
    assert.ok(!/var\(--/.test(line), `待办样式不应引用颜色变量（反色覆盖块管不到）：${line}`);
    assert.ok(!/\brgba?\(/.test(line), `待办样式不应出现 rgb/rgba：${line}`);
  });
  const joined = rules.join('\n');
  assert.ok(joined.includes('currentColor'), '方框与勾必须由 currentColor 绘制，随主题自动变化');
  assert.ok(/\[data-done="1"\][^{]*\{[^}]*opacity/.test(joined), '完成态必须由 opacity 表达而非换色');
});

// ── T11：移动端 8 个按钮不溢出（按钮尺寸已收紧）──
test('T11 移动端媒体查询已收紧按钮尺寸，容纳第 8 个按钮', () => {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(/@media \(max-width:560px\)\{ header\{gap:6px/.test(src), '移动端 header 间距应收紧到 6px');
  assert.ok(/header button\{width:27px;height:27px\}/.test(src), '移动端按钮应收紧到 27px');
  assert.ok(/header button svg\{width:16px;height:16px\}/.test(src), '移动端图标应收紧到 16px');
});
