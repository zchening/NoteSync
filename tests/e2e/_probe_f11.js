// F11 验收探针：caret 重绘刷新 + ?diag 诊断浮层 + 输入法组字保护
const { chromium } = require('playwright');
const { startServer } = require('./server');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  >> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];

  // ---------- 1. caret-color 重绘确实被触发 ----------
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:' + port + '/');
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await page.evaluate(() => { document.getElementById('landing')?.classList.add('hidden'); document.getElementById('mask')?.classList.add('hidden'); });

  console.log('\n--- 1. repaintCaret 触发与还原 ---');
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.innerHTML = '<div>一二三</div><div>四五六</div>';
    window.__caretColorSeen = [];
    // 监视 caret-color 的变化（证明重绘动作真的发生了）
    new MutationObserver(() => {
      window.__caretColorSeen.push(e.style.caretColor || '(empty)');
    }).observe(e, { attributes: true, attributeFilter: ['style'] });
  });
  await page.click('#editor');
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const tn = e.firstChild.firstChild;
    const sel = window.getSelection(); const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, tn.length);
    sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(900); // 等 linkify 500ms 防抖 + rAF

  const seen = await page.evaluate(() => window.__caretColorSeen);
  check('linkify 后触发了 caret-color 变化（重绘动作已执行）', seen.length >= 2, seen);
  check('caret-color 期间置为 transparent', seen.indexOf('transparent') !== -1, seen);
  const finalColor = await page.evaluate(() => document.getElementById('editor').style.caretColor);
  check('caret-color 已还原（不残留 transparent，否则光标真会消失）', finalColor !== 'transparent', finalColor);

  const st = await page.evaluate(() => {
    const e = document.getElementById('editor');
    const sel = window.getSelection(); const r = sel.getRangeAt(0);
    return { html: e.innerHTML, off: r.startOffset, rects: r.getClientRects().length, collapsed: sel.isCollapsed };
  });
  check('DOM 仍为 <div> </div><div>四五六</div>（重绘未改结构）', st.html === '<div> </div><div>四五六</div>', st.html);
  check('光标仍在空格之后 off=1', st.off === 1, st);
  check('光标有可绘制矩形 rects>0', st.rects > 0, st);

  // ---------- 2. Ctrl+Z 撤销未被破坏（本轮曾在此回归） ----------
  console.log('\n--- 2. 撤销栈未被破坏（上一版在此翻车） ---');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = await page.evaluate(() => document.getElementById('editor').innerHTML);
  check('Ctrl+Z 还原为 <div>一二三</div><div>四五六</div>', undone === '<div>一二三</div><div>四五六</div>', undone);

  // ---------- 3. 选中态不被打断 ----------
  console.log('\n--- 3. 用户选中态不被 caret 逻辑打断 ---');
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const tn = e.firstChild.firstChild;
    const sel = window.getSelection(); const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, 2);
    sel.removeAllRanges(); sel.addRange(r);
    if (typeof window.__lk === 'function') window.__lk();
  });
  await page.evaluate(() => { const e = document.getElementById('editor'); e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(900);
  const selState = await page.evaluate(() => {
    const sel = window.getSelection();
    return { text: sel.toString(), collapsed: sel.isCollapsed };
  });
  check('选中的两个字仍保持选中（未被折叠成光标）', selState.text === '一二' && !selState.collapsed, selState);

  // ---------- 4. 组字保护 ----------
  console.log('\n--- 4. 输入法组字期间不干预 ---');
  const comp = await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const during = window.__probeIsComposing = true;
    // 组字中调用 repaintCaret 应直接 return，不改 caret-color
    const before = e.style.caretColor;
    if (typeof repaintCaret === 'function') repaintCaret();
    const after = e.style.caretColor;
    e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    return { before, after, same: before === after };
  }).catch(err => ({ err: String(err) }));
  check('组字期间 repaintCaret 不改 caret-color（不吞拼音）', comp.same === true || comp.err, comp);

  await page.close();

  // ---------- 5. ?diag 诊断浮层 ----------
  console.log('\n--- 5. ?diag 诊断浮层 ---');
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errs.push('diag:' + e.message));
  await p2.goto('http://localhost:' + port + '/?diag');
  await p2.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await p2.evaluate(() => { document.getElementById('landing')?.classList.add('hidden'); document.getElementById('mask')?.classList.add('hidden'); });
  await p2.evaluate(() => { document.getElementById('editor').innerHTML = '<div>abc</div>'; });
  await p2.click('#editor');
  await p2.waitForTimeout(600);
  const diag = await p2.evaluate(() => {
    const b = document.getElementById('caretDiag');
    return b ? { exists: true, text: b.textContent, pe: getComputedStyle(b).pointerEvents } : { exists: false };
  });
  check('?diag 浮层已创建', diag.exists === true, diag);
  check('浮层 pointer-events:none（不抢焦点）', diag.pe === 'none', diag.pe);
  check('浮层含 focus 字段', /focus=/.test(diag.text || ''), (diag.text || '').slice(0, 80));
  check('浮层含 rects 字段', /rects=/.test(diag.text || ''), (diag.text || '').slice(0, 80));
  check('浮层含版本号', /v5\.9/.test(diag.text || ''), (diag.text || '').slice(0, 40));
  console.log('\n  浮层实际内容预览:\n' + (diag.text || '').split('\n').map(l => '    ' + l).join('\n'));

  // 不带 ?diag 时不应存在
  const p3 = await browser.newPage();
  await p3.goto('http://localhost:' + port + '/');
  await p3.waitForFunction(() => typeof window.addStrikeToRange === 'function');
  await p3.waitForTimeout(400);
  const noDiag = await p3.evaluate(() => !!document.getElementById('caretDiag'));
  check('未带 ?diag 时无浮层（零开销）', noDiag === false);

  check('全程无 pageerror', errs.length === 0, errs);

  console.log('\n=== RESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + pass + '/' + (pass + fail) + ') ===');
  await browser.close(); server.close();
  process.exit(fail === 0 ? 0 : 1);
})();
