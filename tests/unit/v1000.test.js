// v10.0.0 渲染消毒专项单测（jsdom 真跑 nsSanitizeHtml，不是正则扫源码）。
// 两条主线：① 恶意构造必须被摘；② 干净内容必须逐字节原样返回——后者更要紧，
// 因为冲突检测拿 lastHtml 与 editor.innerHTML 比字符串，消毒若改写正常内容就是造新事故。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { webcrypto } = require('node:crypto');
const { loadApp } = require('../helpers');

let _w = null;
function app() {
  if (_w) return _w;
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); } catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  });
  _w = dom.window;
  return _w;
}
// 页面有每秒心跳 setInterval，不关窗则 node --test 进程不退出（本仓 unit 惯例：用完即关）
after(() => { if (_w) { try { _w.close(); } catch (e) {} _w = null; } });

// ── S1：干净内容零改写（用 App 实际产出的结构，含全部承重标记）────────────
test('S1 正常正文消毒后逐字节不变（rem-mark/裸u/折叠块/内联img/链接/ZWSP/style）', () => {
  const w = app();
  const clean = [
    '<div>今天记三件事</div>',
    '<div><br></div>',
    '<div class="ns-fold-collapsed">[折叠] 会议纪要</div>',
    '<div class="ns-fold-body" style="display:none">细节在下方&nbsp;列表</div>',
    '<u class="rem-mark" data-m="1700000000000">明天下午三点</u>交材料',
    '<u>普通下划线</u>和<b>粗体</b><i>斜体</i><s>删除线</s>',
    '<a href="https://example.com/a?x=1&amp;y=2" data-url="https://example.com/a?x=1&amp;y=2">链接</a>',
    '<img src="https://res.cloudinary.com/demo/image/upload/v1/abc.jpg" alt="">',
    '<div>零宽​字符与 emoji 😀 也应原样留着</div>',
    '<div>中文标点：「」、——；以及 &lt;转义&gt; 与 &amp;</div>',
  ].join('');
  const out = w.nsSanitizeHtml(clean);
  assert.strictEqual(out, clean, '干净内容被改写了——会连带把冲突检测带偏');
});

// ── S2～S6：恶意构造必须被摘 ──────────────────────────────────────────
test('S2 <img onerror> 事件属性被摘，img 本体与 src 保留', () => {
  const w = app();
  const out = w.nsSanitizeHtml('<img src="https://cdn/x.jpg" onerror="alert(1)">');
  assert.ok(!/onerror/i.test(out), 'onerror 未被摘除: ' + out);
  assert.ok(out.includes('src="https://cdn/x.jpg"'), '正常 img 不该被连带毁掉: ' + out);
});

test('S3 任意 on* 一律摘（onclick/onload/onmouseover）', () => {
  const w = app();
  const out = w.nsSanitizeHtml('<div onclick="a()" onload="b()" onmouseover="c()" class="keep">x</div>');
  assert.ok(!/on(click|load|mouseover)/i.test(out), '仍有 on* 残留: ' + out);
  assert.ok(out.includes('class="keep"'), 'class 是承重属性，必须留着');
});

