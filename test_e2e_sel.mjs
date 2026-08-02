// NoteSync 全链路 E2E：真实无头 Chromium 复现 BUG_CHECKLIST A7（删除线后选区丢失）
// 只读源码，不修改 index.html / server.js
// playwright 装在隔离 runtime workspace，用绝对路径导入
const PW = 'file:///C:/Users/zchen/.workbuddy/binaries/node/workspace/pw-e2e/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const BASE = 'http://localhost:8080';
const NOTE = '/cstest';

const FULL = '1，个人所得税申报（7-23 14点录音。税务人员建议XX在个人所得税APP上对2024年汇算清缴进行更正，填入刚告知的数字即可，点下一步会跳出应缴金额（一两百元）。检测到股息15.34元、利息743.42元，合计750余元，按20%需补交约150多元个税）';
const T = '税务人员建议XX在个人所得税APP上对2024年汇算清缴进行更正，填入刚告知的数字即可，点下一步会跳出应缴金额（一两百元）。检测到股息15.34元、利息743.42元，合计750余元';

const ZWSP = /\u200B/g;
const norm = s => (s || '').replace(ZWSP, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const consoleErrors = [];
const pageErrors = [];

function assert(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

await page.goto(BASE + NOTE, { waitUntil: 'domcontentloaded' });

// --- 解锁 ---
await page.waitForSelector('#pw', { state: 'visible', timeout: 15000 });
await page.fill('#pw', 'testpass123');
await page.click('#ok');
await page.waitForFunction(
  () => document.getElementById('mask').classList.contains('hidden'),
  null, { timeout: 15000 }
);
assert('解锁成功（mask 隐藏）', true);

// --- 注入内容 + 建立选区 ---
const setup = await page.evaluate(({ FULL, T }) => {
  const editor = document.getElementById('editor');
  editor.innerHTML = FULL;
  editor.contentEditable = 'true';
  editor.focus();

  // 在 editor 纯文本中定位 T，映射到文本节点偏移
  const full = editor.textContent;
  const start = full.indexOf(T);
  if (start < 0) return { ok: false, reason: 'T not found in editor text' };
  const end = start + T.length;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let pos = 0, sn = null, so = 0, en = null, eo = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode, len = n.length;
    if (sn === null && pos + len >= start) { sn = n; so = start - pos; }
    if (en === null && pos + len >= end) { en = n; eo = end - pos; }
    if (sn && en) break;
    pos += len;
  }
  const r = document.createRange();
  r.setStart(sn, so); r.setEnd(en, eo);
  const sel = document.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange')); // 确保 lastRange 被记录
  return { ok: true, selected: sel.toString(), collapsed: sel.getRangeAt(0).collapsed, active: document.activeElement && document.activeElement.id };
}, { FULL, T });

assert('注入内容并建立初始选区 === T', setup.ok && setup.selected === T && !setup.collapsed,
  `activeElement=${setup.active} len=${setup.selected ? setup.selected.length : 0}/${T.length}`);

const snap = async () => page.evaluate(() => {
  const sel = window.getSelection();
  const editor = document.getElementById('editor');
  const txt = sel.toString();
  return {
    text: txt,
    collapsed: sel.rangeCount ? sel.getRangeAt(0).collapsed : true,
    rangeCount: sel.rangeCount,
    inEditor: sel.rangeCount ? editor.contains(sel.getRangeAt(0).commonAncestorContainer) : false,
    sCount: editor.querySelectorAll('s').length,
    sText: Array.from(editor.querySelectorAll('s')).map(s => s.textContent).join('|'),
    zwspInEditor: (editor.textContent.match(/\u200B/g) || []).length
  };
});

// --- 步骤 4：点击 #strikeBtn 添加删除线 ---
await page.click('#strikeBtn', { force: true });
await sleep(800); // linkify 防抖 500ms + 余量

const afterAdd = await snap();
assert('加删除线后：选区非折叠且仍在 editor 内', !afterAdd.collapsed && afterAdd.inEditor,
  `collapsed=${afterAdd.collapsed} inEditor=${afterAdd.inEditor}`);
assert('加删除线后：SelectedText === T（严格）', afterAdd.text === T,
  `got len=${afterAdd.text.length}, want ${T.length}, zwsp(editor)=${afterAdd.zwspInEditor}`);
assert('加删除线后：SelectedText === T（忽略 U+200B）', norm(afterAdd.text) === norm(T),
  `got="${norm(afterAdd.text).slice(0, 20)}…${norm(afterAdd.text).slice(-12)}"`);
assert('加删除线后：<s> 已生成且覆盖 T', afterAdd.sCount > 0 && norm(afterAdd.sText) === norm(T),
  `sCount=${afterAdd.sCount} sTextLen=${norm(afterAdd.sText).length}`);

// --- 步骤 5：再点一次取消删除线 ---
await page.click('#strikeBtn', { force: true });
await sleep(800);

const afterRemove = await snap();
assert('取消删除线后：选区非折叠且仍在 editor 内', !afterRemove.collapsed && afterRemove.inEditor,
  `collapsed=${afterRemove.collapsed} inEditor=${afterRemove.inEditor}`);
assert('取消删除线后：SelectedText === T（严格）', afterRemove.text === T,
  `got len=${afterRemove.text.length}, want ${T.length}, zwsp(editor)=${afterRemove.zwspInEditor}`);
assert('取消删除线后：SelectedText === T（忽略 U+200B）', norm(afterRemove.text) === norm(T),
  `got="${norm(afterRemove.text).slice(0, 20)}…${norm(afterRemove.text).slice(-12)}"`);
assert('取消删除线后：<s> 已清除', afterRemove.sCount === 0, `sCount=${afterRemove.sCount}`);

// --- 对照组：选区内不含 linkify 分隔符（无 . % / : 等），验证根因是否为 U+200B 插入 ---
const CTRL_FULL = '开头文字。中间这段需要被选中并加删除线的连续中文内容足够长。结尾文字';
const CTRL_T = '中间这段需要被选中并加删除线的连续中文内容足够长';

await page.evaluate(({ CTRL_FULL, CTRL_T }) => {
  const editor = document.getElementById('editor');
  editor.innerHTML = CTRL_FULL;
  editor.focus();
  const full = editor.textContent;
  const start = full.indexOf(CTRL_T), end = start + CTRL_T.length;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let pos = 0, sn = null, so = 0, en = null, eo = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode, len = n.length;
    if (sn === null && pos + len >= start) { sn = n; so = start - pos; }
    if (en === null && pos + len >= end) { en = n; eo = end - pos; }
    if (sn && en) break;
    pos += len;
  }
  const r = document.createRange();
  r.setStart(sn, so); r.setEnd(en, eo);
  const sel = document.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
}, { CTRL_FULL, CTRL_T });

