const { chromium } = require('playwright');
const { startServer } = require('./server');

function dbg(label, o) { console.log(label, JSON.stringify(o, null, 2)); }

(async () => {
  const server = await startServer();
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });

  async function setCaretBefore(ch) {
    await page.evaluate((c) => {
      const ed = document.getElementById('editor');
      ed.focus();
      const tn = ed.firstChild;
      const idx = tn.nodeValue.indexOf(c);
      const r = document.createRange();
      r.setStart(tn, idx);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }, ch);
  }

  // ── Bug 3: 一二三四五六, caret before 四, press Enter
  await page.evaluate(() => { document.getElementById('editor').innerHTML = '一二三四五六'; });
  await setCaretBefore('四');
  dbg('BEFORE Enter:', await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0);
    return { node: r.startContainer.nodeValue, offset: r.startOffset, html: document.getElementById('editor').innerHTML };
  }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  dbg('AFTER Enter (immediate):', await page.evaluate(() => {
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);
    return { html: document.getElementById('editor').innerHTML, type: sel.type, rangeCount: sel.rangeCount,
      startContainer: (r.startContainer.nodeType===3? JSON.stringify(r.startContainer.nodeValue) : r.startContainer.outerHTML), startOffset: r.startOffset,
      parentHTML: r.startContainer.parentElement ? r.startContainer.parentElement.outerHTML : null };
  }));
  await page.waitForTimeout(800);
  dbg('AFTER Enter (post-linkify 800ms):', await page.evaluate(() => {
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);
    return { html: document.getElementById('editor').innerHTML, type: sel.type, rangeCount: sel.rangeCount,
      startContainer: (r.startContainer.nodeType===3? JSON.stringify(r.startContainer.nodeValue) : r.startContainer.outerHTML), startOffset: r.startOffset,
      parentHTML: r.startContainer.parentElement ? r.startContainer.parentElement.outerHTML : null };
  }));

  // ── Bug 4: empty editor + Enter
  await page.evaluate(() => { const ed=document.getElementById('editor'); ed.innerHTML=''; ed.focus(); });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  dbg('EMPTY + Enter immediate:', await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    return { html: ed.innerHTML, type: sel.type, rangeCount: sel.rangeCount };
  }));
  await page.waitForTimeout(800);
  dbg('EMPTY + Enter post-linkify:', await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { html: ed.innerHTML };
  }));

  // ── Bug 2: paste a URL, see if it becomes <a>
  await page.evaluate(() => { const ed=document.getElementById('editor'); ed.innerHTML=''; ed.focus(); });
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const dt = new DataTransfer();
    dt.setData('text/plain', 'http://www.baidu.com');
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(120);
  dbg('PASTE URL immediate:', await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { html: ed.innerHTML, hasA: !!ed.querySelector('a'), aHref: ed.querySelector('a')?.getAttribute('href') };
  }));
  await page.waitForTimeout(800);
  dbg('PASTE URL post-linkify:', await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { html: ed.innerHTML, hasA: !!ed.querySelector('a'), aHref: ed.querySelector('a')?.getAttribute('href') };
  }));

  await browser.close();
  server.close();
})();
