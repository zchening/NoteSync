// v7.3.1 单元测试——「返回首页有时候点了没反应，仍在当前笔记」根因修复回归护栏：
//   根因X（主）：APK 环境 init() 的「冷启动自动跳转上次笔记」误伤主动返回首页——
//       手动输名/扫码/收藏夹进入笔记时跳转标记从未设置，点返回首页 location.assign('/')
//       后被自动跳回 NOTE_LAST_KEY 记的笔记（间歇性=看标记是否已设）
//   根因Y（次）：冲突浮卡（.conflictbar z-index 55 / .confcard pointer-events:auto）与
//       提醒卡（#remCard z-index 80）盖在菜单遮罩（.mask z-index 10）之上，物理挡掉
//       menuHome 点击（v7.3.0 后冲突弹条场景多）——菜单模态提升到 z-index 90
//   二轮对抗审核定稿：标记带时间戳（markJumped/jumpedRecently + JUMP_WINDOW_MS=120s）——
//       既防本会话弹回，又让跨冷启动残留的旧标记过期放行（v5.52「冷启动自动进上次笔记」不丢）；
//       窗口取 120s 而非 10min：标记只须桥接「写入→根页 init 读取」，过长会误杀
//       「回首页后快速重开 App」的免输名特性；setItem 全部 try/catch（异常不吞返回首页动作）；
//       #menuMask 提到 90
// 结构沿 v73.test.js：源码断言 + jsdom 行为测试（全程不碰真实服务器）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const JUMPED = 'notesync_jumped';
const LAST = 'notesync_last_note';

function freshApp(extra, pageUrl) {
  const dom = loadApp(w => {
    if (typeof extra === 'function') extra(w);
  }, pageUrl);
  return { dom, window: dom.window };
}

// ═══════════ 源码断言 ═══════════
// 对抗终审加固：S1/S2 正则锚定 handler 闭合（\}）；——markJumped 必须真的在
// menuHome/maskClose 的 handler 里、且先于 location.assign，不能是文件别处的巧合匹配。
test('V74-S1 根因X：menuHome 返回首页必须 markJumped 在 assign 之前', () => {
  assert.ok(/\$\('#menuHome'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,200}markJumped\(\)[\s\S]{0,60}location\.assign\('\/'\)[\s\S]{0,30}\}\);/.test(SRC),
    'menuHome handler 应「markJumped() → assign("/")」收尾（锚定 }); 防跨函数逃逸）');
});

test('V74-S2 根因X：maskClose（口令框 X）返回首页同样先 markJumped', () => {
  assert.ok(/\$\('#maskClose'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,80}markJumped\(\)[\s\S]{0,60}location\.assign\('\/'\)[\s\S]{0,30}\}\);/.test(SRC),
    'maskClose handler 应「markJumped() → assign("/")」收尾（锚定 }); 防跨函数逃逸）');
});

test('V74-S3 根因Y：#menuMask 模态提升到 z-index 90——盖过冲突浮卡 55/版本条 60/提醒卡 80', () => {
  assert.ok(SRC.includes('#menuMask{z-index:90}'), '菜单遮罩 z-index 应为 90（高于 .conflictbar 55 与 #remCard 80）');
  assert.ok(!/\.mask\{[^}]*z-index:90/.test(SRC), '通用 .mask 不应整体抬到 90（口令框/提醒面板仍为 10，层级语义不变）');
});

test('V74-S4 根因X：init 冷启动守卫用 jumpedRecently()（时间戳窗口）而非永久标记', () => {
  assert.ok(SRC.includes('if (isNativeApp() && !jumpedRecently()) {'),
    'init 应只在「本会话最近未回过首页」时自动跳转（跨冷启动旧标记过期失效，v5.52 特性保留）');
  assert.ok(SRC.includes('const JUMP_WINDOW_MS = 120 * 1000;'), '跳转抑制窗口应为 120s（过长会误杀快速重开 App 的免输名特性）');
});

