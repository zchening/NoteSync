// NoteSync 撤销栈单测（jsdom 加载真实 index.html）
// 覆盖 v5.12 自建撤销栈：recordIfChanged 压栈、syncCurrentState 只同步不压栈、
// Ctrl+Z 撤销 / Ctrl+Y 重做、连续编辑计数。
//
// 注意：撤销栈有"700ms 内连续 insertText 合并为一步"的规则，且 lastEditTime/lastEditType
// 是页面级全局状态、__undoReset 不会重置它们。为避免跨用例污染（上一用例的编辑被合并进下一用例），
// 每个用例都加载一份全新的 jsdom（fresh app），用例结束后关闭 window。
const { test } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

function freshApp() {
  const dom = loadApp();
  const { window } = dom;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor') };
}

function setBaseline(window, editor, html) {
  editor.innerHTML = html;
  window.__undoReset(); // 清空栈并把 lastState 设为当前内容（模拟"初始态"）
}

const inputEv = (window) => new window.InputEvent('input', { inputType: 'insertText', bubbles: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// (a) 加载后关键函数已定义、初始化无 JS 报错
test('撤销栈相关函数与调试钩子已挂到 window', () => {
  const { window, dom } = freshApp();
  try {
    assert.strictEqual(typeof window.addStrikeToRange, 'function');
    assert.strictEqual(typeof window.captureState, 'function');
    assert.strictEqual(typeof window.applyState, 'function');
    assert.strictEqual(typeof window.recordIfChanged, 'function');
    assert.strictEqual(typeof window.syncCurrentState, 'function');
    assert.strictEqual(typeof window.undo, 'function');
    assert.strictEqual(typeof window.redo, 'function');
    assert.strictEqual(typeof window.__undoState, 'function');
    assert.strictEqual(typeof window.__undoReset, 'function');
  } finally { window.close(); }
});

// (b) 用户"输入一个字符"后撤销栈计数为 1
test('用户 input(insertText) 压栈：u === 1', () => {
  const { window, editor } = freshApp();
  try {
    setBaseline(window, editor, '<div>a</div>');
    editor.innerHTML = '<div>ab</div>'; // 模拟用户多打了一个字符
    editor.dispatchEvent(inputEv(window));
    assert.strictEqual(window.__undoState().u, 1, '一次编辑应压 1 步');
  } finally { window.close(); }
});

// (c) 程序化改动不污染撤销栈
test('程序化改动(无 input)只同步不压栈：u 仍为 1', () => {
  const { window, editor } = freshApp();
  try {
    setBaseline(window, editor, '<div>a</div>');
    editor.innerHTML = '<div>ab</div>';
    editor.dispatchEvent(inputEv(window));
    assert.strictEqual(window.__undoState().u, 1);
    // 模拟 linkify 产物：把文本包成 <a>，但不 dispatch input（程序化改动不走 input）
    editor.innerHTML = '<div><a href="http://x">ab</a></div>';
    window.syncCurrentState(); // linkify 的 finally 调用它
    assert.strictEqual(window.__undoState().u, 1, '程序化改动不应新增撤销步');
  } finally { window.close(); }
});

// (d) Ctrl+Z 撤销：innerHTML 回退到基线、重做栈计数为 1
test('Ctrl+Z 撤销还原到基线：html 回退且 r === 1', () => {
  const { window, editor } = freshApp();
  try {
    setBaseline(window, editor, '<div>a</div>');
    editor.innerHTML = '<div>ab</div>';
    editor.dispatchEvent(inputEv(window));
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.strictEqual(editor.innerHTML, '<div>a</div>', '撤销应回到基线内容');
    assert.strictEqual(window.__undoState().r, 1, '撤销后重做栈应有 1 项');
  } finally { window.close(); }
});

// (e) Ctrl+Y 重做：innerHTML 恢复、撤销栈计数回到 1
test('Ctrl+Y 重做恢复内容：html 恢复且 u === 1', () => {
  const { window, editor } = freshApp();
  try {
    setBaseline(window, editor, '<div>a</div>');
    editor.innerHTML = '<div>ab</div>';
    editor.dispatchEvent(inputEv(window));
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.strictEqual(editor.innerHTML, '<div>ab</div>', '重做应恢复编辑后内容');
    assert.strictEqual(window.__undoState().u, 1, '重做后撤销栈应回到 1 步');
  } finally { window.close(); }
});

// (f) 两次"非合并"的编辑各算一步：u === 2
// 说明：合并规则会把 700ms 内的连续 insertText 合并为一步，故此处间隔 >700ms 模拟两次独立编辑。
test('两次不同内容 input 各计一步(间隔>700ms)：u === 2', async () => {
  const { window, editor } = freshApp();
  try {
    setBaseline(window, editor, '<div>a</div>');
    editor.innerHTML = '<div>ab</div>';
    editor.dispatchEvent(inputEv(window));
    await delay(750); // 跳出合并窗口
    editor.innerHTML = '<div>abc</div>';
    editor.dispatchEvent(inputEv(window));
    assert.strictEqual(window.__undoState().u, 2, '两次独立编辑应各压 1 步');
  } finally { window.close(); }
});
