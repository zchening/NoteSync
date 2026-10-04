// v10.1.4 单元测试：扫码换机改「备份笔记本体」路线
//   V1  备份槽：随机档名格式/幂等/存储
//   V2  备份文档编解码往返（含 100 篇、时间戳、普通正文与 ZWSP 毒化正文不得误判）
//   V3  旧 v7.7.0 整包文本与新文本双前缀读取兼容（禁"新手机不认旧码"）
//   V4  跨笔记写入凭据与服务端 HMAC 口径逐字一致 + 旧 deriveWriteKey 行为不变
//   V5  密度不变量：码大小与篇数解耦（并把"为什么必须换路线"的旧形态数据钉进测试）
//   V6  甲案三闸 + 双渲染路径收口的静态锚（口令解锁路径与自动解锁路径都必须进只读收口）
//   V7  解码端加强锚（640px 解码预算禁回潮、取景面积、自排队抽帧链、状态反馈）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

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
const stdKey = () => Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');

test('V1 备份槽：随机档名格式合法、可持久化、幂等复用', async () => {
  // 根页：这些函数与 noteId 无关，笔记页 init 的异步尾巴会在 close 后继续跑（jsdom 报 localStorage is not defined）
  const app = freshApp();
  const { window, localStorage } = app;
  const ids = new Set();
  for (let i = 0; i < 40; i++) ids.add(window.newBakId());
  assert.ok(ids.size >= 36, '40 次随机档名不应大面积相撞（实得 ' + ids.size + ' 个唯一值）');
  for (const id of ids) {
    assert.ok(/^nsbak-[a-z0-9]{6}$/.test(id), '档名必须匹配 BAK_ID_RE：' + id);
    assert.ok(/^[a-z0-9_-]{1,64}$/.test(id), '档名必须过服务端 ID_RE：' + id);
    assert.ok(!/[lo1]/.test(id.slice(6)), '随机段去掉 l/o/1 歧义字符（手输档名兜底要能读对）：' + id);
  }
  assert.strictEqual(window.readBakSlot(), null, '初始应无备份槽');
  localStorage.setItem('notesync_bak_slot', '坏 JSON{{');
  assert.strictEqual(window.readBakSlot(), null, '坏数据必须降级为无槽，绝不抛');
  localStorage.setItem('notesync_bak_slot', JSON.stringify({ id: 'evil-name-with-space', salt: null }));
  assert.strictEqual(window.readBakSlot(), null, '档名不合法就不算槽（防被污染数据把备份写进任意档名）');
  window.writeBakSlot('nsbak-abc123', 'c2FsdA==');
  const got = window.readBakSlot();
  assert.strictEqual(got.id, 'nsbak-abc123', '写入后应读回同一个槽');
  assert.strictEqual(got.salt, 'c2FsdA==', '盐随槽一起记（非机密，与离线缓存同口径）');
  app.dom.window.close();
});

test('V2 备份文档编解码往返：100 篇零丢字，普通正文/毒化正文一律不误判', async () => {
  // 根页，避开 init 异步尾巴
  const app = freshApp();
  const { window } = app;
  const entries = [['travel1014', stdKey()]];
  for (let i = 0; i < 99; i++) entries.push(['ns' + String(i).padStart(3, '0'), stdKey()]);
  const doc = window.encodeBakDoc(entries, 1700000000000);
  assert.ok(doc && doc.startsWith('<div data-ns-bak="1">notesync-bak:1:'), '文档形态=<div data-ns-bak> + 前缀 + base64url');
  const back = window.parseBakDoc(doc);
  assert.ok(back, '自己编码的文档必须解得回来');
  assert.strictEqual(back.f.length, 100, '100 篇应一篇不少（实得 ' + back.f.length + '）');
  assert.strictEqual(back.f[7][0], entries[7][0], '档名顺序不得被打乱（恢复后 ok[0] 语义依赖顺序）');
  assert.strictEqual(back.f[7][1], entries[7][1], '密钥逐字往返');
  assert.strictEqual(back.ts, 1700000000000, '生成时间戳要带回去（恢复卡要说清这份备份多旧）');
  // 误判防线：宁可漏判走正常编辑，也绝不把普通笔记锁成只读
  assert.strictEqual(window.parseBakDoc('<div>notesync-bak:1:QUJD</div>'), null, '没有 data-ns-bak 属性不算备份文档');
  assert.strictEqual(window.parseBakDoc('<div data-ns-bak="1">notesync-bak:1:QUJD</div>'), null, 'base64 解不出合法清单不算备份文档');
  assert.strictEqual(window.parseBakDoc('<div data-ns-bak="1">notesync-bak:1:QUJD</div><div>x</div>'), null, '尾部拖任何东西都不算');
  assert.strictEqual(window.parseBakDoc('<div data-ns-bak="1">notesync-​bak:​1:QUJD</div>'), null, '被 ZWSP 断行毒化过的串必须判否（绝不允许把毒化正文当备份清单写回密钥）');
  assert.strictEqual(window.parseBakDoc(''), null, '空正文判否');
  app.dom.window.close();
});

