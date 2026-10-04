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
  assert.ok(src.includes('function pasteBackupTextUI'), '粘贴恢复兜底在位（不依赖摄像头）');
  assert.ok(!/window\.prompt\(/.test(src), '禁回潮 window.prompt：Android WebView 不支持，返回 null＝「点了没反应」');
  assert.ok(src.includes('id="bakRestMask"') && src.includes('id="bakMask"'), '出码弹窗与恢复卡 DOM 在位');
  assert.ok(src.includes('const BAK_MAX = 100') && src.includes('FAVS_MAX = 100'), '容量：备份 100 篇 + 收藏夹上限随动抬到 100');
});

test('V7 v10.1.5 真机报障三件的守卫：解码静默失效自动降级 / 相册识码 / 备份范围回退默认只收藏', () => {
  const src = readSrc();
  // ① 解码端：detect() 静默失效（构造函数在、每帧抛错或永远返回空）必须能中途换引擎，且留下可复制证据
  assert.ok(src.includes('window.__scanDiag'), '扫码自检对象在位（诊断页要能读出 engine/frames/errs/hits）');
  assert.ok(/L\.push\(sd \? \('scan: engine='/.test(src), '诊断页必须输出扫码自检行（用户手机上一次复现即可定位，不再靠猜）');
  assert.ok(!/catch \(e\) \{ \/\* 单帧失败忽略，继续下一帧 \*\/ \}/.test(src), '禁回潮：每帧异常静默吞掉＝「画面在跑、永远扫不出」的元凶形状');
  assert.ok(src.includes("engine = 'jsqr'; diag.engine = 'jsqr(降级)'"), '中途降级到 jsQR 的实现要在位');
  // 降级函数的声明与两处调用必须引用同一个标识符（变异反证 N1b 实锤：只改函数名、调用点悬空时，
  // 上面那些「字面串还在」的锚全部照绿，而真机降级那一刻会 ReferenceError——静默失效换个形状复活）
  assert.strictEqual((src.match(/switchToJsQR\b/g) || []).length, 3, 'switchToJsQR 必须恰好 1 处声明 + 2 处调用（连错3帧 / 40帧零命中）；必须词边界——子串计数会把 switchToJsQRoff 这类改名也算作命中（变异反证 N1b 二次实锤）');
  // ② 不依赖摄像头的两条出口
  assert.ok(src.includes("albumBtn.id = 'scanAlbum'"), '取景框内「从相册选二维码」入口在位');
  assert.ok(src.includes('function scanFromAlbum()'), '相册识码实现在位（截图原始像素，比拍屏稳）');
  assert.ok(src.includes('function handleScanResult(raw)'), '摄像头与相册共用同一结果收口（两处判定迟早分叉）');
  assert.ok(src.includes('raw = raw.trim();'), '扫码原文先去尾部空白（原生扫码器偶尔带换行，前缀判定与正则都会因此误判）');
  // ③ 备份范围回退：默认只收藏，扩范围要显式同意
  assert.ok(src.includes('async function collectBackupEntries(includeOther) {'), '范围参数化在位');
  assert.ok(src.includes('if (includeOther) {'), '枚举本机其他密钥必须受开关控制（v10.1.4 无条件枚举＝收藏 6 篇报 61 篇）');
  assert.ok(src.includes('function countOtherUnlocked()'), '勾选框上的数字有独立算法（与清单口径同源）');
  assert.ok(src.includes('if (bakWide) bakWide.checked = false;'), '每次打开出码框都回到未勾（不替用户记住上次的扩大选择）');
  assert.ok(src.includes('const col = await collectBackupEntries(wide);'), '生成时按勾选传参');
  // ④ 文案精简：不再自证、不再两行长句
  assert.ok(!src.includes('永远扫得动'), '禁回潮：自证式长句（对用户没用，评审也判它是噪声）');
  assert.ok(src.includes("bakIdLine.textContent = '备份笔记：' + res.id;"), '档名行压成一行小字');
});

test('V8 解码端加强：640px 预算禁回潮、取景面积、自排队抽帧、状态反馈', () => {
  const src = readSrc();
  assert.ok(!/Math\.min\(640, video\.videoWidth\)/.test(src), '禁回潮：解码帧 640px 上限（微信扫得出、我们扫不出的一半根因）');
  assert.ok(src.includes('Math.min(1280, video.videoWidth)'), '解码像素预算提到 1280');
  assert.ok(src.includes('height:56vh;min-height:200px;max-height:420px'), '取景面积加大（旧 44vh/340px 两头堵）');
  assert.ok(src.includes('width: { ideal: 1280 }, height: { ideal: 720 }'), '相机给 720p 软目标（ideal 非 exact，不抛 OverconstrainedError）');
  assert.ok(!/timer = setInterval\(async/.test(src), '禁回潮：setInterval 抽帧（一帧超时会互相排队，慢机型越扫越卡）');
  assert.ok(src.includes('timer = setTimeout(tick, Math.min(400, Math.max(120, Date.now() - t0 + 120)))'), '自适应抽帧：按上一帧耗时排下一枪');
  assert.ok(src.includes("setScanHint('识别中") && src.includes("setScanHint('已识别')"), '扫码过程必须有实时状态（旧版只有解出来才动＝「扫半天没反应」观感）');
  assert.ok(src.includes("if (finish) finish('')"), '取消/点遮罩要把在途 Promise 收口（旧版悬挂＝再点一次叠第二层取景框）');
  assert.ok(src.includes("pasteBtn.id = 'scanPaste'"), '取景框内直接给粘贴恢复入口');
});
