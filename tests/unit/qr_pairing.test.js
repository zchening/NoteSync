// NoteSync 单元测试（jsdom 加载真实 index.html）
// v5.20 二维码配对（快速档）静态层：
//   Q1 b64ToUrlSafe/urlSafeToB64 全字节往返 + URL-safe 字符集约束
//   Q2 parsePairingKey 合法/非法 hash 解析
//   Q3 配对弹层 DOM 结构齐全且默认隐藏
//   Q4 内联二维码库可用（真实配对 URL 能生成模块矩阵）
//   Q5 版本号 5.27
//   Q6/Q7/Q8 v5.27 生产主站短链 + biji 直出分支（源断言）+ 本地分支直连（jsdom 功能）
// 真实解锁链路（导入密钥→解密→进入编辑器）由 Playwright 探针 _probe_qr_pairing.js 覆盖。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

const dom = loadApp();
const { window } = dom;
const document = window.document;

after(() => { try { window.close(); } catch (e) {} });

// ── Q1：URL-safe base64 往返 ──────────────────────────────
test('b64ToUrlSafe/urlSafeToB64 全字节往返一致', () => {
  for (const len of [1, 2, 3, 16, 32, 33, 64]) {
    for (let round = 0; round < 20; round++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + round * 91 + len * 13) & 0xff;
      const b64 = Buffer.from(bytes).toString('base64');
      const safe = window.b64ToUrlSafe(b64);
      assert.ok(!/[+/=]/.test(safe), 'URL-safe 变体不应含 + / =：' + safe);
      assert.strictEqual(window.urlSafeToB64(safe), b64, '往返应还原 len=' + len + ' round=' + round);
    }
  }
});

test('urlSafeToB64 正确补齐 = 填充', () => {
  // "n+/" base64 -> safe "n-_"; 长度 3 -> 补一个 '='
  assert.strictEqual(window.urlSafeToB64('n-_'), 'n+/=');
  // 长度恰为 4 的倍数时不补
  assert.strictEqual(window.urlSafeToB64('YWJj'), 'YWJj');
});

// ── Q2：parsePairingKey 解析 ──────────────────────────────
test('parsePairingKey 从 #k= 解析并还原标准 base64', () => {
  const b64 = Buffer.from('0123456789abcdef0123456789abcdef', 'binary').toString('base64');
  window.location.hash = '#k=' + window.b64ToUrlSafe(b64);
  assert.strictEqual(window.parsePairingKey(), b64);
});

test('parsePairingKey 非法输入一律返回 null', () => {
  const cases = ['', '#', '#k=', '#k=abc+def', '#k=abc/def', '#k=abc=', '#x=abc', '#k=abc&junk', '#k=中文'];
  for (const h of cases) {
    window.location.hash = h;
    assert.strictEqual(window.parsePairingKey(), null, 'hash=' + JSON.stringify(h) + ' 应返回 null');
  }
  window.location.hash = '';
});

// ── Q3：配对弹层 DOM 结构 ──────────────────────────────
test('二维码配对弹层结构齐全且默认隐藏（v5.21：无配对链接行）', () => {
  assert.ok(document.getElementById('qrBtn'), '顶栏应有 qrBtn');
  const m = document.getElementById('qrMask');
  assert.ok(m, '应有 qrMask 弹层');
  assert.ok(m.classList.contains('hidden'), '弹层默认应隐藏');
  assert.ok(document.getElementById('qrHolder'), '应有二维码容器');
  assert.ok(!document.getElementById('qrUrl'), 'v5.21 已移除配对链接展示行');
  assert.ok(document.getElementById('qrClose'), '应有关闭按钮');
});

test('v5.21 状态区在底栏（顶栏无状态）', () => {
  const foot = document.getElementById('foot');
  assert.ok(foot.contains(document.getElementById('status')), '状态圆点应在底栏');
  assert.ok(foot.contains(document.getElementById('statustext')), '状态文字应在底栏');
  assert.ok(!document.querySelector('header .status'), '顶栏不应再有状态区');
});

// ── Q4：内联二维码库 ──────────────────────────────
test('内联 qrcode 库可为真实配对 URL 生成模块矩阵', () => {
  assert.strictEqual(typeof window.qrcode, 'function', 'qrcode-generator 应挂到 window');
  const url = 'https://note.example.com/zhangsan#k=' + window.b64ToUrlSafe(Buffer.alloc(32, 7).toString('base64'));
  const qr = window.qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  assert.ok(n >= 33 && n <= 61, '模块数应在合理区间（version 5~11），实际 ' + n);
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
  assert.ok(dark > n * n * 0.2 && dark < n * n * 0.8, '明暗模块比例应正常（防止空/全黑渲染）');
});

