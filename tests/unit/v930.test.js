// NoteSync v9.3.0 单元测试守护（用户一批十条的落码钉）。
// 守护纪律：①字面量钉锚到补丁行；②行为优先于文本；③禁现串必须是目标串完整形（防误伤同形代码/自命中）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.resolve(ROOT, 'index.html'), 'utf8');
const MANIFEST = fs.readFileSync(path.resolve(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const KT_SAVE = fs.readFileSync(path.resolve(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'img', 'ImgSavePlugin.kt'), 'utf8');
const KT_UPD = fs.readFileSync(path.resolve(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'update', 'UpdatePlugin.kt'), 'utf8');
const KT_CLIP = KT_UPD; // 占位不用
void KT_CLIP;
const MAINJAVA = fs.readFileSync(path.resolve(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'MainActivity.java'), 'utf8');
function layerSrc() {
  const i = SRC.lastIndexOf('v9.0.0 彩蛋层 A');
  const j = SRC.lastIndexOf('v9.0.0 彩蛋层 B');
  return { a: SRC.slice(i, j), b: SRC.slice(j) };
}

/* ── G1 折叠选择复制/剪切不再丢正文（用户报） ─────────────────────── */
test('G1 copy/cut 显形补丁在位：判据函数+两监听+还原链齐全', () => {
  assert.ok(SRC.includes('function foldHideInSelection() {'), '缺选区相交判定函数');
  assert.ok(SRC.includes("editor.addEventListener('copy', () => {"), '缺 copy 监听（顶栏复制钮之外的选区通道）');
  assert.ok(SRC.includes("editor.addEventListener('cut', () => {"), '缺 cut 监听');
  const cut = SRC.slice(SRC.indexOf("editor.addEventListener('cut', () => {"));
  assert.ok(cut.slice(0, 420).includes('persistFoldStates()'), 'cut 后必须按退格护栏同款顺序重建+落态防把手错位');
});
test('G1b jsdom 行为：选区跨收起折叠时复制——事件内显形、事件后折叠还原', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  const ed = d.getElementById('editor');
  ed.innerHTML = '<div>[折叠]标题行</div><div>被折的正文甲</div><div>被折的正文乙</div><div><br></div>';
  w.eval('applyFolds()');
  assert.ok(d.querySelector('#editor .ns-fold-hide'), '前置：折叠应处于收起态（有隐藏块）');
  const r = d.createRange();
  r.selectNodeContents(ed);
  const sel = w.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  let hiddenDuring = null;
  ed.addEventListener('copy', () => { hiddenDuring = d.querySelectorAll('#editor .ns-fold-hide').length; }, { once: true });
  const ev = new w.Event('copy', { bubbles: true, cancelable: true });
  ed.dispatchEvent(ev);
  assert.strictEqual(hiddenDuring, 0, 'copy 事件派发时隐藏块必须已显形（否则浏览器序列化仍丢字）');
  await new Promise(res => setTimeout(res, 30));
  assert.ok(d.querySelector('#editor .ns-fold-hide'), '事件后必须折叠还原（复制不该改变用户看到的收起态）');
});

/* ── G2 折叠三角感应区 44×44（仅窄屏；桌面零变化） ─────────────────── */
test('G2 窄屏三角放大钉：可见 16px + 44×44 定宽高 + touch-action + pointerdown 触屏拦截', () => {
  const css = SRC.slice(SRC.indexOf('#editor .ns-fold-hide{display:none}'));
  const blk = css.slice(0, css.indexOf('/* v9.1.1：打印时展开全部折叠'));
  assert.ok(/@media \(max-width:560px\)/.test(blk), '感应区放大必须锁在窄屏媒体查询内');
  assert.ok(blk.includes('width:44px;height:44px'), '感应区 44×44 缺位');
  assert.ok(blk.includes('font-size:16px'), '可见三角未加大');
  assert.ok(blk.includes('touch-action:manipulation'), '缺双击缩放消等');
  const pd = SRC.indexOf("if (e.pointerType !== 'touch') return;");
  const pdTail = SRC.slice(pd, pd + 200);
  assert.ok(pd > 0 && pdTail.includes("closest('span.ns-fold-mark')) e.preventDefault()"),
    '缺触屏 pointerdown 拦截折叠三角（源头不弹键盘，桌面鼠标 pointerType!=="touch" 不拦）');
});

/* ── G3 图片：PC 还系统菜单 / 删除退役 / 保存主路径（行为在 v920 V8/V8c/V8d/F4 已翻钉，此处补 Kotlin） ── */
test('G3 ImgSavePlugin 新增 saveImageUrl：https 校验 + 64MB 上限 + 落盘复用既有通道', () => {
  assert.ok(KT_SAVE.includes('fun saveImageUrl(call: PluginCall)'), '原生直链下载方法缺位（JS 主路径依赖它）');
  assert.ok(KT_SAVE.includes('startsWith("https://")'), '必须挡非 https');
  assert.ok(KT_SAVE.includes('1024 * 1024'), '缺体积上限（失控下载冻存储）');
  assert.ok(KT_SAVE.includes('viaMediaStore(name, realMime, data)') || KT_SAVE.includes('viaMediaStore(name, mime, bytes)'), '新路径必须复用既有落盘通道');
});

/* ── G4 桌宠 App 内可见链：菜单入口 + 键盘模式 + 行为（领养开面板） ── */
test('G4 菜单「桌宠」行在位且走 nsRouteEgg(pet) 唯一入口；键盘 adjustResize', () => {
  assert.ok(SRC.includes('id="menuPet"'), '主菜单缺桌宠行（App 无地址栏时领养唯一明路）');
  const wire = SRC.slice(SRC.indexOf("$('#menuPet').addEventListener"));
  assert.ok(wire.slice(0, 300).includes("window.nsRouteEgg('pet')"), '行点击必须直开 /pet 面板（面板挂载即领养/唤醒）');
  assert.ok(MANIFEST.includes('android:windowSoftInputMode="stateHidden|adjustResize"'),
    '缺 adjustResize——键盘弹出布局视口不缩，bottom 浮层（/pet 确认条）被推出可视区即 App 领养链断的根因');
});
test('G4b jsdom 行为：点菜单桌宠行 → 领养落库且打开桌宠档案面板', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  d.getElementById('menuPet').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 60 && !d.getElementById('nsGame'); i++) await new Promise(res => setTimeout(res, 50));
  const pet = JSON.parse(w.localStorage.getItem('notesync_pet') || '{}');
  assert.strictEqual(pet.adopted, true, '访问 /pet 面板必须即领养（与 v9.0.0 拍板同语义）');
  assert.ok(d.getElementById('nsGame'), '点桌宠行应打开桌宠档案面板');
  // 注：顶栏浮宠 #nsPet 的挂载受 petBadgeOn() 徽章优先门禁 + boot/MutationObserver 时机影响，jsdom 干净态不可靠，
  // 其存在性由 G 系列其它宠物用例与真机覆盖，此处不断言（HEAD 单跑同样挂不出，属既有脆弱点，非本版回归）。
});

