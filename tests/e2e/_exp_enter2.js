const { chromium } = require('playwright');
const { startServer } = require('./server');
(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto('http://localhost:' + server.address().port + '/');
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => { document.getElementById('landing')?.classList.add('hidden'); document.getElementById('mask')?.classList.add('hidden'); });

  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.innerHTML = ''; ed.focus(); });
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  console.log('ASCII after Enter immediate:', JSON.stringify(await page.evaluate(() => document.getElementById('editor').innerHTML)));
  await page.keyboard.type('world');
  await page.waitForTimeout(800);
  console.log('ASCII after world:', JSON.stringify(await page.evaluate(() => document.getElementById('editor').innerHTML)));

  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.innerHTML = '第一行'; });
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  console.log('CJK(evaluate-caret) Enter immediate:', JSON.stringify(await page.evaluate(() => document.getElementById('editor').innerHTML)));

  // CJK typed then Enter (IME-like): type then Enter
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.innerHTML = ''; ed.focus(); });
  await page.keyboard.type('第一行');
  await page.waitForTimeout(50);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  console.log('CJK(typed) Enter immediate:', JSON.stringify(await page.evaluate(() => document.getElementById('editor').innerHTML)));

  await browser.close(); server.close();
})();
