// v5.57 单元测试：真机验收九连修的回归护栏
// G1 通知点击不弹面板 | G2 提醒恢复后补下划线重绘 | G3 chip 裸文本兜底+组字补触发
// G4 冲突/草稿浮卡形态 | G5 解锁框返回首页 | G6 自动解锁写最后笔记 | G7 APP 菜单收纳
// G8 parsePairLink 扫码解析 | G9 MainActivity 缓存引导 reload + 诊断新字段
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}
function readAndroid(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', rel), 'utf8');
}

// ── G1：通知点击不再弹提醒面板（用户实测：通知本身就是提醒，进正文即可）──
// v6.0：监听恢复=跨笔记跳转到提醒所属笔记，「弹面板」旧形态仍被此断言拦截
test('G1 无 rem-notify-click→toggleRemPanel 链路', () => {
  const src = readSrc();
  assert.ok(!/rem-notify-click'[^\n]*toggleRemPanel/.test(src), '通知点击不得再打开提醒面板');
  assert.ok(!/rem-notify-click[\s\S]{0,400}toggleRemPanel/.test(src), '监听体内也不得触达提醒面板');
});

// ── G2：poll / 用服务器版 两条 loadReminder 路径都补下划线重绘 ──
test('G2 loadReminder 后无条件 scheduleRemMarkRefresh（两处）', () => {
  const src = readSrc();
  const hits = src.match(/loadReminder\(note, cryptoKey\); scheduleRemMarkRefresh\(\);/g) || [];
  assert.ok(hits.length >= 2, 'poll 与 remoteTake 两处恢复提醒后都应补下划线重绘（「有时候没下划线」实锤：远端只动提醒没动正文时 linkify 分支不跑）');
});

// ── G3：chip 裸文本节点兜底 + 组字结束补触发（「有时候不弹」双嫌疑）──
test('G3 caretInfoInEditor 裸文本兜底 + compositionend 补 chip 触发', () => {
  const src = readSrc();
  const idx = src.indexOf('function caretInfoInEditor()');
  assert.ok(idx > -1, '应存在 caretInfoInEditor');
  const seg = src.slice(idx, idx + 900);
  assert.ok(seg.includes('parentNode === editor'), '应有裸文本节点（editor 直接子文本）兜底分支');
  assert.ok(seg.includes('startContainer.data'), '裸文本兜底应取节点自身文本');
  const ci = src.indexOf("addEventListener('compositionend'");
  assert.ok(ci > -1, '应存在 compositionend 监听');
  const cseg = src.slice(ci, ci + 400);
  assert.ok(cseg.includes('maybeShowTimeChip'), '组字结束应补 chip 触发（组合态内 selectionchange 全被 isComposing 拦掉）');
});

// ── G4：冲突/草稿提示=扫码配对同款浮卡（v5.58 起文案与尺寸由 v558.test.js 接管）──
test('G4 conflictbar/confcard 浮卡形态 + hintbar 退役', () => {
  const src = readSrc();
  assert.ok(src.includes('.conflictbar{'), '应有 conflictbar 容器样式');
  assert.ok(src.includes('.confcard{'), '应有 confcard 浮卡样式（圆角18+rise+同款阴影）');
  assert.ok(src.includes('border-radius:18px'), '浮卡应同款圆角 18');
  assert.ok(src.includes('pointer-events:none'), '容器应不挡输入（无遮罩）');
  const bars = src.match(/class="conflictbar hidden"/g) || [];
  assert.equal(bars.length, 2, 'draftBar 与 remoteBar 应都是 conflictbar 浮卡');
  assert.ok(!/id="draftBar" class="hintbar/.test(src) && !/id="remoteBar" class="hintbar/.test(src), '两条不应再是 hintbar 单行条');
});

// ── G5：口令框「返回首页」出口（APP 里不想解锁只能杀进程实锤）──
test('G5 口令框右上角 X 出口（v6.1：返回首页按钮退役）', () => {
  const src = readSrc();
  assert.ok(!src.includes('id="unlockHome"'), 'v6.1「返回首页」按钮应退役');
  assert.ok(src.includes('id="maskClose"'), '口令框应有右上角 X');
  assert.ok(src.includes("$('#maskClose').addEventListener('click'"), 'maskClose 应有 wiring');
  assert.ok(/maskClose'\)\.addEventListener\('click'[^}]*location\.assign\('\/'\)/.test(src), '点击 X 应回首页');
  assert.ok(src.includes('class="box-x"'), 'X 应为右上角通用关闭样式');
});

// ── G6：自动解锁路径也写「最后打开的笔记」（冷启动跳转形同虚设实锤）──
test('G6 自动解锁路径补写 NOTE_LAST_KEY（共两处：口令+自动）', () => {
  const src = readSrc();
  const hits = src.match(/localStorage\.setItem\(NOTE_LAST_KEY, noteId\)/g) || [];
  assert.ok(hits.length >= 2, '口令解锁与自动解锁两条路径都应写 NOTE_LAST_KEY（此前仅口令路径写，记住密钥/扫码配对进来的设备跳转键从不更新）');
});

// ── G7：菜单收纳（v5.58 起三端统一；v7.7.0 扫一扫迁出菜单 → 顶栏 scanBtn + 首页 landingScan，菜单新增换机备份码 menuBackup）──
test('G7 菜单三件套 DOM + wiring', () => {
  const src = readSrc();
  assert.ok(!src.includes('id="menuScan"'), 'v7.7.0：☰ 菜单应不再有扫一扫项（入口迁顶栏与首页）');
  assert.ok(src.includes('id="scanBtn"') && src.includes("$('#scanBtn').addEventListener('click'"), '顶栏应有扫一扫按钮 DOM+wiring');
  assert.ok(src.includes('id="landingScan"') && src.includes("$('#landingScan').addEventListener('click'"), '首页应有扫码入口 DOM+wiring');
  assert.ok(src.includes('id="menuBackup"') && src.includes("$('#menuBackup').addEventListener('click'"), '菜单应有备份换机码 DOM+wiring');
  assert.ok(src.includes('async function doScanAndOpen('), '扫码流程应抽公共函数 doScanAndOpen');
  assert.ok(src.includes('await scanWithWebCamera()'), 'doScanAndOpen 应保留网页扫码层分支');
  assert.ok(src.includes('id="menuTheme"') && src.includes('id="menuLock"'), '菜单应有日夜间切换/退出锁定两项');
  assert.ok(src.includes("$('#menuTheme').addEventListener('click'"), 'menuTheme 应有 wiring');
  assert.ok(src.includes("$('#menuLock').addEventListener('click'"), 'menuLock 应有 wiring');
});

// ── G8：parsePairLink 扫码解析三形态（jsdom 行为）──
test('G8 parsePairLink：短链/双域直链/裸路径放行，非本系统 null', () => {
  const src = readSrc();
  assert.ok(src.includes('function parsePairLink('), '应有 parsePairLink');
  // 纯函数抽出eval测行为（与 index.html 内实现同源断言）
  const fnSrc = src.slice(src.indexOf('function parsePairLink('), src.indexOf('// --- 同步 ---'));
  const parsePairLink = new Function(fnSrc + '\nreturn parsePairLink;')();
  assert.equal(parsePairLink('https://xuyinji.com.cn/note/home%E6%B5%8B%E8%AF%95#k=abc-DEF_123'), null, '解码后非 ASCII 名应拒绝（服务端 ID_RE 同规则）');
  assert.equal(parsePairLink('https://xuyinji.com.cn/note/my%2Dnote_1#k=abc-DEF_123'), '/my-note_1#k=abc-DEF_123', '百分号编码形态（配对弹窗出码实际形态）应解码放行');
  assert.equal(parsePairLink('https://xuyinji.com.cn/note/my-note_1#k=abc-DEF_123'), '/my-note_1#k=abc-DEF_123', '主站短链应解出路径+密钥');
  assert.equal(parsePairLink('https://note.xuyinji.com.cn/abc#k=XYZ_123-abc'), '/abc#k=XYZ_123-abc', 'note 域直链应解出');
  assert.equal(parsePairLink('https://biji.xuyinji.com.cn/work#k=k1'), '/work#k=k1', 'biji 域直链应解出');
  assert.equal(parsePairLink('/plain#k=kk'), '/plain#k=kk', '裸路径应放行');
  assert.equal(parsePairLink('https://note.xuyinji.com.cn/only'), '/only', '无 #k= 也放行（走口令解锁）');
  assert.equal(parsePairLink('https://evil.com/note/x#k=y'), null, '外站链接应拒绝');
  assert.equal(parsePairLink('hello world'), null, '普通文本应拒绝');
  assert.equal(parsePairLink(''), null, '空串应拒绝');
});

// ── G9：MainActivity 缓存引导 reload（mainDocCache=none 根治）+ 诊断新字段 ──
test('G9 MainActivity 缓存不存在则装完 client 补一次 reload + diag future/lastNativeSync', () => {
  const main = readAndroid('MainActivity.java');
  assert.ok(main.includes('didCacheBootstrapReload'), '应有进程内防循环布尔');
  assert.ok(main.includes('wv.reload()'), '缓存不存在时应补一次 reload 让拦截器接管');
  const ri = main.indexOf('didCacheBootstrapReload = true;');
  const reloadIdx = main.indexOf('wv.reload();', ri);
  assert.ok(ri > -1 && reloadIdx > ri, 'reload 应在置位之后（防循环语义）');
  const cacheChk = main.indexOf('new java.io.File(getFilesDir(), MAIN_DOC_CACHE).exists()');
  assert.ok(cacheChk > -1, '应以磁盘缓存存在性为触发条件');

  const src = readSrc();
  assert.ok(src.includes('lastNativeSync='), '诊断应含最近原生同步读数');
  assert.ok(src.includes('future='), '诊断应含未来提醒数（scheduled=0 时分辨全部过期 vs 没同步）');
  assert.ok(src.includes("window.__lastNativeSync = 'no-bridge'"), '无桥时 lastNativeSync 应落 no-bridge');
});

// ── G10：扫码依赖进 package.json（CI npm ci 安装链路与 cap sync 拾取）──
test('G10 @capacitor-mlkit/barcode-scanning 依赖声明 + JS 走 Capacitor.Plugins 挂点', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies && pkg.dependencies['@capacitor-mlkit/barcode-scanning'], 'package.json 应声明扫码插件依赖');
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package-lock.json'), 'utf8'));
  assert.ok(lock.packages && lock.packages['node_modules/@capacitor-mlkit/barcode-scanning'], 'package-lock 应锁定扫码插件（CI npm ci 依赖）');
  const src = readSrc();
  assert.ok(src.includes('cap.Plugins && cap.Plugins.BarcodeScanner'), 'JS 应走 Capacitor.Plugins.BarcodeScanner 挂点（v5.55 window.RemBridge 教训：必须按 Capacitor 真实形态）');
  assert.ok(!src.includes("import { BarcodeScanner }"), '单文件无打包器，不得 import npm 包');
});
