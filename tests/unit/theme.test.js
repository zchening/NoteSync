// NoteSync 单元测试：主题（日间/夜间）与浏览器强制深色对抗（v5.29 专项）
//
// 背景：系统深色 + QQ 浏览器/小米浏览器「网页夜间模式=跟随系统」时，页内切日间会被强制反色。
// 三条防线：
//   ① color-scheme 降级链 —— only light 需 Chromium 98+，旧内核会把整条声明解析失败并丢弃，
//      此时必须退回标准 light，绝不能回落到 :root 的 light dark（= 主动声明"我支持深色"）。
//   ② 写回校验 —— 即便内核"嘴上支持、实际丢弃"，也要补写标准值，不留声明失败的窗口。
//   ③ !important 覆盖必须挂在 documentElement 末尾，否则插在浏览器注入的夜间 CSS 之前等于白写。
// 本文件只创建并运行测试，不修改应用代码。
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const openDoms = [];

// extraBeforeParse 在页面脚本执行前打桩，用来模拟不同内核的能力差异
function openApp(extra) {
  const dom = loadApp(extra);
  openDoms.push(dom);
  return dom.window;
}
after(() => { openDoms.forEach(d => { try { d.window.close(); } catch (e) {} }); });

// 内核打桩：现代内核（认 only light）
function stubModern(w) { w.CSS = { supports: (p, v) => v === 'only light' }; }
// 内核打桩：国产旧内核（CSS.supports 直接说不支持）—— v5.29 前这条会死的路径
function stubLegacy(w) { w.CSS = { supports: () => false }; }

function schemeOf(w) {
  const el = w.document.documentElement;
  if (el.style.colorScheme) return el.style.colorScheme;
  const m = /color-scheme\s*:\s*([^;]+)/.exec(el.getAttribute('style') || '');
  return m ? m[1].trim() : '';
}
function metaContent(w, name) {
  const m = w.document.querySelector('meta[name="' + name + '"]');
  return m ? m.getAttribute('content') : null;
}
function overrideEl(w) { return w.document.getElementById('theme-override'); }

// ── 静态源断言：防止有人再把兜底声明改回 light dark（那等于主动邀请反色）────────
test('静态兜底：:root 的 color-scheme 只声明 light，不得出现 light dark', () => {
  const rootBlock = /:root\{([\s\S]*?)\}/.exec(SRC);
  assert.ok(rootBlock, '应能取到 :root 规则块');
  const decl = /color-scheme\s*:\s*([^;]+);/.exec(rootBlock[1]);
  assert.ok(decl, ':root 内应有 color-scheme 声明');
  assert.strictEqual(decl[1].trim(), 'light', ':root 的 color-scheme 必须是 light（写 light dark 会被读成"已适配深色"而触发反色）');
});

test('静态兜底：head 内 meta[name=color-scheme] 初始 content 为 light', () => {
  const m = /<meta name="color-scheme" content="([^"]*)">/.exec(SRC);
  assert.ok(m, 'head 内应有静态 meta[name=color-scheme]');
  assert.strictEqual(m[1], 'light', 'JS 未执行时的首帧兜底必须声明 light');
});

test('静态兜底：head 内存在 meta[name=theme-color]（部分国产引擎据此采样页面主色）', () => {
  assert.ok(/<meta name="theme-color" content="#[0-9A-Fa-f]{6}">/.test(SRC), '应有 theme-color meta');
});

test('覆盖样式挂载点：用 documentElement.appendChild，不得用 head.appendChild', () => {
  const fn = /function mountThemeOverride\(dark\)\s*\{([\s\S]*?)\n\}/.exec(SRC);
  assert.ok(fn, '应能取到 mountThemeOverride 函数体');
  assert.ok(/document\.documentElement\.appendChild\(override\)/.test(fn[1]), 'override 必须挂到 documentElement 末尾');
  assert.ok(!/document\.head\.appendChild\(override\)/.test(fn[1]), '挂到 head 会插在浏览器注入的夜间 CSS 之前，等于白写');
});

test('降级链：源码含 CSS.supports 探测与"读回为空则补写"的校验', () => {
  assert.ok(/CSS\.supports\('color-scheme',\s*'only light'\)/.test(SRC), '应探测 only light 是否被支持');
  assert.ok(/if\s*\(!htmlEl\.style\.colorScheme\)/.test(SRC), '应有写回校验：声明被内核丢弃时补写标准值');
});

test('MutationObserver 重插守卫存在（对抗浏览器任意时刻的样式注入）', () => {
  assert.ok(/new MutationObserver\(/.test(SRC), '应有 MutationObserver');
  assert.ok(/ov\.nextSibling/.test(SRC), '守卫条件必须是"不在末尾才移动"，否则会自触发死循环');
});

// ── 场景 A：现代内核（认 only light）── 拿 Chrome 的官方强豁免 ──────────────
test('现代内核：日间声明 only light，夜间声明 dark', () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  assert.strictEqual(schemeOf(w), 'only light', '支持 only 时应写 only light（Chrome Auto-Dark 官方豁免）');
  assert.strictEqual(metaContent(w, 'color-scheme'), 'only light', 'meta 应与内联样式同步');
  w.applyTheme(true);
  assert.strictEqual(schemeOf(w), 'dark');
  assert.strictEqual(metaContent(w, 'color-scheme'), 'dark');
});

test('现代内核：theme-color 随主题同步为对应背景色', () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  assert.strictEqual(metaContent(w, 'theme-color'), '#FBFBF8', '日间 theme-color 应为浅色背景');
  w.applyTheme(true);
  assert.strictEqual(metaContent(w, 'theme-color'), '#0F0F11', '夜间 theme-color 应为深色背景');
});

