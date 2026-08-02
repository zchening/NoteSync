// 探针：复现 backspace 合并后首行空块被误删
// 场景：<div></div><div>一</div><div>二</div>，光标在第三行"二"左侧，按 Backspace
// 期望：<div></div><div>一二</div>（首行空块保留）
// 实际（bug）：<div>一二</div>（首行空块被 cleanup 误删，内容上移）
const { chromium } = require('playwright');
const { startServer } = require('./server');

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto('http://localhost:' + server.address().port + '/');
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });

  await page.evaluate(() => {
    const ed = document.getElementById('editor'); // 直接设 DOM（跳过口令解锁后的内部初始化）
    ed.innerHTML = '<div></div><div>一</div><div>二</div>';
    ed.focus();
  });
  await page.waitForTimeout(50);

  // 光标放到第三行"二"左侧
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const divs = ed.querySelectorAll('div');
    const third = divs[divs.length - 1];
    const r = document.createRange();
    r.setStart(third, 0); r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  const imm = await page.evaluate(() => document.getElementById('editor').innerHTML);
  await page.waitForTimeout(700); // 等 cleanup + linkify
  const fin = await page.evaluate(() => document.getElementById('editor').innerHTML);

  console.log('初始设定: <div></div><div>一</div><div>二</div>');
  console.log('Backspace 后(立即): ' + imm);
  console.log('Backspace 后(700ms): ' + fin);

  const expect = '<div></div><div>一二</div>';
  const ok = fin === expect;
  console.log('\n期望: ' + expect);
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL (首行空块被吞)');

  await browser.close(); server.close();
  process.exit(ok ? 0 : 1);
})();
