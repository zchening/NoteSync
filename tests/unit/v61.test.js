// v6.1 十项改动验收测试（2026-09-07 用户九条需求 + 历史版本优化）
// 覆盖：图标 B 参数 / 口令弹窗 X+去图标 / 修改口令放宽 / 菜单图标加大 /
//       日夜间文案反转 / 关于弹窗+诊断彩蛋 / 删菜单诊断 / 历史版本单行+滚动 / 扫码文案分流
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

function readSrc() { return fs.readFileSync(INDEX_PATH, 'utf8'); }
function readRel(rel) { return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8'); } // 基准=仓库根

// ── 1. App 图标 B 参数（用户拍板：N 太大且太瘦 → 44% / 5.6%）──
test('V61-1 图标 B 参数：gen_icons.py 44%/5.6% + foreground 30%/5.0% + playstore 40%/4.8%', () => {
  const s = readRel('tools/gen_icons.py');
  assert.ok(s.includes('render(size, 0.44, 0.056)'), 'launcher 应 44%/5.6%');
  assert.ok(s.includes('render(size, 0.30, 0.050)'), 'adaptive foreground 应 30%/5.0%');
  assert.ok(s.includes('render(512, 0.40, 0.048)'), 'Play Store 512 应 40%/4.8%');
  assert.ok(!s.includes('0.52'), '旧 52% 参数应退役');
  // 全套 PNG 已重生成（launcher 至少 mdpi 48 存在）
  const png = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'res', 'mipmap-mdpi', 'ic_launcher.png');
  assert.ok(fs.existsSync(png) && fs.statSync(png).size > 500, 'mdpi launcher PNG 应在位');
});

// ── 2. favicon 同步加粗 2.6→3.4（用户拍板）──
test('V61-2 favicon.svg 线宽加粗到 3.4', () => {
  const s = readRel('favicon.svg');
  assert.ok(s.includes('stroke-width="3.4"'), 'favicon 应 3.4 线宽');
  assert.ok(!s.includes('stroke-width="2.6"'), '旧 2.6 应退役');
});

// ── 3. 口令弹窗：去图标 + 标题精简 + X 出口（方案 A + 用户拍板）──
test('V61-3 口令弹窗：无圆环图标、标题「输入口令」、右上角 X 回首页、「返回首页」按钮退役', () => {
  const src = readSrc();
  assert.ok(!src.includes('class="mark"'), '口令弹窗圆环图标应删除（方案 A）');
  assert.ok(!src.includes('.box .mark{'), 'mark CSS 应退役');
  assert.ok(src.includes('<h1>输入口令</h1>'), '标题应精简为「输入口令」');
  assert.ok(!src.includes('输入访问口令'), '旧标题「输入访问口令」应退役');
  assert.ok(!src.includes('id="unlockHome"'), '「返回首页」按钮应退役');
  assert.ok(/id="mask"[\s\S]{0,400}id="maskClose"/.test(src), '口令弹窗内应有 maskClose X');
  assert.ok(src.includes("$('#maskClose').addEventListener('click', () => { location.assign('/'); });"), 'X 点击应回首页');
  assert.ok(src.includes('.modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px}'), 'v6.2 X 应融入标题行（flex 头部：标题左、X 右）');
  assert.ok(src.includes('.box-x{width:36px;height:36px'), 'v6.2 X 应为 36px 热区流内按钮');
  assert.ok(!src.includes('.box-x{position:absolute'), 'v6.1 绝对定位悬浮式应退役');
  assert.ok(src.includes('.box button:not(.box-x){'), '通栏按钮规则应排除关闭 X（否则按优先级覆盖 X 样式）');
});

// ── 4. 修改口令：1 位即可 + 文案精简 + 输入框间距 ──
test('V61-4 修改口令：非空即可、placeholder 精简、相邻输入框 12px 间距', () => {
  const src = readSrc();
  assert.ok(src.includes("if (!p1) { cpErr.textContent = '新口令不能为空'; return; }"), '校验应放宽为非空');
  assert.ok(!src.includes('p1.length < 4') && !src.includes('至少 4 位'), '4 位下限应退役');
  assert.ok(src.includes('placeholder="新口令"'), 'placeholder 应为「新口令」');
  assert.ok(src.includes('placeholder="再次输入"'), 'placeholder 应为「再次输入」');
  assert.ok(!src.includes('再输一遍新口令'), '旧文案应退役');
  assert.ok(src.includes('#cpNew,#cpNew2{margin-top:12px}'), '相邻输入框应有 12px 间距');
});

// ── 5. 菜单图标加大（用户：点击费劲）──
test('V61-5 菜单尺寸：图标 26px、条目 42px/15px（v7.0.1 flex 瘦身）', () => {
  const src = readSrc();
  assert.ok(src.includes('.menu-item svg{width:26px;height:26px;flex:none}'), 'SVG 应 26px');
  assert.ok(/\.menu-item\{[^}]*min-height:42px/.test(src), '条目应 42px');
  assert.ok(/\.menu-item\{[^}]*padding:9px 12px/.test(src), '条目 padding 应 9px 12px');
  assert.ok(/\.menu-item\{[^}]*font-size:15px/.test(src), '条目字号应 15px');
});

