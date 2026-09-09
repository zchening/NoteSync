// v7.7.0 单元测试
//   W1-W3 ZWSP 长词断行限域 + 时间串豁免 + 历史毒化自愈（悬浮卡不弹/提醒退化共同根因）
//   W4    对账净化 remSanitize/htmlToRemText（剥 ZWSP + 全角归一）
//   W5-W7 等价集认识 Blink 克隆样式 span（isCloneNoiseSpan，行首编辑假脏/假变更根因）
//   W8    linkify 术后补存守卫（行移动终态必达）
//   W9    扫码入口迁移拓扑 + scanFeedback landing 守卫 + 扫码层 z-index
//   W10-W12 换机备份码：载荷/校验/恢复行为 + landing 一键恢复
//   W13   导出图片回退阶梯静态形态
//   W14   安卓侧：ImgClip 桥注册 / CAMERA 权限 / ML Kit gradle 接线
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH, ZWSP } = require('../helpers');

function freshApp(pageUrl) {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  }, pageUrl);
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor'), localStorage: window.localStorage };
}
function readSrc() { return fs.readFileSync(INDEX_PATH, 'utf8'); }
const ROOT = path.resolve(__dirname, '..', '..');

// ── W1：行内含 ≥15 长词时，时间串不再被 ZWSP 毒化；collectTimeMatches 能解析（悬浮"添加提醒"卡恢复可弹）──
test('W1 长词断行限域：时间串零污染且可被识别', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  editor.innerHTML = '<div>2026-09-15 18:00 明天体检，明早早点送橙子上学+空腹</div>';
  window.linkifyEditor();
  const txt = editor.textContent;
  assert.ok(txt.includes('2026-09-15 18:00'), '时间串必须完整连续（ZWSP 不得侵入）：' + JSON.stringify(txt));
  const expect = new Date(2026, 8, 15, 18, 0).getTime();
  const hits = window.collectTimeMatches(txt);
  assert.ok(hits.some(m => m.at === expect), 'collectTimeMatches 应解析出 2026-9-15 18:00');
});

// ── W2：时间串与长词粘连（T 连接无空格）时，时间子串仍豁免，长词其余部分保留断行 ZWSP ──
test('W2 粘连形态：T 时间子串豁免，长词断行能力不丢', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  editor.innerHTML = '<div>2026-09-15T18:00abcdefghijk-lmnopqrstuvwxyz</div>';
  window.linkifyEditor();
  const txt = editor.textContent;
  assert.ok(txt.includes('2026-09-15T18:00'), '时间子串不得被 ZWSP 拦腰截断：' + JSON.stringify(txt));
  assert.ok(txt.includes('-' + ZWSP), '长词内分隔符后的 ZWSP 断行仍要保留（换行能力不回退）');
});

// ── W3：历史被毒化存量笔记，开页/手术一轮即自愈（手术前 2624 剥 ZWSP，重建不再复发）──
test('W3 历史毒化文本经一轮 linkify 手术自愈', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  editor.innerHTML = '<div>2026-' + ZWSP + '09-' + ZWSP + '15 18:' + ZWSP + '00 明天体检，明早早点送橙子上学+空腹</div>';
  window.linkifyEditor();
  const txt = editor.textContent;
  assert.ok(txt.includes('2026-09-15 18:00'), '旧毒化应被剥净重建：' + JSON.stringify(txt));
});

// ── W4：对账净化口径——htmlToRemText/remSanitize 剥 ZWSP + 全角归一 ──
test('W4 htmlToRemText/remSanitize 净化历史毒化与全角形态', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  assert.strictEqual(window.htmlToRemText('<div>2026-' + ZWSP + '09-15 18:00</div>'), '2026-09-15 18:00', 'htmlToRemText 应剥 ZWSP');
  assert.strictEqual(window.remSanitize('２０２６－０９－１５　18：00'), '2026-09-15　18:00', '全角数字/冒号/横杠归一；全角空格(U+3000)保留');
});

// ── W5：Blink 克隆样式 span（全 inherit/transparent）与裸文本装饰等价（v7.5.1 旧断言反转）──
test('W5 normDecorHtml 拍平克隆噪声 span、保留有实效样式', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const clone = '<div><span style="background-color: transparent; font-family: inherit; color: inherit">你好</span></div>';
  const bare = '<div>你好</div>';
  assert.strictEqual(window.isDecorativelyEqual(clone, bare), true, '克隆噪声 span 应判装饰等价');
  const styled = '<div><span style="color: red">你好</span></div>';
  assert.strictEqual(window.isDecorativelyEqual(styled, bare), false, '有实效样式的 span 绝不拍平');
});