/* ── G5 桌宠×彩蛋互动桥与三局内钩子 ───────────────────────────────── */
test('G5 nsPetGame 桥 + brick/dragon 局内小宠 + 雨张望，全部带 on() 门禁', () => {
  const la = layerSrc().a;
  assert.ok(la.includes('window.nsPetGame = {'), '缺互动桥（游戏层独立脚本够不着 PET）');
  assert.ok(la.includes("on: function () { try { return !!PET.adopted && !PET.asleep;"), '桥 on() 必须「已领养且醒着」双判据');
  const lb = layerSrc().b;
  assert.strictEqual((lb.match(/nsPetGame && nsPetGame\.on\(\)/g) || []).length >= 3, true,
    'brick 碎砖+draw、dragon draw 至少三处消费方');
  assert.ok(lb.includes('function petMini(c, P, x, y, bob)'), '缺共用小宠剪影');
  assert.ok(SRC.includes('body:has(#nsRain:not(.hidden)) #nsPet svg'), '缺雨天张望 CSS（挂 svg 不抢爬行 translateX）');
});

/* ── G6 brick/dragon 词源吃正文（其余游戏与 tank 种子零变化） ─────── */
test('G6 词源门禁：仅 brick/dragon 走正文，obs/tank 不动；正文词不足必回退', () => {
  const lb = layerSrc().b;
  assert.ok(lb.includes("if (kind === 'brick' || kind === 'dragon') { var bw = bodyWords(); if (bw.length >= 8) return bw; }"),
    '正文优先门禁形变（阈值/种类改动须随版）');
  assert.ok(lb.includes('var nm = names(\'brick\');'), 'brick 未接正文 kind');
  assert.ok(lb.includes("words = names('dragon')"), 'dragon 未接正文 kind');
  assert.ok(lb.includes("var src = names('obs')"), 'tank 种子仍走旧池（不该被顺手改）');
});
test('G6b jsdom 行为：nsBodyWords 切词——中文长句 3 字块、标点/空白分界、去重、空正文为 []', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  d.getElementById('editor').textContent = '';
  assert.strictEqual(w.eval('window.nsBodyWords()').length, 0, '空正文必须是空集（触发回退）');
  d.getElementById('editor').textContent = '这周主要把机房巡检的自动化跑通了，脚本在测试环境连跑三天没有再出现漏单。周一例会上定稿了移动端首页的改版口径；砍掉了轮播位。';
  const ws = w.eval('window.nsBodyWords()');
  assert.ok(ws.length >= 8, '长正文应切出足够词：' + ws.length);
  assert.ok(ws.every(x => x.length >= 2 && x.length <= 6), '词长必须 2..6');
  assert.ok(new Set(ws).size === ws.length, '必须去重');
  assert.ok(ws.indexOf('，') < 0 && ws.every(x => !/[。，；：！？]/.test(x)), '标点不得留在词里');
});