// ── 6. 日夜间切换文案反转（用户拍板：显示点击后将切换到的模式）──
test('V61-6 日夜间菜单项动态：日间显「夜间模式」、夜间显「日间模式」+ 图标随语义', () => {
  const src = readSrc();
  assert.ok(src.includes('id="menuThemeIcon"') && src.includes('id="menuThemeLabel"'), '主题项应拆出图标/文字容器');
  assert.ok(src.includes("lb.textContent = dark ? '日间模式' : '夜间模式';"), '文案语义应为目标模式');
  assert.ok(src.includes('ic.innerHTML = dark ? ICON_SUN : ICON_MOON;'), '图标应随语义翻转（夜间显太阳）');
  assert.ok(src.includes('syncThemeMenuItem(dark);       // v6.1'), 'applyTheme 应同步菜单项');
  assert.ok(src.includes('syncThemeMenuItem(themeWantsDark)'), 'renderMenu 打开菜单应刷新');
  assert.ok(!src.includes('>日夜间切换<'), '旧固定文案「日夜间切换」应退役');
});

// ── 7. 关于 NoteSync 弹窗 + 版本号 + 作者 ──
test('V61-7 关于弹窗：菜单入口、qr-box 风格、网页/APP 版本行、作者 zchening', () => {
  const src = readSrc();
  assert.ok(src.includes('id="menuAbout"') && src.includes('关于 NoteSync'), '菜单底部应有「关于 NoteSync」');
  assert.ok(src.includes('id="aboutMask"'), '应有 aboutMask 弹窗');
  assert.ok(/id="aboutMask"[\s\S]{0,300}class="box qr-box"/.test(src), '关于弹窗应复用 qr-box 风格（同扫码配对）');
  assert.ok(src.includes('id="aboutTitle">关于NoteSync</h1>'), '标题应为「关于NoteSync」（v7.0：用户拍板文案）');
  assert.ok(src.includes("$('#aboutVer').textContent = 'Version ' + APP_VERSION;"), '应有网页版本行（v7.0：三段式 Version）');
  assert.ok(src.includes("av.textContent = 'Version ' + nv;"), 'APP 端应显示 APP 版本（v7.0：同三段式）');
  assert.ok(src.includes("rb.getVersion"), '应经 RemBridge.getVersion 取原生版本');
  assert.ok(src.includes('id="aboutAuthorName">@zchening</span>'), '应显示作者 @zchening（v7.0：用户拍板文案）');
});

// ── 8. 彩蛋：标题连点 4 次 → 诊断模态 ──
test("V61-8 彩蛋：连点「关于NoteSync」标题 4 次弹出诊断模态", () => {
  const src = readSrc();
  assert.ok(src.includes('aboutTaps >= 4'), '应连点 4 次触发');
  assert.ok(src.includes('setTimeout(() => { aboutTaps = 0; }, 800)'), '800ms 连击窗口');
  assert.ok(src.includes('aboutMask.classList.add(\'hidden\');\n    openDiagModal();'), '触发后应关关于弹窗并开诊断模态');
});

// ── 9. 诊断模态：居中可读 + 复制 + 自动关闭 ──
test('V61-9 诊断模态：主题前景色可读、collectDiagLines 快照、复制按钮、点外/滚动关闭', () => {
  const src = readSrc();
  assert.ok(src.includes('id="diagMask"') && src.includes('id="diagContent"') && src.includes('id="diagCopy"'), '应有诊断模态三件套');
  assert.ok(src.includes('window.collectDiagLines = function'), '采样应抽成共用函数');
  assert.ok(src.includes("pre.textContent = window.collectDiagLines().join('\\n');"), '模态应取采样快照');
  assert.ok(src.includes('#diagContent{margin:0 0 14px;padding:12px;background:var(--hover);border-radius:10px;font:13px/1.6 ui-monospace,Consolas,monospace;color:var(--fg)'), '诊断正文应用主题前景色（日夜可读）');
  assert.ok(src.includes('navigator.clipboard.writeText(txt).then(done, () => fallbackCopyText(txt, done))'), '复制应有 clipboard+降级双路');
  assert.ok(src.includes('diagMask.addEventListener(\'click\', e => { if (e.target === diagMask) diagMask.classList.add(\'hidden\'); })'), '点弹窗外应关闭');
  assert.ok(src.includes("editor.addEventListener('scroll', () => { if (!diagMask.classList.contains('hidden')) diagMask.classList.add('hidden'); })"), '滚动笔记应自动关闭');
  assert.ok(src.includes('复制诊断信息'), '应有复制按钮文案');
});

