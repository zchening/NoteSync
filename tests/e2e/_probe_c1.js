// 探针：复现 C1 每一步的 DOM，定位 def 丢失原因
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
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });

  const dump = async (label) => {
    const d = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const sel = getSelection();
      let caret = null;
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0);
        caret = { start: r.startContainer.nodeType === 3 ? r.startContainer.nodeValue.slice(0, r.startOffset) + '|' + r.startContainer.nodeValue.slice(r.startOffset) : (r.startContainer.tagName + '@' + r.startOffset) };
      }
      return { html: ed.innerHTML, caret };
    });
    console.log(`\n[${label}]`);
    console.log('  html: ' + d.html);
    console.log('  caret: ' + JSON.stringify(d.caret));
  };

  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>see http://example.com/abcdef end</div>';
    window.linkifyEditor({ keepSelection: false });
    ed.focus();
  });
  await dump('after linkify');

  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, v = n.nodeValue.replace(/\u200B/g, '');
      const i = v.indexOf('abc');
      if (i >= 0) {
        let vis = 0, real = 0;
        while (real < n.nodeValue.length && vis < i + 3) { if (n.nodeValue[real] !== '\u200B') vis++; real++; }
        const r = document.createRange(); r.setStart(n, real); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return;
      }
    }
  });
  await dump('caret placed after abc');

  await page.keyboard.press('Enter');
  await dump('right after Enter (before flatten/linkify debounce)');
  await page.waitForTimeout(900);
  await dump('after 900ms (linkify ran)');

  await page.keyboard.press('Backspace');
  await dump('right after Backspace');
  await page.waitForTimeout(900);
  await dump('after Backspace + 900ms');

  await browser.close();
  server.close();
  process.exit(0);
})();