// ── W6：blocksEqual/占位等价同口径（红线13 消费点同步）──
test('W6 normPlaceholderHtml 对克隆噪声 span 同口径透传/拍平', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window } = app;
  const cloneShell = '<div><span style="font-family: inherit"><u class="rem-mark">2026-9-15 19:35</u>　你好</span></div>';
  const bare = '<div><u class="rem-mark">2026-9-15 19:35</u>　你好</div>';
  assert.strictEqual(window.isPlaceholderEqual(cloneShell, bare), true, '克隆 span 包装的提醒壳应与裸壳占位等价');
  const ph = readSrc().match(/function normPlaceholderHtml[\s\S]*?\nfunction isPlaceholderEqual/);
  assert.ok(ph && (ph[0].match(/isCloneNoiseSpan/g) || []).length >= 2, 'isEmptyShell/walk 两处消费点必须走 isCloneNoiseSpan（红线13）');
});

// ── W7：真实空行仍在占位等价中保留（克隆样式放宽不得吞用户空行）──
test('W7 真实空行不吞：回车后终态与无空行版仍不等价', () => {
  const app = freshApp();
  app.dom.window.close();
  const { window } = app;
  const withBlank = '<div><br></div><div><u class="rem-mark">2026-9-15 19:35</u>　你好</div>';
  const noBlank = '<div><u class="rem-mark">2026-9-15 19:35</u>　你好</div>';
  assert.strictEqual(window.isPlaceholderEqual(withBlank, noBlank), false, '真实空行是语义差异，绝不判等');
});

// ── W8：linkify 术后补存守卫在位（终态必达服务器）──
test('W8 linkifyEditor finally 术后补存守卫', () => {
  const src = readSrc();
  const i = src.indexOf('v7.7.0 术后补存');
  assert.ok(i > -1, '应有术后补存注释块');
  const blk = src.slice(i, i + 1400);
  assert.ok(blk.includes('!isDecorativelyEqual(body, lastHtml) && !isPlaceholderEqual(body, lastHtml)'), '三重等价全不认才补存');
  assert.ok(blk.includes('!busy && !pendingRemoteNote && !isComposing'), '安静态守卫齐全');
  assert.ok(blk.includes('isDraftBarHidden()'), '冲突条挂起期不补存');
  assert.ok(blk.includes('RESTORE_GUARD_MS'), '恢复保护窗内不补存');
  assert.ok(blk.includes("setTimeout(() => { saveLocal(takeForceResave()); }, 300)"), '300ms 补挂 saveLocal 且随带 force 意图');
});

// ── W9：扫码入口迁移 + landing 反馈守卫 + 扫码层抬高 ──
test('W9 扫码拓扑与 landing 反馈守卫', () => {
  const src = readSrc();
  assert.ok(src.includes("overlay.style.zIndex = '40'"), '扫码层必须抬到 z40（首页 landing z30 否则盖住）');
  assert.ok(src.includes('function scanFeedback'), 'scanFeedback 统一反馈口在位');
  assert.ok(/w\.textContent === msg/.test(src), 'landingWarn 自动收回带「文案仍是它才清」守卫（红线15）');
  assert.ok(src.includes('id="landingScan"') && src.includes('#landing #landingScan{'), '首页扫码入口 DOM+CSS 在位（变量配色自适应夜间）');
  assert.ok(src.includes("'scanBtn'"), 'scanBtn 应进防焦点抢夺数组');
  assert.ok(src.includes('e.key === \'Enter\' || e.key === \' \''), 'landingScan 键盘可达（Enter/空格）');
});

