// v5.53 单元测试：IME 组字不打断 + 空 inputType 不再误清理 + 首页 IME 兜底轮询
// 覆盖：源码形态（grep 顺序/存在性断言）+ 可选 jsdom 行为。
// 风格参考 rem-bridge.test.js（B 系列）与 helpers.js（loadApp/INDEX_PATH）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}

// ── D1：editor input 监听器开头必须有 isComposing 旁路分支 ──
// 在 editor.addEventListener('input' 之后、if (busy) 之前出现，且分支内含 saveTimer 计时。
test('D1 editor input 监听器开头有 isComposing 旁路分支（组字期间只留保存计时）', () => {
  const src = readSrc();
  const inputIdx = src.indexOf("editor.addEventListener('input'");
  const busyIdx = src.indexOf("if (busy) {", inputIdx > -1 ? inputIdx : 0);
  assert.ok(inputIdx > -1, '应存在 editor.addEventListener(\'input\'');
  assert.ok(busyIdx > inputIdx, 'if (busy) 应位于 input 监听器之后');

  // 截取 input 监听器到 busy 判定之间的片段，确认 isComposing 旁路在 busy 之前
  const seg = src.slice(inputIdx, busyIdx);
  assert.ok(seg.includes('if (isComposing) {'),
    'input 监听器开头应有 if (isComposing) { 旁路分支（位于 if (busy) 之前）');
  assert.ok(seg.includes('saveTimer = setTimeout(saveLocal, 800)'),
    'isComposing 旁路分支内应仅保留草稿保存计时 saveTimer = setTimeout(saveLocal, 800)');
});

// ── D2：needCleanup 表达式不得包含 it === ''（空 inputType 不再触发清理）──
// 部分 WebView+输入法组合下组字事件 inputType 为空串，曾误触发 cleanup 致汉字无法上屏。
test('D2 needCleanup 移除 it === \'\' 条件（空 inputType 不再误清理）', () => {
  const src = readSrc();
  assert.ok(
    src.includes("const needCleanup = it.indexOf('delete') === 0 || it === 'insertFromPaste';"),
    'needCleanup 应仅为 delete 前缀或 insertFromPaste');
  // 用 'it === \'\' &&'（带 &&）精确排除注释中的 'it === \'\'' 字样，避免注释误命中
  assert.ok(!src.includes("it === '' &&"),
    '源码中不应再出现 it === \'\' && 这类空 inputType 清理条件');
});

// ── D3：首页输入框有 250ms IME 兜底轮询，并在点击按钮时清除 ──
test('D3 首页 250ms IME 兜底轮询（setInterval + sanitizeName 共现，点击按钮 clearInterval）', () => {
  const src = readSrc();
  const landStart = src.indexOf("document.getElementById('landing').classList.remove('hidden');");
  const landEnd = src.indexOf("li.addEventListener('keydown', e => { if (e.key === 'Enter') lb.click(); });");
  assert.ok(landStart > -1 && landEnd > landStart, '应定位到首页 landing 初始化代码块');

  const block = src.slice(landStart, landEnd);
  assert.ok(block.includes('sanitizeName'),
    'landing 初始化代码应定义 sanitizeName（非法字符剔除 + 按钮态同步）');
  assert.ok(block.includes('setInterval') && block.includes('}, 250);'),
    'landing 初始化代码应存在 250ms 的 IME 兜底轮询 setInterval');

  // clearInterval(pollTimer) 必须落在 lb.addEventListener('click' 回调内
  const clickIdx = block.indexOf("lb.addEventListener('click'");
  assert.ok(clickIdx > -1, 'landing 按钮应有 click 监听');
  const afterClick = block.slice(clickIdx, clickIdx + 160);
  assert.ok(afterClick.includes('clearInterval(pollTimer)'),
    'lb click 回调内应 clearInterval(pollTimer) 停止 IME 兜底轮询');
});

// ── D4：jsdom 行为 —— IME 注入（无 inputType 的 input 事件）不抛错；首页输入按钮态正确 ──
test('D4 jsdom：无 inputType 的 input 事件不抛错；首页输入后按钮解锁', () => {
  const dom = loadApp(); // url http://localhost/ → init() 走 landing 分支，不触发 fetch/EventSource
  const w = dom.window;

  // 4a：editor 派发无 inputType 的 input 事件（模拟 IME 注入），不应抛错
  const editor = w.document.getElementById('editor');
  assert.ok(editor, 'editor 元素应存在');
  assert.doesNotThrow(() => {
    editor.dispatchEvent(new w.Event('input'));
  }, '组字注入（无 inputType）派发 input 不应抛错');

  // 4b：首页 landingInput 输入合法名 → 打开按钮解锁；清空 → 重新禁用
  const li = w.document.getElementById('landingInput');
  const lb = w.document.getElementById('landingBtn');
  assert.ok(li && lb, 'landingInput / landingBtn 应存在');

  li.value = 'myNote';
  li.dispatchEvent(new w.Event('input'));
  assert.equal(lb.disabled, false, '输入合法笔记名后「打开」按钮应解锁');

  li.value = '';
  li.dispatchEvent(new w.Event('input'));
  assert.equal(lb.disabled, true, '清空输入后「打开」按钮应重新禁用');

  dom.window.close(); // 释放 jsdom 资源，否则 node --test 进程不退出（SIGTERM）
});