test('S4 javascript: 协议 href/src 被摘，含 java\\tscript 与前置空白变体', () => {
  const w = app();
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', 'javascript&#58;alert(1)']) {
    const out = w.nsSanitizeHtml('<a href="' + bad + '">x</a>');
    assert.ok(!/javascript/i.test(out.replace(/&#58;/g, ':')), '未拦下 [' + bad + '] → ' + out);
  }
});

test('S5 script / iframe / object 整节点摘除，前后文本不丢', () => {
  const w = app();
  const out = w.nsSanitizeHtml('<div>前<script>alert(1)</script>中<iframe src="https://evil"></iframe><object data="x"></object>后</div>');
  assert.ok(!/script|iframe|object/i.test(out), '危险节点残留: ' + out);
  assert.ok(out.includes('前') && out.includes('中') && out.includes('后'), '周边文本被连带吃掉: ' + out);
});

test('S6 svg 内嵌脚本路径被摘（本项目正文不用 svg，出现即视为注入）', () => {
  const w = app();
  const out = w.nsSanitizeHtml('<div><svg><script>alert(1)</script></svg></div>');
  assert.ok(!/svg|script/i.test(out), 'svg 残留: ' + out);
});

// ── S7：直通与健壮性 ────────────────────────────────────────────────
test('S7 纯文本/空值直通，不抛异常', () => {
  const w = app();
  assert.strictEqual(w.nsSanitizeHtml('就是普通文字，没有标签'), '就是普通文字，没有标签');
  assert.strictEqual(w.nsSanitizeHtml(''), '');
  assert.strictEqual(w.nsSanitizeHtml(null), null);
  assert.strictEqual(w.nsSanitizeHtml(undefined), undefined);
});

test('S8 幂等：消毒结果再消毒一次必须完全不变（防二次改写破坏内容）', () => {
  const w = app();
  const once = w.nsSanitizeHtml('<div>a<script>x</script><img src="https://c/i.jpg" onerror="e()"></div>');
  assert.strictEqual(w.nsSanitizeHtml(once), once, '二次消毒改写了结果');
});

// ── S9：接点齐全（防以后新增解密上屏路径漏挂消毒）────────────────────
test('S9 所有解密上屏点都挂了消毒（精确计数 + 负向），且凭据链完整', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(src.includes('function nsSanitizeHtml('), '消毒函数本体应在');
  const n = (src.match(/nsSanitizeHtml\(await decryptText\(/g) || []).length;
  assert.strictEqual(n, 13, '解密结果过消毒的点数应恰好为 13（9 个渲染口 + 4 个比较器入口），实测 ' + n);
  // 第三轮复核抓出的"看起来实现了、实际没生效"形态：真主创建序列里落盐那一枪是**最早**的认领时机
  // （此刻 cryptoKey 尚未赋值，不显式传 key 就发不出凭据），错过它就要等到首次打开才补认，
  // 窗口白送一段时间——所以这一枪必须带凭据。
  assert.ok(/apiPut\(\{ ct: note\.ct \|\| '', iv: note\.iv \|\| '', salt: currentSaltB64\(\) \}, \{ wkKey: key \}\)/.test(src),
    '落盐 PUT 必须显式用新派生的 key 带凭据（最早的认领时机）');
  // 第五轮复核①P0：本机密钥已作废（口令在别处改过）时绝不能再拿它去认领，
  // 否则笔记被登记成旧凭据的哈希，刚改完口令的真主会被硬 403 锁死且无 wkOld 可自证。
  assert.ok(/if \(auKeyGood\) claimNote\(\);/.test(src), '自动解锁路径必须先解密成功才允许认领');
  assert.ok(/async function claimNote\(\)[\s\S]{0,900}r\.status === 403/.test(src),
    '认领返回 403 必须当场可见提示，不能等保存到被拒才发现');
  // 复核①：只数「直调 decryptText」这种形态会漏掉「先存变量再传进函数」的路径——
  // applyRemoteBody / autoMergeSave 当初正是这么漏网的，这里把两个收口点单独钉死。
  assert.ok(/async function applyRemoteBody\(note, html\) \{[\s\S]{0,220}html = nsSanitizeHtml\(html\);/.test(src),
    'applyRemoteBody 入口必须收口消毒（远端正文进 DOM 的总闸）');
  assert.ok(/async function autoMergeSave\(note, remoteHtml\) \{[\s\S]{0,400}remoteHtml = nsSanitizeHtml\(remoteHtml\);/.test(src),
    'autoMergeSave 的远端侧必须消毒');
  assert.ok(src.includes("const mergedHtml = nsSanitizeHtml(merged.blocks.join(''));"),
    '三方合并结果（要落库+上屏）必须消毒');
  // 负向：不许出现「editor.innerHTML 直接等于未消毒的解密结果」——弱断言只数下界，漏一处照样绿
  const raw = src.match(/editor\.innerHTML\s*=\s*await decryptText\(/g) || [];
  assert.strictEqual(raw.length, 0, '存在未消毒直接上屏的解密路径 ' + raw.length + ' 处');
  assert.ok(src.includes("headers['x-note-key'] = wk"), '主写入凭据头在');
  assert.ok(src.includes('async function wkJsonHeaders()'), '历史写入凭据手链在');
  assert.ok(/deriveWriteKey\(keyOld\)/.test(src), '改口令原子换绑在');
});

// ── S11：MCP 侧签发迁移（闸 R1 命中：web 迁了、MCP 没迁=洞还在）──────
test('S11 MCP 图片上传已迁服务端签发，不再硬编码免签名 preset', () => {
  const fs = require('fs'), path = require('path');
  const mcp = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'notesync-mcp-server.js'), 'utf8');
  assert.ok(!/NoteXCloudinary/.test(mcp), 'MCP 里不得再出现旧免签名 preset 名');
  assert.ok(!/const\s+UPLOAD_PRESET\s*=/.test(mcp), 'MCP 里不得再硬编码 preset 常量');
  assert.ok(!/const\s+CLOUDINARY_URL\s*=/.test(mcp), 'MCP 里不得再拼死上传 URL');
  assert.ok(mcp.includes("BASE + '/api/upsign'"), 'MCP 必须先向自家服务器取一次一签');
  assert.ok(mcp.includes("fd.append('signature', sign.signature)"), 'MCP 上传必须带签名');
  // web 端同源同理：三处壳都不得残留旧 preset
  const idx = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(!/NoteXCloudinary/.test(idx), 'index.html 里旧 preset 必须零残留');
});
// ── S10：data: 型 href（闸 R2-E）──────────────────────────────────
test('S10 href 里的 data: 一律拒（含 svg+xml 载荷），src 的位图 data: 仍放行', () => {
  const w = app();
  const svg = w.nsSanitizeHtml('<a href="data:image/svg+xml,<svg onload=alert(1)>">x</a>');
  assert.ok(!/data:image/i.test(svg), 'href 里的 data:svg 未被摘: ' + svg);
  assert.ok(svg.includes('>x</a>'), '链接文字不该丢: ' + svg);
  const png = w.nsSanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="">');
  assert.ok(png.includes('data:image/png;base64'), '粘贴图/离线兜底要用的位图 data: 不该被误伤: ' + png);
});