// ── Q5：版本号 ──────────────────────────────
test('APP_VERSION 为 8.1.4', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  assert.ok(src.includes("const APP_VERSION = '8.1.4';"), 'index.html 应声明 APP_VERSION = 8.1.4');
});

// ── Q5c：v8.1.4 无 GMS 机型扫码回退链守护（锚补丁行，防回潮）──
test('v8.1.4 doScanAndOpen：无 GMS/原生异常回退网页扫码层，旧静默 catch 退役', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  // 先探谷歌扫码模块可用性并按 available 判定（无 GMS → 不走原生取景框）
  assert.ok(src.includes('isGoogleBarcodeScannerModuleAvailable'), '应先探 bs.isGoogleBarcodeScannerModuleAvailable 可用性');
  assert.ok(src.includes('av.available'), '应按 available 字段判定可用性');
  // 回退到自写网页扫码层（免 GMS）：无 GMS 分支 + 原生异常 catch 分支，共 ≥2 处
  assert.ok((src.match(/await scanWithWebCamera\(\)/g) || []).length >= 2, '应有≥2处回退到 scanWithWebCamera');
  // 用户主动取消仍静默；相机权限被拒单独提示（不再一律静默）
  assert.ok(src.includes('if (/cancel/i.test(msg)) return;'), '用户取消应显式保持静默 return');
  assert.ok(src.includes("if (/permission denied|denied access to camera/i.test(msg))"), '权限拒应单独提示（匹配真实串 User denied access to camera）');
  // 防回潮：旧的「catch 里直接 return 吞掉所有原生异常」＝无 GMS 机型点了没反应的根因，必须消失
  assert.ok(!src.includes('/* 用户取消扫码/相机关闭等，静默 */'), '旧静默 catch 注释应已退役');
});

// ── Q5d：v8.1.4 扫码出帧前占位舞台守护（锚补丁行，防回潮播放三角）──
test('v8.1.4 scanWithWebCamera：video 出帧前隐藏 + 常驻取景框 + 占位，旧裸 video 样式退役', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  // video 初始隐藏（避免空窗期系统默认播放三角）
  assert.ok(src.includes('object-fit:cover;visibility:hidden'), 'video 应初始 visibility:hidden');
  // 占位舞台：金色取景框扫描线 keyframes（唯一名，非已退役 spin）+ 文案（锚代码唯一串，注释里是「…」不命中）
  assert.ok(src.includes('scanSweep') && src.includes('scanStageCss'), '应注入 scanSweep 扫描线动画与一次性 stage 样式');
  assert.ok(src.includes('正在开启相机<span'), '出帧前应显示「正在开启相机…」占位');
  // 出帧后显形：多事件 + 幂等 + 定时兜底（防某些 WebView 事件不发导致永久黑屏）
  assert.ok(src.includes("video.addEventListener('loadedmetadata', revealScan)"), 'loadedmetadata 应触发显形');
  assert.ok(src.includes("video.addEventListener('playing', revealScan)"), 'playing 应触发显形');
  assert.ok(src.includes('if (scanRevealed) return'), 'revealScan 应幂等');
  assert.ok(src.includes('setTimeout(revealScan, 2500)'), '应有 2.5s 定时兜底强制显形');
  // 取景框常驻（reveal 只移除 loading，不移除 reticle）
  assert.ok(src.includes('if (loading.parentNode) loading.remove()') && !src.includes('reticle.remove()'), '出帧后取景框应常驻，仅移除占位文案');
  // 防回潮：旧的裸 video 内联样式（会闪默认播放三角）必须消失
  assert.ok(!src.includes('width:100%;max-height:46vh;background:#000;border-radius:12px;object-fit:cover'), '旧裸 video 样式应已退役');
});

// ── Q5b：v5.48 键盘视口策略（Chrome 安卓菜单栏被顶飞修复）──
test('v5.48 viewport meta 声明 interactive-widget=resizes-content', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  const META = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content">';
  assert.ok(src.includes(META), 'viewport meta 必须包含 interactive-widget=resizes-content（键盘弹出时压缩布局视口，header 不再被顶出屏幕）');
  assert.ok(!src.includes('user-scalable=no">'), '旧 viewport 形态（无 interactive-widget）不应残留');
});