test('V3 读侧兼容：v7.7.0 整包载荷与新备份文本同一入口都认', async () => {
  // 根页，避开 init 异步尾巴
  const app = freshApp();
  const { window } = app;
  const k = stdKey();
  const legacy = 'notesync-backup:v1:' + Buffer.from(JSON.stringify({ v: 1, f: [['a1', k]] })).toString('base64');
  const fresh = 'notesync-bak:1:' + Buffer.from(JSON.stringify({ v: 1, ts: 123, f: [['a2', k]] })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(window.parseBakText(legacy).f[0][0], 'a1', '旧 v1 载荷必须仍读得出（旧手机出的码不能变砖）');
  assert.strictEqual(window.parseBakText(fresh).f[0][0], 'a2', '新格式读得出');
  assert.strictEqual(window.parseBakText(fresh).ts, 123, '新格式带时间戳');
  assert.strictEqual(window.parseBakText('https://xuyinji.com.cn/note/abc#k=AAA'), null, '配对链不是备份文本');
  assert.strictEqual(window.parseBakText('notesync-bak:1:@@非法@@'), null, '非法字符判否不抛');
  app.dom.window.close();
});

test('V4 跨笔记写入凭据：与服务端 HMAC 口径逐字一致，旧函数行为零变更', async () => {
  const app = freshApp('http://localhost/crednote');
  const { window } = app;
  const raw = webcrypto.getRandomValues(new Uint8Array(32));
  const key = await window.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const nodeHmac = await (async () => {
    const k2 = await webcrypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sign = async name => {
      const sig = await webcrypto.subtle.sign('HMAC', k2, new TextEncoder().encode('notesync-write-v1:' + name));
      return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    return sign;
  })();
  const forBak = await window.deriveWriteKeyFor('nsbak-abc123', key);
  assert.strictEqual(forBak, await nodeHmac('nsbak-abc123'), '跨笔记凭据必须等于服务端算法（域分离串 + 目标名，不是全局 noteId）');
  const forCur = await window.deriveWriteKey(key);
  assert.strictEqual(forCur, await nodeHmac('crednote'), '原 deriveWriteKey 仍按当前笔记名派生，行为零变更');
  assert.notStrictEqual(forBak, forCur, '两篇笔记的凭据不得通用（域分离失效=一处泄漏全库可写）');
  assert.strictEqual(await window.deriveWriteKeyFor('', key), null, '空目标名直接 null，绝不发凭据');
  assert.strictEqual(await window.deriveWriteKeyFor('nsbak-abc123', null), null, '无密钥直接 null');
  // 两份实现必须逐字同口径（不共用是因为原函数带一条必须可见的失败提示、且老语义依赖 noteId 空串）：
  // 行为等价断言比数字面量更硬——同钥同名派生结果必须一模一样，分叉即真主自己撞 403。
  assert.strictEqual(forCur, await window.deriveWriteKeyFor('crednote', key), 'deriveWriteKey 与 deriveWriteKeyFor 对同一笔记必须产出同一凭据（两实现不得分叉）');
  assert.strictEqual((readSrc().match(/notesync-write-v1:/g) || []).length, 2, '域分离串只允许这两处实现（原函数 + 目标参数版），第三处=口径分叉前科');
  app.dom.window.close();
});

test('V5 密度不变量：一张码与篇数解耦，永远落在配对码那一档可扫密度', async () => {
  // 根页，避开 init 异步尾巴
  const app = freshApp();
  const { window } = app;
  const mod = text => { const q = window.qrcode(0, 'M'); q.addData(text, 'Byte'); q.make(); return q.getModuleCount(); };
  const pitchAt = (px, n) => px / (n + 8);
  const url1 = window.pairingUrlFor('nsbak-abc123', stdKey());
  const entries = [];
  for (let i = 0; i < 100; i++) entries.push(['ns' + String(i).padStart(3, '0'), stdKey()]);
  const doc = window.encodeBakDoc(entries, Date.now());
  const nNew = mod(url1);
  assert.ok(nNew <= 45, '配对链载荷恒定：100 篇也还是 ' + nNew + ' 格（≤45）');
  assert.ok(doc.length > 6000, '清单确实进了笔记正文（' + doc.length + ' 字节），不是被悄悄裁掉');
  assert.ok(pitchAt(260, nNew) >= 4.5, '260px 弹窗下每格 ' + pitchAt(260, nNew).toFixed(2) + ' CSS px，仍在可扫带内（与一直好扫的配对码同档）');
  // 把「为什么必须换路线」的旧形态数据钉进测试：旧整包码随篇数线性变密，第 6 篇起掉出可扫带，
  // 20 篇顶到弹窗上限，100 篇直接超出二维码物理容量（v40-M≈2331 字节）连码都生不出来。
  const legacy = n => 'notesync-backup:v1:' + Buffer.from(JSON.stringify({ v: 1, f: entries.slice(0, n) })).toString('base64');
  const n6 = mod(legacy(6)), n20 = mod(legacy(20));
  assert.ok(n6 > 80, '旧形态 6 篇已 ' + n6 + ' 格（新形态 ' + nNew + ' 格）');
  assert.ok(pitchAt(260, n6) < 3.1, '旧形态 6 篇每格仅 ' + pitchAt(260, n6).toFixed(2) + ' CSS px＝用户实锤「微信能扫、app 扫不动」的密度');
  assert.ok(pitchAt(260, n20) < 1.8, '旧形态 20 篇每格仅 ' + pitchAt(260, n20).toFixed(2) + ' CSS px，彻底不可扫');
  let threw = '';
  try { mod(legacy(100)); } catch (e) { threw = String(e); }
  assert.ok(/code length overflow/.test(threw), '禁回潮：100 篇整包塞一码在物理上根本成不了码（qrcode 抛 ' + threw + '）');
  app.dom.window.close();
});

test('V6 甲案三闸与双渲染路径收口：静态锚在位', () => {
  const src = readSrc();
  // 闸2 必须锚在 saveLocal 内部、且排在 busy 排队之后（V73-S2 钉的入口不变量）。只 includes 一句
  // "if (bakMode) { setStatus(false, " 会同时命中「扫码换机」菜单项那处——撤掉真闸门照样绿（闸 R2-P2）。
  assert.ok(/async function saveLocal\([\s\S]{0,400}?if \(busy\)[\s\S]{0,900}?if \(bakMode\) \{ setStatus\(false, '换机备份只能在「扫码换机」里更新'\); return; \}/.test(src), '闸2：saveLocal 内硬拒写，且排在 busy 排队之后');
  assert.ok(/function enterBackupMode\(bundle, note\) \{[\s\S]{0,260}editor\.contentEditable = false;[\s\S]{0,160}editor\.innerHTML = '';/.test(src), '闸1：只读收口必须同时置 contentEditable=false 并清空编辑器');
  // 本轮闸修新增的五道 bakMode 守卫逐条钉住（漏一处＝那条路径能把备份写坏或谎报成功）
  assert.ok(/function openChangePass\(\) \{[\s\S]{0,520}if \(bakMode\)/.test(src), '闸2补口：备份笔记上禁止「修改口令」（cpRotate 拿空正文重加密会把备份清成空档，三路评审独立命中）');
  assert.ok(/async function poll\(\) \{[\s\S]{0,700}if \(bakMode\) return;/.test(src), 'poll 入口守卫：他端重建备份不得灌进只读编辑器');
  assert.ok(/function toggleRemPanel\(force\) \{[\s\S]{0,260}if \(bakMode\)/.test(src), '提醒面板守卫：只读态不给备份档写 rem 字段');
  assert.ok(/menuHistEntry[\s\S]{0,300}if \(bakMode\)/.test(src), '历史版本守卫：逐版恢复在只读态会谎报成功');
  assert.ok(/if \(note && note\.ct\) \{[\s\S]{0,900}\/history[\s\S]{0,400}manual: false/.test(src), '闸3 成真：覆盖旧备份前先把它追加进该档历史环（否则「可回滚」是空话）');
  // 三条「解密上屏」路径的只读收口必须逐条钉住真实形态。变异反证实锤：只数 parseBakDoc/enterBackupMode
  // 出现次数是恒真锚——把 `if (auBak) { enterBackupMode(...) }` 改成 `if (false) {...}` 把真收口撤掉，
  // 字面量还在、计数照样 4，测试全绿（闸 R1-P1-2 / R2-P0-2 就是靠这个形状漏进去的）。
  assert.ok(src.includes('if (bakBundle) { enterBackupMode(bakBundle, note); return; }'), '路径①口令解锁 applyUnlocked 必须真收口');
  assert.ok(src.includes('if (auBak) { enterBackupMode(auBak, note); return; }'), '路径②自动解锁 init 必须真收口');
  assert.ok(src.includes('if (bak) { enterBackupMode(bak, { salt: c.salt || null }); return true; }'), '路径③离线缓存 loadCachedBody 必须真收口');
  assert.ok((src.match(/enterBackupMode\(/g) || []).length >= 4, '收口点下界 4（定义 + 三路径）；将来新增第四条解密上屏路径必须一并补口');
  assert.ok(src.includes('window.__nsSnap = async () => {'), '〔抓拍识别〕兜底在位（不依赖连续帧，专治拍屏幕反光/对焦不实）');
  assert.ok(!/window\.prompt\(/.test(src), '禁回潮 window.prompt：Android WebView 不支持，返回 null＝「点了没反应」');
  assert.ok(src.includes('id="bakRestMask"') && src.includes('id="bakMask"'), '出码弹窗与恢复卡 DOM 在位');
  assert.ok(src.includes('const BAK_MAX = 100') && src.includes('FAVS_MAX = 100'), '容量：备份 100 篇 + 收藏夹上限随动抬到 100');
});

test('V7 v10.1.5 真机报障三件的守卫：解码静默失效自动降级 / 相册识码 / 备份范围回退默认只收藏', () => {
  const src = readSrc();
  // ① 解码端：detect() 静默失效（构造函数在、每帧抛错或永远返回空）必须能中途换引擎，且留下可复制证据
  assert.ok(src.includes('window.__scanDiag'), '扫码自检对象在位（诊断页要能读出 engine/frames/errs/hits）');
  assert.ok(/L\.push\(sd \? \('scan: ' \+ \(sd\.path \|\| '\?'\)/.test(src), '诊断页必须输出扫码自检行（含走了哪条路；v10.1.6 起优先读会话副本，跨页不丢）');
  assert.ok(!/catch \(e\) \{ \/\* 单帧失败忽略，继续下一帧 \*\/ \}/.test(src), '禁回潮：每帧异常静默吞掉＝「画面在跑、永远扫不出」的元凶形状');
  assert.ok(src.includes("engine = 'jsqr'; diag.engine = 'jsqr(降级)'"), '中途降级到 jsQR 的实现要在位');
  // 降级函数的声明与两处调用必须引用同一个标识符（变异反证 N1b 实锤：只改函数名、调用点悬空时，
  // 上面那些「字面串还在」的锚全部照绿，而真机降级那一刻会 ReferenceError——静默失效换个形状复活）
  assert.strictEqual((src.match(/switchToJsQR\b/g) || []).length, 3, 'switchToJsQR 必须恰好 1 处声明 + 2 处调用（连错3帧 / 40帧零命中）；必须词边界——子串计数会把 switchToJsQRoff 这类改名也算作命中（变异反证 N1b 二次实锤）');
  // ② 不依赖摄像头的两条出口
  assert.ok(src.includes('function handleScanResult(raw)'), '摄像头与相册共用同一结果收口（两处判定迟早分叉）');
  assert.ok(src.includes('raw = raw.trim();'), '扫码原文先去尾部空白（原生扫码器偶尔带换行，前缀判定与正则都会因此误判）');
  // ③ 备份范围回退：默认只收藏，扩范围要显式同意
  // v10.1.7 用户定稿：只备份收藏夹，参数与开关一并删除（沿革见 index.html 内注释）。
  // 这里全部改成「禁回潮」负向锚——将来谁再把范围扩出去或加回开关，必须显式改这条断言并说明理由。
  assert.ok(src.includes('async function collectBackupEntries() {'), '备份范围函数无参数（只有收藏夹一个口径）');
  assert.ok(!/collectBackupEntries\(\s*(?:true|wide|includeOther)\s*\)/.test(src), '禁回潮：不得再出现"带上其他笔记"的调用形态');
  assert.ok(!src.includes('function countOtherUnlocked()'), '禁回潮：其他笔记报数函数已随开关删除');
  assert.ok(!src.includes('bakWide'), '禁回潮：勾选框 DOM/变量不得回来');
  // ④ 文案精简：不再自证、不再两行长句
  assert.ok(!src.includes('永远扫得动'), '禁回潮：自证式长句（对用户没用，评审也判它是噪声）');
  assert.ok(src.includes("bakIdLine.textContent = '备份笔记：' + res.id;"), '档名行压成一行小字');
});

test('V8 解码端加强：640px 预算禁回潮、取景面积、自排队抽帧、状态反馈', () => {
  const src = readSrc();
  assert.ok(!/Math\.min\(640, video\.videoWidth\)/.test(src), '禁回潮：解码帧 640px 上限（微信扫得出、我们扫不出的一半根因）');
  // v10.1.6 随版：像素预算不再是"一刀 1280"，改成取景裁剪 + 分级（先 560 快试、连续 8 帧不中升 1120）
  assert.ok(!/Math\.min\(1280, video\.videoWidth\)/.test(src), '禁回潮：整帧 1280 宽直解（92 万像素一帧 150~300ms，手感就是"磨好几秒"）');
  assert.ok(src.includes('const tier = misses >= 8 ? 1120 : 560;'), '分级像素策略在位：先小预算抢帧率，连续失败再上分辨率');
  assert.ok(src.includes('height:56vh;min-height:200px;max-height:420px'), '取景面积加大（旧 44vh/340px 两头堵）');
  assert.ok(src.includes('width: { ideal: 1280 }, height: { ideal: 720 }'), '相机给 720p 软目标（ideal 非 exact，不抛 OverconstrainedError）');
  assert.ok(!/timer = setInterval\(async/.test(src), '禁回潮：setInterval 抽帧（一帧超时会互相排队，慢机型越扫越卡）');
  assert.ok(src.includes('timer = setTimeout(tick, Math.min(400, Math.max(120, Date.now() - t0 + 120)))'), '自适应抽帧：按上一帧耗时排下一枪');
  assert.ok(src.includes("setScanHint('识别中") && src.includes("setScanHint('已识别')"), '扫码过程必须有实时状态（旧版只有解出来才动＝「扫半天没反应」观感）');
  assert.ok(src.includes("if (finish) finish('')"), '取消/点遮罩要把在途 Promise 收口（旧版悬挂＝再点一次叠第二层取景框）');
  assert.ok(!src.includes("async function scanWithNativePreview") && !src.includes('native-mlkit'),
    '禁回潮：随包 ML Kit 原生预览层已在 v10.1.8 整体退役（用户拍板：无谷歌服务＝直接页面扫码），新口径见 unit/v1018.test.js');
  assert.ok(!src.includes("pasteBtn.id = 'scanPaste'"), '禁回潮：粘贴入口随「复制备份文本」一起撤掉（用户只要扫码路径）');
});

test('V9 v10.1.6 手感三件：默认全屏大码 + 常亮句柄 + 取景裁剪与分级 + 自检覆盖原生路且不落扫码内容', async () => {
  const src = readSrc();
  // ① 出码默认全屏（用户实测「扫半天」里有一半是 24mm 小码对焦吃力）
  assert.ok(src.includes('window.__bakQrOn = true;'), '出码成功即置全屏态旗标');
  // v10.1.7 用户拍板推翻 10.1.6 的"默认全屏"：出码后保持弹窗原样，想看大的点码本身，点放大层任意处还原
  //（与配对码同一交互）。自动全屏＝每次都被迫看一个占满屏幕的东西，比小码更烦。
  assert.ok(!/window\.__bakQrOn = true;\r?\n\s*try \{ showQrLarge/.test(src), '禁回潮：出码后不得自动全屏铺满');
  assert.ok(src.includes("$('#bakQrHolder').addEventListener('click'"), '点码放大在位（手动，与配对码同一交互）');
  assert.ok(!src.includes("id=\"bakEnlarge\"") && !src.includes("id=\"bakCopy\""), '禁回潮：〔放大〕〔复制备份文本〕按钮已按用户要求撤掉');
  assert.ok(src.includes('window.__bakQrOn = false; releaseBakWakeLock();'), '关闭备份弹窗必须交还常亮句柄（不留后台锁）');
  assert.ok(src.includes("if (document.hidden || !window.__bakQrOn)"), '备份码常亮判据必须独立于 qrMask（共用会被下一秒释放：配对码有常亮、备份码没有就是这么分叉的）');
  // ② 只解取景框可见区域 + 分级像素
  assert.ok(src.includes('ctx.drawImage(video, sx, sy, cw, ch, 0, 0, w, hh)'), '只解取景框那块（中心裁剪，与 object-fit:cover 的可见窗口同形）');
  assert.ok(src.includes('const aspect = sr.width / Math.max(1, sr.height);'), '裁剪比例取自取景框实测尺寸');
  // ③ 自检覆盖原生路（上一版只埋网页路，用户按指引去看诊断，得到的是「本机尚未跑过扫码」）
  assert.ok(src.includes("scanDiag({ path: useNative ? 'native-gms'"), '原生路必须也埋点');
  assert.ok(src.includes("result: raw ? '命中' : '空手而归'"), '空手而归要与「没扫过」可分辨');
  assert.ok(src.includes("try { sd = JSON.parse(sessionStorage.getItem('ns_scan_diag') || 'null'); }"), '诊断页优先读会话副本（每开一篇笔记都是整页重载，内存态必丢）');
  // ④ 行为：落会话、只落白名单——扫码原文带着全库密钥，任何 storage 都不能碰
  const app = freshApp();
  const { window } = app;
  const secret = 'https://xuyinji.com.cn/note/nsbak-abc123#k=AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKLLL';
  window.scanDiag({ path: 'native-gms', engine: 'jsqr', frames: 7, hits: 1, len: secret.length, kind: '配对链', result: '命中', 内容: secret });
  const persisted = window.sessionStorage.getItem('ns_scan_diag');
  assert.ok(persisted, '自检要落会话副本');
  assert.ok(persisted.indexOf('AAAABBBB') < 0 && persisted.indexOf('#k=') < 0, '落盘副本绝不含扫码原文或其片段');
  assert.ok(Object.keys(JSON.parse(persisted)).indexOf('内容') < 0, '只允许白名单字段，任意传入键不得透传落盘');
  assert.strictEqual(JSON.parse(persisted).frames, 7, '元信息正常写入');
  app.dom.window.close();
});


test('V11 v10.1.7 免口令出码：本机已有备份笔记密钥就直接生成，不再读口令框；没有才要口令', async () => {
  const app = freshApp('http://localhost/mynote');
  const { window: w, localStorage: ls } = app;
  const raw = webcrypto.getRandomValues(new Uint8Array(32));
  let bin = ''; for (const b of raw) bin += String.fromCharCode(b);
  const stdKeyB64 = btoa(bin);
  ls.setItem('notesync_bak_slot', JSON.stringify({ id: 'nsbak-abc123', salt: 'c2FsdA==' }));
  ls.setItem('notesync_key_nsbak-abc123', stdKeyB64);
  ls.setItem('notesync_key_mynote', stdKeyB64); // 收藏那篇也得有密钥，否则清单为空、走不到写备份那一步
  ls.setItem('notesync_favs', JSON.stringify(['mynote']));
  const calls = [];
  w.writeBackupNote = async (entries, pass, presetKey) => { calls.push({ pass: pass, hasKey: !!presetKey }); return { id: 'nsbak-abc123', url: 'http://localhost/nsbak-abc123#k=AAA', doc: '<div></div>' }; };
  w.drawQrTo = () => {};
  // 弹窗必须像真机那样是开着的：不开就会撞进 doBakGenerate 的取消早退门，那这半段只测到"早退"，
  // 出码与常亮那半段零行为覆盖（闸 R2 末轮点名的 V11 盲区）
  w.document.getElementById('bakMask').classList.remove('hidden');
  await w.doBakGenerate(await w.getBakKey());
  assert.strictEqual(calls.length, 1, '免口令路径应直达写备份（不必先填口令框）');
  assert.strictEqual(calls[0].hasKey, true, '必须把本机已存的密钥传下去');
  assert.strictEqual(calls[0].pass, '', '免口令时口令必须是空串（证明没读输入框）');
  assert.ok(!w.document.getElementById('bakStage2').classList.contains('hidden'), '写完后必须停在出码态（看得见二维码）');
  assert.strictEqual(w.__bakQrOn, true, '出码成功必须置常亮旗标——早退门若把它挡掉，这里就是零覆盖');
  assert.strictEqual(w.document.getElementById('bakErr').textContent, '', '正常出码不该带报错');
  // 反证：本机没有密钥时仍然要口令——不能拿空密钥去写。先显示弹窗：不显示就必须走取消早退门，
  // 那样这半段其实只测了"早退"，出码那半段零覆盖（闸 R2 末轮点名的 V11 盲区）
  const calls2 = [];
  w.writeBackupNote = async (entries, pass, presetKey) => { calls2.push({ pass: pass, hasKey: !!presetKey }); return { id: 'x', url: 'y', doc: 'z' }; };
  w.document.getElementById('bakMask').classList.remove('hidden');
  ls.removeItem('notesync_key_nsbak-abc123');
  w.document.getElementById('bakPass').value = '';
  await w.doBakGenerate(await w.getBakKey());
  assert.strictEqual(calls2.length, 0, '没有本机密钥且口令为空时不得写备份');
  assert.strictEqual(w.document.getElementById('bakErr').textContent, '请输入口令', '要口令时必须在界面上说清楚');
  const src = readSrc();
  assert.ok(src.includes('const preKey = await getBakKey();'), '菜单入口的免口令分支在位');
  assert.ok(src.includes('async function getBakKey()'), 'getBakKey 在位');
  // 本机密钥失效时必须"清掉坏钥 + 回退要口令 + 界面上说清楚"，否则会陷入"拿着坏钥反复失败且不知为何"
  assert.ok(/if \(presetKey\) \{[^\n]*readBakSlot\(\)[^\n]*removeItem\(KEY_PREFIX/.test(readSrc()), '验钥失败要清掉本机坏密钥');
  assert.ok(src.includes("bakErr.textContent = '本机存的备份密钥已失效，请输入口令'"), '失效原因必须上界面');
  app.dom.window.close();
});

// V12 v10.1.7 发版闸回修守卫。来源：第一轮 R1/R2/R3 三路独立命中同一 P0（免口令那条路根本不显示弹窗），
// 加上评审点名的六处 P1。每条断言都锚在本轮真正改过的那一行形态上，逐条做过变异反证（把修复反撤 → 必红）。
test('V12 v10.1.7 闸修：弹窗显示早于免口令分支 / 403 作废本机钥 / 计时器早于 startScan / 浮层锁色成对 / 抓拍不再卡 ctx', () => {
  const src = readSrc();
  // ① 免口令入口必须先把弹窗本体显示出来（V11 直调 doBakGenerate 绕过本入口，正是它的盲区）
  const h = src.slice(src.indexOf("$('#menuBackup').addEventListener"), src.indexOf("bakPass.addEventListener('input'"));
  assert.strictEqual((h.match(/bakMask\.classList\.remove\('hidden'\)/g) || []).length, 1,
    '「开弹窗」在整个入口里只准写一处：分叉里各抄一遍必漏一半（v10.1.7 那个三路独立命中的 P0 就是这么来的）');
  assert.ok(h.indexOf("bakMask.classList.remove('hidden');") < h.indexOf('await doBakGenerate(preKey)'),
    '免口令出码之前弹窗必须已经显示（否则二维码画进隐形弹窗：备份真写进服务器、屏幕上啥也没有、还关不掉）');
  assert.ok(h.indexOf("bakMask.classList.remove('hidden');") > h.indexOf('const preKey = await getBakKey();'),
    '先取密钥定好态、再一次性开弹窗：不得先闪一框空口令给人看（与"不再要口令"的口径自相矛盾）');
  assert.ok(!/if \(preKey\) \{[^\n]*bakShowStage/.test(h), '禁回潮：免口令分支里自己抄一遍开弹窗（分叉必漏另一半）');
  // ② 403 死循环：本机有钥→免口令→又 403，且这条路永远读不到口令框。硬抛不降级是红线，但本机那把钥要当场作废
  const wf = src.slice(src.indexOf('async function writeBackupNote'), src.indexOf('// ── 出码弹窗'));
  assert.ok(/status === 403/.test(wf), '凭据不符仍然硬抛 403（绝不自动降级）');
  assert.ok(/status === 403[\s\S]{0,420}removeItem\(KEY_PREFIX/.test(wf), '403 时必须作废本机那把钥，否则免口令→403 死循环、用户没有重来的一步');
  assert.ok(/presetKey \? '本机存的备份密钥已失效，请输入口令' : '口令不对/.test(wf),
    '打错口令与本机密钥失效不能共用一句报错（共用的话会把用户推向错误的自救）');
  assert.ok(src.includes('color:rgba(233,232,227,.62);-webkit-text-fill-color:rgba(233,232,227,.62)'),
    '网页取景框那条状态行（现在是"卡住原因"的落点）同样必须成对，否则日间主题下深底深字看不见');
  assert.ok(src.includes("setScanHint('让码完整落在框里 · ' + scanWhyShort())"), '网页层卡住原因同样必须写屏');
  // ⑥ 抓拍不再被 detector 卡死
  assert.ok(!src.includes('if (done || !video.videoWidth || !ctx)'), '禁回潮：抓拍用 ctx 判空——detector 在位时 ctx 是 null，第一下必报「画面还没准备好」');
  assert.ok(!src.includes('let cvs = detector ? null :'), '禁回潮：canvas/ctx 只在无 detector 时才建');
  assert.ok(/window\.__nsSnap = async \(\) => \{[\s\S]{0,700}typeof window\.jsQR !== 'function' && !\(await loadJsQR\(\)\)/.test(src),
    'detector 那条路上 jsQR 从没加载过，抓拍必须自己把它拉进来');
  // ⑦ 已删功能的死路指引
  assert.ok(!src.includes('请换用「复制备份文本」'), '禁回潮：报错指向本版已删的〔复制备份文本〕');
  assert.ok(!src.includes('请用「粘贴备份文本」'), '禁回潮：报错指向本版已撤的粘贴入口');
    assert.ok(!src.includes('收藏与已解锁笔记'), '弹窗文案不得再承诺"带未收藏的已解锁笔记"（本版定稿只备份收藏夹）');
  // ⑧ 二轮评审补的五条：取消门 / 相机交还 / 借光要关 / 句柄归属 / 未挂载时的反馈 / 死代码不得留
  assert.ok(/if \(bakMask\.classList\.contains\('hidden'\)\) \{ setStatus\(false, '已取消换机备份'\); return; \}\r?\n\s*bakShowStage\(2\);/.test(src),
    '写入那几秒里用户取消后，不得把二维码和常亮句柄塞回已经关掉的弹窗（隐形 stage2 没有「关闭」＝P0 从另一扇门回来）');
  assert.ok(!src.includes('window.__nsWatchdog'), '15 秒 watchdog 不得挂 window：全局单槽时并发两层互踩（后层覆盖 id＝前层 timer 成孤儿，前层收场又清掉后层的 watchdog＝后层丢自救）');
  assert.ok(/try \{ if \(window\.__nsSnap === mySnap\) window\.__nsSnap = null/.test(src), '抓拍句柄只摘自己那一层挂上的那把（旧层迟到收场不得摘掉新层句柄）');
  assert.ok(/snapBtn\.addEventListener\('click', \(\) => \{ if \(typeof window\.__nsSnap === 'function'\) window\.__nsSnap\(\); else setScanHint/.test(src),
    '句柄还没挂上时点〔抓拍识别〕也要给一句反馈（静默＝用户以为按钮坏了）');
  assert.ok(!/try \{ bakGo\.disabled = !bakPass\.value; \} catch \(e2\)/.test(src), '禁回潮：失效回退分支里改 bakGo.disabled（同一函数 finally 无条件置 false，那是死代码）');
  // ⑨ 第三轮（R2 终态审）命中"修复自己带进来的形状"五条
  assert.ok(src.includes("if (nsScanBusyAt && now - nsScanBusyAt < NS_SCAN_BUSY_MS) { scanFeedback('扫码已在进行中'); return; }")
    && src.includes('finally { nsScanBusyAt = 0; }') && !/let nsScanBusy = false;/.test(src),
    '重入锁必须用带过期的时间戳并可提示：布尔锁遇到永不 resolve 的 await（谷歌取景框/系统权限框/getUserMedia 冷启动）会把「扫一扫」永久锁死、第二下毫无提示——比它要防的叠层更糟');
  assert.ok(src.includes('async function nsScanOnce() {'), '重入锁包在外层，真链路抽成 nsScanOnce（两者必须同时在位）');
  assert.ok(/gms: gmsAvail, result: '',[\s\S]{0,40}frames: 0, hits: 0, miss: 0, errs: 0, err0: '', cam: '0x0', dec: '', ms: 0, len: 0, kind: ''/.test(src),
    '每场扫码开场必须把**整场账**归零：原生层不重置这些，6 秒上屏的"原因"会把上一场的「画面 1280x720/首错」当实况播报');
  assert.ok(src.includes("'服务器拒绝了写入（备份笔记已被别的口令认领）' + (presetKey ?"),
    '403 的"本机密钥已作废"只能在真用了本机密钥时说（口令打错那一路说它是假话）');
  assert.ok(/if \(preKey\) \{\r?\n\s*bakShowStage\(2\); bakTip\.textContent = '正在写入备份…';/.test(h),    '免口令时不得闪那个带空口令框的态（口径是"不再要口令"，摆一框口令给人看＝自相矛盾）：直接进 stage2 报进度');
  assert.ok(/if \(!col\.f\.length\) \{ bakShowStage\(1\); bakErr/.test(src) && /catch \(e\) \{ bakShowStage\(1\); bakErr\.textContent = '二维码生成失败/.test(src)
    && /catch \(e\) \{\r?\n\s*bakShowStage\(1\);[^\n]*\r?\n\s*bakErr\.textContent = \(e && e\.msg\)/.test(src),
    '三处报错前都必须先把能看见的态切回来：免口令时我们停在 stage2，而报错的 .err 画在 stage1 里＝静默失败');
  assert.ok(src.includes("'。看不清就点一下码'"), '放大改手动后必须给屏上指引：cursor 只在桌面生效，手机上没有任何线索');
  assert.ok(src.includes("bakGo.disabled = !bakPass.value; bakGo.textContent = oldLabel;"),
    '出码收场的按钮判据必须与口令框对齐（旧写法一律 enabled：空口令时手快一下撞出「请输入口令」假报错，密钥失效回退到口令态后同样错）');
  assert.ok(h.includes("try { bakQrHolder.innerHTML = ''; }"), '进度态必须先清掉上一张码：关窗只清了 bakQrUrl 没清画布，不清会在"正在写入备份…"下面闪一张旧码');
});