test('V74-S5 标记读写全部 try/catch：任何环境异常都不吞返回首页动作', () => {
  assert.ok(/function markJumped\(\) \{\s*try \{[\s\S]{0,120}setItem/.test(SRC), 'markJumped 的 setItem 必须在 try 内');
  assert.ok(/function jumpedRecently\(\) \{\s*try \{/.test(SRC), 'jumpedRecently 应 try/catch 包裹 getItem');
});

test('V74-S6 返回键出口：笔记页注册 pagehide→markJumped（扫码/深链进入的笔记返回首页不被弹回）', () => {
  assert.ok(SRC.includes("if (noteId) window.addEventListener('pagehide', markJumped);"),
    '笔记页应注册 pagehide→markJumped（返回键落首页时 init 不再弹回本笔记）');
});

// ═══════════ jsdom 行为测试 ═══════════
// jsdom 不支持 location.assign 导航——但 handler 内 markJumped() 在 assign 之前执行，
// 仍可断言状态（menuHome/maskClose 是脚本加载时静态绑定的监听）。
test('V74-B1 根因X行为：点菜单「返回首页」→ 关菜单 + 写入新鲜跳转标记', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const menuMask = window.document.getElementById('menuMask');
  const menuHome = window.document.getElementById('menuHome');
  const before = Date.now();
  window.sessionStorage.removeItem(JUMPED);
  menuMask.classList.remove('hidden'); // 模拟菜单开着
  menuHome.click();
  const t0 = Number(window.sessionStorage.getItem(JUMPED));
  assert.ok(Number.isFinite(t0) && t0 >= before && t0 <= Date.now(), '返回首页必须写入时间戳标记（APK init 不再弹回）');
  assert.ok(menuMask.classList.contains('hidden'), '菜单应关闭');
});

test('V74-B2 根因X行为：口令框 X → 写入新鲜跳转标记（锁定态返回首页不再弹回锁态笔记）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const maskClose = window.document.getElementById('maskClose');
  const before = Date.now();
  window.sessionStorage.removeItem(JUMPED);
  maskClose.click();
  const t0 = Number(window.sessionStorage.getItem(JUMPED));
  assert.ok(Number.isFinite(t0) && t0 >= before && t0 <= Date.now(), '口令框 X 也应写入时间戳标记');
});

test('V74-B3 根因X行为（核心语义）：APK 环境 + 新鲜标记 → init 绝不自动跳回，显示首页', async t => {
  // beforeParse 注入 Capacitor（模拟 APK）：即便 localStorage 有 last 笔记，只要 jumped 是
  // 新鲜时间戳（=用户刚主动回过首页），init() 必须显示 landing 而不是 assign('/last') 弹回。
  const app = freshApp(w => {
    w.Capacitor = { isNativePlatform: () => true };
    w.sessionStorage.setItem(JUMPED, String(Date.now()));
    w.localStorage.setItem(LAST, 'mynote');
  }, 'http://localhost/');
  t.after(() => app.dom.window.close());
  const landing = app.window.document.getElementById('landing');
  assert.ok(!landing.classList.contains('hidden'), '有新鲜跳转标记时 init 必须停在首页（landing 显示）');
});

test('V74-B4 行为基线：Web 端（无 Capacitor）根路径 init 直接显示 landing，不受修复影响', async t => {
  const app = freshApp(w => {
    w.localStorage.setItem(LAST, 'mynote');
  }, 'http://localhost/');
  t.after(() => app.dom.window.close());
  const landing = app.window.document.getElementById('landing');
  assert.ok(!landing.classList.contains('hidden'), 'Web 端根路径应显示 landing（isNativeApp=false 不跳转）');
});

test('V74-B5 根因Y行为：冲突浮卡弹出后菜单仍可正常打开（z-index 90 盖过浮卡，点击不被物理拦截）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const menuBtn = window.document.getElementById('menuBtn');
  const menuMask = window.document.getElementById('menuMask');
  const remoteBar = window.document.getElementById('remoteBar');
  remoteBar.classList.remove('hidden'); // 冲突浮卡显示（模拟冲突挂起）
  menuBtn.click(); // 打开菜单
  assert.ok(!menuMask.classList.contains('hidden'), '浮卡显示时菜单应能打开（菜单 z-index 高于浮卡）');
  const css = Array.from(window.document.querySelectorAll('style')).map(s => s.textContent).join('');
  assert.ok(css.includes('#menuMask{z-index:90}') || SRC.includes('#menuMask{z-index:90}'), '菜单 z-index 90 应在样式表中');
});

test('V74-B6 标记语义（辅助函数直测）：新鲜→抑制跳转 / 过期或缺失→放行', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  window.sessionStorage.setItem(JUMPED, String(Date.now()));
  assert.equal(window.jumpedRecently(), true, '新鲜时间戳应判定为「刚回过首页」');
  window.sessionStorage.setItem(JUMPED, String(Date.now() - 119999));
  assert.equal(window.jumpedRecently(), true, '窗口边界内 119999ms 应判定为新鲜（抑制跳转）');
  window.sessionStorage.setItem(JUMPED, String(Date.now() - 120000));
  assert.equal(window.jumpedRecently(), false, '恰好 120000ms 应判定过期（v5.52 特性放行）');
  window.sessionStorage.setItem(JUMPED, String(Date.now() + 60000));
  assert.equal(window.jumpedRecently(), false, '未来时间戳（时钟拨快）应视为过期放行——否则标记永不过期，冷启动特性被静默杀死');
  window.sessionStorage.setItem(JUMPED, '1'); // 旧格式/跨冷启动残留
  assert.equal(window.jumpedRecently(), false, '旧格式残值应放行冷启动自动跳转（v5.52 特性保留）');
  window.sessionStorage.removeItem(JUMPED);
  assert.equal(window.jumpedRecently(), false, '无标记应放行');
  window.markJumped();
  const t0 = Number(window.sessionStorage.getItem(JUMPED));
  assert.ok(Number.isFinite(t0) && Date.now() - t0 < 5000, 'markJumped 应写入新鲜时间戳');
});

test('V74-B7 返回键出口行为：笔记页 pagehide → 写入新鲜标记（首页 init 不再弹回）', async t => {
  const app = freshApp(w => {
    w.sessionStorage.removeItem(JUMPED);
  }, 'http://localhost/BackNote');
  t.after(() => app.dom.window.close());
  const { window } = app;
  const before = Date.now();
  window.dispatchEvent(new window.Event('pagehide'));
  const t0 = Number(window.sessionStorage.getItem(JUMPED));
  assert.ok(Number.isFinite(t0) && t0 >= before && t0 <= Date.now(), '笔记页 pagehide 应写入新鲜时间戳标记');
});

test('V74-B8 首页不注册 pagehide 打标：首页→笔记导航不污染跳转标记', async t => {
  const app = freshApp(w => {
    w.sessionStorage.removeItem(JUMPED);
  }, 'http://localhost/');
  t.after(() => app.dom.window.close());
  const { window } = app;
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(window.sessionStorage.getItem(JUMPED), null, '无 noteId 的首页 pagehide 不应写入标记');
});