await page.click('#strikeBtn', { force: true });
await sleep(800);
const ctrlAdd = await snap();
assert('[对照组] 无分隔符文本：加删除线后 SelectedText === T', ctrlAdd.text === CTRL_T,
  `got="${ctrlAdd.text}" zwsp=${ctrlAdd.zwspInEditor}`);

await page.click('#strikeBtn', { force: true });
await sleep(800);
const ctrlRm = await snap();
assert('[对照组] 无分隔符文本：取消删除线后 SelectedText === T', ctrlRm.text === CTRL_T,
  `got="${ctrlRm.text}"`);
assert('[对照组] 无分隔符文本：<s> 已清除', ctrlRm.sCount === 0, `sCount=${ctrlRm.sCount}`);

// --- 诊断信息 ---
console.log('\n--- 诊断 ---');
console.log('取消后残留 <s> 内容:', JSON.stringify(afterRemove.sText));
console.log('加线后 selected(norm):', JSON.stringify(norm(afterAdd.text)));
console.log('取消后 selected(norm):', JSON.stringify(norm(afterRemove.text)));
console.log('期望 T             :', JSON.stringify(T));
console.log('editor 内 U+200B 数 :', afterAdd.zwspInEditor, '->', afterRemove.zwspInEditor);
console.log('console.error:', consoleErrors.length ? consoleErrors : '(无)');
console.log('pageerror   :', pageErrors.length ? pageErrors : '(无)');

const failed = results.filter(r => !r.pass);
console.log(`\n=== 汇总: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length) console.log('失败项:', failed.map(f => f.name).join(' | '));

await browser.close();
process.exit(failed.length ? 1 : 0);
