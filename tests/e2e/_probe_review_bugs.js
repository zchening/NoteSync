// _probe_review_bugs.js — 代码审查疑点验证（v5.18）
// 疑点清单：
//   R1 行中粘贴单行文本 → 是否产生嵌套 <div> 导致多出换行（原生行为应合并为一行）
//   R2 行中粘贴多行文本 → 首/尾行是否与前后文本正确合并
//   R3 URL 后紧跟中文标点（。！？，）→ 是否被吞进链接文本/href
//   R4 URL 文本中含双引号 → linkify 用字符串拼 innerHTML 是否存在属性注入（XSS）
//   R5 含 <tag> 样式的文本（节点同时含可链接内容）→ innerHTML 重建是否丢失/篡改内容
//   R6 Shift+Enter 软换行 sanity
//   R7 空编辑器粘贴多行（回归 sanity，对应 G1）
//
// 用法: node tests/e2e/_probe_review_bugs.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });

  await page.evaluate(() => {
    const l = document.getElementById('landing'); if (l) l.classList.add('hidden');
    const m = document.getElementById('mask'); if (m) m.classList.add('hidden');
    const e = document.getElementById('editor'); e.contentEditable = 'true'; e.focus();
    window.apiPut = async () => ({ v: (window.__v = (window.__v || 0) + 1) });
    window.apiGet = async () => ({ v: 0, ct: '', iv: '' });
  });

  const inner = () => page.evaluate(() => document.getElementById('editor').innerHTML);
  const text = () => page.evaluate(() => document.getElementById('editor').innerText);
  const norm = s => (s || '').replace(/\u200B/g, '');

  async function setHtml(html) {
    await page.evaluate(h => {
      const e = document.getElementById('editor'); e.innerHTML = h; e.focus();
      if (window.__undoReset) window.__undoReset();
    }, html);
  }
  // 把光标放到第 blockIdx 个块的文字 offset 处
  async function caretAt(blockIdx, offset) {
    await page.evaluate(([bi, off]) => {
      const e = document.getElementById('editor');
      const blocks = Array.from(e.children);
      const blk = blocks[bi] || e.lastChild;
      const t = blk.firstChild;
      const r = document.createRange();
      r.setStart(t, Math.min(off, t.length));
      r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      e.focus();
    }, [blockIdx, offset]);
  }
  async function doPaste(t) {
    await page.evaluate(v => {
      const editor = document.getElementById('editor');
      editor.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', v);
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      ev.clipboardData = dt;
      editor.dispatchEvent(ev);
    }, t);
  }
  // 直写文本节点后派发 input，触发 500ms linkify
  async function setRawTextAndLinkify(txt) {
    await page.evaluate(v => {
      const e = document.getElementById('editor');
      e.innerHTML = '';
      const d = document.createElement('div');
      d.textContent = v;
      e.appendChild(d);
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }, txt);
    await page.waitForTimeout(800);
  }

  // ===================== R1 行中粘贴单行 =====================
  console.log('\n===== R1: 行中粘贴单行 "XY"（内容 abcdef，光标 c|d） =====');
  await setHtml('<div>abcdef</div>');
  await caretAt(0, 3);
  await doPaste('XY');
  await page.waitForTimeout(800);
  let h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  console.log('  innerText = ' + JSON.stringify(await text()));
  // 浏览器原生粘贴行为：abcXYdef 一行。嵌套 div 会造成多行。
  check('R1: 行中粘贴单行不产生嵌套块', !/<div[^>]*>[^<]*<div/.test(h), h);
  check('R1: 渲染为一行 abcXYdef', norm(await text()).trim() === 'abcXYdef', JSON.stringify(await text()));

  // ===================== R2 行中粘贴多行 =====================
  console.log('\n===== R2: 行中粘贴多行 "X\\nY"（内容 abcdef，光标 c|d） =====');
  await setHtml('<div>abcdef</div>');
  await caretAt(0, 3);
  await doPaste('X\nY');
  await page.waitForTimeout(800);
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  console.log('  innerText = ' + JSON.stringify(await text()));
  // 原生预期：abcX / Ydef 两行
  const linesR2 = norm(await text()).split('\n').map(s => s.trim());
  check('R2: 渲染为两行 [abcX, Ydef]', linesR2.length === 2 && linesR2[0] === 'abcX' && linesR2[1] === 'Ydef', JSON.stringify(linesR2));
  check('R2: 不产生嵌套块', !/<div[^>]*>[^<]*<div/.test(h), h);

  // ===================== R2b 行尾粘贴多行 =====================
  console.log('\n===== R2b: 行尾粘贴多行 "X\\nY"（内容 abc，光标末尾） =====');
  await setHtml('<div>abc</div>');
  await caretAt(0, 3);
  await doPaste('X\nY');
  await page.waitForTimeout(800);
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  console.log('  innerText = ' + JSON.stringify(await text()));
  const linesR2b = norm(await text()).split('\n').map(s => s.trim());
  check('R2b: 渲染为两行 [abcX, Y]', linesR2b.length === 2 && linesR2b[0] === 'abcX' && linesR2b[1] === 'Y', JSON.stringify(linesR2b));

  // ===================== R3 URL 后紧跟中文标点 =====================
  console.log('\n===== R3: "看https://baidu.com。很好" linkify 后链接边界 =====');
  await setRawTextAndLinkify('看https://baidu.com。很好');
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  const aInfo = await page.evaluate(() => {
    const a = document.querySelector('#editor a');
    return a ? { text: a.textContent, href: a.getAttribute('href') } : null;
  });
  console.log('  链接 = ' + JSON.stringify(aInfo));
  check('R3: 链接文本不含后续中文（"。很好"不应被吞入链接）',
    !!aInfo && !/[。，！？、；：）]/.test(norm(aInfo.text).replace(/^https?:\/\//, '').split('/').slice(2).join('/') || aInfo.text) && !/。很好/.test(norm(aInfo.text)),
    JSON.stringify(aInfo));

  // ===================== R4 URL 含双引号 → 属性注入 =====================
  console.log('\n===== R4: URL 文本含双引号（属性注入/XSS 风险） =====');
  await setRawTextAndLinkify('https://a.com/x"onmouseover="alert(1)');
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  const inj = await page.evaluate(() => {
    const a = document.querySelector('#editor a');
    if (!a) return { none: true };
    return {
      hasOnmouseover: a.hasAttribute('onmouseover'),
      attrs: Array.from(a.attributes).map(at => at.name + '=' + at.value),
      extraAnchors: document.querySelectorAll('#editor [onmouseover]').length,
    };
  });
  console.log('  属性 = ' + JSON.stringify(inj));
  check('R4: 无注入的 onmouseover 属性', !(inj && inj.hasOnmouseover), JSON.stringify(inj));

  // ===================== R5 含 <tag> 的文本在可链接节点中 =====================
  console.log('\n===== R5: 文本 "<b>bold</b> see https://x.com"（HTML 样式文本是否被吞） =====');
  await setRawTextAndLinkify('<b>bold</b> see https://x.com');
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  const tR5 = norm(await text());
  console.log('  innerText = ' + JSON.stringify(tR5));
  check('R5: 用户输入的 "<b>bold</b>" 文本原样保留', /<b>bold<\/b>/.test(tR5) || /&lt;b&gt;bold/.test(h), 'text=' + JSON.stringify(tR5) + ' html=' + JSON.stringify(h));

  // ===================== R6 Shift+Enter 软换行 sanity =====================
  console.log('\n===== R6: Shift+Enter 软换行 =====');
  await setHtml('<div>abc</div>');
  await caretAt(0, 3);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Shift');
  await page.keyboard.type('def', { delay: 10 });
  await page.waitForTimeout(800);
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  console.log('  innerText = ' + JSON.stringify(await text()));
  check('R6: Shift+Enter 后两行 abc / def', norm(await text()).split('\n').map(s => s.trim()).join('|') === 'abc|def', JSON.stringify(await text()));

  // ===================== R7 空编辑器粘贴多行（回归 sanity） =====================
  console.log('\n===== R7: 空编辑器粘贴 "一二三\\n四五六"（回归） =====');
  await setHtml('');
  await page.evaluate(() => document.getElementById('editor').focus());
  await doPaste('一二三\n四五六');
  await page.waitForTimeout(800);
  h = await inner();
  console.log('  innerHTML = ' + JSON.stringify(h));
  check('R7: 两行且无空首行', /<div>一二三<\/div><div>四五六<\/div>/.test(h), h);

  // ===================== 总结 =====================
  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
