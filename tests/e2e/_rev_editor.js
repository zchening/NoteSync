// 复核脚本：Enter 行为（<a>/<s>/列表内）、删除线回归、粘贴 cleanup、同步选区恢复
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

  const setHTML = (h) => page.evaluate((x) => {
    const ed = document.getElementById('editor'); ed.innerHTML = x; ed.focus();
  }, h);
  const html = () => page.evaluate(() => document.getElementById('editor').innerHTML);
  const state = () => page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    let inA = false, inS = false, path = null;
    if (sel.rangeCount) {
      let n = sel.getRangeAt(0).startContainer;
      const parts = [];
      let p = n.nodeType === 3 ? n.parentElement : n;
      while (p && p !== ed) { parts.unshift(p.tagName); if (p.tagName === 'A') inA = true; if (p.tagName === 'S') inS = true; p = p.parentElement; }
      path = parts.join('>');
    }
    return { html: ed.innerHTML, text: ed.textContent.replace(/\u200B/g, ''), inA, inS, path,
      caret: sel.rangeCount > 0, blocks: ed.querySelectorAll(':scope>div,:scope>p').length };
  });
  // 把光标放到某文本内容第 idx 个字符前（按可见文本全局定位）
  const caretAt = (needle, after) => page.evaluate(({ needle, after }) => {
    const ed = document.getElementById('editor'); ed.focus();
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      const i = n.nodeValue.indexOf(needle);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, after ? i + needle.length : i);
        r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }
    }
    return false;
  }, { needle, after });

  // ─────────────────────────────────────────────────────────
  console.log('\n=== A. Enter 在行内元素内部的行为 ===');

  // A1: 链接中间回车 —— 新行不应继承 <a>，否则后续输入全变链接文字
  await setHTML('<div>see http://example.com/abcdef end</div>');
  await page.waitForTimeout(700); // 等 linkify 生成 <a>
  let h0 = await html();
  check('前置条件: 已生成 <a>', h0.includes('<a '), h0);
  await caretAt('abc', true); // 落在 <a> 文本中间 (abc|def)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  let s = await state();
  check('A1 链接中间回车后光标不在 <a> 内(否则续打字变链接)', !s.inA, s);
  await page.keyboard.type('X');
  await page.waitForTimeout(120);
  s = await state();
  check('A1 回车后输入的 X 不在 <a> 内', !/<a[^>]*>[^<]*X/.test(s.html), s);

  // A2: 删除线中间回车
  await setHTML('<div><s>abcdef</s></div>');
  await caretAt('abc', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.type('Y');
  await page.waitForTimeout(120);
  s = await state();
  check('A2 <s> 中间回车产生两行', s.blocks >= 2 || s.html.split('<div').length >= 2, s);
  console.log('     A2 结果 html: ' + s.html);

  // A3: 列表内回车
  await setHTML('<ul><li>item1</li></ul>');
  await caretAt('item1', true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.type('item2');
  await page.waitForTimeout(120);
  s = await state();
  check('A3 列表内回车产生新 <li>', (s.html.match(/<li/g) || []).length === 2, s);

  // A4: 行尾连续回车产生连续空行 (bug4)
  await setHTML('<div>hello</div>');
  await caretAt('hello', true);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(80); }
  s = await state();
  check('A4 行尾按3次回车产生4行', s.blocks >= 4, s);

  // A5: Shift+Enter 软换行仍走浏览器默认
  await setHTML('<div>ab</div>');
  await caretAt('ab', true);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(120);
  s = await state();
  check('A5 Shift+Enter 插入 <br> 而非新块', s.html.includes('<br'), s);

  // A6: bug3 —— "一二三四五六http://x" 在"四"前回车，光标应在新行开头
  await setHTML('<div>abcdef http://example.com</div>');
  await page.waitForTimeout(700);
  await caretAt('def', false); // "abc|def ..."
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900); // 等 linkify 500ms 定时器跑完
  const after = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    if (!sel.rangeCount) return { none: true, html: ed.innerHTML };
    const r = sel.getRangeAt(0);
    // 光标前的可见文本
    const pre = document.createRange();
    pre.selectNodeContents(ed);
    pre.setEnd(r.startContainer, r.startOffset);
    return { before: pre.toString().replace(/\u200B/g, ''), html: ed.innerHTML };
  });
  check('A6 回车+linkify 后光标停在 "abc" 之后(不跳)', after.before === 'abc', after);

  // ─────────────────────────────────────────────────────────
  console.log('\n=== B. 删除线回归 (A1-A7) ===');

  // B1: 普通加删除线
  await setHTML('<div>hello world</div>');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const t = ed.firstChild.firstChild;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(r);
  });
  await page.evaluate(() => window.toggleStrike ? window.toggleStrike() : document.getElementById('strikeBtn')?.click());
  await page.waitForTimeout(200);
  s = await state();
  check('B1 加删除线生成 <s>hello</s>', /<s>hello<\/s>/.test(s.html), s);
  check('B1 加删除线后选区仍存在', s.caret, s);

  // B2: 再次点击取消
  await page.evaluate(() => window.toggleStrike ? window.toggleStrike() : document.getElementById('strikeBtn')?.click());
  await page.waitForTimeout(200);
  s = await state();
  check('B2 取消删除线后 <s> 移除', !s.html.includes('<s>'), s);

  // B3: 含 URL 行加删除线（linkify 与 <s> 共存，A7）
  await setHTML('<div>go http://example.com now</div>');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const r = document.createRange();
    r.selectNodeContents(ed.firstChild);
    const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(r);
  });
  await page.evaluate(() => window.toggleStrike ? window.toggleStrike() : document.getElementById('strikeBtn')?.click());
  await page.waitForTimeout(800);
  s = await state();
  check('B3 URL 行加删除线后 <s> 存在', s.html.includes('<s>'), s);
  check('B3 URL 行加删除线后 <a> 未丢失', s.html.includes('<a '), s);
  check('B3 文本未丢失', s.text.includes('example.com'), s);

  // ─────────────────────────────────────────────────────────
  console.log('\n=== C. 粘贴路径 cleanup 门控 ===');

  async function paste(text) {
    await page.evaluate((t) => {
      const ed = document.getElementById('editor');
      ed.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await page.waitForTimeout(800);
  }

  // C1: 空编辑器粘贴 URL
  await setHTML('');
  await paste('http://example.com');
  s = await state();
  check('C1 空编辑器粘贴 URL → 有 <a>', s.html.includes('<a '), s);
  check('C1 粘贴后无残留首尾空行', !/^(<br>|<div><br><\/div>)/.test(s.html), s);

  // C2: 多行文本粘贴
  await setHTML('<div>head</div>');
  await caretAt('head', true);
  await paste('\nline1\nline2\n');
  s = await state();
  check('C2 多行粘贴后内容含 line1/line2', s.text.includes('line1') && s.text.includes('line2'), s);
  console.log('     C2 结果 html: ' + s.html);

  // C3: 粘贴后按回车仍有效（skipCleanupOnce 未被污染）
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.type('Z');
  await page.waitForTimeout(150);
  s = await state();
  check('C3 粘贴后回车+输入 Z 生效', s.text.includes('Z'), s);

  // ─────────────────────────────────────────────────────────
  console.log('\n=== D. E3 删除多行后无残留空行 ===');
  await setHTML('<div>aaa</div><div>bbb</div><div>ccc</div><div>ddd</div>');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const r = document.createRange(); r.setStart(ed, 0); r.setEnd(ed, 3);
    const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  s = await state();
  check('D1 删除前3行后只剩 ddd', s.text.replace(/\s/g, '') === 'ddd', s);
  check('D1 无首部空行', !/^(<br>|<div><br><\/div>)/.test(s.html), s);
  check('D1 无尾部空行', !/(<br>|<div><br><\/div>)$/.test(s.html), s);

  // D2: 全选删除
  await setHTML('<div>aaa</div><div>bbb</div><div>ccc</div>');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  s = await state();
  check('D2 全删后内容为空', s.text.trim() === '', s);
  check('D2 全删后光标仍在', s.caret, s);
  // D3: 全删后立刻能打字
  await page.keyboard.type('new');
  await page.waitForTimeout(200);
  s = await state();
  check('D3 全删后可继续输入', s.text.includes('new'), s);

  // ─────────────────────────────────────────────────────────
  console.log('\n=== E. 同步 poll 覆盖 innerHTML 后选区恢复 (E1) ===');
  await setHTML('<div>abcdefgh</div>');
  await caretAt('abcd', true); // 光标在 abcd 后
  const e1 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);
    const saved = window.saveSelectionOffsets(ed, r);
    // 模拟 poll 覆盖
    ed.innerHTML = '<div>abcdefgh</div><div>remote</div>';
    window.linkifyEditor({ keepSelection: false });
    ed.focus();
    const nr = window.restoreSelectionOffsets(ed, saved.start, saved.end);
    if (nr) { sel.removeAllRanges(); sel.addRange(nr); }
    const pre = document.createRange();
    pre.selectNodeContents(ed);
    if (sel.rangeCount) pre.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return { saved, restored: !!nr, before: pre.toString().replace(/\u200B/g, ''), html: ed.innerHTML };
  });
  check('E1 poll 覆盖后选区恢复成功', e1.restored, e1);
  check('E1 光标位置正确(abcd 后)', e1.before === 'abcd', e1);

  // E2: poll 覆盖内容变短时兜底不报错
  const e2 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>0123456789</div>'; ed.focus();
    const sel = window.getSelection();
    const t = ed.firstChild.firstChild;
    const r = document.createRange(); r.setStart(t, 9); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    const saved = window.saveSelectionOffsets(ed, sel.getRangeAt(0));
    ed.innerHTML = '<div>ab</div>';
    const nr = window.restoreSelectionOffsets(ed, saved.start, saved.end);
    return { restored: !!nr };
  });
  check('E2 内容变短时 restore 返回 null 走兜底(不抛错)', e2.restored === false, e2);

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  if (fails.length) console.log('失败项:\n - ' + fails.join('\n - '));
  console.log('pageerror 数量: ' + errs.length + (errs.length ? '\n' + errs.join('\n') : ''));
  await browser.close();
  server.close();
  process.exit(0);
})();
