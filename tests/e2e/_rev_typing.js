// 复核脚本 v3：真实"逐字输入"路径下的 URL 识别 + 链接内回车的 href 一致性
// 只读，不修改 index.html
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

  const clear = async () => {
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = ''; ed.focus();
      const r = document.createRange(); r.setStart(ed, 0); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.waitForTimeout(60);
  };
  const links = () => page.evaluate(() => ({
    html: document.getElementById('editor').innerHTML,
    list: Array.from(document.getElementById('editor').querySelectorAll('a'))
      .map(a => ({ text: a.textContent.replace(/\u200B/g, ''), href: a.getAttribute('href') }))
  }));

  console.log('\n=== A. 逐字输入 URL（真实路径，走 input debounce）===');
  const typed = [
    ['http://example.com', true, 'ASCII 方案 URL'],
    ['www.baidu.com', true, '裸 www 域名'],
    ['example.com', true, '裸域名'],
    ['https://cdn.jsdelivr.net/npm/vue.js', true, '.js 结尾真 URL'],
    ['https://github.com/a/b/README.md', true, '.md 结尾真 URL'],
    ['http://files.io/report.pdf', true, '.pdf 结尾真 URL'],
    ['README.md', false, '裸文件名'],
    ['x@y.com', false, '邮箱'],
    ['1.Introduction', false, '编号标题'],
    ['3.14', false, '小数'],
  ];
  for (const [text, want, desc] of typed) {
    await clear();
    await page.keyboard.type(text);
    await page.waitForTimeout(900); // 等 500ms linkify debounce
    const r = await links();
    const got = r.list.length > 0;
    check(`输入 "${text}" ${want ? '应' : '不应'}成链接 (${desc})`, got === want, { got: r.list, html: r.html });
  }

  console.log('\n=== B. 链接内回车后 href 与文本是否一致 ===');
  await clear();
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>see http://example.com/abcdef end</div>';
    window.linkifyEditor({ keepSelection: false });
    ed.focus();
  });
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
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const b = await links();
  console.log('     拆分结果: ' + JSON.stringify(b.list));
  const consistent = b.list.every(l => l.href === l.text || l.href === 'https://' + l.text);
  check('B1 拆分后每个 <a> 的 href 与其文本一致', consistent, b.list);

  console.log('\n=== C. 链接中间回车再撤销(Backspace 合并回来) ===');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(900);
  const c = await links();
  console.log('     合并后: ' + JSON.stringify(c.list));
  check('C1 删回车后合并为单个 <a>', c.list.length === 1, c.list);
  check('C1 合并后 href 正确', c.list[0] && c.list[0].href === 'http://example.com/abcdef', c.list);
  check('C1 文本无重复/丢失', !/abcabc|defdef/.test(c.html), c.html);

  console.log('\n=== D. 中文输入 + URL 混排 ===');
  await clear();
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>一二三四五六http://example.com</div>';
    window.linkifyEditor({ keepSelection: false });
    ed.focus();
  });
  await page.waitForTimeout(200);
  // 光标放在"四"前
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, i = n.nodeValue.indexOf('四');
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
    }
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const d = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const s = getSelection();
    if (!s.rangeCount) return { none: true, html: ed.innerHTML };
    const r = s.getRangeAt(0);
    const pre = document.createRange(); pre.selectNodeContents(ed); pre.setEnd(r.startContainer, r.startOffset);
    return { before: pre.toString().replace(/\u200B/g, ''), html: ed.innerHTML };
  });
  check('D1 bug3 场景光标停在"一二三"后(不跳)', d.before === '一二三', d);
  // 继续输入验证落点
  await page.keyboard.type('N');
  await page.waitForTimeout(900);
  const d2 = await page.evaluate(() => document.getElementById('editor').textContent.replace(/\u200B/g, ''));
  check('D2 输入落在第二行行首("N四五六...")', d2.includes('N四五六'), d2);

  console.log('\n=== C2. 在拆出来的 <a>def</a> 中间打字是否被吞进链接 ===');
  await clear();
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>see http://example.com/abcdef end</div>';
    window.linkifyEditor({ keepSelection: false });
    ed.focus();
  });
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
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight'); // 移到 d 之后
  await page.keyboard.type('ZZ');
  await page.waitForTimeout(900);
  const c2 = await links();
  console.log('     C2 结果: ' + JSON.stringify(c2.list));
  check('C2 在拆出的链接中间打字不被吞进 <a>', !c2.list.some(l => l.text.includes('ZZ')), c2.list);

  console.log('\n=== E. 长时间连续编辑无 JS 报错 ===');
  await clear();
  await page.keyboard.type('line one ');
  await page.keyboard.press('Enter');
  await page.keyboard.type('http://a.com and www.b.com ');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tail');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(600);
  const e = await page.evaluate(() => ({ html: document.getElementById('editor').innerHTML, caret: getSelection().rangeCount > 0 }));
  check('E1 连续编辑后全删干净且光标在', e.caret, e);
  check('E1 无 pageerror', errs.length === 0, errs);

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) console.log('失败项:\n - ' + fails.join('\n - '));
  console.log('pageerror 数量: ' + errs.length + (errs.length ? '\n' + errs.join('\n') : ''));
  await browser.close();
  server.close();
  process.exit(0);
})();
