// v10.1.0 单元测试：冷启主文档「本地优先 + 接管绕过拦截器的首载 + 原子落盘 + 埋点」回归护栏（十六测）
// A1-A8 主文档本地优先（治「装完第一次打开必等公网」+「同一版白下两遍」）
// B1-B2 冷启接管首载｜C1-C5 冷启埋点（?diag 可验收）｜D1-D2 旧口径禁回潮 + 离线兜底能力守恒
// 原生侧无本机 JDK 可编译：A3/A5 用真实壳字节与版本比较的行为移植做实证，其余按源码契约下钉；CI 编译是终裁。
// 每条都配了「撤掉对应修复必红」的变异台账（见 docs/VERSION_LOG.md v10.1.0 段⑧），不做恒真断言。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..');
const readSrc = () => fs.readFileSync(INDEX_PATH, 'utf8');
const readAndroid = rel => fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', rel), 'utf8');
const MAIN = () => readAndroid('MainActivity.java');
const REM = () => readAndroid(path.join('rem', 'RemPlugin.kt'));
const slice = (s, from, to) => {
  const a = s.indexOf(from);
  assert.ok(a > -1, '锚点缺失：' + from.slice(0, 40));
  const b = to ? s.indexOf(to, a) : s.length;
  assert.ok(b > a, '终点缺失：' + to);
  return s.slice(a, b);
};

// 与 MainActivity.embeddedVersion 等价的字节扫描（校验真实壳字节，非重实现业务）
const MARKER = "const APP_VERSION = '";
function embeddedVersion(b) {
  if (!b || b.length === 0) return null;
  const m = MARKER.length;
  for (let i = 0; i + m < b.length; i++) {
    let hit = true;
    for (let j = 0; j < m; j++) {
      if (b[i + j] !== MARKER.charCodeAt(j)) { hit = false; break; }
    }
    if (!hit) continue;
    const s = i + m;
    let e = s;
    while (e < b.length && e - s < 32 && b[e] !== 39) e++;
    if (e >= b.length || e === s || e - s >= 32) return null;
    return b.slice(s, e).toString('utf8');
  }
  return null;
}
// 与 MainActivity.parseVersion / nsVersionCmp 等价（A5 行为验证用）
function parseVersion(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const parts = s.split('.');
  if (parts.length < 1 || parts.length > 3) return null;
  const out = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.length > 6 || !/^\d+$/.test(p)) return null;
    out[i] = parseInt(p, 10);
  }
  return out;
}
function nsVersionCmp(a, b) {
  const va = parseVersion(a), vb = parseVersion(b);
  if (!va || !vb) return -2;
  for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return va[i] > vb[i] ? 1 : -1;
  return 0;
}

// ── A1：拦截器必须先取本地，且**真的按判据分支**（不能只是把函数调用写在那里）──
test('A1 主文档本地优先：调用顺序 + 真实判据分支（撤成 if(false) 必红）', () => {
  const main = MAIN();
  const call = main.indexOf('byte[] local = localMainDoc();');
  const guard = main.indexOf('if (local != null && local.length > 0) {');
  const bg = main.indexOf('bgRefreshMainDoc(request.getUrl().toString());');
  const ret = main.indexOf('new ByteArrayInputStream(local)', bg);
  const net = main.indexOf('byte[] bytes = fetchMainDoc(request.getUrl().toString(), etagOut);');
  assert.ok(call > -1, '拦截器应调用 localMainDoc()');
  assert.ok(guard > call, '本地命中必须有真判据分支（仅调用不判据＝可被 if(false) 静默回退，首轮变异实测 20/20 假绿）');
  assert.ok(bg > guard && ret > bg, '命中分支内应先触发后台核对再返回本地字节');
  assert.ok(call < net, '本地必须排在同步网络之前——顺序反了就回到「首开必等公网」');
});

// ── A2：归属判定走 HTML 自带版本号，且绝不另存版本戳 ──
test('A2 磁盘缓存归属判定读 HTML 自带 APP_VERSION，不另存版本戳文件', () => {
  const main = MAIN();
  const body = slice(main, 'private byte[] localMainDoc()', '/** v10.1.0 闸 R2-P0 修');
  assert.ok(/nsVersionCmp\(snap\.ver, installedVersionName\(\)\) >= 0/.test(body), '归属判定必须落在 localMainDoc 内');
  assert.ok(!/readSmallText\(MAIN_DOC_VER\)/.test(main), '不得另存版本戳文件（自带版本号已够，且没有写入顺序坑）');
  assert.ok(main.includes('cacheDiskIsCurrentVersion = false;'), '判不可采用时必须显式落 false 再退回内置壳');
});

