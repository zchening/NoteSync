// v10.1.8 单元测试：扫码路线简化 + 折叠与删除线互不干扰
//   V1  折叠标题加删除线：折叠结构与展开/收起状态都不变（整行全选，把 [折叠] 一起圈进去）
//   V2  取消删除线：回到干净形态、结构与状态同样不变
//   V3  历史脏数据 <s>[折叠]</s> 要被认回把手（这条救的是已经同步到服务端的坏 HTML）
//   V4  无谷歌服务 → 直接页面扫码（不再走原生预览，也不再三层接力）
//   V5  有谷歌服务 → 仍然走原生弹窗（最快的那条路不许丢）
//   V6  〔从相册选二维码〕〔复制原因〕已退役：按钮与两条实现都不许再现
//   V7  相机起不来 → 立即收口（不许留浮层枯等，也不许把下一次扫码锁住）
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const ZWS = /[\u200B\u200C\uFEFF\u2060]/g;

function app0(pageUrl) {
  const dom = loadApp(w => {
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
    // jsdom 不真拉外部脚本，/jsQR.js 的 <script> 永远不触发 onload/onerror → loadJsQR 的 Promise 会挂着不 resolve，
    // 页面解码层一进去就卡死。这里直接把解码器打成「永远解不出」，测试只关心走的是哪条路。
    try { Object.defineProperty(w, 'jsQR', { value: () => null, configurable: true, writable: true }); } catch (e) { w.jsQR = () => null; }
  }, pageUrl || 'http://localhost/');
  return { dom, w: dom.window, ed: dom.window.document.getElementById('editor') };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function blocks(w) { return Array.prototype.slice.call(w.document.getElementById('editor').children); }
function handles(w) { return blocks(w).filter(b => b.classList.contains('ns-fold')); }
function states(w) { return handles(w).map(h => h.classList.contains('ns-fold-open') ? '展开' : '收起'); }
function selectAll(w, block) {
  const r = w.document.createRange();
  r.selectNodeContents(block);
  const sel = w.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  w.document.dispatchEvent(new w.Event('selectionchange'));
}

/* ── V1 整行全选加删除线：手不能抖、态不能变 ───────────────────────── */
test('V1 折叠标题加删除线：折叠结构不变、展开/收起状态不变、[折叠] 不被划线', t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  w.localStorage.setItem('notesync_fold_open', JSON.stringify({ '': [1] })); // 第 2 处折叠设为展开
  ed.innerHTML = '<div>[折叠]标题A</div><div>正文A</div><div>[折叠]标题B</div><div>正文B</div>';
  w.applyFolds();
  assert.strictEqual(handles(w).length, 2, '前置：两处把手');
  assert.deepStrictEqual(states(w), ['收起', '展开'], '前置：第 1 处收起、第 2 处展开');

  selectAll(w, handles(w)[1]);
  w.applyStrike();

  assert.strictEqual(handles(w).length, 2, '加完删除线把手不许少一个（少一个＝其后所有折叠序号集体前移，状态全错位）');
  assert.deepStrictEqual(states(w), ['收起', '展开'], '加完删除线展开/收起状态必须原样');
  const b = blocks(w)[2];
  assert.ok(/<span class="ns-fold-mark">\[折叠\]<\/span>/.test(b.innerHTML), '行首 [折叠] 必须仍是干净的 mark span，没被 <s> 咬住');
  assert.ok(/<s>标题B<\/s>/.test(b.innerHTML), '划线只该落在真正的标题文字上');
  assert.ok(!/<s>\[折叠\]/.test(ed.innerHTML), '[折叠] 是控制标记不是正文，绝不能出现在删除线里');
  assert.strictEqual(ed.textContent, '[折叠]标题A正文A[折叠]标题B正文B', '全文不许丢字');
});

/* ── V2 取消删除线：回得去，而且不能留下空壳 ───────────────────────── */
test('V2 取消删除线：折叠与状态都不变，且不留空 <s> 壳', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  w.localStorage.setItem('notesync_fold_open', JSON.stringify({ '': [1] }));
  ed.innerHTML = '<div>[折叠]标题A</div><div>正文A</div><div>[折叠]标题B</div><div>正文B</div>';
  w.applyFolds();

  selectAll(w, handles(w)[1]);
  w.applyStrike();
  await sleep(360);                        // strikeBusy 有 300ms 防重锁，不等会被自己挡掉（不是 bug）
  selectAll(w, handles(w)[1]);
  w.applyStrike();

  assert.strictEqual(handles(w).length, 2, '取消删除线后把手数不变');
  assert.deepStrictEqual(states(w), ['收起', '展开'], '取消删除线后状态不变');
  assert.strictEqual(ed.querySelectorAll('s').length, 0, '取消干净：正文里不许残留 <s>（残留＝下次再划会认成已有删除线而直接取消）');
  assert.strictEqual(ed.textContent, '[折叠]标题A正文A[折叠]标题B正文B', '全文不许丢字');
});

