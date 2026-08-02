// 字面复现探针（F8 验收门槛）：严格回放用户报告的场景，全绿才算修好。
// 场景A：逐字输两行 → 选中第一行+空格 → Ctrl+Z
// 场景B：粘贴"一二三"到空编辑器 → 选中+空格（原 F7 报告）
const { chromium } = require('playwright');
const { startServer } = require('./server');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  >> ' + JSON.stringify(extra) : '')); }
}

async function selectFirstLine(page) {
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const tn = e.firstChild.firstChild; // 第一个 div 的文本节点
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, tn.length);
    sel.removeAllRanges(); sel.addRange(r);
  });
}
async function caretInfo(page) {
  return page.evaluate(() => {
    const sel = window.getSelection(); const r = sel.getRangeAt(0);
    return { collapsed: sel.isCollapsed, text: sel.toString(), rects: r.getClientRects().length,
      off: r.startOffset, val: r.startContainer.nodeType === 3 ? r.startContainer.nodeValue : null,
      anchor: (r.startContainer.nodeType === 3 ? JSON.stringify(r.startContainer.nodeValue) : r.startContainer.nodeName) + '@' + r.startOffset };
  });
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

  console.log('--- 场景A：逐字输入两行 一二三 / 四五六 ---');
  await ed.focus();
  await page.keyboard.type('一二三');
  await page.keyboard.press('Enter');
  await page.keyboard.type('四五六');
  await page.waitForTimeout(700);
  let html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  check('A1 输入两行后结构为 <div>一二三</div><div>四五六</div>', html === '<div>一二三</div><div>四五六</div>', html);

  console.log('--- 场景A：选中第一行"一二三"并按空格 ---');
  await selectFirstLine(page);
  await page.waitForTimeout(30);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  const ci = await caretInfo(page);
  check('A2 选中+空格后结构为 <div> </div><div>四五六</div>（第二行未被吞）', html === '<div> </div><div>四五六</div>', html);
  check('A2 光标可见 (rects>0)', ci.rects > 0, ci);
  check('A2 光标落在空格之后 (off=1, val=" ")', ci.off === 1 && ci.val === ' ', ci);

  console.log('--- 场景A：继续输入"七"（应落在空格后）---');
  await page.keyboard.type('七');
  await page.waitForTimeout(700);
  html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  check('A3 继续输入后 <div> 七</div><div>四五六</div>', html === '<div> 七</div><div>四五六</div>', html);

  console.log('--- 场景A：Ctrl+Z 撤销空格 ---');
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await page.waitForTimeout(700);
  html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  const undo = await caretInfo(page);
  check('A4 Ctrl+Z 后还原 <div>一二三</div><div>四五六</div>', html === '<div>一二三</div><div>四五六</div>', html);
  check('A4 "一二三"处于选中状态', !undo.collapsed && undo.text === '一二三', undo);

  console.log('--- 场景B：粘贴"一二三"到空编辑器 → 选中+空格 ---');
  await page.evaluate(() => { document.getElementById('editor').innerHTML = ''; document.getElementById('editor').focus(); });
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const dt = new DataTransfer(); dt.setData('text/plain', '一二三');
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(700);
  html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  check('B1 粘贴后结构为 <div>一二三</div>', html === '<div>一二三</div>', html);
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const tn = e.firstChild.firstChild;
    const sel = window.getSelection(); const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, tn.length); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.waitForTimeout(30);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  html = await page.evaluate(() => document.getElementById('editor').innerHTML);
  const bci = await caretInfo(page);
  check('B2 选中+空格后 <div> </div>', html === '<div> </div>', html);
  check('B2 光标可见 (rects>0)', bci.rects > 0, bci);
  check('B2 光标落在空格之后 (off=1, val=" ")', bci.off === 1 && bci.val === ' ', bci);

  console.log('\n=== RESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + pass + '/' + (pass + fail) + ') ===');
  await browser.close(); server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
