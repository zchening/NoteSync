// v9.5.5 守护：启动全白/全黑+加载中挂死三批根治——
// 网页：head 主题预应用+原生冷启自动跳上提、配对/poll 超时+重入闸、心跳、startSync 前提、sw 网络超时；
// 服务端：SPA ETag/304、/stream 429 头序、Caddy h1+h2；原生：首载 watchdog、心跳探活 reload、背景预置、二次死亡 toast。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ACT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/MainActivity.java'), 'utf8');
const CAD = fs.readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8');

test('v9.5.5 网页①：head 主题预应用在位、常量与主脚本逐字一致、applyTheme 接管即摘', () => {
  assert.ok(SRC.includes("s.id='ns-boot-theme'"), 'head boot 样式注入在位');
  assert.ok(SRC.includes('mm<420||mm>=1140'), 'head 时间规则 420/1140');
  assert.ok(SRC.includes('const THEME_DAY_START = 7 * 60;') && SRC.includes('const THEME_NIGHT_START = 19 * 60;'), '主脚本常量未动（420/1140 同源）');
  assert.ok(SRC.includes("getElementById('ns-boot-theme'); if (bt) bt.remove();"), 'applyTheme 首帧后摘 boot 样式');
  const iBoot = SRC.indexOf('ns-boot-theme');
  const iStyle = SRC.indexOf('<style>');
  assert.ok(iBoot > 0 && iBoot < iStyle, 'boot 脚本必须先于主样式表（首帧前生效）');
});

test('v9.5.5 网页②：head 原生冷启自动跳，字面量与主脚本 init 对齐', () => {
  assert.ok(SRC.includes("sessionStorage.getItem('notesync_jumped')") && SRC.includes("localStorage.getItem('notesync_last_note')"), 'head 用同一 storage 键');
  assert.ok(SRC.includes('if(isFinite(t)&&age>=0&&age<120000) return;'), 'head 跳转窗口 120s 与 JUMP_WINDOW_MS 一致（age 语义同 init）');
  assert.ok(SRC.includes('const NOTE_LAST_KEY = \'notesync_last_note\';') && SRC.includes('const NOTE_JUMPED_KEY = \'notesync_jumped\';'), '主脚本键名未漂移');
  const iHead = SRC.indexOf("location.assign('/'+encodeURIComponent(last))");
  const iInit = SRC.indexOf('markJumped();');
  assert.ok(iHead > 0 && iHead < iInit, 'head 跳转在 init 之前');
});

test('v9.5.5 网页③：#k= 配对超时、poll 12s 超时（无重入闸）、心跳、startSync 先于 loadReminder', () => {
  assert.ok(SRC.includes('try { note = await withTimeout(apiGet(), 8000); }'), '配对入口 8s 超时');
  assert.ok(SRC.includes('await withTimeout(apiGet(), 12000);'), 'poll 12s 超时');
  assert.ok(!SRC.includes('pollInFlight'), 'poll 无在途重入闸（会误伤 startSync 首 poll 与紧随合法 poll，破坏冲突检测）');
  assert.ok(SRC.includes('window.__nsBeat'), 'JS 心跳在位（原生探活契约）');
  assert.strictEqual((SRC.match(/window\.__nsBeat = Date\.now\(\); setInterval/g) || []).length, 1, '心跳顶层初始化唯一（闸 R2-P1：曾只挂 init 自动解锁路径，手动解锁无心跳恒判死页）');
  assert.ok(SRC.indexOf('window.__nsBeat = Date.now(); setInterval') < SRC.indexOf('function apiPut'), '心跳在主脚本顶层（apiPut 之前），不依赖任何解锁路径');
  const iSync = SRC.indexOf('startSync(); // v9.5.5');
  const iRem = SRC.indexOf('await loadReminder(note, cryptoKey); // v5.56');
  assert.ok(iSync > 0 && iRem > iSync, 'startSync 先于 loadReminder（提醒挂起不再挡同步启动）');
});