/* ── V3 历史脏数据：已经存到服务端的坏 HTML 要能被救回来 ────────────── */
test('V3 脏数据 <s>[折叠]</s> 形态：applyFolds 要能认回把手（这条救的是历史笔记）', t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  w.localStorage.setItem('notesync_fold_open', JSON.stringify({ '': [1] }));
  // 老版本划过线的把手，同步到服务端之后就是这个形状
  ed.innerHTML = '<div>[折叠]标题A</div><div>正文A</div><div><s>[折叠]</s><s>标题B</s></div><div>正文B</div>';
  w.applyFolds();
  assert.strictEqual(handles(w).length, 2, '历史坏形态必须被认回把手（否则老笔记永久塌陷，只能用户手改）');
  assert.deepStrictEqual(states(w), ['收起', '展开'], '救回来的把手要拿回应有的展开/收起状态');
  const b = blocks(w)[2];
  assert.ok(b.querySelector(':scope > .ns-fold-mark'), '重建出干净的 mark span');
  assert.ok(!/\u200B|\[折叠\]<\/s>/.test(b.innerHTML), '不该留裸 [折叠] 或空 <s> 壳');
  assert.strictEqual(b.textContent, '[折叠]标题B', '字一个不许丢');
});

/* ── V4 无谷歌服务 → 直接页面扫码 ─────────────────────────────────── */
test('V4 无谷歌服务：不再走原生预览，直接上页面解码层', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w } = app;
  let gum = 0, nativeStart = 0;
  w.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      BarcodeScanner: {
        isGoogleBarcodeScannerModuleAvailable: async () => ({ available: false }), // 无谷歌服务
        requestPermissions: async () => ({ camera: 'granted' }),
        startScan: async () => { nativeStart++; },   // 原生预览这条已退役，绝不许被调
      },
    },
  };
  w.navigator.mediaDevices = { getUserMedia: async () => { gum++; throw new Error('stop here: 相机起来即算走到网页层'); } };
  await w.doScanAndOpen();
  assert.strictEqual(nativeStart, 0, '原生预览层已退役，不许再被调（用户拍板：无谷歌服务＝页面扫码）');
  assert.strictEqual(gum, 1, '必须直接走 getUserMedia 页面解码层');
  const diag = JSON.parse(w.sessionStorage.getItem('ns_scan_diag') || 'null');
  assert.ok(diag && diag.path === 'web(无GMS)', '诊断要如实记下走的是页面解码：' + JSON.stringify(diag));
});

/* ── V5 有谷歌服务 → 仍然走原生弹窗 ───────────────────────────────── */
test('V5 有谷歌服务：仍然走谷歌弹窗那条最快的路', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w } = app;
  let scanCalls = 0, gum = 0;
  w.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      BarcodeScanner: {
        isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
        requestPermissions: async () => ({ camera: 'granted' }),
        scan: async () => { scanCalls++; return { barcodes: [{ rawValue: 'https://xuyinji.com.cn/note/demo#k=' + 'A'.repeat(43) }] }; },
      },
    },
  };
  w.navigator.mediaDevices = { getUserMedia: async () => { gum++; throw new Error('不该掉到网页层'); } };
  await w.doScanAndOpen();
  assert.strictEqual(scanCalls, 1, '有谷歌服务就该走原生弹窗（用户留着它就是为了快）');
  assert.strictEqual(gum, 0, '这条路没异常时不许再掉网页层');
  const diag = JSON.parse(w.sessionStorage.getItem('ns_scan_diag') || 'null');
  assert.ok(diag && diag.path === 'native-gms', '诊断要记下走的是原生弹窗：' + JSON.stringify(diag));
});

/* ── V6 两个按钮已退役 ────────────────────────────────────────────── */
test('V6 〔从相册选二维码〕〔复制原因〕已退役：按钮与实现都不许再现', () => {
  // 只钉「定义与调用」，不钉注释——注释里交代它退役的原因是有用的，禁止反而让下次接手的人重蹈覆辙。
  assert.ok(!/function scanFromAlbum\s*\(|function copyScanWhy\s*\(/.test(SRC), '两个函数的定义必须整段删掉（留个空壳＝下一个接手的人又会把它接回去）');
  assert.ok(!/scanFromAlbum\(\)|copyScanWhy\(/.test(SRC), '不许再有调用点（删干净的判断标准：没有任何代码会执行到它）');
  assert.ok(!/id = 'scanAlbum'|id = 'scanWhy'|scanNativeAlbum|scanNativeWhy/.test(SRC), '四处按钮不得残留在源码里');
  assert.ok(!SRC.includes('可点〔从相册选二维码〕'), '不许再有指向已删按钮的提示文案（指着不存在的按钮＝用户点了个寂寞）');
  assert.ok(SRC.includes("snapBtn.id = 'scanSnap'"), '〔抓拍识别〕必须留着——它是页面层唯一还能手动自救的手艺');
});

/* ── V7 相机起不来 → 立即收口 ─────────────────────────────────────── */
test('V7 相机起不来：浮层当场拆、Promise 当场收口，不许留着枯等', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w } = app;
  const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  w.navigator.mediaDevices = { getUserMedia: async () => { throw err; } };
  const ret = await w.scanWithWebCamera();
  assert.strictEqual(ret, '', '相机起不来必须当场 resolve 空串（旧写法把浮层留在屏上等 120 秒）');
  assert.strictEqual(w.document.getElementById('scanMask'), null, '浮层必须已经拆掉');
  // 用户的下一句话必须看得到：权限被拒要指到系统设置，而不是继续 recommended 一个不存在的按钮
  const ward = w.document.getElementById('landingWarn');
  assert.ok(ward && /允许相机/.test(ward.textContent), '要给一条说到出路的提示，而不是指着已经删掉的按钮：' + (ward && ward.textContent));
});