// ── 场景 B：国产旧内核（不认 only light）—— 本次修复的核心路径 ──────────────
test('旧内核：日间降级为 light，绝不回落成 only light 或空值', () => {
  const w = openApp(stubLegacy);
  w.applyTheme(false);
  const s = schemeOf(w);
  assert.notStrictEqual(s, 'only light', '内核不支持时写 only light 会被整条丢弃，等于没声明');
  assert.ok(s.length > 0, '声明不能被丢弃后留空');
  assert.strictEqual(s, 'light', '不支持 only 时必须退回标准 light');
  assert.strictEqual(metaContent(w, 'color-scheme'), 'light', 'meta 同步降级值');
});

test('旧内核：夜间仍声明 dark（dark 是各内核通用值，不受 only 支持度影响）', () => {
  const w = openApp(stubLegacy);
  w.applyTheme(true);
  assert.strictEqual(schemeOf(w), 'dark', '夜间必须声明 dark，让引擎判定页面已深色从而放行');
  assert.strictEqual(metaContent(w, 'color-scheme'), 'dark');
});

// ── 场景 C：内核"嘴上支持、实际丢弃"（CSS.supports 撒谎）—— 写回校验兜底 ──────
test('写回校验：内核声称支持 only light 却丢弃该声明时，补写标准 light', () => {
  const w = openApp(stubModern);
  // 模拟只认 light/dark 的内核：给该实例的 style 打桩，写入 only light 会被丢掉
  const st = w.document.documentElement.style;
  Object.defineProperty(st, 'colorScheme', {
    configurable: true,
    get() { return this.__cs || ''; },
    set(v) { this.__cs = (v === 'light' || v === 'dark') ? v : ''; }
  });
  w.applyTheme(false);
  assert.strictEqual(schemeOf(w), 'light', '写回校验必须把被丢弃的声明补成标准 light');
  w.applyTheme(true);
  assert.strictEqual(schemeOf(w), 'dark');
});

// ── 覆盖样式的挂载位置与内容 ────────────────────────────────────────────────
test('theme-override 挂在 DOM 最末位（parentNode=documentElement 且无后继兄弟）', () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  const ov = overrideEl(w);
  assert.ok(ov, 'theme-override 应存在');
  assert.strictEqual(ov.parentNode, w.document.documentElement, '必须挂在 <html> 下（即 </body> 之后）');
  assert.strictEqual(ov.nextSibling, null, '必须是最后一个子节点，才能压过浏览器注入的夜间 CSS');
});

test('反复切换只保留一个 theme-override（不重复创建）', () => {
  const w = openApp(stubModern);
  w.applyTheme(true);
  w.applyTheme(false);
  w.applyTheme(true);
  assert.strictEqual(w.document.querySelectorAll('#theme-override').length, 1, '切换不应堆积 style 元素');
});

test('覆盖内容随主题切换，且日间保留 #landing 的径向渐变', () => {
  const w = openApp(stubModern);
  w.applyTheme(true);
  const darkCss = overrideEl(w).textContent;
  assert.ok(darkCss.includes('#0F0F11'), '夜间覆盖应含深色背景值');
  w.applyTheme(false);
  const lightCss = overrideEl(w).textContent;
  assert.ok(lightCss.includes('#FBFBF8'), '日间覆盖应含浅色背景值');
  assert.ok(/radial-gradient\([^)]*\)[^;]*#FBFBF8/.test(lightCss), '日间 #landing 必须保留径向渐变，不能退化成纯色');
});

test('覆盖锁定删除线颜色（核心功能不得被反色吞掉）', () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  const css = overrideEl(w).textContent;
  assert.ok(/#editor s,#editor strike,#editor del\{[^}]*color:#98958A!important/.test(css), '删除线颜色必须被 !important 锁定');
});

test('MutationObserver 守卫：外部注入样式后 override 被顶回末尾', async () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  const ov = overrideEl(w);
  // 模拟浏览器在 override 之后追加夜间 CSS（appendChild 落在最末位，override 被挤到前面）
  const injected = w.document.createElement('style');
  injected.textContent = 'body{background:#000!important}';
  w.document.documentElement.appendChild(injected);
  assert.strictEqual(ov.nextSibling, injected, '注入后 override 应暂时被挤到非末位');
  await new Promise(r => setTimeout(r, 50)); // 等 MutationObserver 微任务
  assert.strictEqual(ov.nextSibling, null, 'observer 应把 override 重新顶到 DOM 末尾');
  assert.strictEqual(w.document.documentElement.lastElementChild, ov, 'override 应成为 <html> 的最后一个元素子节点');
});

// ── 原有断言保留：初始态与 shouldBeDark 一致 ────────────────────────────────
test('初始按时间自动设置：color-scheme 与 shouldBeDark 一致', () => {
  const w = openApp(stubModern);
  const dark = w.shouldBeDark();
  w.applyTheme(dark);
  assert.strictEqual(schemeOf(w), dark ? 'dark' : 'only light', '初始 color-scheme 应与 shouldBeDark 一致');
});

test('手动切换为纯内存态：不写 localStorage / sessionStorage', () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  const keys = [];
  for (let i = 0; i < w.localStorage.length; i++) keys.push(w.localStorage.key(i));
  assert.ok(!keys.some(k => /theme|dark|night/i.test(String(k))), '主题选择不得持久化，刷新须回到时间规则');
  const fn = /function applyTheme\(dark\)\s*\{([\s\S]*?)\n\}/.exec(SRC);
  assert.ok(fn, '应能取到 applyTheme 函数体');
  assert.ok(!/localStorage|sessionStorage/.test(fn[1]), 'applyTheme 内不得持久化，刷新须回到时间规则');
});
