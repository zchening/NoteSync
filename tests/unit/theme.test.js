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
  assert.ok(/new Date\(Date\.now\(\) \+ 5 \* 60 \* 1000\)/.test(SRC), '默认时间必须 = 当前 +5 分钟');
  assert.ok(/row\.appendChild\(document\.createTextNode\(fmtRemTime/.test(SRC), '列表文字必须走裸文本节点渲染');
});

test('v5.43：输入框内容必须居中（继承 qr-box），showPicker 退役', () => {
  assert.ok(!/#remBoxForm input\{text-align:left\}/.test(SRC), 'v5.42 的输入框左对齐必须删除（用户要求时间/事项内容居中）');
  assert.ok(!/showPicker/.test(SRC), 'showPicker 一并退役（依赖聚焦手势，且自动弹选择器过激）');
});

test('v5.45：打开面板默认聚焦自建分钟框且全选（真选中），聚焦受桌面环境守卫（触屏不聚焦防挤偏）', () => {
  assert.ok(/input\.rem-mm/.test(SRC), '自建分钟输入框必须存在（datetime-local 已退役——内核段选区硬边界）');
  assert.ok(!/datetime-local/.test(SRC), '原生 datetime-local 必须彻底移除');
  assert.ok(/mm\.focus\(\{\s*preventScroll:\s*true\s*\}\)/.test(SRC), '聚焦必须带 preventScroll，不得滚动页面');
  assert.ok(/mm\.select\(\)/.test(SRC), '分钟值必须全选（select() 标准文本 API，v5.45 真选中「16」）');
  assert.ok(/\(hover:hover\) and \(pointer:fine\)/.test(SRC), '自动聚焦必须限定桌面环境（v5.43 教训：移动端聚焦弹软键盘压缩视口，面板偏离正中心）');
  assert.ok(!/inp\.focus\(\)/.test(SRC), '不得出现无参数裸调用（必须 preventScroll 且受桌面守卫包住）');
  assert.ok((SRC.match(/\.focus\(\{/g) || []).length === 1, '带选项的聚焦调用全文件只能出现一次（守卫块内），防止新增无守卫调用');
});

test('v5.44：到点卡片必须居中且文字居中（remRise 专用入场），placeholder 精简，音频全局解锁', () => {
  assert.ok(/#remCard\{[^}]*animation:remRise/.test(SRC), '#remCard 必须挂 remRise 专用入场（通用 rise 的 to 帧 transform:none 会抹掉 translate 居中偏移，动画结束卡片偏离正中心）');
  assert.ok(/@keyframes remRise\{from\{[^}]*translate\(-50%,-50%\)[^}]*\}to\{[^}]*translate\(-50%,-50%\)/.test(SRC), 'remRise 的 from/to 两帧都必须保留 translate(-50%,-50%) 居中偏移');
  assert.ok(/#remCard\{[^}]*text-align:center/.test(SRC), '到点卡片标题「提醒」与正文「时间 · 事项」必须居中（用户反复要求）');
  assert.ok(!/#remCard\{[^}]*animation:rise /.test(SRC), '#remCard 不得再挂通用 rise 动画');
  assert.ok(/item\.placeholder = '事项'/.test(SRC), '事项框 placeholder 必须精简为「事项」（去掉括号补语）');
  assert.ok((SRC.match(/new AC\(\)/g) || []).length === 1, 'AudioContext 只允许在解锁函数里创建一次（响铃时复用全局 ctx，不得再新建 suspended 实例）');
  assert.ok(/createBuffer\(1,\s*1,\s*22050\)/.test(SRC), '音频解锁必须播放静音 buffer（iOS/国产内核手势解锁必需）');
  assert.ok(/\['pointerdown',\s*'touchend',\s*'keydown'\]\.forEach/.test(SRC), '解锁必须挂在首次手势事件（pointerdown/touchend/keydown）上');
  assert.ok(/!\/remCard\.classList\.contains\('hidden'\)|remCard\.classList\.remove\('hidden'\)/.test(SRC), '到点实底卡片仍是页内主通道');
});

test('v5.45+v5.46：提醒下划线标记由 linkify 管理（先拆后建）并纳入双板锁色，未添加/已过期的日期绝不包标记', () => {
  assert.ok(/u\.className = 'rem-mark'/.test(SRC), 'buildLinkSafe 必须生成 u.rem-mark（v5.46：不再挂灰态 class）');
  assert.ok(!/rem-past/.test(SRC), '灰态 class 必须完全退役（v5.46：过期/已提醒过的时间回归普通正文，不变灰）');
  assert.ok(!/mt\.past/.test(SRC), '包裹区间不得再携带 past 字段（过期匹配直接不进计算）');
  assert.ok(/filter\(m => m\.at > now\)/.test(SRC), '已过期匹配必须被过滤（v5.54：纯时间判断，REM_DONE 退役）');
  assert.ok(!/exec\(txt\.slice\(end\)\)/.test(SRC), '事项延展正则必须删除（v5.46：下划线只包时间串本身）');
  assert.ok(/remMatchesFor\(textNode\.nodeValue\)/.test(SRC), 'linkify 重建时必须传入提醒包裹区间');
  assert.ok(/remMarks\.forEach/.test(SRC), '先拆阶段必须拆 u.rem-mark（删提醒→下划线消失靠整轮重算）');
  assert.ok(/remMatchesFor\(node\.nodeValue\)\.length > 0/.test(SRC), 'walker 必须放行已设提醒命中的纯时间文本节点（否则纯时间行建不出标记）');
  assert.ok(/reminders\.some\(r => r\.at === m\.at\)/.test(SRC), '只有解析值存在于提醒列表才包标记（用户拍板：未添加的日期绝不加下划线）');
  assert.ok(/&& m\.at > now/.test(SRC), '早退判断必须同步排除过期时间（v5.54：纯时间判断）');
  assert.ok(/#editor u\.rem-mark\{color:\$\{p\.fg\}!important/.test(SRC), '动态板必须锁 rem-mark 前景色');
  assert.ok(/'#editor u\.rem-mark\{color:#E3E3E5!important/.test(SRC), 'SHELL_CSS 必须预反色锁 rem-mark（目标日间前景）');
  assert.ok(/#timeChip \.chip-cta\{color:\$\{chipCta\}!important/.test(SRC), '动态板必须锁 chip CTA 蓝色');
  assert.ok(/'#timeChip \.chip-cta\{color:#DA9C14!important/.test(SRC), 'SHELL_CSS 必须预反色锁 chip CTA（目标日间蓝 #2563EB）');
});

test('v5.46+v5.47：已添加的未来时间悬停两行展示卡（不可点、移开即消失），分隔符改全角空格「　」', () => {
  assert.ok((SRC.match(/createTextNode\('✅ 提醒已添加'\)/g) || []).length === 2, '两行卡出现两处：点添加后的确认卡 + 悬停已添加时间的展示卡（v5.47 起第一行为文本节点+删除按钮）');
  assert.ok(/if \(reminders\.some\(r => r\.at === m\.at\)\) \{/.test(SRC), 'chip 必须分支已添加的时间（浮两行展示卡）');
  assert.ok(/fmtRemTime\(m\.at\) \+ \(item \? '　' \+ item : ''\)/.test(SRC), '展示卡第二行「时间　事项」（事项空只显时间；v5.47 分隔符=全角空格）');
  assert.ok(/chipData = null; \/\/ 清残留/.test(SRC), '展示卡必须清 chipData（纯展示不可点，防旧目标误触）');
  assert.ok(/timeChip\.classList\.add\('feedback'\)/.test(SRC), '展示卡复用两行卡片样式（圆角/居中/默认光标）');
  assert.ok(!/'设提醒：'/.test(SRC), '旧文案「设提醒：」不得回归');
  assert.ok(/fmtRemInsert\(at\) \+ \(item \? '　' \+ item : ''\)/.test(SRC), '面板回写格式「时间　事项」（v5.47 分隔符=全角空格，用户拍板）');
});

test('v5.47：chip 两行卡带「删除」伪按钮（三板锁色）+ 30 秒窗口差修复 + 面板列表左对齐显式升序 + 全角空格分隔', () => {
  // ── 删除按钮：构建函数 + 三事件 + 键盘可达 ──
  assert.ok(/function buildChipDeleteBtn\(\)/.test(SRC), '删除按钮必须有独立构建函数（确认卡/展示卡两处复用）');
  assert.ok(/function chipDeleteActivate\(e\)/.test(SRC), '删除必须有独立激活函数');
  assert.ok(/e\.stopPropagation\(\); \/\/ 阻止冒泡到 timeChip 的 chipActivate/.test(SRC), '删除点击必须阻止冒泡（不落入整卡 chipActivate 路径）');
  assert.ok(/d\.addEventListener\('pointerdown', chipDeleteActivate\)/.test(SRC) && /d\.addEventListener\('mousedown', chipDeleteActivate\)/.test(SRC), '删除按钮必须挂 pointerdown/mousedown（jsdom 兼容触屏套路）');
  assert.ok(/d\.setAttribute\('tabindex', '0'\)/.test(SRC), '删除伪按钮必须键盘可达（v5.39 铁律）');
  assert.ok(/removeReminder\(at\); \/\/ 异步/.test(SRC), '删除必须走 removeReminder（列表移除+持久化+下划线重算）');
  // ── 三板锁色（静态 CSS / 动态板 / SHELL_CSS 预反色）──
  assert.ok(/#timeChip \.chip-del\{[^}]*border:1px solid var\(--line\)/.test(SRC), '静态 CSS：删除按钮 span+描边（原生 button 国产夜间全黑铁律）');
  assert.ok(/#timeChip \.chip-del\{color:\$\{p\.fg\}!important.*border:1px solid \$\{p\.line\}!important/.test(SRC), '动态板必须锁删除按钮前景/描边');
  assert.ok(/'#timeChip \.chip-del\{color:#E3E3E5!important[^}]*border:1px solid #13151D!important/.test(SRC), 'SHELL_CSS 必须预反色锁删除按钮（目标日间前景/描边）');
  // ── chipDeleteAt 生命周期 ──
  assert.ok(/let chipData = null, chipTimer = null, chipDeleteAt = null;/.test(SRC), 'chipDeleteAt 必须与 chipData 同址声明');
  assert.ok(/function hideTimeChip\(\) \{ chipData = null; chipDeleteAt = null;/.test(SRC), 'hideTimeChip 必须同时清 chipDeleteAt（防旧目标误删）');
  assert.ok((SRC.match(/chipDeleteAt = /g) || []).length >= 4, 'chipDeleteAt 赋值点：声明+清除+展示卡+确认卡');
  // ── 30 秒窗口差修复：已添加分支优先，口径与下划线一致 ──
  assert.ok(/if \(m\.at <= now\) \{ hideTimeChip\(\); return; \}/.test(SRC), '已添加分支以 at<=now 拦截（与下划线阈值一致，修 30s 窗口差）');
  assert.ok(/if \(m\.expired\) \{ hideTimeChip\(\); return; \}/.test(SRC), '未添加的过期时间仍零打扰（硬规则不变）');
  assert.ok(/const now = Date\.now\(\);\s*\n\s*\/\/ v5\.47/.test(SRC), '过期口径判断必须取自当前时刻');
  // ── 面板列表：左对齐 + 显式升序 ──
  assert.ok(/#remBoxList \.rem-row\{[^}]*text-align:left\}/.test(SRC), '面板已设列表必须左对齐（覆盖 .qr-box 居中，用户拍板）');
  assert.ok(/reminders\.filter\(r => r\.at > Date\.now\(\)\)\.sort\(\(a, b\) => a\.at - b\.at\)\.forEach/.test(SRC), '面板列表渲染必须显式升序（最近的最上方，用户要求）');
  // ── 分隔符：remCard 与面板列表同步全角空格 ──
  assert.ok(/t\.textContent = fmtRemTime\(r\.at\) \+ \(r\.text \? '　' \+ r\.text : ''\)/.test(SRC), '到点卡片条目分隔符=全角空格');
  assert.ok(/row\.appendChild\(document\.createTextNode\(fmtRemTime\(r\.at\) \+ \(r\.text \? '　' \+ r\.text : ''\)\)\)/.test(SRC), '面板列表条目分隔符=全角空格');
  assert.ok(!/' · ' \+ (item|r\.text)/.test(SRC), '时间与事项之间的「 · 」分隔符必须全部退役');
});

test('v5.45：chip 文案改版（蓝色 CTA）+ 两行确认卡 + 过期零打扰 + 面板添加回写正文', () => {
  assert.ok(/cta\.textContent = '添加提醒'/.test(SRC), 'chip CTA 必须是「添加提醒」（与面板按钮统一，「设提醒」退役）');
  assert.ok(!/'设提醒：'/.test(SRC), '旧文案「设提醒：」必须删除');
  assert.ok(!/已过期 ' \+ fmtRemTime/.test(SRC), '旧「已过期」chip 文案必须删除（过期不再浮 chip）');
  assert.ok(/if \(m\.expired\) \{ hideTimeChip\(\); return; \}/.test(SRC), '过期命中直接不显示 chip（零打扰，用户拍板；v5.47 起该判断移到已添加分支之后）');
  assert.ok(/createTextNode\('✅ 提醒已添加'\)/.test(SRC), '确认卡第一行必须是「✅ 提醒已添加」（v5.47：文本节点+删除按钮）');
  assert.ok(/l2\.textContent = fmtRemTime\(at\) \+ \(item \? '　' \+ item : ''\)/.test(SRC), '确认卡第二行必须是「时间　事项」（v5.47 分隔符=全角空格）');
  assert.ok(/chipFeedbackUntil = Date\.now\(\) \+ 3000/.test(SRC), '确认卡停留 3 秒');
  assert.ok(/insertRemLine\(at, text\)/.test(SRC), '面板添加成功必须回写正文光标处');
  assert.ok(/insertNodeAtCaret\(document\.createTextNode\(text\)\)/.test(SRC), '回写走 insertNodeAtCaret 纯 DOM 插入（input 事件链照常：撤销栈/保存/linkify）');
  assert.ok(/let panelSavedSel = null;/.test(SRC), '必须维护打开面板前的编辑器选区快照');
  assert.ok(/saveSelectionBlocked\(editor, sel\.getRangeAt\(0\)\)/.test(SRC), '打开面板必须先保存编辑器选区（恢复光标所在处）');
  assert.ok((SRC.match(/scheduleRemMarkRefresh/g) || []).length >= 3, '提醒状态变化（增删）必须触发标记刷新（定义+2 挂点；v5.54 REM_DONE 退役后挂点减少）');
});

test('v5.41：页面 UI 内不得出现 ⏰ emoji（卡片标题/条目/chip 文案），系统通知保留', () => {
  assert.ok(!/id="remCardTitle">[^<]*⏰/.test(SRC), '到点卡片标题必须去 emoji（同屏与条目重复、风格不符）');
  assert.ok(!/t\.textContent = '⏰ /.test(SRC), '到点卡片条目必须去 emoji 前缀');
  assert.ok(!/timeChip\.textContent = '⏰ /.test(SRC), 'chip 浮层文案必须去 emoji 前缀');
  assert.ok(/showNotification\('⏰ NoteSync 提醒'/.test(SRC), '系统通知栏保留 ⏰（系统层 emoji 醒目，不在页面 UI 内）');
  assert.ok(/const title = '⏰ '/.test(SRC), '到点系统通知标题保留 ⏰');
});
