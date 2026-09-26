// v10.1.3 真浏览器验证：存量 br 形态笔记打开 → 硬化劈块 → "1，橙子"恢复缩进与左引导线
const { chromium } = require('playwright');
const { startServer } = require('./server');

const HTML = [
  '<div>[折叠]哈哈<br>1，橙子：尿不湿→内裤</div>',
  '<div>2，橙子吃桃子，牛奶。燕麦片。</div>',
  '<div>3，菜：</div>',
  '<div>-豆腐，娃娃菜，番茄，雪菜。包子，馒头，炖鸡汤，牛肉丸。</div>',
  '<div>-鱼。</div>',
  '<div>4，蛀牙处理</div>',
  '<div>5，找高跟鞋，修旧高跟鞋</div>',
  '<div>6，发票信息备注确认@梁静13958084173</div>',
  '<div>7，趣学桌游→能否生成完全线上版本</div>',
  '<div>8，银吉iPhone备份</div>',
].join('');

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput');
  await page.fill('#landingInput', 'brhard1');
  await page.click('#landingBtn');
  await page.waitForFunction(n => location.pathname.endsWith(n), 'brhard1', { timeout: 10000 });
  await page.waitForSelector('#pw');
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true');
  // 展开态（全部展开）看缩进与竖线
  await page.evaluate(h => {
    const ed = document.getElementById('editor');
    ed.innerHTML = h;
    try { localStorage.setItem('notesync_fold_open', JSON.stringify({})); } catch (e) {}
    window.applyFolds();
  }, HTML);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const rows = Array.prototype.map.call(ed.children, b => {
      const cs = getComputedStyle(b);
      return { cls: b.className || '(none)', txt: (b.textContent || '').replace(/\u200B/g, '').slice(0, 16),
        ml: cs.marginLeft, pl: cs.paddingLeft, bl: cs.borderLeftWidth };
    });
    const orange = rows.find(x => x.txt.indexOf('1，橙子') === 0) || {};
    return { rows, orange, anchors: (ed.textContent.match(/\[\/折叠\]/g) || []).length };
  });
  console.log('anchors=', r.anchors);
  r.rows.forEach((x, i) => console.log(String(i).padStart(2), '|', x.cls.padEnd(36), '| ml=' + x.ml, 'pl=' + x.pl, 'bl=' + x.bl, '|', x.txt));
  console.log('=== "1，橙子"行 ===');
  console.log('class =', r.orange.cls, '| marginLeft =', r.orange.ml, '| paddingLeft =', r.orange.pl, '| borderLeft =', r.orange.bl);
  const okIndent = r.orange.cls.indexOf('ns-fold-body') >= 0;
  console.log(okIndent ? '[PASS] 1，橙子 已独立入组（ns-fold-body，缩进+竖线恢复）' : '[FAIL] 1，橙子 仍未入组');
  await browser.close().catch(() => {});
  try { server.close(); } catch (e) {}
  process.exit(okIndent ? 0 : 1);
})();
