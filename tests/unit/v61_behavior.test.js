// v6.1 行为验收（jsdom）：菜单 X / 关于弹窗 / 标题连点彩蛋 / 诊断滚动关闭 /
// 主题菜单文案翻转 / loadHistList 渲染 / 口令弹窗 DOM 级断言。
// 约定：每条测试 dom.window.close()；不改源码，只测真实 index.html 行为。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function freshApp() {
  const dom = loadApp(); // 默认 url='http://localhost/'，noteId 为空走 landing 分支
  const window = dom.window;
  return { dom, window, document: window.document };
}

// 通过菜单入口打开「关于」弹窗（真实用户链路）
function openAbout(document) {
  document.getElementById('menuBtn').click();
  document.getElementById('menuAbout').click();
}

// 通过菜单 → 关于 → 连点标题 4 次打开诊断模态（真实用户链路）
function openDiagViaEasterEgg(document) {
  openAbout(document);
  const aboutTitle = document.getElementById('aboutTitle');
  for (let i = 0; i < 4; i++) aboutTitle.click(); // 同步连点，必落 800ms 窗口
}

// ── a. 菜单 X 退役 + 遮罩关闭 ─────────────────────────────
test('V61B-a 菜单：menuClose 退役，遮罩空白点击关整个菜单', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;

  const menuMask = document.getElementById('menuMask');
  assert.strictEqual(document.getElementById('menuClose'), null, 'menuClose X 应退役（v6.2）');
  assert.ok(menuMask.classList.contains('hidden'), '前置：菜单初始隐藏');

  document.getElementById('menuBtn').click();
  assert.ok(!menuMask.classList.contains('hidden'), 'menuBtn 打开菜单');
  menuMask.click(); // e.target === menuMask
  assert.ok(menuMask.classList.contains('hidden'), '点遮罩空白后整个菜单关闭');
});

// ── b. 关于弹窗 ───────────────────────────────────────────
test('V61B-b 关于弹窗：菜单入口打开，版本行含「Version 7.1.0」', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;

  openAbout(document);
  await sleep(30); // handler 为 async，兜一拍微任务

  const aboutMask = document.getElementById('aboutMask');
  assert.ok(!aboutMask.classList.contains('hidden'), '关于弹窗应打开');
  assert.ok(document.getElementById('menuMask').classList.contains('hidden'), '打开关于时菜单应关闭');
  assert.strictEqual(document.getElementById('aboutTitle').textContent, '关于NoteSync');
  assert.ok(document.getElementById('aboutVer').textContent.includes('Version 7.1.0'), '版本行应含「Version 7.1.0」');
});

// ── c. 彩蛋：连点标题 4 次 → 诊断模态 ─────────────────────
test("V61B-c 彩蛋：800ms 内连点「关于NoteSync」4 次关关于弹 aboutMask 开 diagMask", async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;

  openDiagViaEasterEgg(document);
  await sleep(30);

  assert.ok(document.getElementById('aboutMask').classList.contains('hidden'), '关于弹窗应被关闭');
  const diagMask = document.getElementById('diagMask');
  assert.ok(!diagMask.classList.contains('hidden'), '诊断模态应打开');
  const txt = document.getElementById('diagContent').textContent;
  assert.ok(txt.length > 0, '#diagContent 应非空');
  assert.ok(txt.includes('7.1.0'), '诊断信息应含 7.1.0 版本行');
});

// ── d. 诊断自动关闭：editor 滚动 ──────────────────────────
test('V61B-d 诊断模态：editor scroll 自动关闭', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;

  openDiagViaEasterEgg(document);
  await sleep(30);
  const diagMask = document.getElementById('diagMask');
  assert.ok(!diagMask.classList.contains('hidden'), '前置：诊断模态已开');

  document.getElementById('editor').dispatchEvent(new window.Event('scroll'));
  assert.ok(diagMask.classList.contains('hidden'), '滚动笔记后诊断模态应自动关闭');
});

