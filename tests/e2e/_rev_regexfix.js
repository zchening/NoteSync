// 只读实验：验证建议修法（不改 index.html），纯正则层面对拍
const CUR = /((?:https?:\/\/|www\.)[^\s<]+|(?:\b|^)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;
const DENY = new Set(['md','txt','js','pdf','png','ini','zip']);

// 建议：1) 前置 (?<![@\w.-]) 排除邮箱/版本号中段；2) deny 只作用于"无 scheme 的裸匹配"，
//       且取 host 的最后一段而非整串最后一段
const FIX = /(?<![@\w.-])((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;
const TLD = new Set(['com','cn','net','org','io','co','me','dev','app','gov','edu','info','xyz','top','vip','cc','tv','ai','so']);

function deny(m) {
  if (/^(?:https?:\/\/|www\.)/i.test(m)) return false;      // 有 scheme/www 前缀 → 一定是 URL
  const host = m.split('/')[0];                              // 只看 host 部分
  const tld = host.split('.').pop().toLowerCase();
  if (DENY.has(tld)) return true;                            // 文件名
  if (!TLD.has(tld)) return true;                            // 裸域名必须是已知 TLD
  return false;
}

const cases = [
  ['http://example.com', true], ['www.baidu.com', true], ['example.com', true],
  ['https://cdn.jsdelivr.net/npm/vue.js', true],
  ['https://github.com/a/b/README.md', true],
  ['http://files.io/report.pdf', true],
  ['README.md', false], ['file.txt', false], ['3.14', false], ['v1.2.3', false],
  ['a.b', false], ['x@y.com', false], ['mail: zhang@qq.com', false],
  ['1.Introduction', false], ['2.Setup', false], ['etc.Then it works', false],
  ['config.ini', false], ['192.168.1.1', false], ['访问 www.baidu.com 看看', true],
];

function run(re, denyFn, label) {
  let p = 0, f = 0;
  console.log('\n--- ' + label + ' ---');
  for (const [text, want] of cases) {
    re.lastIndex = 0;
    let hit = false, got = null;
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      if (!denyFn(m[1])) { hit = true; got = m[1]; break; }
      if (m.index === r.lastIndex) r.lastIndex++;
    }
    if (hit === want) { p++; }
    else { f++; console.log(`  FAIL  "${text}"  want=${want} got=${hit} (${got})`); }
  }
  console.log(`  ${p} PASS / ${f} FAIL`);
  return f;
}

const curDeny = (m) => DENY.has(m.split('.').pop().toLowerCase());
run(CUR, curDeny, '当前实现');
const f = run(FIX, deny, '建议修法');
process.exit(f === 0 ? 0 : 1);