// ── A3：三份壳逐字节 + 壳内版本号==build.gradle versionName（内置壳=本版的立论前提）──
test('A3 根/www/assets 三壳逐字节一致，自带版本号==安装包 versionName', () => {
  const shells = ['index.html', path.join('www', 'index.html'),
    path.join('android', 'app', 'src', 'main', 'assets', 'public', 'index.html')].map(p => path.join(ROOT, p));
  const bufs = shells.map(p => fs.readFileSync(p));
  for (let i = 1; i < bufs.length; i++) {
    assert.ok(bufs[0].equals(bufs[i]), shells[i] + ' 与根 index.html 字节不一致（cap sync 漏同步，内置壳将吐旧版）');
  }
  const ver = embeddedVersion(bufs[0]);
  assert.equal(ver, '10.1.3', '字节扫描应抠出真实版本号（抠不到＝标记字面漂移，A2/A5 判据会全体失效）');
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  const vn = (gradle.match(/versionName "([^"]+)"/) || [])[1];
  assert.equal(ver, vn, '内置壳自带版本号必须等于安装包 versionName——否则覆盖安装后永远判不中本版');
  let n = 0, i = -1;
  const s = bufs[0].toString('utf8');
  while ((i = s.indexOf(MARKER, i + 1)) >= 0) n++;
  assert.equal(n, 1, 'const APP_VERSION 标记必须全库唯一（多处出现则可能抠到非真身）');
});

