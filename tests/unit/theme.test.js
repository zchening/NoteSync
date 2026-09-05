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

// ── 借壳日间（v5.33）：内部伪装夜间 + 预反色板 + invert 滤镜 ────────────────
test('借壳源断言：darkShellActive / mountShellOverride / theme-shell 存在，切换走状态变量', () => {
  assert.ok(/function darkShellActive\(\)/.test(SRC), '应有 darkShellActive 判定函数');
  assert.ok(/function mountShellOverride\(\)/.test(SRC), '应有 mountShellOverride');
  assert.ok(/notesync_darkshell/.test(SRC), '应有 localStorage 校准开关');
  assert.ok(/themeWantsDark = !themeWantsDark/.test(SRC), '手动切换必须走语义状态变量（借壳时 body 恒为 dark，读 class 会判错方向）');
});

test('借壳激活（localStorage=1）：语义日间 → 内部夜间 + theme-shell 预反色板 + color-scheme dark', () => {
  const w = openApp(stubModern);
  w.localStorage.setItem('notesync_darkshell', '1');
  w.applyTheme(false); // 用户语义：日间
  assert.strictEqual(w.document.body.classList.contains('dark'), true, '内部必须伪装夜间（body.dark），让对手放行深色页面');
  const sh = w.document.getElementById('theme-shell');
  assert.ok(sh, '借壳日间应挂载 theme-shell');
  assert.ok(sh.textContent.includes('html{filter:invert(1)'), 'shell 应给 html 套 invert 滤镜');
  assert.ok(sh.textContent.includes('background:#040407'), '预反色板应写米白底 #FBFBF8 的反色值 #040407');
  assert.ok(sh.textContent.includes('img,canvas{filter:invert(1)'), '图片/二维码应有自身 invert 以双重反转复原');
  assert.strictEqual(schemeOf(w), 'dark', '内部 color-scheme 应声明 dark（伪装一致）');
  assert.strictEqual(metaContent(w, 'color-scheme'), 'dark');
});

test('借壳激活：语义夜间 → 内部夜间但无 shell（无滤镜，显示真实夜间）', () => {
  const w = openApp(stubModern);
  w.localStorage.setItem('notesync_darkshell', '1');
  w.applyTheme(true); // 用户语义：夜间
  assert.strictEqual(w.document.body.classList.contains('dark'), true);
  assert.strictEqual(w.document.getElementById('theme-shell'), null, '夜间不得挂 shell（无滤镜）');
  assert.strictEqual(schemeOf(w), 'dark');
});

test('借壳日间：theme-shell 必须压在 theme-override 之后（DOM 末位）', () => {
  const w = openApp(stubModern);
  w.localStorage.setItem('notesync_darkshell', '1');
  w.applyTheme(false);
  const html = w.document.documentElement;
  const ov = w.document.getElementById('theme-override');
  const sh = w.document.getElementById('theme-shell');
  assert.strictEqual(html.lastElementChild, sh, 'shell 必须是最后一个元素子节点');
  assert.strictEqual(ov.nextElementSibling, sh, 'override 应紧邻 shell 之前');
});

test('借壳开关切换：日/夜反复切换 shell 状态正确且不堆积', () => {
  const w = openApp(stubModern);
  w.localStorage.setItem('notesync_darkshell', '1');
  w.applyTheme(false);
  assert.ok(w.document.getElementById('theme-shell'), '日间应有 shell');
  w.applyTheme(true);
  assert.strictEqual(w.document.getElementById('theme-shell'), null, '夜间应卸载 shell');
  w.applyTheme(false);
  w.applyTheme(true);
  assert.strictEqual(w.document.querySelectorAll('#theme-shell').length, 0, '反复切换不得堆积 shell 元素（末态为夜间，应为 0）');
  assert.strictEqual(w.document.querySelectorAll('#theme-override').length, 1, 'override 也不得堆积');
  w.applyTheme(false);
  assert.strictEqual(w.document.querySelectorAll('#theme-shell').length, 1, '再切回日间 shell 恢复且唯一');
});

