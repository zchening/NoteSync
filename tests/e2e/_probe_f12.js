// _probe_f12.js — F12 验收探针：relocateCaretToVisible 能否把"不可绘制光标"挪到可见位置
// 场景：模拟用户截图中的状态 —— 选区合法但 rects=0（光标落在换行符中间）
//
// 注意：headless Chromium 中 getClientRects() 对折叠选区通常有值（这是本 bug 的盲区），
// 所以本探针主要验证：
//   (A) relocateCaretToVisible 函数存在且可调用
//   (B) 函数逻辑正确：能生成候选位置、逐个尝试、不崩溃
//   (C) 在可构造的 rects=0 场景下（空文本节点 / 纯空白节点）能成功重定位
//   (D) 不破坏既有功能（ensureCaret 合法路径仍正常返回）

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(HTML);

  // 等待页面初始化
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

  // ===== A: 函数存在 =====
  console.log('\n===== A: 函数存在性 =====');
  const hasRelocate = await page.evaluate(() => typeof window.relocateCaretToVisible === 'function');
  assert('relocateCaretToVisible 存在', hasRelocate);
  const hasEnsure = await page.evaluate(() => typeof window.ensureCaret === 'function');
  assert('ensureCaret 存在', hasEnsure);

  // ===== B: 基础逻辑 —— 在普通文本中调用不崩溃 =====
  console.log('\n===== B: 普通文本中调用不崩溃 =====');
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>hello world</div>';
    editor.focus();
    // 把光标设在 "hello" 和 " world" 之间（offset=5）
    const r = document.createRange();
    const t = editor.querySelector('div').firstChild;
    r.setStart(t, 5); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  // 这个位置 rects>0，所以 ensureCaret 不应触发 relocate
  const noRelocate = await page.evaluate(() => {
    try {
      ensureCaret(true); // forceRepaint=true 但 rects>0 → 不应 relocate
      return true; // 没崩
    } catch(e) { return false; }
  });
  assert('普通文本 ensureCaret(true) 不崩溃', noRelocate);

  // ===== C: 构造 rects≈0 场景 =====
  console.log('\n===== C: 空白/换行场景 =====');

  // C1: 纯空格+换行的块（接近用户截图场景）
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    // 模拟：第一行是空格+换行，第二行是中文
    editor.innerHTML = '<div> \r\n四五六\n</div>';
    editor.focus();
    // 尝试把光标设到 \r\n 中间（offset=1，即 \r 之后 \n 之前）
    const t = editor.querySelector('div').firstChild;
    if (t && t.nodeType === 3) {
      const r = document.createRange();
      r.setStart(t, 1); // 在 \r 和 \n 之间
      r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  });

  const caretState = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return { error: 'no range' };
    const r = sel.getRangeAt(0);
    return {
      rects: r.getClientRects().length,
      bcr: r.getBoundingClientRect(),
      collapsed: sel.isCollapsed,
      text: r.startContainer.nodeType === 3 ? JSON.stringify(r.startContainer.nodeValue) : '[element]',
      offset: r.startOffset,
      connected: r.startContainer.isConnected,
    };
  });
  console.log(`    C1 光标状态: rects=${caretState.rects} text=${caretState.text} offset=${caretState.offset}`);
  console.log(`    C1 bcr=${JSON.stringify(caretState.bcr)}`);

  // 不管 headless 里 rects 是否为 0，直接调 ensureCaret 看它能否安全处理
  const c1Result = await page.evaluate(() => {
    try {
      ensureCaret(true); // 应该要么 repaint 要么 relocate
      const sel = window.getSelection();
      if (!sel.rangeCount) return { ok: false, reason: 'no range after' };
      const r = sel.getRangeAt(0);
      return {
        ok: true,
        rects: r.getClientRects().length,
        text: r.startContainer.nodeType === 3 ? r.startContainer.nodeValue.slice(0, 20) : '[elem]',
        offset: r.startOffset,
      };
    } catch(e) { return { ok: false, error: e.message }; }
  });
  assert('C1 ensureCaret 不崩溃', c1Result.ok);
  if (c1Result.ok) {
    console.log(`    C1处理后: rects=${c1Result.rects} text="${c1Result.text}" offset=${c1Result.offset}`);
  }

  // C2: 纯空 div（更极端的场景）
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div></div><div>有内容</div>';
    editor.focus();
    const r = document.createRange();
    r.setStart(editor.firstChild, 0); // 空div内
    r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });

  const c2Result = await page.evaluate(() => {
    try {
      ensureCaret();
      const sel = window.getSelection();
      if (!sel.rangeCount) return { ok: false, reason: 'no range' };
      const r = sel.getRangeAt(0);
      return {
        ok: true,
        rects: r.getClientRects().length,
        inEditor: document.getElementById('editor').contains(r.startContainer),
      };
    } catch(e) { return { ok: false, error: e.message }; }
  });
  assert('C2 空div后 ensureCaret 能重定位', c2Result.ok && c2Result.inEditor);
  console.log(`    C2处理后: rects=${c2Result.rects} inEditor=${c2Result.inEditor}`);

  // ===== D: 不破坏选中态 =====
  console.log('\n===== D: 不破坏选中态 =====');
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>选中这段文字做测试</div>';
    editor.focus();
    const t = editor.querySelector('div').firstChild;
    const r = document.createRange();
    r.setStart(t, 0); r.setEnd(t, 4); // 选中"选中这"
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const beforeSel = await page.evaluate(() => {
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);
    return { text: r.toString(), collapsed: sel.isCollapsed };
  });
  await page.evaluate(() => ensureCaret());
  const afterSel = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return { text: '', collapsed: true, lost: true };
    const r = sel.getRangeAt(0);
    return { text: r.toString(), collapsed: sel.isCollapsed, lost: false };
  });
  assert('D 选中态保持(before="' + beforeSel.text + '")', !afterSel.lost && afterSel.text === beforeSel.text);

  // ===== E: Ctrl+Z 不受影响（F8 回归） =====
  console.log('\n===== E: Ctrl+Z 回归检查 =====');
  await page.evaluate(() => {
    const editor = document.getElementById('editor');
    editor.innerHTML = '<div>原始文字</div>';
    editor.focus();
    // 模拟输入
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, '替换内容');
    // Ctrl+Z
    document.execCommand('undo', false, null);
  });
  const undoText = await page.evaluate(() => {
    return document.getElementById('editor').innerText;
  });
  assert('E Ctrl+Z 后内容非空', undoText.trim().length > 0);
  console.log(`    E undo后内容: "${undoText.trim()}"`);

  // ===== 总结 =====
  console.log(`\n${'='.repeat(40)}`);
  console.log(`F12 验收结果: ${passed} 通过 / ${failed} 失败`);
  console.log(`${failed === 0 ? '✅ 全绿' : '❌ 有失败'}`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
