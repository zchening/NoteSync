// NoteSync 三击行选"边界溢出"钳制测试（jsdom 加载真实 index.html）
// 覆盖 v5.13 修复：三击选中第一行后选区终点落在第二行块起点(offset 0)、
// 造成"边界溢出"，随后按空格会把第二行拽上来。新钩子：
//   window.__isOverflowSelection(range)   判定是否溢出（含显式 range 参数）
//   window.__clampOverflowSelection()     钳制当前 selection 的溢出终点、返回是否钳制
//
// 约定：每个用例都加载一份全新 jsdom（freshApp），结束 window.close() 防跨用例污染。
const { test } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

function freshApp() {
  const dom = loadApp();
  const { window } = dom;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor') };
}

// (a) 加载后两个测试钩子均已挂到 window
test('__isOverflowSelection 与 __clampOverflowSelection 都是 function', () => {
  const { window } = freshApp();
  try {
    assert.strictEqual(typeof window.__isOverflowSelection, 'function');
    assert.strictEqual(typeof window.__clampOverflowSelection, 'function');
  } finally { window.close(); }
});

// (b) 溢出选区：终点落在紧随其后的兄弟块起点、未选中其内容 → 应被检测并钳制
test('溢出选区：__isOverflowSelection 为 true，钳制后 end 回到首行末尾', () => {
  const { window, editor } = freshApp();
  try {
    editor.innerHTML = '<div>一二三四五六</div><div>七</div>';
    const div1 = editor.children[0];
    const div2 = editor.children[1];
    const text1 = div1.firstChild; // 文本节点 "一二三四五六"

    const range = window.document.createRange();
    range.setStart(text1, 0);
    range.setEnd(div2, 0); // 终点落在第二行块起点(offset 0)

    assert.strictEqual(window.__isOverflowSelection(range), true, '应判定为边界溢出');

    // 设为当前 selection 后钳制
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const clamped = window.__clampOverflowSelection();
    assert.strictEqual(clamped, true, '应返回钳制成功');

    const s2 = window.getSelection();
    assert.strictEqual(s2.rangeCount, 1, '钳制后 selection 仍应有 1 个 range');
    const r2 = s2.getRangeAt(0);
    assert.strictEqual(r2.startContainer, text1, '起点仍为首行文本节点');
    assert.strictEqual(r2.startOffset, 0, '起点 offset 仍为 0');
    assert.strictEqual(s2.toString(), '一二三四五六', '钳制后选中文本只剩首行');
    // 终点应钳制到首块末尾：selectNodeContents(div1).collapse(false) 的边界位置
    // （合规 DOM 下该位置为 (div1, 1)，与"首行文本节点末尾"代表同一 DOM 位置）
    const blockEnd = window.document.createRange();
    blockEnd.selectNodeContents(div1);
    blockEnd.collapse(false);
    assert.strictEqual(
      r2.compareBoundaryPoints(window.Range.END_TO_END, blockEnd), 0,
      '终点应钳制到首块末尾'
    );
  } finally { window.close(); }
});

// (c) 合法跨块选中（含下一行内容）：不应判定为溢出，且 selection 不被改动
test('合法跨块选中：__isOverflowSelection 为 false，钳制不改动 selection', () => {
  const { window, editor } = freshApp();
  try {
    editor.innerHTML = '<div>一二三四五六</div><div>七</div>';
    const div1 = editor.children[0];
    const div2 = editor.children[1];
    const text1 = div1.firstChild;       // "一二三四五六"
    const text2 = div2.firstChild;       // "七"

    const range = window.document.createRange();
    range.setStart(text1, 0);
    range.setEnd(text2, text2.length);   // 终点在下一行文字内（选中了"七"）

    assert.strictEqual(window.__isOverflowSelection(range), false, '选中了下一行内容 → 不应判溢出');

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const clamped = window.__clampOverflowSelection();
    assert.strictEqual(clamped, false, '合法跨块选中不应被钳制');

    const s2 = window.getSelection();
    assert.strictEqual(s2.rangeCount, 1);
    const r2 = s2.getRangeAt(0);
    assert.strictEqual(r2.startContainer, text1);
    assert.strictEqual(r2.startOffset, 0);
    assert.strictEqual(r2.endContainer, text2);
    assert.strictEqual(r2.endOffset, text2.length, 'selection 终点应原样保留');
  } finally { window.close(); }
});

// (d) 反向选择（终点在前面、起点在后面）：非正向溢出 → false
test('反向选择：__isOverflowSelection 为 false（非正向溢出）', () => {
  const { window, editor } = freshApp();
  try {
    editor.innerHTML = '<div>一二三四五六</div><div>七</div>';
    const div1 = editor.children[0];
    const div2 = editor.children[1];
    const text2 = div2.firstChild; // "七"

    const range = window.document.createRange();
    range.setStart(text2, 0);      // 起点在第二行
    range.setEnd(div1, 0);         // 终点在第一行块起点

    assert.strictEqual(window.__isOverflowSelection(range), false, '反向选择不应判为(正向)溢出');
    assert.strictEqual(window.__clampOverflowSelection === undefined, false);
  } finally { window.close(); }
});

// (e) 折叠选区（collapsed）：不可能溢出 → false
test('折叠选区：__isOverflowSelection 为 false', () => {
  const { window, editor } = freshApp();
  try {
    editor.innerHTML = '<div>一二三四五六</div><div>七</div>';
    const text1 = editor.children[0].firstChild;
    const range = window.document.createRange();
    range.setStart(text1, 2);
    range.setEnd(text1, 2); // 折叠
    assert.strictEqual(range.collapsed, true);
    assert.strictEqual(window.__isOverflowSelection(range), false, '折叠选区不应判溢出');
  } finally { window.close(); }
});

// (f) 单块内选区：无兄弟块可溢出 → false
test('单块内选区：__isOverflowSelection 为 false', () => {
  const { window, editor } = freshApp();
  try {
    editor.innerHTML = '<div>abc</div>';
    const text = editor.children[0].firstChild; // "abc"
    const range = window.document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    assert.strictEqual(window.__isOverflowSelection(range), false, '单块内选区不应判溢出');
  } finally { window.close(); }
});