test('借壳禁用（localStorage=0）：语义日间走正常路径（only light，无 shell）', () => {
  const w = openApp(stubModern);
  w.localStorage.setItem('notesync_darkshell', '0');
  w.applyTheme(false);
  assert.strictEqual(w.document.getElementById('theme-shell'), null, '禁用借壳时不得挂 shell');
  assert.strictEqual(schemeOf(w), 'only light', '禁用借壳时恢复标准日间声明');
  assert.strictEqual(w.document.body.classList.contains('dark'), false, '内部不应伪装夜间');
});

test('无校准 + 非高风险 UA（jsdom 默认）：darkShellActive 判定为关，行为与 v5.29 一致', () => {
  const w = openApp(stubModern);
  w.applyTheme(false);
  assert.strictEqual(w.document.getElementById('theme-shell'), null);
  assert.strictEqual(schemeOf(w), 'only light');
});

// ── v5.38：浮层提示条背景必须实底 ──────────────────────────────
// 根因回顾：.hintbar（remPanel/draftBar/installBar）与 #versionToast 原用 var(--hover)
// = rgba(...,.05)，95% 透明，浮在正文上透出笔记文字，被误认为"面板沉到文字后面"。
// 修复 = 背景改 var(--box-bg)（实底、随主题）；按钮 hover 态的 --hover 不受影响。
test('v5.38：提示条与版本 toast 背景必须实底 var(--box-bg)，不得用半透明 --hover', () => {
  const grab = re => {
    const m = SRC.match(re);
    assert.ok(m, '应能在 index.html 中匹配到规则');
    return m[0];
  };
  const hintbar = grab(/\.hintbar\{[^}]*\}/);
  assert.ok(hintbar.includes('background:var(--box-bg)'), '.hintbar 背景应为实底 var(--box-bg)');
  assert.ok(!hintbar.includes('background:var(--hover)'), '.hintbar 不得再用半透明 --hover 背景');
  const toast = grab(/#versionToast\{[^}]*\}/);
  assert.ok(toast.includes('background:var(--box-bg)'), '#versionToast 背景应为实底 var(--box-bg)');
  assert.ok(!toast.includes('background:var(--hover)'), '#versionToast 不得再用半透明 --hover 背景');
});

