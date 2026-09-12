// NoteSync v8.1.8 E2E（真实 Chromium）：③「加提醒后日期下两条下划线」根修验证。
// 场景：面板给某天加了提醒（正文出现 u.rem-mark 下划线）→ 模拟 contenteditable 打字延续把日期
// 再包进一层浏览器克隆的裸 <u>（用户看到的“自带下划线”，且新 rem-mark 会套进它成双层）→
// 触发一轮 linkify → 断言：裸 <u> 被拆掉（0 个 u:not(.rem-mark)）、无 u 嵌套（无 u u）、
// 日期只剩一条 rem-mark 下划线、文字不丢。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server');

process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }

let server, browser, baseURL;
before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  if (browser) { await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 6000))]).catch(() => {}); }
  try { if (server) server.close(); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

async function openDesktopEditor(noteName) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => (page.__errors = page.__errors || []).push(e.message));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', noteName);
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(noteName), { timeout: 10000 });
  await page.waitForSelector('#editor', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  return { ctx, page };
}

test('V818-3 打字延续克隆的裸 <u> 在 linkify 一轮后被拆净，日期只剩一条下划线', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V818DoubleU');
  try {
    const tomorrow = new Date(Date.now() + 86400e3);
    const ymd = tomorrow.getFullYear() + '-' + (tomorrow.getMonth() + 1) + '-' + tomorrow.getDate();
    // 直接注入「面板回写形态」的正文（绝对时间串 明日 9:30　买牛奶），并用真实提醒函数登记该时刻，
    // 再手动套一层裸 <u> 模拟打字延续克隆（rem-mark 会落到内层 → 双层下划线）。
    const at = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 30, 0, 0).getTime();
    await page.evaluate((a) => {
      const ed = document.getElementById('editor');
      // 裸 <u> 克隆：整行下划线无 rem-mark，且内含一张 <img>（旧有损 unwrapMark 会把它压成 textContent 丢图）
      ed.innerHTML = '<div><u>明天9:30　买牛奶<img src="data:image/gif;base64,R0lGODlhAQABAAAAACwC"></u></div>';
      window.eval('reminders = [{ at: ' + a + ", text: '买牛奶', fired: false, src: '明天9:30' }];");
    }, at);
    // 强制一轮 linkify 手术（真实浏览器可直接调用；deferred 也依赖它）
    await page.evaluate(() => { try { window.linkifyEditor(); } catch (e) {} });
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      return {
        strayU: ed.querySelectorAll('u:not(.rem-mark)').length,
        nested: ed.querySelectorAll('u u').length,
        remMarks: ed.querySelectorAll('u.rem-mark').length,
        imgs: ed.querySelectorAll('img').length,
        text: ed.textContent,
      };
    });
    assert.strictEqual(st.strayU, 0, '重建后不得残留裸 <u>（打字延续克隆应被拆净）: ' + JSON.stringify(st));
    assert.strictEqual(st.nested, 0, '不得出现 <u> 嵌套（双层下划线根因）: ' + JSON.stringify(st));
    assert.strictEqual(st.remMarks, 1, '应恰好重建出一条 u.rem-mark 下划线（防把标记一并拆光仍假绿）: ' + JSON.stringify(st));
    assert.strictEqual(st.imgs, 1, '裸 u 内 <img> 必须被【保节点】拆包存活（评审 R3：有损 unwrapMark 会丢图）: ' + JSON.stringify(st));
    assert.ok(st.text.includes('明天9:30') && st.text.includes('买牛奶'), '正文文本零丢失: ' + st.text);
    assert.deepStrictEqual(page.__errors || [], [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));