// ── W10-W12：换机备份码 ──
test('W10 备份载荷：出码形态与前缀', () => {
  const src = readSrc();
  assert.ok(src.includes("const BACKUP_PREFIX = 'notesync-backup:v1:'"), 'BACKUP_PREFIX 常量在位');
  assert.ok(src.includes('btoa(JSON.stringify({ v: 1, f: entries }))'), '载荷=base64(JSON{v,f:[[id,k]…]})');
  assert.ok(src.includes('drawQrTo(cv, bk.payload)'), '备份码复用 drawQrTo 出图');
  assert.ok(src.includes('篇本机无密钥未包含'), '无密钥条目数需在提示中透明');
});
test('W11 applyBackupBundle 行为：合法恢复/非法拒绝/收藏合并', async () => {
  const app = freshApp('http://localhost/mynote'); // 笔记内路径：setStatus 分支，不触发整页导航
  app.dom.window.close.bind(app.dom.window);
  const { window, localStorage } = app;
  const k1 = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const k2 = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const payload = 'notesync-backup:v1:' + Buffer.from(JSON.stringify({ v: 1, f: [['alpha', k1], ['bad id!', k2]] })).toString('base64');
  await window.applyBackupBundle(payload);
  assert.strictEqual(localStorage.getItem('notesync_key_alpha'), k1, '合法条目应写回 KEY_STORE');
  assert.strictEqual(localStorage.getItem('notesync_key_bad id!'), null, '非法 id 条目必须拒绝');
  const favs = JSON.parse(localStorage.getItem('notesync_favs'));
  assert.ok(Array.isArray(favs) && favs.indexOf('alpha') > -1, '收藏清单应合并落库');
  const t3 = Buffer.from(webcrypto.getRandomValues(new Uint8Array(31))).toString('base64'); // 非 32B 坏密钥
  await window.applyBackupBundle('notesync-backup:v1:' + Buffer.from(JSON.stringify({ v: 1, f: [['beta', t3]] })).toString('base64'));
  assert.strictEqual(localStorage.getItem('notesync_key_beta'), null, '长度非法密钥应被拒');
  await window.applyBackupBundle('notesync-backup:v1:not-json!!');
  assert.ok(true, '畸形载荷静默拒绝不抛');
  app.dom.window.close();
});
test('W12 buildBackupPayload 行为：仅收本机有密钥的收藏', async () => {
  const app = freshApp('http://localhost/mynote');
  const { window, localStorage } = app;
  const k = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
  localStorage.setItem('notesync_key_alpha', k);
  localStorage.setItem('notesync_favs', JSON.stringify(['alpha', 'ghost']));
  localStorage.removeItem('notesync_key_ghost'); // 无密钥收藏 → skipped
  const bk = await window.buildBackupPayload();
  assert.ok(bk && bk.payload.startsWith('notesync-backup:v1:'), 'payload 前缀正确');
  assert.strictEqual(bk.count, 1);
  assert.strictEqual(bk.skipped, 1, '无密钥收藏计入 skipped 提示');
  app.dom.window.close();
});

// ── W13：导出图片回退阶梯静态形态 ──
test('W13 导出图片：手势保活+原生桥+分享+预览阶梯在位', () => {
  const src = readSrc();
  assert.ok(src.includes("new ClipboardItem({ 'image/png': blobP })"), '手势窗口内 ClipboardItem 装 Promise');
  assert.ok(src.includes("blobP.catch(() => {})"), 'Promise 需挂空 catch 防 unhandledrejection 污染 pageerror');
  assert.ok(src.includes('new ClipboardItem({ \'image/png\': blob })'), 'Blob 重试兜底（旧内核只认 Blob）');
  assert.ok(src.includes('cap.Plugins.ImgClip'), 'APP 原生桥挂点（每次现读，同 RemBridge 范式）');
  assert.ok(src.includes('navigator.canShare'), '系统分享面板回退');
  assert.ok(src.includes('AbortError'), '分享取消静默收场');
  assert.ok(src.includes('function showImagePreview'), '长按保存预览兜底');
  assert.ok(src.includes('async function renderNotePng'), '渲染拆出 Promise 化');
  assert.ok(!/图片已下载/.test(src), 'WebView 哑弹下载兜底文案退役');
});

// ── W14：安卓侧接线 ──
test('W14 ImgClip 桥注册 + CAMERA 权限 + ML Kit 进 gradle', () => {
  const main = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/MainActivity.java'), 'utf8');
  assert.ok(main.includes('registerPlugin(ImgClipPlugin.class)'), 'MainActivity 显式注册 ImgClipPlugin');
  const plugin = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/img/ImgClipPlugin.kt'), 'utf8');
  assert.ok(plugin.includes('fun copyImage(') && plugin.includes('FileProvider.getUriForFile') && plugin.includes('setPrimaryClip'), '原生桥：base64→FileProvider→ClipboardManager');
  const mani = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(mani.includes('android.permission.CAMERA'), 'CAMERA 权限声明（ML Kit 插件 manifest 为空，app 必须自declare）');
  const settings = fs.readFileSync(path.join(ROOT, 'android/capacitor.settings.gradle'), 'utf8');
  assert.ok(settings.includes('capacitor-mlkit-barcode-scanning'), 'ML Kit 扫码插件已 cap sync 进 gradle（原生扫码路径真正生效）');
});
