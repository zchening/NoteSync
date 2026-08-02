// E3 回归验证：删除多行选区后不应残留首/尾空行，光标应停在第一行最左侧
const { chromium } = require('playwright');
const { startServer } = require('./server');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

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

  function state() {
    return page.evaluate(() => {
      const ed = document.getElementById('editor');
      const sel = window.getSelection();
      const first = ed.firstChild;
      const firstBlank = !!first && ((first.nodeType === 3 && first.nodeValue.replace(/\s/g, '') === '') ||
        (first.nodeType === 1 && (first.tagName === 'BR' || (first.tagName === 'DIV' && (first.textContent || '').replace(/\s/g, '') === ''))));
      const last = ed.lastChild;
      const lastBlank = !!last && last !== first && ((last.nodeType === 3 && last.nodeValue.replace(/\s/g, '') === '') ||
        (last.nodeType === 1 && (last.tagName === 'BR' || (last.tagName === 'DIV' && (last.textContent || '').replace(/\s/g, '') === ''))));
      return { html: ed.innerHTML, firstBlank, lastBlank, caret: sel.rangeCount > 0 && sel.type === 'Caret', text: ed.textContent.replace(/\u200B/g, '') };
    });
  }

  // 场景1：3 URL + 一二三 + 四五六，全选删除 → 无残留空行
  console.log('\n[E3-1] 多行(含URL)全选删除 → 无残留空行, 光标在');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>http://a.com</div><div>http://b.com</div><div>http://c.com</div><div>一二三</div><div>四五六</div>';
    ed.focus();
  });
  await page.waitForTimeout(700); // 等 linkify
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  let s = await state();
  check('全删后无残留内容', s.text.trim() === '', s);
  check('全删后光标仍在', s.caret, s);

  // 场景2：删前 4 行，只留"四五六" → 首行不应是空行
  console.log('\n[E3-2] 删前4行留"四五六" → 首行不是空行');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>http://a.com</div><div>http://b.com</div><div>http://c.com</div><div>一二三</div><div>四五六</div>';
    ed.focus();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const r = document.createRange();
    r.setStart(ed, 0);
    r.setEnd(ed, 4); // 选中前4个块
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  s = await state();
  check('剩余内容为 四五六', s.text.replace(/\s/g, '') === '四五六', s);
  check('首节点不是空行', !s.firstBlank, s);

  // 场景3：跨行删除普通文字（无URL）
  console.log('\n[E3-3] 跨行删除普通文字 → 首行不是空行');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>第一行</div><div>第二行</div><div>第三行</div>';
    ed.focus();
    const r = document.createRange();
    r.setStart(ed, 0); r.setEnd(ed, 2);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  s = await state();
  check('剩余内容为 第三行', s.text.replace(/\s/g, '') === '第三行', s);
  check('首节点不是空行', !s.firstBlank, s);

  // 场景4：用户主动创建的空行，在别处删除字符后不应被吃掉
  console.log('\n[E3-4] 用户主动空行, 在别处删字后仍保留');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>上一行</div><div><br></div><div>下一行X</div>';
    ed.focus();
    const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, target = null;
    while (n = tw.nextNode()) if (n.nodeValue.includes('下一行X')) target = n;
    const r = document.createRange();
    r.setStart(target, target.nodeValue.length); r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Backspace'); // 删掉 X
  await page.waitForTimeout(300);
  s = await state();
  check('中间空行仍在', /<div><br><\/div>/.test(s.html), s);
  check('X 已删除', !/X/.test(s.text), s);

  console.log('\n==== E3 结果: ' + pass + ' 通过, ' + fail + ' 失败 ====');
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
