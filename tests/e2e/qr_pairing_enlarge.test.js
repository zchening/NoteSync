// NoteSync E2E（真实浏览器）：配对二维码「点按全屏放大 / 点收回」交互（v7.5.1）
// 解锁 → 点二维码开配对弹窗（码出现）→ 点码 → 放大层出现（纯白盖满视口、仅一个 canvas、无文字、压在弹窗上）
// → 点放大层 → 收回且配对弹窗仍开着 → 关闭按钮正常收窗。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }
process.on('unhandledRejection', (r) => { const m = String((r && r.message) || r); if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(m)) return; console.error('Unhandled:', m); process.exitCode = 1; });

let server, browser, baseURL;
const PASS = 'qrpairpw';
before(async () => { ({ server, baseURL, browser } = await setup()); });
after(async () => { await teardown(browser, server); process.exit(failures > 0 ? 1 : 0); });

test('配对码：点按全屏放大、点收回、弹窗不关、放大层无文字', guard(async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  try {
    await page.goto(baseURL + 'QRENL');
    await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
    await page.evaluate(p => window.unlock(String(p)), PASS);
    await page.waitForFunction(() => { const ed = document.getElementById('editor'), m = document.getElementById('mask'); return ed && ed.getAttribute('contentEditable') === 'true' && m && m.classList.contains('hidden'); }, { timeout: 15000 });

    // 开配对弹窗
    await page.click('#qrBtn');
    await page.waitForFunction(() => !document.getElementById('qrMask').classList.contains('hidden'), { timeout: 5000 });
    await page.waitForFunction(() => !!document.querySelector('#qrHolder #qrCanvas'), { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => { const e = document.getElementById('qrLarge'); return !!(e && e.classList.contains('show')); }), false, '初始放大层应隐藏');

    // 点码 → 放大
    await page.click('#qrHolder #qrCanvas');
    await page.waitForFunction(() => { const e = document.getElementById('qrLarge'); return e && e.classList.contains('show') && e.querySelector('canvas'); }, { timeout: 5000 });
    const big = await page.evaluate(() => {
      const e = document.getElementById('qrLarge');
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      const cv = e.querySelector('canvas');
      const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        w: Math.round(r.width), h: Math.round(r.height), disp: cs.display, bg: cs.backgroundColor, z: cs.zIndex,
        vw: window.innerWidth, vh: window.innerHeight,
        childCount: e.childElementCount, childTag: cv ? cv.tagName : null, text: (e.textContent || '').trim(),
        coversDialog: !!(center && (center.closest && (center.closest('#qrLarge') || center === e))),
      };
    });
    assert.strictEqual(big.disp, 'flex', '放大层应显示（display flex）');
    assert.strictEqual(big.bg, 'rgb(255, 255, 255)', '放大层背景应为纯白（最大化出光利于反光下扫码）');
    assert.ok(big.w >= big.vw - 2 && big.h >= big.vh - 2, '放大层应盖满视口 ' + JSON.stringify({ w: big.w, h: big.h, vw: big.vw, vh: big.vh }));
    assert.strictEqual(big.childCount, 1, '放大层应只含一个 canvas（无任何文字/按钮提示）');
    assert.strictEqual(big.childTag, 'CANVAS', '唯一子元素应是 canvas');
    assert.strictEqual(big.text, '', '放大层不得含任何文字');
    assert.strictEqual(big.coversDialog, true, '放大层应压在配对弹窗之上（居中命中属放大层）');

    // 点放大层 → 收回，且弹窗仍在
    await page.click('#qrLarge');
    await page.waitForFunction(() => { const e = document.getElementById('qrLarge'); return !e || !e.classList.contains('show'); }, { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => !document.getElementById('qrMask').classList.contains('hidden')), true, '收回放大后配对弹窗仍应开着');
    assert.ok(await page.evaluate(() => !!document.querySelector('#qrHolder #qrCanvas')), '收回后弹窗码仍在');

    // 关闭 → 收窗，放大层不在
    await page.click('#qrClose');
    await page.waitForFunction(() => document.getElementById('qrMask').classList.contains('hidden'), { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => { const e = document.getElementById('qrLarge'); return !!(e && e.classList.contains('show')); }), false, '关闭后放大层不应残留显示');

    assert.deepStrictEqual(errs, [], '全程不应有页面 JS 错误');
  } finally { try { await ctx.close(); } catch (e) {} }
}));
