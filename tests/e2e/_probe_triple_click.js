// _probe_triple_click.js — 验证 v5.13 修复：三击选第一行 + 空格 → 第二行不再被拽上来
// 同时验证：钳制确实生效（选区终点回到第一行内）、Ctrl+Z 撤销栈不回归、正常跨行替换不受影响。
// 在真实 Chromium 里跑（setContent 加载真实 index.html）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  ✅ ' + label); }
  else { failed++; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}

async function setup(browser) {
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });
  await page.evaluate(() => {
    const hide = id => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); };
    hide('landing'); hide('mask'); hide('loading');
    const ed = document.getElementById('editor');
    ed.contentEditable = 'true'; ed.focus();
    ed.style.position = 'static'; ed.style.left = '0'; ed.style.top = '0';
    ed.style.width = '600px'; ed.style.height = '400px'; ed.style.fontSize = '24px';
    window.apiPut = async () => ({ v: (window.__v = (window.__v || 0) + 1) });
    window.apiGet = async () => ({ v: 0, ct: '', iv: '' });
  });
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });

  // ===== 正例：三击第一行 + 空格 =====
  {
    console.log('\n===== 正例：三击第一行"一二三四五六" + 空格 =====');
    const page = await setup(browser);
    await page.evaluate(() => { document.getElementById('editor').innerHTML = '<div>一二三四五六</div><div>七</div>'; window.__undoReset && window.__undoReset(); document.getElementById('editor').focus(); });
    await page.waitForTimeout(150);
    const box = await page.evaluate(() => {
      const d = document.getElementById('editor').firstChild;
      const r = d.getBoundingClientRect();
      return { x: r.x + 5, y: r.y + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y, { clickCount: 3 });
    await page.waitForTimeout(120);
    // 验证钳制是否生效：选区终点应回到第一行内（不是 div2@0）
    const selInfo = await page.evaluate(() => {
      const s = window.getSelection(); const r = s.getRangeAt(0);
      const ed = document.getElementById('editor');
      return { endInFirst: ed.firstChild.contains(r.endContainer), endNode: r.endContainer.nodeType === 3 ? 'TEXT' : r.endContainer.tagName, endOff: r.endOffset, sel: r.toString() };
    });
    console.log('  三击后选区(钳制后):', JSON.stringify(selInfo));
    check('钳制生效：选区终点回到第一行内(非 div2@0)', selInfo.endInFirst === true, JSON.stringify(selInfo));
    check('钳制后选中文本恰好为"一二三四五六"', selInfo.sel === '一二三四五六', selInfo.sel);
    await page.keyboard.press('Space');
    await page.waitForTimeout(700); // 等 linkify
    const html = await page.evaluate(() => document.getElementById('editor').innerHTML);
    const txt = await page.evaluate(() => document.getElementById('editor').innerText);
    console.log('  按空格后 innerHTML =', JSON.stringify(html));
    console.log('  按空格后 innerText =', JSON.stringify(txt));
    check('修复：innerHTML 恰好 <div> </div><div>七</div>', html === '<div> </div><div>七</div>', html);
    check('修复：innerText 仍为两行(空行 / 七)', txt.split('\n').length === 2 && txt.split('\n')[1] === '七', JSON.stringify(txt.split('\n')));
    await page.close();
  }

  // ===== 撤销栈不回归：空格后再 Ctrl+Z 应恢复两行 =====
  {
    console.log('\n===== 回归：正例之后 Ctrl+Z 撤销恢复 =====');
    const page = await setup(browser);
    await page.evaluate(() => { document.getElementById('editor').innerHTML = '<div>一二三四五六</div><div>七</div>'; window.__undoReset && window.__undoReset(); document.getElementById('editor').focus(); });
    await page.waitForTimeout(150);
    const box = await page.evaluate(() => { const d = document.getElementById('editor').firstChild; const r = d.getBoundingClientRect(); return { x: r.x + 5, y: r.y + r.height / 2 }; });
    await page.mouse.click(box.x, box.y, { clickCount: 3 });
    await page.waitForTimeout(120);
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(120);
    const html = await page.evaluate(() => document.getElementById('editor').innerHTML);
    console.log('  Ctrl+Z 后 innerHTML =', JSON.stringify(html));
    check('撤销栈不回归：Ctrl+Z 恢复到 <div>一二三四五六</div><div>七</div>', html === '<div>一二三四五六</div><div>七</div>', html);
    await page.close();
  }

  // ===== 负例：正常跨两行选中有内容再空格，不应误钳制 =====
  {
    console.log('\n===== 负例：跨两行选中(含下一行内容) + 空格 =====');
    const page = await setup(browser);
    await page.evaluate(() => { document.getElementById('editor').innerHTML = '<div>一二三四五六</div><div>七</div>'; window.__undoReset && window.__undoReset(); document.getElementById('editor').focus(); });
    await page.waitForTimeout(150);
    // 用 evaluate 构造一个"跨行且有内容"的选区：从 div1 开头选到 div2 的"七"末尾
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const t1 = ed.firstChild.firstChild; // "一二三四五六"
      const t2 = ed.lastChild.firstChild;  // "七"
      const r = document.createRange();
      r.setStart(t1, 0); r.setEnd(t2, t2.length);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.waitForTimeout(120);
    const selInfo = await page.evaluate(() => { const r = window.getSelection().getRangeAt(0); const ed = document.getElementById('editor'); return { endInSecond: ed.lastChild.contains(r.endContainer), sel: r.toString() }; });
    check('负例：跨行选区含下一行内容(七)，不应被钳制', selInfo.endInSecond === true && selInfo.sel.indexOf('七') >= 0, JSON.stringify(selInfo));
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const html = await page.evaluate(() => document.getElementById('editor').innerHTML);
    const txt = await page.evaluate(() => document.getElementById('editor').innerText);
    console.log('  负例按空格后 innerHTML =', JSON.stringify(html), 'innerText =', JSON.stringify(txt));
    check('负例：跨行替换为空格后无残留异常结构', /<div> <\/div>/.test(html) && !/七/.test(html), html);
    await page.close();
  }

  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  console.log(failed === 0 ? '✅ 全绿' : '❌ 有失败');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