// ── 10. 删菜单诊断一级项（用户拍板）──
test('V61-10 菜单「诊断」一级项退役，?diag 通道保留', () => {
  const src = readSrc();
  assert.ok(!src.includes('id="menuDiag"'), '菜单不应再有诊断项');
  assert.ok(!src.includes("$('#menuDiag')"), '诊断项 wiring 应删除');
  assert.ok(src.includes("window.__toggleDiag"), '?diag 免 URL 开关应保留');
  assert.ok(src.includes("location.search.indexOf('diag')"), '?diag URL 通道应保留');
});

// ── 11. 历史版本：单行布局 + 信息精简 + 列表滚动 ──
test('V61-11 历史版本：单行「时间 · 手动 | 预览/恢复」、删自动/v/KB、列表可滚、收藏夹同滚', () => {
  const src = readSrc();
  assert.ok(src.includes("row.className = 'hist-item'") && src.includes("line.className = 'hist-line'"), '应为 hist-item>hist-line 单行结构');
  assert.ok(src.includes("meta.textContent = fmtSyncShort(item.ts) + (item.manual ? ' · 手动' : '');"), '仅手动标注「· 手动」');
  assert.ok(!src.includes("' · ' + (item.manual ? '手动' : '自动')"), '「自动」标注应退役');
  assert.ok(!src.includes("Math.round((item.size || 0) * 3 / 4 / 1024)) + 'KB'"), 'KB 信息应退役');
  assert.ok(!src.includes("' · v' + (item.v || 0)"), '版本号信息应退役');
  assert.ok(src.includes("pv.textContent = '预览'") && src.includes("rs.textContent = '恢复'"), '按钮应精简为「预览」「恢复」');
  assert.ok(!src.includes('恢复此版本'), '旧文案「恢复此版本」应退役');
  assert.ok(src.includes('.hist-line{display:flex;align-items:center;justify-content:space-between;gap:8px}'), '单行 flex 布局');
  assert.ok(src.includes('.hist-btns{display:flex;gap:6px;flex-shrink:0}'), '按钮组不挤压');
  assert.ok(src.includes('#menuHistList,#menuFavList{max-height:min(50vh,400px);overflow-y:auto;-webkit-overflow-scrolling:touch}'), '历史/收藏列表应独立滚动');
  assert.ok(src.includes('#menuMainView{max-height:min(72vh,560px);overflow-y:auto;-webkit-overflow-scrolling:touch}'), '菜单主视图应限高内滚');
});

// ── 12. menuBox X 退役（v6.2 用户拍板：遮罩点击已覆盖退出）──
test('V61-12 menuBox X 退役：menuClose 全链路移除 + menuBox 瘦身', () => {
  const src = readSrc();
  assert.ok(!src.includes('id="menuClose"'), 'menuClose 按钮应退役');
  assert.ok(!src.includes("$('#menuClose')"), 'menuClose wiring 应移除');
  assert.ok(src.includes('#menuBox{width:min(86vw,300px);text-align:left;padding:14px 16px}'), 'menuBox 应瘦身（300px/14px 16px）');
  assert.ok(src.includes("menuMask.addEventListener('click', e => { if (e.target === menuMask) menuMask.classList.add('hidden'); });"), '遮罩点击关闭应保留为退出路径');
});

// ── 13. 扫码文案分流（PC 扫码修复配套）──
test('V61-13 扫码提示分流：HTTPS/组件失败/无摄像头/权限拒绝 四路各自可读', () => {
  const src = readSrc();
  assert.ok(src.includes('当前环境无法调用摄像头（需 HTTPS）'), 'HTTP 场景提示');
  assert.ok(src.includes('扫码组件加载失败，请稍后重试'), 'jsQR 不可达提示');
  assert.ok(src.includes('未检测到可用摄像头'), 'NotFoundError 提示');
  assert.ok(src.includes("'相机权限被拒绝'"), 'NotAllowedError 提示');
  assert.ok(!src.includes('当前浏览器不支持扫码，请用 APP'), '旧「请用 APP」误导文案应退役');
});

// ── 14. 版本升格（v7.0 起断言跟随最新版）──
test('V61-14 版本升格：APP_VERSION 7.0.1 / BUILD_DATE / gradle 701+7.0.1 / README 条目 ≤40 汉字', () => {
  const src = readSrc();
  assert.ok(src.includes("const APP_VERSION = '7.1.0';"), 'APP_VERSION 应 7.1.0');
  assert.ok(src.includes("const BUILD_DATE = '2026-09-07';"), 'BUILD_DATE 应更新');
  const gradle = readRel('android/app/build.gradle');
  assert.ok(gradle.includes('versionCode 710') && gradle.includes('versionName "7.1.0"'), 'gradle 应 710/7.1.0');
  const readme = readRel('README.md');
  const row = (readme.match(/^\| v7\.0\.1 \|[^|]+\|([^|]+)\|/m) || [])[1] || '';
  const hz = (row.match(/[一-龥]/g) || []).length;
  assert.ok(hz > 0 && hz <= 40, 'README v7.0.1 摘要应为 1-40 汉字（实测 ' + hz + '）');
  assert.ok(readme.includes('| v6.3 | 2026-09-07 |'), 'README 应有 v6.3 条目');
});
