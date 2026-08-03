// _probe_f13.js — F13 回归探针：回车产生空块后，linkify 触发 ensureCaret 不应把
// 光标跨块拽回上一行（F12 引入的回归）。
//
// 双保险：
//   B) 直接单测空块守卫（确定性，不依赖 headless 的 getClientRects 怪癖）
//   D) 真实「一」+回车 → 等 linkify(500ms) → 断言光标留在第二行空块
//   C) F12 原场景不回归（含内容的块里坏偏移仍 relocate）
//   E) Ctrl+Z 不回归（F8）

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });
  await page.evaluate(() => {
    const el = document.getElementById('landing'); if (el) el.classList.add('hidden');
    const m = document.getElementById('mask'); if (m) m.classList.add('hidden');
  });

  let passed = 0, failed = 0;
  function assert(label, ok) {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}`); }
  }
  const blockIndexOfCursor = async () => page.evaluate(() => {
    const editor = document.getElementById('editor');
    const sel = window.getSelection();
    if (!sel.rangeCount) return -1;
    let c = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    while (c && c.parentElement !== editor) c = c.parentElement;
    return [...editor.children].indexOf(c);
  });

  // ===== A: 函数存在 =====
  console.log('\n===== A: 函数存在性 =====');
  assert('relocateCaretToVisible 存在', await page.evaluate(() => typeof window.relocateCaretToVisible === 'function'));

  // ===== B: 空块守卫（确定性单测）=====
  console.log('\n===== B: 空块里调 relocateCaretToVisible 不应跨块 =====');
  const bResult = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>一</div><div></div>';
    editor.focus();
    const second = editor.children[1];
    const r = document.createRange();
    r.setStart(second, 0); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    try { window.relocateCaretToVisible(r); } catch (e) { return { err: e.message }; }
    const after = window.getSelection().getRangeAt(0);
    let c = after.startContainer.nodeType === 3 ? after.startContainer.parentElement : after.startContainer;
    while (c && c.parentElement !== editor) c = c.parentElement;
    return { idx: [...editor.children].indexOf(c), total: editor.children.length };
  });
  assert(`B 光标留在第二行空块 (idx=${bResult.idx}, total=${bResult.total})`, bResult.idx === 1);

  // ===== C: F12 原场景不回归（含内容块里坏偏移仍 relocate）=====
  console.log('\n===== C: F12 不回归（含内容块的坏偏移仍 relocate）=====');
  const cResult = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div> \r\n四五六\n</div>';
    editor.focus();
    const t = editor.querySelector('div').firstChild;
    const r = document.createRange();
    r.setStart(t, 1); r.collapse(true); // \r 和 \n 之间 → 坏偏移
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    try { window.relocateCaretToVisible(r); } catch (e) { return { err: e.message }; }
    const after = window.getSelection().getRangeAt(0);
    return { text: after.startContainer.nodeValue ? after.startContainer.nodeValue.slice(0, 12) : '[elem]', offset: after.startOffset };
  });
  assert('C relocate 后仍落在含内容块', cResult.text && cResult.text.indexOf('四五六') !== -1);

  // ===== D: 集成 —— 真实「一」+回车 → 等 linkify → 光标在第二行 =====
  console.log('\n===== D: 集成 (一 + 回车 → 光标留第二行空块) =====');
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>一</div>';
    editor.focus();
    const t = editor.querySelector('div').firstChild;
    const r = document.createRange();
    r.setStart(t, 1); r.collapse(true); // 光标在「一」后面
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  // 模拟真实回车（触发 input 事件 → linkify 500ms 防抖 → ensureCaret(true)）
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800); // 等 linkify + ensureCaret 跑完
  const dState = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    return { childCount: editor.children.length, childTags: [...editor.children].map(c => c.tagName) };
  });
  console.log(`    D 编辑器结构: ${dState.childCount} 个 ${dState.childTags.join(',')}`);
  const dIdx = await blockIndexOfCursor();
  console.log(`    D 光标所在块索引: ${dIdx}（期望 1，即第二行空块）`);
  assert('D 回车后编辑器有 2 个块', dState.childCount === 2);
  assert('D 光标留在第二行空块 (idx=1)', dIdx === 1);

  // ===== E: Ctrl+Z 不回归（F8）=====
  console.log('\n===== E: Ctrl+Z 回归检查 =====');
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>原始文字</div>';
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, '替换内容');
    document.execCommand('undo', false, null);
  });
  const undoText = await page.evaluate(() => document.getElementById('editor').innerText);
  assert('E Ctrl+Z 后内容非空', undoText.trim().length > 0);

  // ===== 总结 =====
  console.log(`\n${'='.repeat(40)}`);
  console.log(`F13 验收结果: ${passed} 通过 / ${failed} 失败`);
  console.log(`${failed === 0 ? '✅ 全绿' : '❌ 有失败'}`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