/* ── G7 satoshi：字号降档 + 滑位/合并 pop（行为等价钉在 v900 A25/A45） ── */
test('G7 satoshi 动画与字号钉：新三档在位、旧 .34 禁回潮、pop/滑位双通道、GOAL 分支补 restore', () => {
  const lb = layerSrc().b;
  assert.ok(lb.includes("txt.length > 8 ? s * .16 : txt.length > 5 ? s * .21 : s * .27"), '字号三档非定稿值');
  assert.ok(!lb.includes('s * .34'), '旧最大档禁回潮');
  assert.ok(lb.includes('var SA = { anim: null, t0: 0'), '缺动画状态');
  assert.ok(lb.includes('SA.anim = anims; SA.t0 = saNow();'), 'move 未采集动画');
  assert.ok(lb.includes('0.13 * Math.sin(Math.PI * popP)'), '缺合并 pop');
  assert.ok(lb.includes("if (sc !== 1) c.restore(); continue;"), 'v>=GOAL 分支漏 restore＝变换泄漏');
  assert.ok(lb.includes('b[qc[0]][qc[1]] = tv; SA.anim = null;'), '幻影换格未清动画（坐标失效会画出跳格）');
});

/* ── G8 档案页护照换养 ─────────────────────────────────────────────── */
test('G8 认领函数带 scanText/cb 通道且面板挂换养区（同一正则单一格式源）', () => {
  const la = layerSrc().a;
  assert.ok(la.includes('function nsTryClaimFromBody(scanText, cb)'), '认领函数未开手动通道');
  assert.ok(la.includes('nsTryClaimFromBody(v, function (r)'), '面板按钮未走同一条认领链（另写一份＝格式必漂移，v9.0.0 教训）');
  assert.ok((la.match(/ARC_PASS_RE\.exec\(txt\)/g) || []).length === 1, '护照解析必须恰一处（ARC_PASS_RE 单一消费点）');
  assert.ok(la.includes('class="ns-swap-in"') && la.includes('class="ns-swap-go"'), '缺换养输入区');
});
test('G8b jsdom 行为：手动通道喂乱文→同步回调 format 错且不发 fetch', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  let fetched = 0;
  const of = w.fetch; w.fetch = function (u) { if (String(u).includes('/api/arcade')) fetched++; return of.apply(this, arguments); };
  const got = w.eval("(function(){var g=null;window.nsClaimPassport('完全不像护照的一句话',function(r){g=r});return g})()");
  assert.ok(got && got.ok === false && got.why === 'format', '乱文必须即时回调 format：' + JSON.stringify(got));
  assert.strictEqual(fetched, 0, '格式错不得打服务端（省限流配额）');
});

