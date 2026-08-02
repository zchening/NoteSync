const { chromium } = require('playwright');
const { startServer } = require('./server');

function dbg(label, o) { console.log('\n=== ' + label + ' ==='); console.log(JSON.stringify(o, null, 2)); }

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

  async function reset(html) {
    await page.evaluate((h) => { const ed=document.getElementById('editor'); ed.innerHTML=h||''; ed.focus(); }, html);
  }
  async function caretBefore(ch) {
    await page.evaluate((c) => {
      const ed = document.getElementById('editor');
      ed.focus();
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let n, found=null;
      while (n = walker.nextNode()) { if (n.nodeValue.includes(c)) { found=n; break; } }
      if (!found) return;
      const idx = found.nodeValue.indexOf(c);
      const r = document.createRange();
      r.setStart(found, idx); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }, ch);
  }
  function caretState() {
    return page.evaluate(() => {
      const ed = document.getElementById('editor');
      const sel = window.getSelection();
      if (sel.rangeCount === 0) return { type: sel.type, rangeCount: 0, html: ed.innerHTML };
      const r = sel.getRangeAt(0);
      return {
        type: sel.type, rangeCount: sel.rangeCount,
        startContainer: (r.startContainer.nodeType===3? JSON.stringify(r.startContainer.nodeValue) : r.startContainer.outerHTML),
        startOffset: r.startOffset,
        parentHTML: r.startContainer.parentElement ? r.startContainer.parentElement.outerHTML : null,
        html: ed.innerHTML
      };
    });
  }

  // ── BUG 2: 逐字输入 URL，是否整条变链接 ──
  await reset('');
  await page.keyboard.type('http://www.baidu.com');
  await page.waitForTimeout(900);
  const typed = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { html: ed.innerHTML, aCount: ed.querySelectorAll('a').length,
      linkTexts: Array.from(ed.querySelectorAll('a')).map(a=>a.textContent.replace(/\u200B/g,'')),
      hrefs: Array.from(ed.querySelectorAll('a')).map(a=>a.getAttribute('href')) };
  });
  dbg('BUG2 逐字输入 URL', typed);

  // ── BUG 2b: 输入 www.baidu.com（无 scheme）──
  await reset('');
  await page.keyboard.type('www.baidu.com');
  await page.waitForTimeout(900);
  const typed2 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { html: ed.innerHTML, aCount: ed.querySelectorAll('a').length };
  });
  dbg('BUG2b 输入 www.baidu.com', typed2);

  // ── BUG 3 (含 URL): 一二三四五六 + URL, caret before 四, Enter ──
  await reset('一二三四五六http://www.baidu.com');
  await caretBefore('四');
  dbg('BUG3 before Enter', await caretState());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  dbg('BUG3 after Enter immediate', await caretState());
  await page.waitForTimeout(900);
  dbg('BUG3 after Enter +linkify', await caretState());

  // ── BUG 1: 输入长 URL 后光标是否消失 ──
  await reset('访问 http://www.example.com/very/long/path/that/needs/breaking 看看');
  await page.keyboard.press('End');
  await page.waitForTimeout(900);
  dbg('BUG1 after typing long URL + End', await caretState());

  // ── BUG 4: 空编辑器回车 + 连续两次回车 ──
  await reset('');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const e1 = await page.evaluate(() => { const ed=document.getElementById('editor'); return { html: ed.innerHTML }; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const e2 = await page.evaluate(() => { const ed=document.getElementById('editor'); return { html: ed.innerHTML }; });
  dbg('BUG4 empty + 1 Enter', e1);
  dbg('BUG4 empty + 2 Enter', e2);

  // ── BUG 2c: 粘贴带 scheme 的 URL（应整条链接）──
  await reset('');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const dt = new DataTransfer();
    dt.setData('text/plain', 'http://www.baidu.com');
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(900);
  const paste1 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return { html: ed.innerHTML, aCount: ed.querySelectorAll('a').length,
      linkTexts: Array.from(ed.querySelectorAll('a')).map(a=>a.textContent.replace(/\u200B/g,'')) };
  });
  dbg('BUG2c 粘贴 URL', paste1);

  await browser.close();
  server.close();
})();
