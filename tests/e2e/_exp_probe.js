const { chromium } = require('playwright');
const { startServer } = require('./server');
(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text()); });
  await page.goto('http://localhost:' + server.address().port + '/');
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
    const ed = document.getElementById('editor');
    window.__ce = ed.contentEditable;
    window.__hits = [];
    ed.addEventListener('keydown', e => { if (e.key === 'Enter') window.__hits.push('enter-seen'); }, true);
  });
  console.log('contentEditable =', await page.evaluate(() => window.__ce));
  console.log('isContentEditable =', await page.evaluate(() => document.getElementById('editor').isContentEditable));

  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.innerHTML = ''; ed.focus(); });
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  console.log('hits =', JSON.stringify(await page.evaluate(() => window.__hits)));
  console.log('activeElement id =', await page.evaluate(() => document.activeElement && document.activeElement.id));
  console.log('html after Enter =', JSON.stringify(await page.evaluate(() => document.getElementById('editor').innerHTML)));

  // manual execCommand test
  const manual = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = 'abc';
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    const supported = document.queryCommandSupported ? document.queryCommandSupported('insertParagraph') : 'n/a';
    let ret;
    try { ret = document.execCommand('insertParagraph'); } catch (err) { ret = 'THROW ' + err.message; }
    return { supported, ret, html: ed.innerHTML };
  });
  console.log('manual execCommand =', JSON.stringify(manual));

  // insertLineBreak fallback test
  const manual2 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = 'abc'; ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    let ret; try { ret = document.execCommand('insertHTML', false, '<div><br></div>'); } catch (e) { ret = 'THROW'; }
    return { ret, html: ed.innerHTML };
  });
  console.log('insertHTML test =', JSON.stringify(manual2));

  await browser.close(); server.close();
})();