// ── e. 主题菜单文案 ───────────────────────────────────────
test('V61B-e 主题菜单：初始文案二选一，点击后经 themeBtn 链路翻转；全局函数在位', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;

  // 全局函数在位（与 collectDiagLines 同验证口径）
  assert.strictEqual(typeof window.syncThemeMenuItem, 'function', 'syncThemeMenuItem 应挂到 window');
  assert.ok(Array.isArray(window.collectDiagLines()), 'collectDiagLines 应存在且返回数组');

  const label = document.getElementById('menuThemeLabel');
  const initial = label.textContent;
  assert.ok(initial === '夜间模式' || initial === '日间模式', '初始文案应为「夜间模式/日间模式」之一（按 07:00/19:00）');

  document.getElementById('menuBtn').click(); // renderMenu 会再同步一次文案
  assert.strictEqual(label.textContent, initial, '打开菜单不应翻转文案');

  document.getElementById('menuTheme').click(); // → themeBtn.click() → applyTheme → syncThemeMenuItem
  const after = label.textContent;
  assert.notStrictEqual(after, initial, '点击后文案应翻转到另一模式');
  assert.ok(after === '夜间模式' || after === '日间模式', '翻转后仍应为合法文案');
});

// ── f. loadHistList 渲染 ──────────────────────────────────
test('V61B-f 历史版本列表：单行结构/手动标注/删冗余/按钮文案/DOM 顺序', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document } = app;

  const now = Date.now();
  // fetchRetry 要求 {ok:true,status:200,json()}；/history 返回旧→新（服务端 FIFO 环顺序），
  // 页面 reverse() 后最新在上：第一条=最新(manual:false)，第二条=昨天(manual:true)
  window.fetch = (url) => {
    if (String(url).indexOf('/history') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ list: [
        { ts: now - 86400000, manual: true, v: 584, size: 2048 },
        { ts: now, manual: false, v: 585, size: 4096 },
      ] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };

  document.getElementById('menuBtn').click();
  document.getElementById('menuHistEntry').click();
  await sleep(80); // loadHistList 异步渲染

  assert.ok(!document.getElementById('menuHistView').classList.contains('hidden'), '应切到历史二级视图');
  const items = document.querySelectorAll('#menuHistList .hist-item');
  assert.strictEqual(items.length, 2, '应渲染 2 条 .hist-item');
  assert.ok(document.getElementById('menuHistEmpty').classList.contains('hidden'), '有数据时空态应隐藏');

  const firstMeta = items[0].querySelector('.hist-meta').textContent;
  const secondMeta = items[1].querySelector('.hist-meta').textContent;
  assert.ok(!firstMeta.includes('自动'), '自动快照不应再有「自动」标注');
  assert.ok(!firstMeta.includes('KB'), 'KB 冗余信息应退役');
  assert.ok(!firstMeta.includes('· v'), '版本号冗余信息应退役');
  assert.ok(secondMeta.includes(' · 手动'), '手动快照应标注「· 手动」');

  const btns = items[0].querySelectorAll('button');
  assert.strictEqual(btns.length, 2, '每行两颗按钮');
  assert.strictEqual(btns[0].textContent, '预览');
  assert.strictEqual(btns[1].textContent, '恢复');

  // DOM 顺序：.hist-line 内 meta 在按钮组之前
  const line = items[0].querySelector('.hist-line');
  const meta = line.querySelector('.hist-meta');
  const btnGroup = line.querySelector('.hist-btns');
  assert.ok(!!(meta.compareDocumentPosition(btnGroup) & window.Node.DOCUMENT_POSITION_FOLLOWING),
    'meta 必须位于按钮组之前（单行左信息右按钮）');
});

// ── g. 口令弹窗 DOM 级 ────────────────────────────────────
test('V61B-g 口令弹窗：unlockHome 退役、maskClose 在位、landing 分支初始隐藏', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { document } = app;

  assert.strictEqual(document.getElementById('unlockHome'), null, '「返回首页」按钮应退役（v6.1）');
  const mask = document.getElementById('mask');
  const maskClose = document.getElementById('maskClose');
  assert.ok(maskClose, '#maskClose X 应存在');
  assert.ok(mask.contains(maskClose), '#maskClose 应在 #mask 弹窗内');
  assert.strictEqual(maskClose.className, 'box-x', 'X 应为关闭热区样式');
  assert.strictEqual(maskClose.parentElement.className, 'modal-head', 'v6.2 X 应融入标题行（.modal-head 内）');
  assert.ok(mask.classList.contains('hidden'), 'landing 分支（无 noteId）口令弹窗初始隐藏');
});
