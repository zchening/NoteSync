// v5.51：RemBridge + API_BASE + 热更新单元测试
// 覆盖：源码形态（grep）+ jsdom 行为（mock RemBridge 验证函数挂载与静默）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}

// ── B1：NOTESYNC_API_BASE 默认空串（web 环境）──
test('B1 NOTESYNC_API_BASE 默认空串（无注入 = web 模式）', () => {
  const src = readSrc();
  assert.ok(src.includes("const NOTESYNC_API_BASE = (typeof window !== 'undefined' && window.NOTESYNC_API_BASE) || ''"),
    '应提供 window.NOTESYNC_API_BASE 可选注入，默认空串');
});

// ── B2：NOTE_API / FAIL_API 加 base 前缀（web 模式相对路径不变）──
test('B2 NOTE_API / FAIL_API 用 NOTESYNC_API_BASE 拼接', () => {
  const src = readSrc();
  assert.ok(src.includes("NOTESYNC_API_BASE + '/api/note/'"), 'NOTE_API 应拼接 base');
  assert.ok(src.includes("NOTESYNC_API_BASE + '/api/fail/'"), 'FAIL_API 应拼接 base');
});

// ── B3：EventSource 也加 base ──
test('B3 EventSource URL 加 NOTESYNC_API_BASE 前缀', () => {
  const src = readSrc();
  assert.ok(src.includes("new EventSource(NOTESYNC_API_BASE + '/api/note/'"), 'EventSource URL 应拼接 base');
});

// ── B4：SW 注册条件化（APK 模式不注册）──
test('B4 APK 内不注册 Service Worker（条件守卫）', () => {
  const src = readSrc();
  assert.ok(src.includes("if (!window.__NOTESYNC_NATIVE__ && 'serviceWorker' in navigator)"),
    'SW 注册应被 __NOTESYNC_NATIVE__ 守卫');
});

// ── B5：启动热更新钩子（IIFE 每次读 window.RemBridge）──
test('B5 启动热更新钩子：通过 IIFE 读 window.RemBridge.checkUpdate', () => {
  const src = readSrc();
  assert.ok(src.includes("(typeof window !== 'undefined' && window.RemBridge) || null"),
    '应每次从 window.RemBridge 读取（不缓存 const）');
  assert.ok(src.includes('rb.checkUpdate({ current: APP_VERSION, base: NOTESYNC_API_BASE })'),
    '应传当前版本与 base 给原生层');
});

// ── B6：RemBridge 适配层定义 + syncRemindersToNative 挂点 ──
test('B6 RemBridge 适配层存在，两个挂点全在（loadReminder + persistReminders）', () => {
  const src = readSrc();
  assert.ok(src.includes('async function syncRemindersToNative()'),
    'syncRemindersToNative 函数应定义');
  const hits = (src.match(/syncRemindersToNative\(\)/g) || []).length;
  assert.ok(hits >= 2, `syncRemindersToNative() 至少 2 处挂点，实测 ${hits}`);
});

// ── B7：syncRemindersToNative 函数体形态（每次读 window.RemBridge + 异常吞）──
test('B7 syncRemindersToNative：每次读 window.RemBridge + try/catch', () => {
  const src = readSrc();
  const body = src.match(/async function syncRemindersToNative\(\) \{([\s\S]*?)\n\}/);
  assert.ok(body, '函数体应可匹配');
  const code = body[1];
  assert.ok(code.includes('window.RemBridge'), '应读 window.RemBridge（不缓存）');
  assert.ok(code.includes("typeof rb.sync !== 'function'"), '应守卫 rb.sync 存在');
  assert.ok(code.includes('try {') && code.includes('catch (e)'),
    '应 try/catch 防原生异常污染前端');
});

// ── B8：jsdom 行为 — 函数挂到 window 且无 RemBridge 时静默 ──
test('B8 jsdom：syncRemindersToNative 函数挂到 window，无 mock 时静默', () => {
  const dom = loadApp(); // 不注入 window.RemBridge
  const w = dom.window;
  assert.equal(typeof w.syncRemindersToNative, 'function', '函数应挂到 window');
  // 不应抛错；内部 if (!rb) return
  assert.doesNotThrow(() => w.syncRemindersToNative());
  dom.window.close(); // 释放 jsdom 资源，否则 node --test 进程不退出（SIGTERM）
});