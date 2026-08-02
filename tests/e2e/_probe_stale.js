// 验证 stale-href 修复：链接文字被改动后，href 应随文本刷新
const { chromium } = require('playwright');
const { startServer } = require('./server');
(async () => {
  const server = await startServer();
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => { document.getElementById('landing')?.classList.add('hidden'); document.getElementById('mask')?.classList.add('hidden'); });

  const r = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>go http://old.com/x end</div>';
    window.linkifyEditor({ keepSelection: false });
    const a = ed.querySelector('a[data-url="1"]');
    const before = { text: a.textContent, href: a.getAttribute('href') };
    // 模拟用户把链接文字改长（不改 DOM 结构，只改文本节点）
    const tn = a.firstChild;
    tn.nodeValue = 'http://new-long-domain.com/y';
    window.linkifyEditor({ keepSelection: false });
    const a2 = ed.querySelector('a[data-url="1"]');
    const after = { text: a2 ? a2.textContent : null, href: a2 ? a2.getAttribute('href') : null };
    return { before, after };
  });
  console.log('before:', JSON.stringify(r.before));
  console.log('after :', JSON.stringify(r.after));
  const ok = r.after && r.after.href === 'http://new-long-domain.com/y' && r.after.text.replace(/\u200B/g, '') === 'http://new-long-domain.com/y';
  console.log(ok ? 'PASS stale-href 已修复（href 随文本刷新）' : 'FAIL stale-href 仍存在');
  await browser.close(); server.close(); process.exit(ok ? 0 : 1);
})();
