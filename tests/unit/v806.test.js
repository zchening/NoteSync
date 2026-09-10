// v8.0.6 守护——回前台键盘不复弹。
// 根因链：安卓「收起键盘」不触发 blur（editor 留焦）→ visibilitychange 切后台原本只 flush 保存
// → 回前台系统把键盘弹回仍持焦的编辑器（manifest 无 windowSoftInputMode，stateUnspecified=恢复）。
// 修：①Web 层 hidden 分支追加 dismissKeyboardForTouch()（自带 仅触屏/非组字/焦点在editor 三重守卫）；
//    ②原生层 activity 加 windowSoftInputMode="stateHidden" 兜底（只加 state 位，不动 adjust——
//    布局让位已由 viewport interactive-widget=resizes-content 接管）。
// 结构沿 v71.test.js（SRC 静态断言锚定补丁行 + jsdom 行为）+ chip_mobile_fit 的 matchMedia 反证门控。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const MANIFEST = fs.readFileSync(path.resolve(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');

// ── A：源码静态断言（锚定补丁行本体，防回退） ──
test('V806-A visibilitychange hidden 分支必须 flush+收焦两连，旧裸 flush 不得回潮', () => {
  assert.ok(SRC.includes('else { flushDirtySave(); dismissKeyboardForTouch(); }'),
    'hidden 分支应为 { flushDirtySave(); dismissKeyboardForTouch(); }（v8.0.6 补丁行）');
  assert.ok(!SRC.includes('else flushDirtySave();'),
    '旧形态「else flushDirtySave();」不得复活（漏收焦即键盘复弹）');
  assert.ok(SRC.includes('function dismissKeyboardForTouch()'),
    '守卫 helper 本体必须在（仅触屏+非组字+焦点在 editor 才 blur）');
});

test('V806-B manifest stateHidden 兜底：只加 state 位，禁动 adjust 位', () => {
  assert.ok(MANIFEST.includes('android:windowSoftInputMode="stateHidden"'),
    'activity 应声明 windowSoftInputMode=stateHidden');
  assert.ok(!/android:windowSoftInputMode="[^"]*adjust/i.test(MANIFEST),
    '禁带 adjust 位——resizes-content 已接管布局让位，加 adjustResize/Pan 会搅 v7.9.1 贴底行');
});

// ── C：www 逐字节同步（APK webDir=www，漂移即线上旧包） ──
test('V806-C www/index.html 与根 index.html 逐字节一致', () => {
  const a = fs.readFileSync(INDEX_PATH);
  const b = fs.readFileSync(path.resolve(__dirname, '..', '..', 'www', 'index.html'));
  assert.ok(a.equals(b), 'www/index.html 必须与根 index.html 字节级同步');
});

// ── jsdom 行为公共打点 ──
function focusAndHide(window, document, editor) {
  editor.tabIndex = -1; // jsdom focus() 仅对可聚焦元素生效，测试侧补 tabindex（不扰页面语义）
  editor.focus();
  assert.strictEqual(document.activeElement, editor, '前置：编辑器已聚焦（=键盘场景）');
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
}

test('V806-D 触屏切后台：编辑器焦点必须被收掉（回前台键盘不再自弹）', () => {
  const dom = loadApp(); // jsdom matchMedia 恒不命中 fine → CHIP_HOVER_OK=false（触屏路径）
  try {
    const { document } = dom.window;
    focusAndHide(dom.window, document, document.getElementById('editor'));
    assert.notStrictEqual(document.activeElement, document.getElementById('editor'),
      'hidden 后 activeElement 不得仍是 editor（留焦=键盘复弹根因）');
  } finally { dom.window.close(); }
});

test('V806-E 桌面端反证：hover+fine 命中时切后台绝不 blur（零变化红线）', () => {
  const dom = loadApp(w => {
    w.matchMedia = q => ({ matches: /hover:\s*hover/.test(q) && /pointer:\s*fine/.test(q), media: q,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null });
  });
  try {
    const { document } = dom.window;
    const editor = document.getElementById('editor');
    focusAndHide(dom.window, document, editor);
    assert.strictEqual(document.activeElement, editor, '桌面端 hidden 后焦点应原样保留');
  } finally { dom.window.close(); }
});

test('V806-F 组字中不 blur（吞字红线）；组字结束后收焦恢复生效', () => {
  const dom = loadApp();
  try {
    const { document } = dom.window;
    const editor = document.getElementById('editor');
    editor.tabIndex = -1;
    editor.focus();
    editor.dispatchEvent(new dom.window.Event('compositionstart', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.strictEqual(document.activeElement, editor, '拼音组字中 hidden 不得 blur（iOS/WebView 吞字红线）');
    editor.dispatchEvent(new dom.window.Event('compositionend', { bubbles: true }));
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.notStrictEqual(document.activeElement, editor, '组字结束后 hidden 应正常收焦');
  } finally { dom.window.close(); }
});

test('V806-G 焦点不在编辑器时零打扰（不碰口令框/提醒面板）', () => {
  const dom = loadApp();
  try {
    const { document } = dom.window;
    const pw = document.getElementById('pw');
    pw.tabIndex = -1;
    pw.focus();
    assert.strictEqual(document.activeElement, pw, '前置：焦点在解锁口令框');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.strictEqual(document.activeElement, pw, 'hidden 不得抢走非编辑器焦点');
  } finally { dom.window.close(); }
});
