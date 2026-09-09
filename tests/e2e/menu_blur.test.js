// NoteSync E2E 回归：手机端点工具栏图标（☰/二维码/复制/闹钟）不得弹出软键盘（v7.5.1）
// 语义：dismissKeyboardForTouch() —— 仅触屏(!CHIP_HOVER_OK)且编辑器正聚焦时 blur 收 IME；桌面行为零变化。
// headless 无真软键盘，用「点按钮后焦点是否离开编辑器」作可观测代理：
//   触屏模拟（patch matchMedia 使 CHIP_HOVER_OK=false）→ 点每个按钮后 activeElement 不再是编辑器；
//   桌面对照（不 patch，CHIP_HOVER_OK=true）→ 点复制后编辑器仍聚焦（证明未误伤桌面光标）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }
process.on('unhandledRejection', (r) => { const m = String((r && r.message) || r); if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(m)) return; console.error('Unhandled:', m); process.exitCode = 1; });

const PASS = 'menublpw';
function touchPatch() {
  // 让 (hover: hover) / (pointer: fine) 恒不匹配 → 应用内 CHIP_HOVER_OK=false（模拟触屏）
  window.matchMedia = function (q) {
    if (/\(\s*hover:\s*hover\s*\)|pointer:\s*fine/.test(q)) {
      return { matches: false, media: String(q), onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
    }
    const o = { matches: false, media: String(q), onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
    return o;
  };
}
async function openUnlocked(browser, baseURL, patch) {
  const ctx = await browser.newContext();
  if (patch) await ctx.addInitScript(touchPatch);
  const page = await ctx.newPage();
  await page.goto(baseURL + 'REGBLURBTN');
  await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
  await page.evaluate(p => window.unlock(String(p)), PASS);
  await page.waitForFunction(() => { const ed = document.getElementById('editor'), m = document.getElementById('mask'); return ed && ed.getAttribute('contentEditable') === 'true' && m && m.classList.contains('hidden'); }, { timeout: 15000 });
  const hasKey = await page.evaluate(() => !!cryptoKey);
  return { ctx, page, hasKey };
}
async function focusEditor(page) {
  await page.evaluate(() => {
    ['menuMask', 'qrMask', 'remMask', 'aboutMask', 'diagMask', 'cpMask'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    const ed = document.getElementById('editor'); ed.innerHTML = '<div>abc</div>'; ed.focus();
  });
}
const isFocused = (page) => page.evaluate(() => document.activeElement === document.getElementById('editor'));

let server, browser, baseURL;
before(async () => { ({ server, baseURL, browser } = await setup()); });
after(async () => { await teardown(browser, server); process.exit(failures > 0 ? 1 : 0); });

test('触屏：点 ☰/二维码/复制/闹钟 后焦点离开编辑器（收键盘）', guard(async () => {
  const d = await openUnlocked(browser, baseURL, true);
  try {
    assert.strictEqual(d.hasKey, true, '应已解锁（cryptoKey 就绪，闹钟按钮才有 cryptoKey 守卫放行）');
    assert.strictEqual(await d.page.evaluate(() => CHIP_HOVER_OK), false, '触屏模拟应令 CHIP_HOVER_OK=false');
    for (const btn of ['#menuBtn', '#qrBtn', '#copyBtn', '#remBtn']) {
      await focusEditor(d.page);
      assert.strictEqual(await isFocused(d.page), true, btn + ' 前置：编辑器应聚焦');
      await d.page.click(btn);
      await new Promise(r => setTimeout(r, 120));
      assert.strictEqual(await isFocused(d.page), false, btn + ' 后编辑器应已 blur（触屏收软键盘），实际仍聚焦=会弹键盘');
    }
  } finally { try { await d.ctx.close(); } catch (e) {} }
}));

test('桌面对照：点复制不 blur，编辑器保持聚焦（未误伤桌面光标）', guard(async () => {
  const d = await openUnlocked(browser, baseURL, false);
  try {
    assert.strictEqual(await d.page.evaluate(() => CHIP_HOVER_OK), true, '无模拟时桌面 CHIP_HOVER_OK 应为 true');
    await focusEditor(d.page);
    assert.strictEqual(await isFocused(d.page), true, '前置：编辑器应聚焦');
    await d.page.click('#copyBtn');
    await new Promise(r => setTimeout(r, 120));
    assert.strictEqual(await isFocused(d.page), true, '桌面点复制不应 blur 编辑器（保持光标）');
  } finally { try { await d.ctx.close(); } catch (e) {} }
}));
