// NoteSync v10.0.3 E2E（真实 Chromium）：折叠组语义改造 + 导出图折叠层级。
// 为什么必须真浏览器：①Blink insertParagraph 会把把手块的 ns-fold* 类克隆给新块（jsdom 不克隆）；
// ②隐形锚/0 高行/缩进与左引导线只有真渲染才量得到（jsdom 恒 0）；③回车落点走的是真 contenteditable 选区。
// 守护纪律：等异步一律 waitForFunction 真条件，不定值 sleep 承重。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server');

let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }
let server, browser, baseURL;
before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  if (browser) await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 6000))]).catch(() => {});
  try { if (server) server.close(); } catch (e) {}
  process.exit(failures > 0 ? 1 : 0);
});

async function openNote(noteName, html) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.__errors = errors; page.__ctx = ctx;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', noteName);
  await page.click('#landingBtn');
  await page.waitForFunction(n => location.pathname.endsWith(n), encodeURIComponent(noteName), { timeout: 10000 });
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  await page.evaluate(h => {
    const ed = document.getElementById('editor');
    ed.innerHTML = h;
    try { localStorage.setItem('notesync_fold_open', '{}'); } catch (e) {}
    window.applyFolds();
    ed.dispatchEvent(new Event('input'));
  }, html);
  await page.waitForTimeout(200);
  return page;
}
// 把光标落到"含 key 的那一块"可见文字的第 n 个字符后（n='end' 即末尾）
async function caretIn(page, key, n) {
  const ok = await page.evaluate(([k, nn]) => {
    const ed = document.getElementById('editor');
    const blk = Array.prototype.find.call(ed.children, b => (b.textContent || '').indexOf(k) >= 0);
    if (!blk) return 'NO_BLOCK';
    const tn = (function (b) { const ns = b.childNodes; for (let i = 0; i < ns.length; i++) if (ns[i].nodeType === 3 && ns[i].nodeValue) return ns[i]; return null; })(blk);
    if (!tn) return 'NO_TEXT';
    const off = nn === 'end' ? tn.nodeValue.length : Math.max(1, Math.floor(tn.nodeValue.length / 2));
    const r = document.createRange(); r.setStart(tn, off); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
    return 'ok';
  }, [key, n]);
  assert.strictEqual(ok, 'ok', '光标落点成功：' + key);
}
const dump = page => page.evaluate(() => Array.prototype.map.call(document.getElementById('editor').children, b => ({
  t: b.textContent.replace(/[\u200B\u200C\uFEFF\u2060]/g, ''),
  vis: getComputedStyle(b).display !== 'none' && parseFloat(getComputedStyle(b).height) > 0,
  body: b.classList.contains('ns-fold-body'), gap: b.classList.contains('ns-fold-gap'),
  handle: b.classList.contains('ns-fold'), open: b.classList.contains('ns-fold-open'),
  endline: b.classList.contains('ns-fold-endline'), tail: !!(b.querySelector && b.querySelector('span.ns-fold-endmark'))
})));
const flat = rs => rs.map(r => (r.vis ? 'V' : 'H') + (r.handle ? (r.open ? '[把▼]' : '[把▶]') : r.body ? '[正文]' : r.gap ? '[空隙]' : '[外]') + (r.t || '␣')).join(' ');

const BASE = '<div>抬头一行</div><div>[折叠]阳台备货清单</div><div>花肥、喷壶</div><div>吊兰换盆</div><div><br></div><div>结尾一行</div>';
const TITLED = '<div>[折叠]我是标题后面还有字</div><div>正文一</div><div>正文二</div>';
const NOTRAIL = '<div>[折叠]体检要问的</div><div>甲状腺随访周期</div>';

