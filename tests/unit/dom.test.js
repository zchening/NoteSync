// NoteSync 单元测试（jsdom 加载真实 index.html）
// 覆盖 A 类核心路径：偏移换算(A7)、range 相交(A5)、删除线加/取消 DOM 手术(A1/A2/A4/A6)、偏移保存恢复往返(A3/A7)
const { test, after } = require('node:test');
const assert = require('node:assert');
const { loadApp, ZWSP } = require('../helpers');

const dom = loadApp();
const { window } = dom;
const document = window.document;
const editor = document.getElementById('editor');

// 测试结束后关闭 jsdom window，避免遗留定时器导致进程退出码非 0
after(() => { try { window.close(); } catch (e) {} });

const stripZWSP = (s) => s.replace(/\u200B/g, '');
const visible = (s) => stripZWSP(s);

function reset(html) { editor.innerHTML = html; }
function textNode(value) {
  const walker = document.createTreeWalker(editor, window.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue === value) return walker.currentNode;
  }
  return null;
}
function rangeOver(startNode, startOff, endNode, endOff) {
  const r = document.createRange();
  r.setStart(startNode, startOff);
  r.setEnd(endNode, endOff);
  return r;
}

// ── A7：可见字符偏移换算，无视零宽空格 ──────────────────────────────
test('visibleLen 忽略零宽空格', () => {
  assert.strictEqual(window.visibleLen('15' + ZWSP + '.34'), 5);
  assert.strictEqual(window.visibleLen('普通文字'), 4);
  assert.strictEqual(window.visibleLen(''), 0);
});

test('visibleToRealOffset 在含 ZWSP 文本节点上正确映射', () => {
  const node = document.createTextNode('15' + ZWSP + '.34'); // 长度 6，含 1 个 ZWSP
  assert.strictEqual(window.visibleToRealOffset(node, 0), 0);
  assert.strictEqual(window.visibleToRealOffset(node, 2), 2); // 落在 ZWSP 位置
  assert.strictEqual(window.visibleToRealOffset(node, 5), 6); // 末尾
});

// ── A5：rangeIntersectsNode 运算符方向（反直觉的 >=0 / <=0）────────────
test('rangeIntersectsNode 重叠返回 true，不相交返回 false', () => {
  reset('甲乙<span id="x">丙丁</span>');
  const node = document.getElementById('x').firstChild; // "丙丁"
  const firstText = editor.firstChild;                // "甲乙"
  // 选 "甲"：在目标节点之前
  assert.strictEqual(window.rangeIntersectsNode(rangeOver(firstText, 0, firstText, 1), node), false);
  // 选 "丙"：在目标节点内
  assert.strictEqual(window.rangeIntersectsNode(rangeOver(node, 0, node, 1), node), true);
  // 选 "丁"：在目标节点尾部
  assert.strictEqual(window.rangeIntersectsNode(rangeOver(node, 1, node, 2), node), true);
  // 选 "甲乙丙丁" 整体：跨过目标节点
  assert.strictEqual(window.rangeIntersectsNode(rangeOver(firstText, 0, node, 2), node), true);
});

// ── A1：跨行选中加删除线，行数不变 ──────────────────────────────────
test('addStrikeToRange 跨行选中后行数不变', () => {
  reset('<p>第一行</p><p>第二行</p>');
  const p1 = editor.children[0], p2 = editor.children[1];
  const t1 = p1.firstChild, t2 = p2.firstChild;
  window.addStrikeToRange(rangeOver(t1, 0, t2, t2.length));
  assert.strictEqual(editor.querySelectorAll('p').length, 2, '行数应不变');
  assert.strictEqual(editor.querySelectorAll('s').length, 2, '每段文字各自被 <s> 包裹');
  assert.strictEqual(visible(editor.textContent), '第一行第二行');
});

// ── A4：单行选区（公共祖先为文本节点）加删除线有效 ───────────────────
test('addStrikeToRange 单行选区(公共祖先为文本节点)有效', () => {
  reset('abcdef');
  const t = editor.firstChild; // 文本节点 "abcdef"
  window.addStrikeToRange(rangeOver(t, 1, t, 3)); // 选 "bc"
  assert.strictEqual(editor.querySelectorAll('s').length, 1);
  assert.strictEqual(editor.querySelector('s').textContent, 'bc');
  assert.strictEqual(visible(editor.textContent), 'abcdef');
});

// ── A2：部分覆盖取消删除线，只移出选中部分 ──────────────────────────
test('removeStrikeFromRange 部分覆盖只取消选中部分', () => {
  reset('<s>甲乙丙</s>丁');
  const sTag = editor.querySelector('s');
  const sText = sTag.firstChild; // "甲乙丙"
  window.removeStrikeFromRange(rangeOver(sText, 1, sText, 2)); // 选 "乙"
  // 期望：甲、丙 保留删除线，乙 被移出，丁 不变
  assert.strictEqual(editor.querySelectorAll('s').length, 2);
  assert.strictEqual(
    Array.from(editor.querySelectorAll('s')).map((s) => s.textContent).join(''),
    '甲丙'
  );
  assert.strictEqual(visible(editor.textContent), '甲乙丙丁');
});

// ── A6：完全覆盖取消删除线，不残留空 <s> ────────────────────────────
test('removeStrikeFromRange 完全覆盖不产生空 <s>', () => {
  reset('<s>甲</s>乙');
  const sTag = editor.querySelector('s');
  const sText = sTag.firstChild;
  window.removeStrikeFromRange(rangeOver(sText, 0, sText, 1)); // 完全覆盖 "甲"
  assert.strictEqual(editor.querySelectorAll('s').length, 0, '不应残留空 <s>');
  assert.strictEqual(visible(editor.textContent), '甲乙');
});

// ── A3/A7：保存/恢复偏移对 ZWSP 插入鲁棒 ───────────────────────────
test('saveSelectionOffsets/restore 对 ZWSP 插入鲁棒', () => {
  reset('汉字ABC');
  const t = editor.firstChild; // "汉字ABC"
  const r = rangeOver(t, 1, t, 3); // 选 "字A"（可见偏移 1..3）
  const saved = window.saveSelectionOffsets(editor, r);
  // 注意：返回值来自 jsdom 的 realm，避免跨 realm 的对象原型比对，逐字段断言
  assert.strictEqual(saved.start, 1);
  assert.strictEqual(saved.end, 3);

  // 模拟 linkify：同一文本节点插入 ZWSP（如 "汉|字ABC"）
  t.nodeValue = '汉' + ZWSP + '字ABC';
  const restored = window.restoreSelectionOffsets(editor, saved.start, saved.end);
  assert.ok(restored, '应恢复出 range');
  assert.strictEqual(visible(restored.toString()), '字A');
});

test('restoreSelectionOffsets 越界返回 null', () => {
  reset('abc');
  assert.strictEqual(window.restoreSelectionOffsets(editor, 100, 101), null);
});
