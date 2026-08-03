// _probe_f13_edge.js — F13 边缘场景探针（独立测试层，只读 index.html，不改产品代码）
//
// 覆盖：
//   M1/M2  模块级：直接调 window.relocateCaretToVisible
//   FC1-6  全链路：真实按键回车 → 等 linkify(500ms 防抖) → 断言光标落点
//   SEL    ensureCaret 不破坏用户选中态

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

let passed = 0, failed = 0;
function assert(label, ok, extra) {
  if (ok) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${extra !== undefined ? '  >> ' + JSON.stringify(extra) : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });
  await page.evaluate(() => {
    const el = document.getElementById('landing'); if (el) el.classList.add('hidden');
    const m = document.getElementById('mask'); if (m) m.classList.add('hidden');
  });

  // 光标所在块索引 + 块内偏移 + 文本
  const caretState = () => page.evaluate(() => {
    const editor = document.getElementById('editor');
    const sel = window.getSelection();
    if (!sel.rangeCount) return { idx: -1, total: editor.children.length, note: 'no-range' };
    const r = sel.getRangeAt(0);
    let c = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    while (c && c.parentElement !== editor) c = c.parentElement;
    return {
      idx: [...editor.children].indexOf(c),
      total: editor.children.length,
      offset: r.startOffset,
      inText: r.startContainer.nodeType === 3,
      nodeVal: r.startContainer.nodeType === 3 ? r.startContainer.nodeValue : '[' + r.startContainer.nodeName + ']',
      blockText: c ? c.textContent : null,
      collapsed: sel.isCollapsed,
      texts: [...editor.children].map(x => x.textContent),
      html: editor.innerHTML
    };
  });

  // 在编辑器里铺好内容并把光标放到 (块索引, 文本偏移)
  const setup = (html, blockIdx, off) => page.evaluate(([html, blockIdx, off]) => {
    const editor = document.getElementById('editor');
    editor.innerHTML = html;
    editor.focus();
    const blk = editor.children[blockIdx];
    const r = document.createRange();
    const tn = blk.firstChild;
    if (tn && tn.nodeType === 3) r.setStart(tn, off === -1 ? tn.nodeValue.length : off);
    else r.setStart(blk, 0);
    r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [html, blockIdx, off]);

  // ===== M1: 含内容块的坏偏移仍 relocate（F12 不回归）=====
  console.log('\n===== M1 模块：含内容块坏偏移 → 仍 relocate 到本块 =====');
  const m1 = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div> \r\n四五六\n</div>';
    editor.focus();
    const t = editor.querySelector('div').firstChild;
    const r = document.createRange();
    r.setStart(t, 1); r.collapse(true); // \r 与 \n 之间 → 坏偏移
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    try { window.relocateCaretToVisible(r); } catch (e) { return { err: e.message }; }
    const a = window.getSelection().getRangeAt(0);
    let c = a.startContainer.nodeType === 3 ? a.startContainer.parentElement : a.startContainer;
    while (c && c.parentElement !== editor) c = c.parentElement;
    return {
      idx: [...editor.children].indexOf(c),
      val: a.startContainer.nodeType === 3 ? a.startContainer.nodeValue : '[elem]',
      rects: a.getClientRects().length
    };
  });
  assert(`M1 relocate 后仍落在含「四五六」的块 (idx=${m1.idx})`, !!m1.val && m1.val.indexOf('四五六') !== -1, m1);

  // ===== M2: 空块守卫（F13 核心）=====
  console.log('\n===== M2 模块：空块内 relocate 不跨块 =====');
  const m2 = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>一</div><div></div>';
    editor.focus();
    const second = editor.children[1];
    const r = document.createRange();
    r.setStart(second, 0); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    try { window.relocateCaretToVisible(r); } catch (e) { return { err: e.message }; }
    const a = window.getSelection().getRangeAt(0);
    let c = a.startContainer.nodeType === 3 ? a.startContainer.parentElement : a.startContainer;
    while (c && c.parentElement !== editor) c = c.parentElement;
    return { idx: [...editor.children].indexOf(c), total: editor.children.length };
  });
  assert(`M2 光标仍在第二个空块 (idx=${m2.idx}/共${m2.total})`, m2.idx === 1, m2);

  // ===== FC1: 单行末尾回车 =====
  console.log('\n===== FC1 全链路：<div>一二三</div> 末尾回车 =====');
  await setup('<div>一二三</div>', 0, -1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const fc1 = await caretState();
  console.log(`    html=${fc1.html}  idx=${fc1.idx}`);
  assert('FC1 回车后有 2 个块', fc1.total === 2, fc1);
  assert('FC1 光标在 idx=1 的空块', fc1.idx === 1, fc1);

  // ===== FC2: 第二行末尾回车 =====
  console.log('\n===== FC2 全链路：两行文本，第二行末尾回车 =====');
  await setup('<div>一</div><div>二</div>', 1, -1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const fc2 = await caretState();
  console.log(`    html=${fc2.html}  idx=${fc2.idx}`);
  assert('FC2 回车后有 3 个块', fc2.total === 3, fc2);
  assert('FC2 光标在 idx=2 的空块', fc2.idx === 2, fc2);

  // ===== FC3: 行中回车（拆行）=====
  console.log('\n===== FC3 全链路：行中回车（「一」后拆行）=====');
  await setup('<div>一二三</div>', 0, 1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const fc3 = await caretState();
  console.log(`    html=${fc3.html}  idx=${fc3.idx} off=${fc3.offset} texts=${JSON.stringify(fc3.texts)}`);
  assert('FC3 拆成 2 个块', fc3.total === 2, fc3);
  assert('FC3 第一行=「一」、第二行=「二三」', fc3.texts[0] === '一' && fc3.texts[1] === '二三', fc3.texts);
  assert('FC3 光标在新块(idx=1)开头', fc3.idx === 1 && fc3.offset === 0, fc3);

  // ===== FC4: 回车后立刻输入 =====
  console.log('\n===== FC4 功能：回车后立刻输入「二」=====');
  await setup('<div>一</div>', 0, -1);
  await page.keyboard.press('Enter');
  await page.evaluate(() => document.execCommand('insertText', false, '二'));
  await page.waitForTimeout(800);
  const fc4 = await caretState();
  console.log(`    html=${fc4.html}  idx=${fc4.idx} off=${fc4.offset} texts=${JSON.stringify(fc4.texts)}`);
  assert('FC4 共 2 个块且第二行内容为「二」', fc4.total === 2 && fc4.texts[1] === '二', fc4.texts);
  assert('FC4 光标在第二行「二」之后 (idx=1, off=1)', fc4.idx === 1 && fc4.offset === 1, fc4);

  // ===== FC5: 连续两次回车 =====
  console.log('\n===== FC5 功能：连续回车两次 =====');
  await setup('<div>一</div>', 0, -1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const fc5 = await caretState();
  console.log(`    html=${fc5.html}  idx=${fc5.idx}`);
  assert('FC5 共 3 个块', fc5.total === 3, fc5);
  assert('FC5 光标在最后一个空块 (idx=2)，未跳回第一行', fc5.idx === 2, fc5);

  // ===== FC6: 含 URL 的行末回车 =====
  console.log('\n===== FC6 功能：含 URL 的行末回车 =====');
  await setup('<div>http://a.com</div>', 0, -1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const fc6 = await caretState();
  const hasLink = await page.evaluate(() =>
    !!document.getElementById('editor').querySelector('a[data-url], a[href]'));
  console.log(`    html=${fc6.html}  idx=${fc6.idx} hasLink=${hasLink}`);
  assert('FC6 光标在 idx=1 空块', fc6.idx === 1, fc6);
  assert('FC6 URL 仍被识别为链接', hasLink, fc6.html);

  // ===== SEL: ensureCaret 不破坏选中态 =====
  console.log('\n===== SEL：ensureCaret 不破坏用户选中态 =====');
  const sel = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>一二三四五</div>';
    editor.focus();
    const tn = editor.firstChild.firstChild;
    const r = document.createRange();
    r.setStart(tn, 1); r.setEnd(tn, 4); // 选中「二三四」
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    const before = s.toString();
    try { window.ensureCaret(); } catch (e) { return { err: e.message }; }
    const s2 = window.getSelection();
    return { before, after: s2.toString(), collapsed: s2.isCollapsed };
  });
  console.log(`    before="${sel.before}" after="${sel.after}" collapsed=${sel.collapsed}`);
  assert('SEL ensureCaret 后选中文本未丢失（仍为「二三四」）',
    sel.after === '二三四' && sel.collapsed === false, sel);

  console.log(`\n${'='.repeat(46)}`);
  console.log(`F13 边缘场景验收: ${passed} 通过 / ${failed} 失败`);
  console.log(`${failed === 0 ? '✅ 全绿' : '❌ 有失败'}`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
