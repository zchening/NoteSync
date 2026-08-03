// F11 诊断探针：用户报「选中"一二三"按空格后，光标不在，但可以接着打字」
// 目标：对比【光标正常态】与【光标消失态】的全部 layout / focus / selection 指标，找出唯一差异。
const { chromium } = require('playwright');
const { startServer } = require('./server');

async function snapshot(page, label) {
  const s = await page.evaluate(() => {
    const e = document.getElementById('editor');
    const sel = window.getSelection();
    const out = {
      activeEl: document.activeElement ? (document.activeElement.id || document.activeElement.nodeName) : null,
      hasFocusDoc: document.hasFocus(),
      editorFocused: document.activeElement === e,
      contentEditable: e.contentEditable,
      rangeCount: sel.rangeCount,
      html: e.innerHTML,
      childBlocks: Array.from(e.childNodes).map(n => ({
        name: n.nodeName,
        text: JSON.stringify((n.textContent || '').slice(0, 12)),
        h: n.nodeType === 1 ? n.getBoundingClientRect().height : null,
        w: n.nodeType === 1 ? n.getBoundingClientRect().width : null,
      })),
    };
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      const rects = Array.from(r.getClientRects()).map(x => ({ x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }));
      const bcr = r.getBoundingClientRect();
      out.sel = {
        collapsed: sel.isCollapsed,
        text: JSON.stringify(sel.toString()),
        startNode: r.startContainer.nodeType === 3 ? 'TEXT' + JSON.stringify(r.startContainer.nodeValue) : r.startContainer.nodeName,
        startOffset: r.startOffset,
        connected: r.startContainer.isConnected,
        inEditor: e.contains(r.commonAncestorContainer),
        rectsLen: rects.length,
        rects: rects,
        bcr: { x: Math.round(bcr.x), y: Math.round(bcr.y), w: Math.round(bcr.width), h: Math.round(bcr.height) },
      };
      // caret 所在块的信息
      let blk = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
      while (blk && blk.parentElement !== e && blk !== e) blk = blk.parentElement;
      if (blk && blk !== e) {
        const b = blk.getBoundingClientRect();
        out.caretBlock = { name: blk.nodeName, html: JSON.stringify(blk.innerHTML), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      }
    }
    return out;
  });
  console.log('\n=== ' + label + ' ===');
  console.log(JSON.stringify(s, null, 2));
  return s;
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto('http://localhost:' + server.address().port + '/');
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => { document.getElementById('landing')?.classList.add('hidden'); document.getElementById('mask')?.classList.add('hidden'); });
  const ed = await page.$('#editor');

  // ---- 复现用户步骤：粘贴两行 ----
  await ed.click();
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.innerHTML = '<div>一二三</div><div>四五六</div>';
    const sel = window.getSelection(); const r = document.createRange();
    const t = e.lastChild.firstChild; r.setStart(t, t.length); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  });
  await page.waitForTimeout(700);
  const A = await snapshot(page, 'A. 基线：光标在第二行末（用户说这种时候光标正常）');

  // ---- 选中第一行 ----
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const tn = e.firstChild.firstChild;
    const sel = window.getSelection(); const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, tn.length);
    sel.removeAllRanges(); sel.addRange(r);
  });
  await snapshot(page, 'B. 选中第一行"一二三"（选中态，本来就不该有 caret）');

  // ---- 按空格 ----
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const C = await snapshot(page, 'C. 刚按下空格（linkify 尚未跑）');

  await page.waitForTimeout(800); // 等 linkify 500ms 防抖 + ensureCaret
  const D = await snapshot(page, 'D. ★ 空格 + linkify 之后（用户报「光标不在」）');

  // ---- 对比诊断 ----
  console.log('\n\n########## 差异诊断 ##########');
  console.log('基线A caret rects:', JSON.stringify(A.sel && A.sel.rects));
  console.log('异常D caret rects:', JSON.stringify(D.sel && D.sel.rects));
  console.log('基线A caret 所在块:', JSON.stringify(A.caretBlock));
  console.log('异常D caret 所在块:', JSON.stringify(D.caretBlock));
  console.log('A editorFocused =', A.editorFocused, ' / D editorFocused =', D.editorFocused);
  const aH = A.sel && A.sel.bcr.h, dH = D.sel && D.sel.bcr.h;
  console.log('caret 高度: A=' + aH + '  D=' + dH + (dH === 0 ? '   <<<<< D 的 caret 高度为 0 → 不可见！' : ''));
  const dBlkH = D.caretBlock && D.caretBlock.h;
  console.log('caret 所在块高度: A=' + (A.caretBlock && A.caretBlock.h) + '  D=' + dBlkH + (dBlkH === 0 ? '   <<<<< 块高度为 0 → caret 无处可画！' : ''));

  // ---- 追加：验证能否继续打字（用户说可以）----
  await page.keyboard.type('X');
  await page.waitForTimeout(100);
  const html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  console.log('\n打字 X 之后 html =', JSON.stringify(html));

  await browser.close(); server.close();
})();
