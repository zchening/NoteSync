// 探针：复现"粘贴'一二三'→选中按空格→光标不显示"
// 关键对比：粘贴路径 vs 逐字输入路径，select-all + Space 后的 DOM 结构与光标矩形
const { chromium } = require('playwright');
const { startServer } = require('./server');

const diag = async (page, label) => {
  return await page.evaluate((label) => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    const r = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const rects = r ? r.getClientRects() : [];
    let firstRect = null;
    try { if (r) firstRect = r.getBoundingClientRect(); } catch (e) {}
    return {
      label,
      activeElementIsEditor: document.activeElement === ed,
      innerHTML: ed.innerHTML,
      isCollapsed: r ? r.collapsed : null,
      selAnchorNode: r ? (r.anchorNode && r.anchorNode.nodeType === 3 ? 'TEXT' : (r.anchorNode ? r.anchorNode.nodeName : null)) : null,
      anchorOffset: r ? r.anchorOffset : null,
      clientRectsLen: rects.length,
      boundingRect: firstRect ? { w: Math.round(firstRect.width), h: Math.round(firstRect.height) } : null,
    };
  }, label);
};

const selectAllSpace = async (page) => {
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Space');
};

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

  // ---------- 路径 A：真实粘贴（走我们的 paste 处理器） ----------
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '';
    ed.focus();
  });
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const dt = new DataTransfer();
    dt.setData('text/plain', '一二三');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ed.dispatchEvent(ev);
  });
  await page.waitForTimeout(700); // 等 linkify + cleanup 稳定
  const afterPasteA = await diag(page, 'A.粘贴后(before select+space)');
  await selectAllSpace(page);
  await page.waitForTimeout(50);
  const immA = await diag(page, 'A.粘贴→选中+空格(立即)');
  await page.waitForTimeout(700);
  const finA = await diag(page, 'A.粘贴→选中+空格(700ms后)');
  // 继续输入，应落在空格之后
  await page.keyboard.type('X');
  await page.waitForTimeout(700);
  const afterTypeA = await page.evaluate(() => document.getElementById('editor').innerHTML);

  // ---------- 路径 B：逐字输入（真实键盘，走浏览器原生插入→自动包 div） ----------
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '';
    ed.focus();
  });
  await page.keyboard.type('一二三');
  await page.waitForTimeout(700);
  const afterTypeB = await diag(page, 'B.输入后(before select+space)');
  await selectAllSpace(page);
  await page.waitForTimeout(50);
  const immB = await diag(page, 'B.输入→选中+空格(立即)');
  await page.waitForTimeout(700);
  const finB = await diag(page, 'B.输入→选中+空格(700ms后)');

  const show = d => `  [${d.label}] active=${d.activeElementIsEditor} innerHTML=${JSON.stringify(d.innerHTML)} collapsed=${d.isCollapsed} anchor=${d.selAnchorNode}@${d.anchorOffset} rects=${d.clientRectsLen} bbox=${JSON.stringify(d.boundingRect)}`;
  console.log(show(afterPasteA));
  console.log(show(immA));
  console.log(show(finA));
  console.log('  A 继续输入X后: ' + JSON.stringify(afterTypeA));
  console.log('---');
  console.log(show(afterTypeB));
  console.log(show(immB));
  console.log(show(finB));

  // 断言（F7）：粘贴后必须是块级包裹（<div>），不再是根下裸文本节点
  const A_blockAfterPaste = /<div>\s*一二三\s*<\/div>/.test(afterPasteA.innerHTML);
  const A_blockAfterSpace = /<div>\s*<\/div>/.test(finA.innerHTML);
  const A_typeAfterSpace = /<div>\s*X\s*<\/div>/.test(afterTypeA);
  const B_block = /<div>/.test(afterTypeB.innerHTML);

  console.log('\n=== 断言 ===');
  console.log('A 粘贴后块级包裹(<div>一二三</div>): ' + A_blockAfterPaste);
  console.log('A 选中+空格后块级(<div> </div>): ' + A_blockAfterSpace);
  console.log('A 继续输入落在空格后(<div> X</div>): ' + A_typeAfterSpace);
  console.log('B 逐字输入块级: ' + B_block);

  const ok = A_blockAfterPaste && A_blockAfterSpace && A_typeAfterSpace && B_block;
  console.log('\nRESULT: ' + (ok ? 'PASS' : 'FAIL'));

  await browser.close(); server.close();
  process.exit(ok ? 0 : 1);
})();