test('V1003-E1 收起·标题末尾回车+打字 → 新行在组外、原正文仍折起、自动补锚', guard(async () => {
  const page = await openNote('v1003e1', BASE);
  await caretIn(page, '阳台备货清单', 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.type('我是新行');
  await page.waitForFunction(() => Array.prototype.some.call(document.getElementById('editor').children,
    b => b.textContent.indexOf('我是新行') >= 0 && getComputedStyle(b).display !== 'none'), null, { timeout: 8000 });
  await page.waitForTimeout(1800); // 让 linkify 防抖 + applyFolds 落定
  const rs = await dump(page);
  const typed = rs.find(r => r.t.indexOf('我是新行') >= 0);
  assert.ok(typed && typed.vis && !typed.body && !typed.gap, '新行必须可见且在组外：' + flat(rs));
  assert.ok(rs.some(r => !r.vis && r.body && r.t.indexOf('花肥') >= 0), '原折叠正文仍被折起：' + flat(rs));
  assert.ok(rs.some(r => r.t.indexOf('[/折叠]') >= 0), '自动补了 [/折叠] 闭合锚：' + flat(rs));
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1003-E2 收起·标题中间回车 → 前半句留把手、后半句挪到组外、组内一字不动', guard(async () => {
  const page = await openNote('v1003e2', TITLED);
  await caretIn(page, '我是标题后面还有字', 'mid');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Array.prototype.some.call(document.getElementById('editor').children,
    b => b.className.indexOf('ns-fold') >= 0 && b.textContent.indexOf('[折叠]') === 0 && b.textContent.length > 4), null, { timeout: 8000 });
  await page.waitForTimeout(1800);
  const rs = await dump(page);
  const h = rs.find(r => r.handle);
  assert.ok(h.t.indexOf('[折叠]我是标题') === 0 && h.t.length < '[折叠]我是标题后面还有字'.length, '把手只剩前半句：' + flat(rs));
  const moved = rs.filter(r => !r.handle && !r.body && !r.gap && r.vis && r.t.indexOf('折叠') < 0);
  assert.ok(moved.some(r => /面还有字|后面还有字|还有字/.test(r.t)), '后半句以组外可见行存在：' + flat(rs));
  assert.ok(rs.some(r => r.body && !r.vis && r.t.indexOf('正文一') === 0), '组内正文一未被搬动（仍折起、原文）：' + flat(rs));
  assert.ok(rs.some(r => r.body && !r.vis && r.t.indexOf('正文二') === 0), '组内正文二未被搬动：' + flat(rs));
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1003-E3 展开态·正文首行行首回车留空块 → 组不被截断（旧版此处正文整段掉出组）', guard(async () => {
  const page = await openNote('v1003e3', BASE);
  await page.evaluate(() => { const m = document.querySelector('#editor .ns-fold-mark'); if (m) m.click(); }); // 展开
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 });
  await caretIn(page, '花肥', 'start');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const blk = Array.prototype.find.call(ed.children, b => b.textContent.indexOf('花肥') >= 0);
    const r = document.createRange(); r.setStart(blk.firstChild, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  });
  await page.keyboard.press('Enter');            // 在标题与正文之间留下一个空块
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const m = document.querySelector('#editor .ns-fold-open .ns-fold-mark'); if (m) m.click(); }); // 收起
  await page.waitForTimeout(1800);
  const rs = await dump(page);
  assert.ok(rs.some(r => r.body && !r.vis && r.t.indexOf('花肥') >= 0), '花肥仍在组内（没掉出去）：' + flat(rs));
  assert.ok(rs.some(r => r.body && !r.vis && r.t.indexOf('吊兰') >= 0), '吊兰仍在组内：' + flat(rs));
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1003-E4 光标落到隐形锚之后打字 → 弹回锚前，锚不失效、组不散架', guard(async () => {
  const page = await openNote('v1003e4', NOTRAIL);
  await caretIn(page, '体检要问的', 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.type('新行不背锅');
  await page.waitForTimeout(1800);
  const before = await dump(page);
  assert.ok(before.some(r => r.t.indexOf('新行不背锅') >= 0 && r.vis && !r.body), '前置：新行在组外：' + flat(before));
  // 把光标硬塞到挂尾锚 span 之后，再打字
  const moved = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const sp = ed.querySelector('span.ns-fold-endmark');
    if (!sp) return 'NO_ANCHOR';
    const r = document.createRange(); r.setStartAfter(sp); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return 'placed';
  });
  assert.strictEqual(moved, 'placed', '锚 span 存在可落光标');
  await page.evaluate(() => { document.getElementById('editor').focus(); });
  await page.keyboard.type('乙');
  await page.waitForTimeout(1800);
  const rs = await dump(page);
  assert.ok(rs.some(r => r.body && !r.vis && r.t.indexOf('甲状腺') >= 0), '原正文仍被折起（组没散）：' + flat(rs));
  assert.ok(rs.some(r => r.t.indexOf('[/折叠]') >= 0), '锚文本仍在（没被顶成行中间碎片）：' + flat(rs));
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1003-E5 删 [折叠] 把手 → 本组锚联动清除、正文一字不丢', guard(async () => {
  const page = await openNote('v1003e5', BASE);
  await caretIn(page, '阳台备货清单', 'end');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  const withAnchor = await page.evaluate(() => document.getElementById('editor').textContent.indexOf('[/折叠]') >= 0);
  assert.ok(withAnchor, '前置：已有闭合锚');
  const textBefore = await page.evaluate(() => document.getElementById('editor').textContent.replace(/[\u200B]/g, '').replace(/\[\/?折叠\]/g, ''));
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const mk = ed.querySelector('.ns-fold-mark');
    const r = document.createRange(); r.setStartAfter(mk); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => ({
    anchor: document.getElementById('editor').textContent.indexOf('[/折叠]') >= 0,
    handle: !!document.querySelector('#editor .ns-fold'),
    text: document.getElementById('editor').textContent.replace(/[\u200B]/g, '').replace(/\[\/?折叠\]/g, '')
  }));
  assert.strictEqual(after.handle, false, '把手已不再是折叠');
  assert.strictEqual(after.anchor, false, '锚被联动清除（不留无主 [/折叠]）');
  assert.strictEqual(after.text, textBefore, '删把手一个字正文都不丢');
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1003-E6 导出图：折叠正文有缩进与左竖线、锚不露字、编辑器零渗透', guard(async () => {
  const page = await openNote('v1003e6', '<div>[折叠]标题甲</div><div>正文一</div><div><br></div><div>正文二[/折叠]</div><div>组外行</div>');
  const got = await page.evaluate(async () => {
    const p = window.renderNotePng();
    let out = null;
    for (let i = 0; i < 500 && !out; i++) {
      const body = document.querySelector('.ns-export .ns-fold-body');
      if (body) {
        const cs = getComputedStyle(body);
        const gap = document.querySelector('.ns-export .ns-fold-gap');
        const gcs = gap ? getComputedStyle(gap) : null;
        const end = document.querySelector('.ns-export [data-ns-export-end]');
        out = {
          ml: parseFloat(cs.marginLeft), pl: parseFloat(cs.paddingLeft),
          blw: parseFloat(cs.borderLeftWidth), bls: cs.borderLeftStyle,
          gapMl: gcs ? parseFloat(gcs.marginLeft) : -1,
          endFs: end ? parseFloat(getComputedStyle(end).fontSize) : -1,
          leaked: !!document.querySelector('#editor [data-ns-export], #editor [data-ns-export-end]')
        };
      }
      await new Promise(r => setTimeout(r, 5));
    }
    await Promise.resolve(p).catch(() => {});
    for (let i = 0; i < 200 && document.querySelectorAll('.ns-export').length; i++) await new Promise(r => setTimeout(r, 20));
    return out || 'NO_WRAP';
  });
  assert.notStrictEqual(got, 'NO_WRAP', '导出副本已挂进 DOM');
  assert.ok(got.ml > 0 && got.pl > 0, '导出正文有缩进（margin+padding）：' + JSON.stringify(got));
  assert.ok(got.blw >= 2 && got.bls === 'solid', '导出正文有左竖引导线：' + JSON.stringify(got));
  assert.ok(got.gapMl > 0, '组内空隙同样走引导线：' + JSON.stringify(got));
  assert.strictEqual(got.endFs, 0, '导出图里 [/折叠] 锚 font-size:0 不露字：' + JSON.stringify(got));
  assert.strictEqual(got.leaked, false, '属性门控零渗透（编辑器 DOM 无 data-ns-export*）');
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));
