// _diag_triple_click.js — 只读诊断：复现"三击选中第一行 + 空格 → 第二行被拽上来"
// 只观察，不修改应用代码。打印：初始 DOM、三击后选区细节、按空格后 DOM。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });
  await page.evaluate(() => {
    const l = document.getElementById('landing'); if (l) l.classList.add('hidden');
    const m = document.getElementById('mask'); if (m) m.classList.add('hidden');
    const ld = document.getElementById('loading'); if (ld) ld.classList.add('hidden');
    const e = document.getElementById('editor'); e.contentEditable = 'true'; e.focus();
    window.apiPut = async () => ({ v: 1 });
    window.apiGet = async () => ({ v: 0, ct: '', iv: '' });
    // 模拟用户输入后的块结构：第一行 一二三四五六，第二行 七
    e.innerHTML = '<div>一二三四五六</div><div>七</div>';
    // 让编辑器可见可点（去掉可能遮挡的样式）
    e.style.position = 'static'; e.style.left = '0'; e.style.top = '0';
    e.style.width = '600px'; e.style.height = '400px'; e.style.fontSize = '24px';
    e.focus();
  });
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => document.getElementById('editor').innerHTML);
  console.log('【初始 innerHTML】', JSON.stringify(before));

  // 三击第一行（clickCount=3）
  const box = await page.evaluate(() => {
    const d = document.getElementById('editor').firstChild;
    const r = d.getBoundingClientRect();
    return { x: r.x + 5, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { clickCount: 3 });
  await page.waitForTimeout(100);

  const sel = await page.evaluate(() => {
    const s = window.getSelection();
    if (!s.rangeCount) return { none: true };
    const r = s.getRangeAt(0);
    const ed = document.getElementById('editor');
    function desc(n){ if(!n) return 'null'; if(n.nodeType===3) return 'TEXT("'+(n.nodeValue||'').slice(0,12)+'")'; if(n.nodeType===1) return n.tagName+(n.id?'#'+n.id:''); return n.nodeName; }
    const startInFirst = ed.firstChild.contains(r.startContainer);
    const endInFirst = ed.firstChild.contains(r.endContainer);
    const endInSecond = ed.firstChild.nextSibling && ed.firstChild.nextSibling.contains(r.endContainer);
    return {
      collapsed: s.isCollapsed,
      start: desc(r.startContainer) + '@' + r.startOffset,
      end: desc(r.endContainer) + '@' + r.endOffset,
      selectedText: r.toString(),
      startInFirstDiv: startInFirst,
      endInFirstDiv: endInFirst,
      endInSecondDiv: endInSecond,
      editorInnerAfterSelect: ed.innerHTML
    };
  });
  console.log('【三击后选区】', JSON.stringify(sel, null, 2));

  // 按空格
  await page.keyboard.press('Space');
  await page.waitForTimeout(700); // 等 linkify 跑完

  const after = await page.evaluate(() => document.getElementById('editor').innerHTML);
  console.log('【按空格后 innerHTML】', JSON.stringify(after));

  // 用 innerText 看视觉行
  const text = await page.evaluate(() => document.getElementById('editor').innerText);
  console.log('【按空格后 innerText】', JSON.stringify(text));

  await browser.close();
  process.exit(0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
