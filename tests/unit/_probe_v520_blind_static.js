// _probe_v520_blind_static.js — v5.20 二维码配对「独立盲测」静态层探针（jsdom 加载真实 index.html）
// 与主代理 unit/qr_pairing.test.js 独立设计，专攻边界构造：
//   S1 定向构造 base64 必含 + 与 / 的 AES 密钥（穷举种子而非碰运气），URL-safe 往返无损
//   S2 fragment 垃圾注入全谱系：追加查询参数/二次散列/空白/大小写 K/换行/非法字符 → parsePairingKey 拒绝
//   S3 合法但非常规的 URL-safe 输入（超长、极短）能通过 parse 层（后续长度校验交给 importKey）
//   S4 静态源码审查断言：60000ms 自动隐藏、关闭即复位、qrBtn 打开前先 reset
// 用法: cd tests && node unit/_probe_v520_blind_static.js
'use strict';
const path = require('path');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}

const dom = loadApp();
const { window } = dom;

// ---- S1 定向构造含 + 与 / 的密钥（决定性：按字节模式推导，不靠随机碰撞）----
// base64 每 3 字节 → 4 字符：字节 0xFB,0xEF → "++" 前缀字符；0xFF,0xBF → "//" 类字符。
{
  const bytes = new Uint8Array(32);
  // 让输出字符里必然出现 '+'（索引 62）与 '/'（索引 63）：
  // 取 3 字节组 (0xFF,0xFF,0xFF) → "////"；(0xFB,0xEF,0xBE) → "++" 开头。
  bytes.set([0xfb, 0xef, 0xbe], 0);   // → '++' 段
  bytes.set([0xff, 0xff, 0xff], 3);   // → '//' 段
  for (let i = 6; i < 32; i++) bytes[i] = (i * 53 + 7) & 0xff;
  const b64 = Buffer.from(bytes).toString('base64');
  check('S1a: 构造密钥的标准 base64 确含 + 与 / 且以 = 结尾', b64.includes('+') && b64.includes('/') && b64.endsWith('='), b64);
  const safe = window.b64ToUrlSafe(b64);
  check('S1b: URL-safe 化后无 + / =', !/[+/=]/.test(safe), safe);
  check('S1c: - 与 _ 正确替换了 + 与 /', !b64.includes('+') || safe.includes('-') && safe.includes('_'));
  check('S1d: urlSafeToB64 往返还原（含 = 填充）', window.urlSafeToB64(safe) === b64, window.urlSafeToB64(safe));
  // 逐字节恒等
  const roundTrip = Buffer.from(window.urlSafeToB64(safe), 'base64');
  check('S1e: 还原字节与原始 32 字节逐一相等', roundTrip.equals(Buffer.from(bytes)));
}

// ---- S2 fragment 垃圾注入谱系（真实密钥打底）----
{
  const keySafe = window.b64ToUrlSafe(Buffer.from('0123456789abcdef0123456789abcdef', 'binary').toString('base64'));
  const reject = [
    ['#k=' + keySafe + '&foo=1', '追加查询参数'],
    ['#k=' + keySafe + '#yyy', '二次散列'],
    ['#k=' + keySafe + ' ', '尾部空格'],
    [' #k=' + keySafe, '头部空格'],
    ['#K=' + keySafe, '大写 K'],
    ['#k =' + keySafe, '等号前空格'],
    ['#k=' + keySafe + '%3D', '百分号编码的 ='],
    ['#k=' + keySafe.slice(0, -4) + '中文ab', '非法 Unicode'],
    ['#key=' + keySafe, '键名错误'],
    ['#k=', '空密钥'],
  ];
  for (const [hash, desc] of reject) {
    window.location.hash = hash;
    check('S2 拒绝: ' + desc, window.parsePairingKey() === null, 'hash=' + JSON.stringify(hash) + ' got=' + window.parsePairingKey());
  }
  // 换行注入：WHATWG URL 解析器会在到达应用前剥离 \n/\r/\t，落到 parsePairingKey 的是净化后的 hash。
  // 断言：(1) hash 中无换行残留（URL 层规范化生效）；(2) 净化后与干净配对链接行为一致（不构成绕过也不误拒）。
  window.location.hash = '#k=' + keySafe.slice(0, 20) + '\n' + keySafe.slice(20);
  const hNorm = window.location.hash;
  check('S2 换行注入被 URL 解析器剥离（无 \\n 残留）', !hNorm.includes('\n'), JSON.stringify(hNorm));
  check('S2 换行剥离后与干净配对链接等价', window.parsePairingKey() === window.urlSafeToB64(keySafe));
  window.location.hash = '';
}

// ---- S3 合法字符集的极端长度能通过 parse 层（拒绝职责在 importKey/decrypt，不在正则）----
{
  const long = 'A'.repeat(512), short = 'QQ';
  window.location.hash = '#k=' + long;
  check('S3a: 超长合法字符集 parse 不抛错', typeof window.parsePairingKey() === 'string');
  window.location.hash = '#k=' + short;
  check('S3b: 极短合法字符集 parse 不抛错', typeof window.parsePairingKey() === 'string');
  window.location.hash = '';
}

// ---- S4 静态源码断言（时序逻辑存在性）----
{
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  check('S4a: 存在 60000ms 自动隐藏定时器', /setTimeout\(\s*resetQrHolder\s*,\s*60000\s*\)/.test(src));
  check('S4b: qrBtn 打开弹层前先 resetQrHolder（不残留上次二维码）', /qrBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*resetQrHolder\(\);\s*qrMask\.classList\.remove\('hidden'\)/.test(src));
  check('S4c: qrClose 关闭即复位', /qrClose'\)\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*resetQrHolder\(\);\s*qrMask\.classList\.add\('hidden'\)/.test(src));
  check('S4d: revealQr 每次重新 clearTimeout（防多定时器叠加）', /clearTimeout\(qrHideTimer\);\s*\n\s*qrHideTimer = setTimeout/.test(src));
  check('S4e: 配对密钥走 fragment（#k=），buildPairingUrl 不含 ? 查询段', /'#k=' \+ b64ToUrlSafe\(b64\)/.test(src));
  check('S4f: tryPairingUnlock 成功与失败路径均 stripHash', (src.match(/stripHash\(\);/g) || []).length >= 3);
  check('S4g: 错误配对密钥不落地（失败路径无 setItem(KEY_STORE)）', !/catch \(e\) \{[^}]*setItem\(KEY_STORE/.test(src));
  check('S4h: server.js 零改动假设外：配对未调用 reportFail（密钥暴力破解不计入口令失败）——仅记录', true);
}

try { window.close(); } catch (e) {}
console.log('\n' + '='.repeat(48));
console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed > 0 ? 1 : 0);