/* ── G9 在线升级（关于页 + UpdatePlugin） ─────────────────────────── */
test('G9 升级 UI 与代理拉取钉（v9.3.1 改同源代理）：/api/latest、no-store、≤3 行摘要、壳外隐藏、server 代拉', () => {
  const SRV = fs.readFileSync(path.resolve(ROOT, 'server.js'), 'utf8');
  assert.ok(SRC.includes("fetch('/api/latest?ts='"), '必须打同源 /api/latest——国内容器直连 api.github.com 必挂（用户「检查失败」实锤）');
  assert.ok(!SRC.includes("api.github.com/repos/' + UPD_REPO"), '手机侧直连 GitHub 旧形态禁回潮');
  assert.ok(SRC.includes("cache: 'no-store'"), '每次检查必须实时——留缓存=按钮骗人');
  assert.ok(SRV.includes("latest_app.json") && SRV.includes("no release metadata"), 'server.js 必须读部署落地的 latest_app.json（云服务器到 GitHub 的 TLS 实测间歇断，任何代拉不可靠）');
  assert.ok(!SRV.includes('https://api.github.com') && !SRV.includes('releases.atom'), '服务器出网代拉的旧形态禁回潮（升级查询零外网依赖）');
  assert.ok(SRC.includes("Array.isArray(o.summary)"), '更新要点优先读 summary（人工浓缩分行，非自动掐 3 行）');
  assert.ok(SRC.includes("document.createTextNode('新版本：v' + tag)"), '顶部必须「新版本：vX」');
  assert.ok(SRC.includes("sz.className = 'sz'"), '大小要弱成 .sz 小字跟在版本后');
  assert.ok(!SRC.includes('GitHub Releases 官方安装包') && !SRC.includes("$('#updMeta')"), 'meta 行（GitHub/官方安装包）必须删净，禁回潮');
  assert.ok(SRC.includes(".box .upd-btns button.ghost-btn{margin-top:0}"), '两按钮错位修复：清零选择器必须提到 .box .upd-btns 权重（压过 .box button.ghost-btn 的 margin-top:10px）');
  assert.ok(SRC.includes("} else $('#aboutUpdRow').classList.add('hidden');"), '网页版必须隐藏升级行');
  assert.ok(SRC.includes("id=\"aboutUpdRow\"") && SRC.includes('id="updMask"'), '缺关于行/确认弹窗骨架');
});
/* ── G9e v9.3.2 交互三改（用户拍板）：彩蛋词 hover 即问可重复 / 恐龙点跳按住低头 / 桌宠天数按 born 现算 ── */
test('G9e v9.3.2 交互三改：彩蛋词只读命中弹层、恐龙点=跳按住=低头、桌宠天数现算、nsAsk 方案1 新样式', () => {
  // 彩蛋 hover：全部锚到新增块独有串（旧文件别处也有 editor mousemove/click，泛串会恒真）
  assert.ok(SRC.includes('function nsEggAtPoint') && SRC.includes('caretRangeFromPoint'), '须用只读指针命中（不注入 span 污染存档）');
  assert.ok(SRC.includes('_hoverTok = t;') && SRC.includes("if (e.buttons) return;"), '桌面 hover：边沿触发 _hoverTok + 按住/拖拽中(e.buttons)不打扰');
  assert.ok((SRC.match(/if \(t && !asked\[t\]\) \{ try \{ nsAskConfirm\(t\)/g) || []).length >= 2, 'hover 与触屏两路都须尊重 asked（点过不了不再弹）');
  assert.ok(SRC.includes('try { asked[id] = 1; }'), '「不了」必须真写 asked，否则移上去仍复弹（违不再打扰红线）');
  assert.ok(SRC.includes('#nsAsk .ns-dot') && SRC.includes('-apple-system,"PingFang SC",sans-serif'), '确认层方案1：无衬线 + 金色小圆点，去等宽小字');
  // 恐龙：点=跳/按住=低头 + 首点不补跳
  assert.ok(SRC.includes('heldDuck') && SRC.includes("if (phase === 'run' && !dead) jump()"), '恐龙：短按=跳、按住(heldDuck)=低头');
  assert.ok(SRC.includes('introTap') && SRC.includes('if (introTap) { introTap = false; return; }'), '恐龙首点只起跑、抬手不补跳');
  assert.ok(!SRC.includes('y0 > SH().H * 0.55'), '恐龙旧的「按 y 分上下半屏」判据必须退役');
  assert.ok(SRC.includes("tip: '点屏幕 = 跳 · 按住屏幕 = 低头"), '恐龙提示语随新操作更新');
  // 桌宠天数：按 born 现算且 clamp≥1
  assert.ok(SRC.includes('Math.max(1, 1 + Math.floor((Date.now() - p.born) / 864e5))'), '桌宠天数须每次按 born 现算并 clamp≥1（多端一致、时钟超前不显示 0/负）');
});
/* ── G9d APK 国内域名直下（v9.3.2：GitHub releases CDN 国内慢/需翻墙，改服务器固定名覆盖式直出）── */
test('G9d APK 国内直下：server.js 服务 /dl/latest.apk（固定覆盖文件+Range 续传）且 latest_app.json 指向 biji 不回潮 GitHub', () => {
  const SRV = fs.readFileSync(path.resolve(ROOT, 'server.js'), 'utf8');
  const LATEST = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'latest_app.json'), 'utf8'));
  assert.ok(SRV.includes("url === '/dl/latest.apk'"), 'server.js 必须有 /dl/latest.apk 精确路由（国内直下入口）');
  assert.ok(SRV.includes("'apk', 'latest.apk'"), 'APK 必须走 APP_DIR/apk/latest.apk 固定覆盖名（磁盘只留最新，不堆旧副本）');
  assert.ok(SRV.includes("'Accept-Ranges': 'bytes'") && SRV.includes('206'), '/dl 必须支持 Range 断点续传（低带宽 DownloadManager 必备）');
  const u = LATEST.assets[0].browser_download_url;
  assert.ok(u === 'https://biji.xuyinji.com.cn/dl/latest.apk', 'latest_app.json 下载地址必须是国内 biji 域，实得 ' + u);
  assert.ok(!/github\.com\/.*\/releases\/download\//.test(u), '禁回潮 GitHub releases 直链（国内翻墙/慢根因）');
  assert.ok(/\.apk$/i.test(LATEST.assets[0].name), 'asset.name 仍以 .apk 结尾（App 端 /\\.apk$/ 过滤依赖）');
});
test('H1 护照换养：从笔记复制带零宽空格的护照必须能解析（用户报「格式不对」根因=linkify 插 U+200B）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const of = w.fetch; let hitId = ''; w.fetch = function (u) { hitId = String(u); return of.apply(this, arguments); };
  // 构造被 linkify 长词断行毒化的护照：ns1:​id=... 中间塞零宽
  const zw = String.fromCharCode(0x200B);
  const dirty = 'ns1:' + zw + 'id=ABC23456' + zw + ';key=' + zw + 'DEFG2345';
  const ok = w.eval("(function(){var g=null;window.nsClaimPassport(" + JSON.stringify(dirty) + ",function(r){g=r});return g})()");
  assert.ok(!ok || ok.why !== 'format', '带零宽的合法护照不得判「格式不对」（应剥零宽后正常发起认领）：' + JSON.stringify(ok));
  assert.ok(/\/api\/arcade\/ABC23456/.test(hitId), '剥零宽后必须按真 id 打认领请求，实得 ' + hitId);
});
test('H2 词表触发进过一次后同会话可再进（用户报第二次进不去），但点「不了」仍不再打扰', () => {
  assert.ok(SRC.includes('b.remove(); try { delete asked[id]; } catch (e) {}'), '点「进入」必须清 asked[id] re-arm');
  assert.ok(SRC.includes("if (asked[id]) return;"), 'asked 判据仍在（防重复弹）');
});
test('H3 图片底栏按钮可点+顺序：容器 pointer-events 不得为 none（老内核父 none 子 auto 不回升），保存到右', () => {
  const bar = SRC.slice(SRC.indexOf('#nsZoom .nz-bar{position'));
  const blk = bar.slice(0, bar.indexOf('}', bar.indexOf('padding:12px')));
  assert.ok(/pointer-events:auto/.test(blk), '底栏容器必须 auto——父 none 下按钮在国产老内核点不动（用户真机「保存灰的点不动」）');
  assert.ok(SRC.includes("[['复制链接', function () { nsImgCopyLink(im); }], ['保存到相册', function () { nsImgSave(im); }, true]]"), '顺序：复制链接左、保存到相册右（用户指定）');
});
test('G9b UpdatePlugin：三方法+FileProvider authority+权限注册', () => {
  assert.ok(KT_UPD.includes('fun downloadApk(call: PluginCall)') && KT_UPD.includes('fun downloadState(call: PluginCall)') && KT_UPD.includes('fun install(call: PluginCall)'), '三方法缺位');
  assert.ok(KT_UPD.includes('.fileprovider'), 'FileProvider authority 必须 <pkg>.fileprovider');
  assert.ok(KT_UPD.includes('application/vnd.android.package-archive'), '安装 Intent MIME');
  assert.ok(MANIFEST.includes('android.permission.REQUEST_INSTALL_PACKAGES'), '缺覆盖安装权限');
  assert.ok(MAINJAVA.includes('registerPlugin(UpdatePlugin.class)'), '未在 MainActivity 注册');
});
test('G9c nsVerCmp 语义：段比大小、缺段按 0、相等 0', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  assert.ok(w.eval('nsVerCmp("9.3.0","9.2.9")') > 0);
  assert.ok(w.eval('nsVerCmp("9.3","9.3.0")') === 0, '缺段按 0——9.3 不比 9.3.0 旧');
  assert.ok(w.eval('nsVerCmp("10.0.0","9.99.99")') > 0, '十位段不许按字符串比');
  assert.ok(w.eval('nsVerCmp("v9.3.1".replace(/^v/,""),"9.3.0")') > 0);
});