// ── Q6：v5.26 生产配对二维码走主站 302 短链 ──────────────────────────────
test('v5.27 生产分支走主站短链，且不再硬编码 bridge 中转 URL', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  // 生产分支：可信主站短链 + 片段密钥
  assert.ok(src.includes("'https://xuyinji.com.cn/note/'"), '生产配对链接应以主站 /note/ 短链为基底');
  assert.ok(src.includes("location.hostname === 'note.xuyinji.com.cn'"), '短链分支应仅在生产域名启用（本地/自建直连，不影响探针与自部署）');
  // 密钥仍以 #k= 片段传递（片段不发往服务器，302 后由浏览器拼回）
  assert.ok(/'https:\/\/xuyinji\.com\.cn\/note\/' \+ encodeURIComponent\(noteId\) \+ '#k=' \+ b64ToUrlSafe\(b64\)/.test(src), '短链分支应以 #k= 片段携带密钥');
  // v5.23 的 bridge 中转常量应从配对链接构造中移除（bridge.html 文件与路由保留，兼容旧码）
  assert.ok(!src.includes("'https://note.xuyinji.com.cn/bridge.html'"), 'buildPairingUrl 不应再指向 bridge.html 中转页');
});

test('v5.27 本地分支（jsdom 下）仍生成当前源的直连配对链接', () => {
  const b64 = Buffer.alloc(32, 9).toString('base64');
  window.localStorage.setItem('notesync_key_', b64); // jsdom url=http://localhost/ → noteId 为空
  const url = window.buildPairingUrl();
  assert.match(url, /^http:\/\/localhost\/#k=[A-Za-z0-9_-]+$/, '非生产域名应直连当前源：' + url);
  assert.strictEqual(window.urlSafeToB64(url.split('#k=')[1]), b64, '密钥往返应无损');
  window.localStorage.removeItem('notesync_key_');
});

// ── Q8：v5.27 biji 并行可信域直出分支 ──────────────────────────────
test('v5.27 biji 域直出自身域名（无中转），与 note 分支并列', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  assert.ok(src.includes("location.hostname === 'biji.xuyinji.com.cn'"), 'biji 分支应在 buildPairingUrl 中显式声明');
  assert.ok(/'https:\/\/biji\.xuyinji\.com\.cn\/' \+ encodeURIComponent\(noteId\) \+ '#k=' \+ b64ToUrlSafe\(b64\)/.test(src), 'biji 分支应直出 biji.xuyinji.com.cn/<id>#k=...（无中转）');
});

// ── Q9：v7.5.1 去掉二维码 60 秒自动隐藏 ──────────────────
test('v7.5.1 去掉二维码 60 秒自动隐藏', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  assert.ok(!src.includes('setTimeout(resetQrHolder, 60000)'), 'revealQr 的 60s 自动隐藏应移除（弹窗开着码常驻，仅关闭才清）');
});

// ── Q10：v7.5.1 点码全屏放大（纯白、压于遮罩上、点任意处收回）──
test('v7.5.1 配对码点按全屏放大', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  assert.ok(src.includes("cv.addEventListener('click', () => showQrLarge(url))"), '弹窗码应绑定点击→全屏放大');
  assert.ok(src.includes('function showQrLarge(') && src.includes('function hideQrLarge('), '应有 showQrLarge/hideQrLarge');
  assert.ok(/#qrLarge\{[^}]*z-index:300[^}]*background:#fff/.test(src), '放大层应全屏纯白、z-index 高于遮罩(10) 压在弹窗之上');
  assert.ok(src.includes("el.addEventListener('click', hideQrLarge)"), '点放大层任意处应收回原弹窗');
});

// ── Q11：v7.5.1 静默 wakeLock（特性检测 + 开申请/关释放 + 零用户可见提示）──
test('v7.5.1 配对期间静默屏幕常亮且无界面提示', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('../helpers').INDEX_PATH, 'utf8');
  assert.ok(src.includes("if (!('wakeLock' in navigator) || !navigator.wakeLock || !navigator.wakeLock.request) return;"), 'wakeLock 必须特性检测，不支持即静默跳过');
  assert.ok(/revealQr\(\);\s*\n\s*acquireQrWakeLock\(\);/.test(src), '打开配对弹窗（解锁态）应申请常亮');
  assert.ok(src.includes('hideQrLarge(); releaseQrWakeLock(); resetQrHolder();'), '关闭配对应释放常亮并收回放大层');
  assert.ok(!src.includes('已保持常亮') && !/showUploadStatus\([^)]*常亮/.test(src) && !/setStatus\([^)]*常亮/.test(src), '不得向用户展示任何“屏幕常亮/防熄屏”类提示文案');
});
