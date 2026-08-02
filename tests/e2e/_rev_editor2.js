// 复核脚本 v2：修正 harness（linkify 显式触发 / applyStrike 走 lastRange / pre-wrap 下 \n 即换行）
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

  // setHTML 后显式跑一次 linkify（innerHTML 赋值不触发 input，debounce 不会启动）
  const setHTML = async (h, doLink) => {
    await page.evaluate(({ x, l }) => {
      const ed = document.getElementById('editor'); ed.innerHTML = x; ed.focus();
      if (l) window.linkifyEditor({ keepSelection: false });
    }, { x: h, l: !!doLink });
    await page.waitForTimeout(60);
  };
  const state = () => page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    let inA = false, inS = false, path = null;
    if (sel.rangeCount) {
      const parts = [];
      let n = sel.getRangeAt(0).startContainer;
      let p = n.nodeType === 3 ? n.parentElement : n;
      while (p && p !== ed) { parts.unshift(p.tagName); if (p.tagName === 'A') inA = true; if (p.tagName === 'S') inS = true; p = p.parentElement; }
      path = parts.join('>');
    }
    return { html: ed.innerHTML, text: ed.textContent.replace(/\u200B/g, ''), inA, inS, path,
      caret: sel.rangeCount > 0, blocks: ed.querySelectorAll(':scope>div,:scope>p').length };
  });
  const caretAt = (needle, after) => page.evaluate(({ needle, after }) => {
    const ed = document.getElementById('editor'); ed.focus();
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      const i = n.nodeValue.replace(/\u200B/g, '').indexOf(needle);
      if (i >= 0) {
        // 换算回含 ZWSP 的真实 offset
        let vis = 0, real = 0, target = after ? i + needle.length : i;
        while (real < n.nodeValue.length && vis < target) { if (n.nodeValue[real] !== '\u200B') vis++; real++; }
        const r = document.createRange();
        r.setStart(n, real); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }
    }
    return false;
  }, { needle, after });
  // 选中 editor 内可见文本的 [a,b) 区间，并等 selectionchange 更新 lastRange
  const selectRange = async (a, b) => {
    await page.evaluate(({ a, b }) => {
      const ed = document.getElementById('editor'); ed.focus();
      const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let pos = 0, sn = null, so = 0, en = null, eo = 0;
      while (w.nextNode()) {
        const n = w.currentNode, L = n.nodeValue.length;
        if (sn === null && pos + L >= a) { sn = n; so = a - pos; }
        if (en === null && pos + L >= b) { en = n; eo = b - pos; }
        pos += L;
      }
      if (!sn || !en) return false;
      const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }, { a, b });
    await page.waitForTimeout(120); // 等 selectionchange 写 lastRange
  };
  const strike = async () => { await page.evaluate(() => window.applyStrike()); await page.waitForTimeout(400); };

  // ─────────────────────────────────────────────────────────
  console.log('\n=== A. Enter 在行内元素内部 ===');

  // A1: 链接中间回车（真实存在 <a> 的前提下）
  await setHTML('<div>see http://example.com/abcdef end</div>', true);
  let s = await state();
  check('A0 前置: <a> 已生成', s.html.includes('<a '), s.html);
  await caretAt('abc', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  s = await state();
  check('A1 链接中间回车后光标不在 <a> 内', !s.inA, { path: s.path, html: s.html });
  await page.keyboard.type('X');
  await page.waitForTimeout(900);
  s = await state();
  const xInA = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    return Array.from(ed.querySelectorAll('a')).some(a => a.textContent.includes('X'));
  });
  check('A1 回车后输入的 X 未被吞进 <a>', !xInA, s.html);
  console.log('     A1 html: ' + s.html);

  // A1b: 链接末尾回车后打字
  await setHTML('<div>go http://example.com</div>', true);
  await caretAt('com', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.type('plain');
  await page.waitForTimeout(900);
  const plainInA = await page.evaluate(() => Array.from(document.getElementById('editor').querySelectorAll('a')).some(a => a.textContent.includes('plain')));
  s = await state();
  check('A1b 链接末尾回车后输入不进 <a>', !plainInA, s.html);
  console.log('     A1b html: ' + s.html);

  // A2: 删除线中间回车 —— 新行继承 <s> 是否合理
  await setHTML('<div><s>abcdef</s></div>');
  await caretAt('abc', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.type('Y');
  await page.waitForTimeout(150);
  s = await state();
  check('A2 <s> 中回车产生两行', s.blocks >= 2, s);
  console.log('     A2 html: ' + s.html + '  (新行是否继承<s>: ' + /<div><s>Y/.test(s.html) + ')');

  // A3: 列表
  await setHTML('<ul><li>item1</li></ul>');
  await caretAt('item1', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.type('item2');
  await page.waitForTimeout(150);
  s = await state();
  check('A3 列表内回车产生新 <li>', (s.html.match(/<li/g) || []).length === 2, s.html);

  // A4: 连续回车
  await setHTML('<div>hello</div>');
  await caretAt('hello', true);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(90); }
  s = await state();
  check('A4 行尾3次回车产生4块', s.blocks >= 4, { blocks: s.blocks, html: s.html });

  // A4b: 空编辑器连续回车
  await setHTML('');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); const r = document.createRange(); r.setStart(ed, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(90); }
  await page.keyboard.type('tail');
  await page.waitForTimeout(200);
  s = await state();
  check('A4b 空编辑器3次回车后能输入且有多行', s.text.includes('tail') && s.blocks >= 2, { blocks: s.blocks, html: s.html });

  // A5: Shift+Enter（editor 是 white-space:pre-wrap，\n 即软换行，<br> 或 \n 都算通过）
  await setHTML('<div>ab</div>');
  await caretAt('ab', true);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(120);
  s = await state();
  check('A5 Shift+Enter 软换行(不新增块)', s.blocks === 1 && (s.html.includes('<br') || s.html.includes('\n')), s.html);

  // A6: bug3 光标不跳
  await setHTML('<div>abcdef http://example.com</div>', true);
  await caretAt('def', false);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const a6 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    if (!sel.rangeCount) return { none: true, html: ed.innerHTML };
    const r = sel.getRangeAt(0);
    const pre = document.createRange(); pre.selectNodeContents(ed); pre.setEnd(r.startContainer, r.startOffset);
    return { before: pre.toString().replace(/\u200B/g, ''), html: ed.innerHTML };
  });
  check('A6 回车+linkify 后光标在 "abc" 之后', a6.before === 'abc', a6);

  // ─────────────────────────────────────────────────────────
  console.log('\n=== B. 删除线回归 (A1-A7) ===');

  await setHTML('<div>hello world</div>');
  await selectRange(0, 5);
  await strike();
  s = await state();
  check('B1 加删除线生成 <s>hello</s>', /<s>hello<\/s>/.test(s.html), s.html);
  const selAfter = await page.evaluate(() => { const x = getSelection(); return { type: x.type, txt: x.toString() }; });
  check('B1 加删除线后选区仍覆盖 hello', selAfter.txt === 'hello', selAfter);

  await strike();
  s = await state();
  check('B2 再次调用取消删除线', !s.html.includes('<s>'), s.html);

  // B3: 含 <a> 的行加删除线
  await setHTML('<div>go http://example.com now</div>', true);
  let vlen = await page.evaluate(() => document.getElementById('editor').textContent.replace(/\u200B/g, '').length);
  await page.evaluate(() => {
    const ed = document.getElementById('editor'); ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed.firstChild);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(120);
  await strike();
  s = await state();
  check('B3 URL 行加删除线后 <s> 存在', s.html.includes('<s>'), s.html);
  check('B3 <a> 未丢失', s.html.includes('<a '), s.html);
  check('B3 文本未丢失', s.text.replace(/\s/g, '').includes('example.com'), s.text);
  console.log('     B3 html: ' + s.html);

  // B4: 删除线后再跑 linkify，选区/内容是否稳定（A7）
  const before4 = (await state()).html;
  await page.evaluate(() => window.linkifyEditor());
  await page.waitForTimeout(200);
  s = await state();
  check('B4 删除线后再 linkify 不破坏内容', s.text.replace(/\s/g, '').includes('example.com'), s.html);

  // B5: 跨块选区加删除线
  await setHTML('<div>aaa</div><div>bbb</div>');
  await selectRange(1, 5);
  await strike();
  s = await state();
  check('B5 跨块删除线不丢内容', s.text.replace(/\s/g, '') === 'aaabbb', s.html);
  check('B5 跨块删除线块数不变', s.blocks === 2, s.html);
  console.log('     B5 html: ' + s.html);

  // B6: 删除线内回车后再取消删除线
  await setHTML('<div><s>abcdef</s></div>');
  await caretAt('abc', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await selectRange(0, 3);
  await strike();
  s = await state();
  check('B6 <s>内回车后可取消删除线', s.text.replace(/\s/g, '').includes('abc'), s.html);
  console.log('     B6 html: ' + s.html);

  // ─────────────────────────────────────────────────────────
  console.log('\n=== C. 粘贴 ===');
  async function paste(text) {
    await page.evaluate((t) => {
      const ed = document.getElementById('editor'); ed.focus();
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await page.waitForTimeout(800);
  }

  await setHTML('');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); const r = document.createRange(); r.setStart(ed, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await paste('http://example.com');
  s = await state();
  check('C1 空编辑器粘贴 URL → <a>', s.html.includes('<a '), s.html);

  // C2: 粘贴裸域名（粘贴用的是旧正则，只认 scheme；靠 linkify 兜底）
  await setHTML('');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); const r = document.createRange(); r.setStart(ed, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await paste('www.baidu.com');
  s = await state();
  check('C2 粘贴裸域名最终也成链接', s.html.includes('<a '), s.html);

  // C3: 粘贴含文件扩展名的真 URL
  await setHTML('');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); const r = document.createRange(); r.setStart(ed, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await paste('https://cdn.example.com/lib.js');
  s = await state();
  check('C3 粘贴 .js 结尾 URL 仍是链接', s.html.includes('<a '), s.html);

  // C4: 多行粘贴后无残留空行 + 回车可用
  await setHTML('<div>head</div>');
  await caretAt('head', true);
  await paste('\nl1\nl2\n');
  s = await state();
  check('C4 多行粘贴内容完整', s.text.includes('l1') && s.text.includes('l2'), s.html);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.type('Z');
  await page.waitForTimeout(200);
  s = await state();
  check('C4 粘贴后回车+输入生效', s.text.includes('Z'), s.html);

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) console.log('失败项:\n - ' + fails.join('\n - '));
  console.log('pageerror 数量: ' + errs.length + (errs.length ? '\n' + errs.join('\n') : ''));
  await browser.close();
  server.close();
  process.exit(0);
})();