// ── v5.41：提醒 UI 纳入深色对抗保护圈 + 页面内去 ⏰ emoji ──────
// 根因回顾：#remCard（v5.37）与 #remBoxList（v5.40）不在 v5.29 的覆盖名单里，
// 国产浏览器夜间 CSS 注入把「知道了」「时间 · 事项」的文字色吃掉 → 黑底黑字；
// 「×」按钮则被 .box button 反色规则强制成实底黑块。
// 修复 = 三份覆盖名单（动态日板/夜板 + SHELL_CSS 预反色板）全部补规则。
test('v5.41：动态覆盖日/夜两板都必须含 #remCard 全家与 #remBoxList 规则（文字带 text-fill 双保险）', () => {
  const w = openApp(stubModern);
  w.applyTheme(true);
  const darkCss = overrideEl(w).textContent;
  w.applyTheme(false);
  const lightCss = overrideEl(w).textContent;
  for (const [tag, css] of [['夜间', darkCss], ['日间', lightCss]]) {
    assert.ok(/#remCard\{[^}]*background:[^}]*!important/.test(css), tag + '板 #remCard 卡片背景必须实底锁定');
    assert.ok(/#remCardTitle\{[^}]*-webkit-text-fill-color:[^}]*!important/.test(css), tag + '板 #remCardTitle 文字必须 text-fill 双保险');
    assert.ok(/#remCardList \.rem-when\{[^}]*-webkit-text-fill-color:[^}]*!important/.test(css), tag + '板到点条目文字必须 text-fill 双保险');
    assert.ok(/#remCardList \.rem-late\{[^}]*color:[^}]*!important/.test(css), tag + '板"已过 X 分钟"补录文字必须锁定');
    assert.ok(/#remCardAck\{[^}]*background:[^}]*!important/.test(css), tag + '板「知道了」按钮背景必须锁定');
    assert.ok(/#remCardAck\{[^}]*-webkit-text-fill-color:[^}]*!important/.test(css), tag + '板「知道了」文字必须 text-fill 双保险（黑底黑字根因）');
    assert.ok(/#remBoxList \.rem-row\{[^}]*-webkit-text-fill-color:[^}]*!important/.test(css), tag + '板列表行容器必须 text-fill 双保险（v5.42 文字改裸文本节点靠行容器继承）');
    assert.ok(/#remBoxList \.rem-row\{[^}]*background:none!important/.test(css), tag + '板列表行容器必须锁透明底（防注入上底色）');
    assert.ok(/#remBoxList \.rem-row button\{[^}]*background:none!important/.test(css), tag + '板「×」按钮必须恢复描边极简样式，不得被反色规则卷成实底黑块');
  }
});

test('v5.41：SHELL_CSS（借壳日间预反色板）也必须含 #remCard / #remBoxList 规则', () => {
  assert.ok(/'#remCard\{background:#000000!important/.test(SRC), 'SHELL_CSS 应含 #remCard 实底规则（invert 后 = light box）');
  assert.ok(/'#remCardAck\{background:#E3E3E5!important;color:#040407!important/.test(SRC), 'SHELL_CSS 应含 ack 反色规则（invert 后 = 深底白字）');
  assert.ok(/'#remBoxList \.rem-row\{/.test(SRC), 'SHELL_CSS 应含列表行规则（v5.42 文字节点靠行容器锁色）');
  assert.ok(/'#remBoxList \.rem-row button\{[^}]*background:none!important/.test(SRC), 'SHELL_CSS「×」按钮同样保持描边极简');
});

test('v5.42：列表行文字必须是裸文本节点（span 元素盒在该内核被吃字）+ 面板居中 + 默认 +5 分钟', () => {
  assert.ok(!/#remBoxList \.rem-row span\{/.test(SRC), 'span 级规则必须删除（span 元素已退役）');
  assert.ok(/#remBoxList \.rem-row\{display:grid;grid-template-columns:1fr auto/.test(SRC), '行布局必须 grid 1fr auto（文字列居中 + × 右侧）');
  assert.ok(/class="box qr-box" id="remPanel"/.test(SRC), '提醒面板必须挂 qr-box 居中（与配对弹窗一致）');
  assert.ok(/#remBoxForm input\{text-align:left\}/.test(SRC), '输入件内容保持左对齐（居中只给展示文字）');
  assert.ok(/new Date\(Date\.now\(\) \+ 5 \* 60 \* 1000\)/.test(SRC), '默认时间必须 = 当前 +5 分钟');
  assert.ok(/row\.appendChild\(document\.createTextNode\(fmtRemTime/.test(SRC), '列表文字必须走裸文本节点渲染');
});

test('v5.41：页面 UI 内不得出现 ⏰ emoji（卡片标题/条目/chip 文案），系统通知保留', () => {
  assert.ok(!/id="remCardTitle">[^<]*⏰/.test(SRC), '到点卡片标题必须去 emoji（同屏与条目重复、风格不符）');
  assert.ok(!/t\.textContent = '⏰ /.test(SRC), '到点卡片条目必须去 emoji 前缀');
  assert.ok(!/timeChip\.textContent = '⏰ /.test(SRC), 'chip 浮层文案必须去 emoji 前缀');
  assert.ok(/showNotification\('⏰ NoteSync 提醒'/.test(SRC), '系统通知栏保留 ⏰（系统层 emoji 醒目，不在页面 UI 内）');
  assert.ok(/const title = '⏰ '/.test(SRC), '到点系统通知标题保留 ⏰');
});