test('v9.5.5 网页④：sw.js 两条网络分支 10s AbortController 超时', () => {
  assert.ok(SW.includes('function fetchTO(req, ms)') && SW.includes('c.abort()'), 'SW fetchTO 助手在位');
  assert.ok((SW.match(/fetchTO\(e\.request, 10000\)/g) || []).length === 2, '两条网络分支都包超时');
});

test('v9.5.5 服务端⑥⑦：SPA ETag/304+no-cache、/stream 上限检查先于 writeHead、Caddy 摘 no-store 且 h2 缓行', () => {
  assert.ok(SRV.includes("req.headers['if-none-match']") && SRV.includes('res.writeHead(304'), 'SPA 条件请求 304');
  assert.ok(SRV.includes("'Cache-Control': 'no-cache', 'ETag': ieTag"), '200 带 ETag 且 no-cache（不再 no-store 全量重下）');
  const i429 = SRV.indexOf('sseActive >= MAX_SSE');
  const iHead = SRV.indexOf("'text/event-stream'");
  assert.ok(i429 > 0 && i429 < iHead, '429 上限检查在 writeHead(SSE) 之前（ERR_HTTP_HEADERS_SENT 修复）');
  // 闸 R1 考古：v3.3 提交明言 protocols h1 是「fixes HTTP/2+SSE issues」刻意降级 → h2 缓行留专项
  assert.ok(CAD.includes('protocols h1') && !CAD.includes('protocols h1 h2'), 'Caddy 保持 h1（h2 缓行，历史决策不空手翻）');
  assert.ok(CAD.includes('h2 留专项'), '缓行注记在位');
  assert.ok((CAD.match(/header @html Cache-Control "no-cache" # v9\.5\.5/g) || []).length === 2, 'note/biji 两站 @html 摘 no-store→no-cache（放行源站 ETag 复访）');
});

test('v9.5.5 原生⑧⑨⑩⑪：首载 watchdog、心跳探活 reload、背景预置、二次死亡 toast', () => {
  assert.ok(ACT.includes('private volatile boolean mainFrameDone'), 'mainFrameDone 标志');
  assert.ok(ACT.includes('public void onPageFinished(WebView view, String url)'), 'onPageFinished 维护标志');
  assert.ok(ACT.includes('}, 6000);') && ACT.includes('wvBoot.stopLoading();'), '首载 watchdog 6s 重走拦截器');
  assert.ok(ACT.includes('String(Date.now()-(window.__nsBeat||0))') && ACT.includes('gap > 15000'), 'onResume 心跳探活（只 reload 真死页）');
  assert.ok(ACT.includes('wv.setBackgroundColor(bootNight ? 0xFF0F0F11 : 0xFFFBFBF8);'), 'WebView 背景按时间规则预置');
  assert.ok(ACT.includes('界面渲染异常，请重新打开'), '二次渲染死亡 toast 不静默闪退');
  assert.ok(ACT.includes('Toast.makeText(MainActivity.this'), 'Toast 的 Context 必须限定 MainActivity.this（匿名 client 内裸 this 指 client，CI 编译终裁）');
  assert.ok(ACT.includes('!isFinishing() && !isDestroyed()') && !ACT.includes('wvResume.isFinishing()'), '探活回调用 Activity 级 isFinishing/isDestroyed（WebView 无此方法）');
  // 闸 R1/R2-P1：ETag 必须落到 App 链路——拦截器自抓 fetchMainDoc 带条件头，304 吐磁盘缓存
  assert.ok(ACT.includes('private static final String MAIN_DOC_ETAG'), 'ETag 存文常量在位');
  assert.ok(ACT.includes('setRequestProperty("If-None-Match", savedEtag)'), 'fetchMainDoc 带 If-None-Match');
  assert.ok(ACT.includes('if (code == 304) return new byte[0];'), '304 空数组信号');
  assert.ok(ACT.includes('bytes != null && bytes.length == 0'), '拦截器调用方处理 304→磁盘缓存且不计 fetchFail');
});
