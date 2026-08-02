const { chromium } = require('playwright');
const { startServer } = require('./server');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

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
  function caret() {
    return page.evaluate(() => {
      const ed = document.getElementById('editor');
      const sel = window.getSelection();
      if (sel.rangeCount === 0) return { type: sel.type, rangeCount: 0 };
      const r = sel.getRangeAt(0);
      return { type: sel.type, rangeCount: sel.rangeCount,
        startContainer: (r.startContainer.nodeType===3? JSON.stringify(r.startContainer.nodeValue): r.startContainer.outerHTML),
        startOffset: r.startOffset,
        parentHTML: r.startContainer.parentElement ? r.startContainer.parentElement.outerHTML : null,
        html: ed.innerHTML };
    });
  }
  async function typeText(t) { await page.keyboard.type(t); }
  // 渲染行数：顶层 DIV/P 各算一行；首个块之前的裸文本/行内内容再算一行
  // （contenteditable 首行常不被 div 包裹，只数 div 会少算一行）
  function lineCount() {
    return page.evaluate(() => {
      const ed = document.getElementById('editor');
      let blocks = 0, leadingInline = false, seenBlock = false;
      for (const n of ed.childNodes) {
        const isBlock = n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P');
        if (isBlock) { blocks++; seenBlock = true; }
        else if (!seenBlock) {
          const t = n.nodeType === 3 ? n.nodeValue : n.textContent;
          if ((t || '').replace(/\u200B/g, '').length > 0 || (n.nodeType === 1 && n.tagName === 'BR')) leadingInline = true;
        }
      }
      return { lines: blocks + (leadingInline ? 1 : 0), html: ed.innerHTML };
    });
  }
  async function caretBefore(ch) {
    await page.evaluate((c) => {
      const ed = document.getElementById('editor'); ed.focus();
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let n, found=null; while (n = walker.nextNode()) { if (n.nodeValue.includes(c)) { found=n; break; } }
      if (!found) return;
      const idx = found.nodeValue.indexOf(c);
      const r = document.createRange(); r.setStart(found, idx); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }, ch);
  }

  console.log('\n[BUG2] 输入裸域名 www.baidu.com 应自动链接');
  await reset('');
  await typeText('www.baidu.com');
  await page.waitForTimeout(800);
  let s = await page.evaluate(() => { const ed=document.getElementById('editor'); return { a: ed.querySelectorAll('a').length, href: ed.querySelector('a')?.getAttribute('href') }; });
  check('www.baidu.com 被识别为链接', s.a === 1 && /baidu\.com/.test(s.href||''), s);

  console.log('\n[BUG2] 输入裸域名 example.com 应自动链接');
  await reset('');
  await typeText('访问 example.com 看看');
  await page.waitForTimeout(800);
  s = await page.evaluate(() => { const ed=document.getElementById('editor'); return { a: ed.querySelectorAll('a').length, text: ed.querySelector('a')?.textContent.replace(/\u200B/g,'') }; });
  check('example.com 被识别为链接', s.a === 1 && s.text === 'example.com', s);

  console.log('\n[BUG2] 文件扩展名不应被误链接');
  await reset('');
  await typeText('打开 README.md 文件');
  await page.waitForTimeout(800);
  s = await page.evaluate(() => { const ed=document.getElementById('editor'); return { a: ed.querySelectorAll('a').length }; });
  check('README.md 未误链接', s.a === 0, s);

  console.log('\n[BUG2] 逐字输入 http://www.baidu.com 应合成一条链接（不拆两段）');
  await reset('');
  await typeText('http://www.baidu.com');
  await page.waitForTimeout(800);
  s = await page.evaluate(() => {
    const ed=document.getElementById('editor');
    const a = ed.querySelector('a');
    return { aCount: ed.querySelectorAll('a').length, href: a?.getAttribute('href'), text: a?.textContent.replace(/\u200B/g,'') };
  });
  check('合成一条链接', s.aCount === 1 && s.href === 'http://www.baidu.com' && s.text === 'http://www.baidu.com', s);

  console.log('\n[BUG3] 一二三四五六 + URL, 光标移到"四"前, 回车 → 光标应停在"四"前(第二行), 不跳到"三"后');
  await reset('一二三四五六http://www.baidu.com');
  await caretBefore('四');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  // 重新取光标（post-linkify）
  s = await caret();
  const onLine2BeforeSi = s.parentHTML && s.parentHTML.includes('四五六') && s.startContainer === '"四五六"' && s.startOffset === 0;
  check('回车后光标停在"四"前(第二行)', onLine2BeforeSi, s);
  check('回车后光标未跳到"三"后(第一行末尾)', !(s.startContainer === '"一二三"' && s.startOffset === 3), s);

  console.log('\n[BUG3-real] 输入文字+回车+继续输入, 应为两行');
  await reset('');
  await typeText('第一行');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await typeText('第二行');
  await page.waitForTimeout(800);
  s = await lineCount();
  check('生成两行', s.lines === 2 && /第一行/.test(s.html) && /第二行/.test(s.html), s);

  console.log('\n[BUG4] 空编辑器连按两次回车, 应出现空行且光标不丢');
  await reset('');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  s = await caret();
  check('空编辑器回车后光标仍在(未消失)', s.type === 'Caret' && s.rangeCount === 1, s);
  // 继续输入应能落在空行上
  await typeText('新内容');
  await page.waitForTimeout(800);
  s = await page.evaluate(() => { const ed=document.getElementById('editor'); return { html: ed.innerHTML }; });
  check('空行上能正常输入', /新内容/.test(s.html), s);

  console.log('\n[BUG4-real] 文字+回车+回车+输入, 中间应保留空行');
  await reset('');
  await typeText('上一行');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter'); // 在空行上再回车
  await page.waitForTimeout(100);
  await typeText('下一行');
  await page.waitForTimeout(800);
  s = await lineCount();
  check('保留中间空行(共3行)', s.lines === 3 && /<div><br><\/div>/.test(s.html), s);

  console.log('\n[BUG1] 长 URL 输入后光标不应消失');
  await reset('访问 http://www.example.com/very/long/path/that/needs/breaking 结尾');
  await page.keyboard.press('End');
  await page.waitForTimeout(900);
  s = await caret();
  check('长 URL 输入后光标未消失', s.type === 'Caret' && s.rangeCount === 1, s);

  console.log('\n[BUG1] 回车后再输入, 光标稳定不丢');
  await reset('一http://a.com二http://b.com');
  await caretBefore('二');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await typeText('中');
  await page.waitForTimeout(800);
  s = await caret();
  check('回车+输入后光标未消失', s.type === 'Caret' && s.rangeCount === 1, s);

  console.log('\n==== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ====');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
