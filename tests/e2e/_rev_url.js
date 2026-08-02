// 复核脚本：URL 识别正确性（误判 / 漏判）—— 只读，不修改 index.html
const { chromium } = require('playwright');
const { startServer } = require('./server');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const server = await startServer();
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.log('PAGEERR', e.message); });
  await page.goto(baseURL);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });

  // 直接把文本塞进 editor 再调 linkifyEditor（不聚焦，避免选区干扰），读回 <a>
  async function linkOf(text) {
    return page.evaluate((t) => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '';
      ed.appendChild(document.createTextNode(t));
      window.linkifyEditor({ keepSelection: false });
      return {
        html: ed.innerHTML,
        links: Array.from(ed.querySelectorAll('a')).map(a => ({
          text: a.textContent.replace(/\u200B/g, ''), href: a.getAttribute('href')
        }))
      };
    }, text);
  }

  console.log('\n=== 1. 应该识别为链接（漏判检测）===');
  const shouldLink = [
    ['http://example.com', 'http://example.com'],
    ['https://www.baidu.com', 'https://www.baidu.com'],
    ['www.baidu.com', 'www.baidu.com'],
    ['example.com', 'example.com'],
    ['访问 www.baidu.com 看看', 'www.baidu.com'],
    ['https://github.com/user/repo', 'https://github.com/user/repo'],
    // 关键：带文件扩展名结尾的真 URL 不该被 FILE_EXT_DENY 误杀
    ['https://github.com/u/r/README.md', 'https://github.com/u/r/README.md'],
    ['https://cdn.example.com/lib.js', 'https://cdn.example.com/lib.js'],
    ['http://x.com/a.zip', 'http://x.com/a.zip'],
    ['https://a.com/pic.png', 'https://a.com/pic.png'],
  ];
  for (const [text, want] of shouldLink) {
    const r = await linkOf(text);
    const hit = r.links.some(l => l.text === want);
    check(`应链接: ${text}`, hit, { got: r.links, html: r.html });
  }

  console.log('\n=== 2. 不该识别为链接（误判检测）===');
  const shouldNotLink = [
    'README.md',
    'file.txt',
    '3.14',
    'v1.2.3',
    'a.b',
    '这是中文。另一句话',
    'x@y.com',                 // 邮箱
    'mail: zhang@qq.com',      // 邮箱带前缀
    '1.Introduction',          // 无空格编号标题
    '2.Setup',
    'etc.Then it works',       // 句子里句号后紧跟大写词
    '版本 1.0.0 发布',
    'config.ini',
    '192.168.1.1',             // 纯 IP（无 TLD 字母）
  ];
  for (const text of shouldNotLink) {
    const r = await linkOf(text);
    check(`不该链接: ${text}`, r.links.length === 0, { got: r.links });
  }

  console.log('\n=== 3. 手机号 ===');
  {
    const r = await linkOf('打给我 13800138000 谢谢');
    check('手机号仍成 tel: 链接', r.links.some(l => l.href === 'tel:13800138000'), r.links);
  }

  console.log('\n=== 4. href 规范化 ===');
  {
    const r = await linkOf('www.baidu.com');
    check('裸域名 href 补 https://', r.links[0] && r.links[0].href === 'https://www.baidu.com', r.links);
  }
  {
    const r = await linkOf('http://example.com');
    check('已有 scheme 不重复加', r.links[0] && r.links[0].href === 'http://example.com', r.links);
  }

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) console.log('失败项:\n - ' + fails.join('\n - '));
  console.log('pageerror 数量: ' + errs.length);
  await browser.close();
  server.close();
  process.exit(0);
})();