// ── A4：后台核对只写盘不回填，带冷却 + 在途去重 + finally 收口 ──
test('A4 后台公网核对只落盘、60s 冷却 + 在途去重、在途旗标 finally 收口', () => {
  const main = MAIN();
  const body = slice(main, 'private void bgRefreshMainDoc(', '/** 当前安装包 versionName');
  assert.ok(/new Thread\(/.test(body), '必须在独立线程跑，绝不占拦截线程/主线程');
  assert.ok(body.includes('bgRefreshing || now - lastBgRefreshAt < 60000'), '应有在途去重 + 60s 冷却');
  assert.ok(body.includes('saveMainDoc(bytes, etagOut[0]);'), '取到新版应连同 etag 一起写盘供下次冷启');
  assert.ok(!/WebResourceResponse/.test(body), '后台核对绝不回填本轮响应——热更新语义正是由此变成「晚一次打开」');
  assert.ok(/fetchMainDoc\(urlStr, etagOut\)/.test(body), '必须复用 fetchMainDoc 的 If-None-Match/304 链路，且 etag 随本次返回值同批次带回');
  assert.ok(/finally\s*\{[^}]*bgRefreshing = false/.test(body), '在途旗标必须 finally 收口（一次意外不能让核对整进程熄火）');
  assert.ok(/catch \(Throwable t\) \{[\s\S]{0,120}bgRefreshing = false/.test(body), 'Thread.start 抛错路径也要收口');
  assert.ok(main.includes('conn.setRequestProperty("If-None-Match", savedEtag)'), '条件请求头不能丢（v9.5.5 成果）');
});

// ── A5：归属判据是「不低于」而非「相等」——纯网页热更通道（闸 R2-P0）──
test('A5 判据「磁盘版本 不低于 安装包版本」，跨版本号网页热更仍可达、旧版必挡', () => {
  const main = MAIN();
  const body = slice(main, 'private byte[] localMainDoc()', '/** v10.1.0 闸 R2-P0 修');
  assert.ok(/nsVersionCmp\(snap\.ver, installedVersionName\(\)\) >= 0/.test(body),
    '调用点必须用 nsVersionCmp(...) >= 0（A5 与 A2 双钉，防只改一处）');
  assert.ok(!/installedVersionName\(\)\.equals\(/.test(main), '判据不得退回 equals（会静默掐断"只发网页不发 APK"的历史主通道）');
  assert.ok(/nsVersionCmp\(String a, String b\)/.test(main) && /if \(va == null \|\| vb == null\) return -2/.test(main),
    '不可解析版本一律返 -2 走安全侧（不采用磁盘）');
  // 行为移植验证：装的是 10.1.0 这台机器，各种磁盘缓存状态该怎么判
  const INSTALLED = '10.1.0';
  assert.ok(nsVersionCmp('10.1.1', INSTALLED) >= 0, '服务器热更到 10.1.1（无新 APK）→ 必须采用，否则更新通道被掐死');
  assert.ok(nsVersionCmp('10.2.0', INSTALLED) >= 0 && nsVersionCmp('11.0.0', INSTALLED) >= 0, '更高 minor/major 同样采用（十位段按数字比）');
  assert.equal(nsVersionCmp('10.1.0', INSTALLED), 0, '同版采用');
  assert.ok(nsVersionCmp('10.0.4', INSTALLED) < 0, '覆盖安装后磁盘躺着上一版 → 必须挡掉、退回内置壳');
  assert.ok(nsVersionCmp('9.99.99', INSTALLED) < 0, '十位段不许按字符串比（"9">"1"）');
  assert.equal(nsVersionCmp('unknown', INSTALLED), -2, '抠不到版本号 → 安全侧不采用');
  assert.equal(nsVersionCmp(null, INSTALLED), -2);
  assert.equal(nsVersionCmp('10.1.0-beta', INSTALLED), -2, '非纯数字段不猜');
});

// ── A6：ETag 与正文同批次传递，且只在原子落盘成功后提交（闸 R1-P1 / R1-P1-2 / R2-P2-4 / 二审-P2）──
test('A6 ETag 随正文同批次传递、仅原子落盘成功才提交；退路直写与失败路径都不提交', () => {
  const main = MAIN();
  const fetch = slice(main, 'private byte[] fetchMainDoc(String urlStr, String[] etagOut)', 'private String readSmallText');
  assert.ok(!fetch.includes('writeSmallText(MAIN_DOC_ETAG'), 'fetchMainDoc 内绝不写 etag（响应头一到就写＝中途被杀留下「新 etag+旧 HTML」恒 304 钉死旧页）');
  assert.ok(fetch.includes('etagOut[0] = et'), 'etag 必须由返回值同批次带回');
  assert.ok(!/fetchedEtag/.test(main), '不得用共享字段暂存 etag——拦截线程与后台核对线程并发会配错对（二审-P2）');
  const save = slice(main, 'private void saveMainDoc(byte[] bytes, String etag)', 'private byte[] readMainDoc()');
  assert.ok(save.includes('synchronized (DOC_LOCK)'), '整个落盘须持锁：两线程并发会互踩同名 .tmp');
  assert.ok(save.includes('MAIN_DOC_CACHE + ".tmp"') && save.includes('getFD().sync()'), '必须 tmp + fsync + rename');
  const rename = save.indexOf('renameTo(dst)');
  const etagCommit = save.indexOf('writeSmallText(MAIN_DOC_ETAG');
  assert.ok(rename > -1 && etagCommit > rename, '顺序铁律：原子改名成功后才提交 etag');
  assert.ok(/if \(atomicOk && etag != null/.test(save), 'rename 失败的退路直写绝不提交 etag（否则等于把刚杀死的死法从退路复活）');
  assert.ok(save.indexOf('if (!written) return;') < etagCommit, '两种写法都失败必须直接返回');
  assert.ok(save.indexOf('sDiskBytes = bytes') > etagCommit, '读缓存最后更新，失败路径不进缓存');
  assert.equal(main.split('saveMainDoc(bytes, etagOut[0])').length - 1, 2, '两处调用点（网络兜底 + 后台核对）都必须把 etag 一起传下去');
});

// ── A7：读盘放大治理（内置壳常驻 + 磁盘按 stat 复用 + 字节与版本号成对取）──
test('A7 内置壳常驻、磁盘按 (长度,mtime) 复用且字节与版本号成对返回', () => {
  const main = MAIN();
  const asset = slice(main, 'private byte[] assetMainDocCached()', '/** 磁盘缓存快照');
  assert.ok(asset.includes('if (sAssetTried) return sAssetBytes;'), '内置壳进程内不可变 → 读过即常驻，不再重读');
  const snap = slice(main, 'private DiskSnap diskMainDocSnapshot()', '/** 只记本轮冷启的第一次主文档供给');
  assert.ok(snap.includes('sDiskLen == len && sDiskMtime == mt'), '磁盘侧以 (长度,mtime) 为键复用');
  assert.ok(snap.indexOf('readMainDoc()') > snap.indexOf('sDiskLen == len'), '键未变则不重读');
  assert.equal(snap.split('return new DiskSnap(').length - 1, 2, '缓存命中与冷取两条路径都要成对返回字节+版本号');
  assert.ok(!/private String cachedDiskVersion\(\)/.test(main), '分两次取锁的旧写法已废（中间换盘会"判据用新版、吐旧字节"）');
  assert.ok(/synchronized \(DOC_LOCK\)/.test(main), '缓存读写须挂同一把锁');
});

// ── A8：本地命中路径不产生任何同步公网等待（D1 的行为面补强，两条独立钉）──
test('A8 版本比较与解析函数不得触网/触盘（纯函数）', () => {
  const main = MAIN();
  const body = slice(main, 'private static int nsVersionCmp', '/** 三段式数字版本解析');
  assert.ok(!/getFilesDir|openFile|HttpURL|getAssets/.test(body), '判据必须是纯函数，便于离线推理与测试');
  const pv = slice(main, 'private static int[] parseVersion', '/* v10.1.0 闸 R2-P2 修');
  assert.ok(!/getFilesDir|HttpURL/.test(pv), '解析同样纯函数');
  assert.ok(/parts\.length > 3\) return null/.test(pv), '段数异常一律拒绝，不猜');
});

// ── B1：绕过拦截器的首载被当场接管，且进程内只一次、本地无货不接管 ──
test('B1 冷启接管首载（判据锚调用点，置位先于 stopLoading）', () => {
  const main = MAIN();
  const guard = main.indexOf('if (!didBootInterceptorReload && localMainDocAvailable())');
  assert.ok(guard > -1, '必须是「进程内一次 + 本地有货」双条件的调用点判据（只判方法存在＝防不住条件回退）');
  const set = main.indexOf('didBootInterceptorReload = true;');
  const stop = main.indexOf('wv.stopLoading();');
  const load = main.indexOf('wv.loadUrl(bootStart)');
  assert.ok(set > guard && stop > set && load > stop, '顺序：置位 → stopLoading → 重新 loadUrl（防循环语义）');
  assert.ok(main.includes('else wv.reload();'), 'appUrl 取不到时应退回 reload 兜底');
  assert.ok(!/boolean didCacheBootstrapReload/.test(main), '旧 v5.57 旗标声明不得残留（半改＝两套接管并存）');
});

// ── B2：接管判定保持轻量，绝不在主线程 onCreate 读整包 HTML ──
test('B2 localMainDocAvailable 只做 stat 级判断（不主线程读 844KB、不抠版本号）', () => {
  const main = MAIN();
  const body = slice(main, 'private boolean localMainDocAvailable()', '/** v10.1.0 A：抠 HTML');
  assert.ok(!/readMainDoc\(\)/.test(body), '不得读磁盘 HTML（onCreate 主线程 I/O）');
  assert.ok(!/embeddedVersion\(/.test(body), '不得抠版本号——那活归拦截线程的 localMainDoc');
  assert.ok(body.includes('MAIN_DOC_CACHE).exists()') || body.includes('getAssets().open("public/index.html")'), '只该做存在性/stat 级判断');
});

// ── C1：埋点基准必须是 onCreate 第一条语句 ──
test('C1 bootT0 为 onCreate 首条语句', () => {
  const main = MAIN();
  const onCreate = main.indexOf('public void onCreate(Bundle savedInstanceState) {');
  const t0 = main.indexOf('bootT0 = android.os.SystemClock.elapsedRealtime();');
  assert.ok(onCreate > -1 && t0 > onCreate && t0 - onCreate < 90, '基准被注释挤到后面＝前面几段耗时全丢');
});

// ── C2：落地/掀幕只记本轮首次 ──
test('C2 pageDone/curtain/serve 三处幂等只记本轮首次', () => {
  const main = MAIN();
  assert.ok(/if \(MainActivity\.bootPageDoneAt == 0\)/.test(main), 'pageDone 只记首次，后续导航不得覆写');
  assert.ok(/if \(MainActivity\.bootCurtainAt == 0\)/.test(main), 'curtain 同理（掀幕幂等会被多次调用）');
  assert.ok(/private void markBootBytes\(int n\) \{\s*if \(bootServeAt == 0\)/.test(main), 'serve/bytes 走同一把首次守卫');
  assert.ok(!/mainDocBytes = (local|fresh|bytes|cached|asset)\.length;/.test(main), '不得再有绕过 markBootBytes 的裸赋值');
});

// ── C3：cacheInfo 透传 + ?diag 渲染存在（旧 APK 降级见 C5）──
test('C3 cacheInfo 九字段透传 + index.html 有 boot 行', () => {
  const kt = REM();
  ['mainDocSrc', 'mainDocBytes', 'bootServeAt', 'bootPageDoneAt', 'bootCurtainAt', 'bootBgRefreshMs',
    'bgRefresh', 'bootReload', 'diskVerOk'].forEach(k => {
    assert.ok(kt.includes('"' + k + '"'), 'RemPlugin.cacheInfo 应透传 ' + k);
  });
  const src = readSrc();
  assert.ok(src.includes("L.push('boot: serve='"), '?diag 应新增 boot 行');
  assert.ok(src.includes("boot: ERR"), 'boot 行须自带 try/catch 兜底，新字段异常不得带崩整页诊断');
});

// ── C4：整组读数随基准同刻归零（闸 R2-P1）──
test('C4 onCreate 归零整组埋点读数，recreate 后不混发上一轮数字', () => {
  const main = MAIN();
  const t0 = main.indexOf('bootT0 = android.os.SystemClock.elapsedRealtime();');
  const block = main.slice(t0, t0 + 1200);
  ['bootServeAt', 'bootPageDoneAt', 'bootCurtainAt', 'bootBgRefreshMs', 'mainDocBytes',
    'mainDocSrc', 'bgRefreshResult', 'bootInterceptorReload', 'cacheDiskIsCurrentVersion'].forEach(f => {
    assert.ok(new RegExp(f + ' = (0|"none"|false);').test(block), f + ' 必须与 bootT0 同刻归零，否则 ==0 幂等守卫永不更新');
  });
});

// ── C5：?diag 字段统一 sv() 口径（闸 R2-P2/R3-P2 双路命中）──
test('C5 旧 APK 缺字段一律落 ?，布尔出 yes/no，绝不上屏 undefined', () => {
  const src = readSrc();
  const seg = slice(src, "L.push('boot: serve='", "if (rb && typeof rb.cacheInfo === 'function')");
  assert.ok(!/undefined/.test(seg), 'boot 行不得出现字面 undefined');
  ['mainDocSrc', 'diskVerOk', 'bgRefresh'].forEach(f => {
    assert.ok(seg.includes('sv(ci && ci.' + f + ')'), f + ' 必须经 sv() 归一（旧 APK 上是 undefined，直连拼接会打上屏）');
  });
  assert.ok(/const sv = v =>/.test(src), 'sv() 统一口径助手应在位');
  assert.ok(/typeof v === 'boolean'/.test(src), '布尔不得被 || 吞成 ?（no 与"没有该字段"是两回事）');
  assert.ok(!/\(ci \? ci\.(mainDocSrc|diskVerOk|bgRefresh) : '\?'\)/.test(src), '旧的三元直连写法已作废');
});

// ── D1：本地命中后不得再出现同步公网等待（禁回潮）──
test('D1 本地命中分支内不得出现同步 fetchMainDoc', () => {
  const main = MAIN();
  const a = main.indexOf('byte[] local = localMainDoc();');
  const seg = main.slice(a, main.indexOf('// 本地彻底无货'));
  assert.ok(seg.includes('if (local != null && local.length > 0)'), '判据在（与 A1 同一锚，撤修复必红两处）');
  assert.ok(seg.includes('return new WebResourceResponse'), '命中即返回本地字节');
  assert.ok(!/fetchMainDoc/.test(seg.replace(/bgRefreshMainDoc/g, '')), '命中分支内不得出现同步 fetchMainDoc（bgRefresh 已剔除）');
});

// ── D2：离线兜底三级能力守恒（v5.55/v5.56 成果不得被 A 段削弱）──
test('D2 断网/失败仍走 磁盘→内置壳 三级兜底，同源白名单与错误掀幕在位', () => {
  const main = MAIN();
  assert.ok(main.includes('private byte[] readAssetMainDoc()'), '内置壳末级兜底函数保留');
  assert.ok(main.includes('fetchFailCount++;'), '同步链路失败计数保留（?diag 口径）');
  const order = [main.indexOf('byte[] bytes = fetchMainDoc(request.getUrl().toString(), etagOut);'),
    main.indexOf('byte[] cached = readMainDoc();'),
    main.indexOf('byte[] asset = assetMainDocCached();')];
  assert.ok(order[0] > -1 && order[0] < order[1] && order[1] < order[2], '兜底顺序仍为 联网 → 磁盘 → 内置壳');
  assert.ok(main.includes('"note.xuyinji.com.cn".equals(host) || "biji.xuyinji.com.cn".equals(host)'),
    '同源白名单不得放宽（v8.1.0：否则外站整页会被当笔记主页缓存）');
  assert.ok(main.includes('if (request.isForMainFrame())'), 'onReceivedError 主帧掀幕兜底在位（v9.5.6）');
});
