// NoteSync v5.45 独立回归验证（Playwright + 真实 Chromium）
//
// 逐字针对用户本轮需求：
//   ① 面板添加提醒成功 → 正文光标处回写「时间 · 事项」，可 Ctrl+Z 撤销
//   ② 已设提醒的时间+事项整段带下划线（u.rem-mark，linkify 管理）；未添加的日期无标记
//   ③ 正文时间文本上的 chip 更明显（14px + 蓝色 CTA「添加提醒」）
//   ④ 已过期/已提醒过的文本变灰（u.rem-mark.rem-past）；删除提醒后标记消失
//   ⑤ 过期时间光标移上 → chip 完全不出现（零打扰）
//   ⑥ chip 点添加 → 两行确认卡（✅ 提醒已添加 / 时间 · 事项）
//   ⑦ 面板打开时分钟框默认聚焦且值全选（真选中「16」）
// 不修改任何业务代码。
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
function guard(fn) {
  return async (t) => {
    try { await fn(t); }
    catch (e) { failures++; throw e; }
  };
}

let server, browser, baseURL;

before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
});

after(async () => {
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 6000)),
    ]).catch(() => {});
  }
  try { if (server) server.close(); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

// 桌面环境：落地页 → 笔记名 → 口令解锁 → 编辑器就绪
async function openDesktopEditor(noteName) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', noteName || 'V545Verify');
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(noteName || 'V545Verify'), { timeout: 10000 });
  await page.waitForSelector('#editor', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  return { ctx, page };
}

// 面板添加一条「明天 09:30 · 买牛奶」
async function addViaPanel(page) {
  const tomorrow = new Date(Date.now() + 86400e3);
  const ymd = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
  await page.click('#remBtn');
  await page.waitForSelector('#remPanel', { timeout: 5000 });
  await page.fill('#remBoxForm input[type="date"]', ymd);
  await page.fill('#remBoxForm input.rem-hh', '9');
  await page.fill('#remBoxForm input.rem-mm', '30');
  await page.fill('#remBoxForm input.rem-item', '买牛奶');
  await page.evaluate(() => {
    [...document.querySelectorAll('#remBoxForm button')].find(b => b.textContent === '添加提醒').click();
  });
  await page.waitForTimeout(900); // 500ms linkify 防抖 + 余量
  return { ymd };
}

// ── ①+② 面板添加 → 正文回写 + 下划线；Ctrl+Z 撤销整行 ──────────────────
test('V545-1 面板添加后正文回写「时间 · 买牛奶」并带 rem-mark 下划线，Ctrl+Z 可整行撤销', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545A');
  try {
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>今天要买</div>';
    });
    await page.click('#editor');
    await page.keyboard.press('Control+End'); // 光标放正文里
    const { ymd } = await addViaPanel(page);
    const expectLine = ymd.replace(/^(\d+)-(\d+)-(\d+)$/, (s, y, m, d) => (+y) + '-' + (+m) + '-' + (+d)) + ' 9:30 · 买牛奶';
    const st = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const u = ed.querySelector('u.rem-mark');
      return {
        text: ed.textContent,
        hasU: !!u,
        uText: u ? u.textContent : '',
        underline: u ? getComputedStyle(u).textDecorationLine : '',
      };
    });
    assert.ok(st.text.includes(expectLine), `正文必须回写「${expectLine}」，实际: ${st.text}`);
    assert.ok(st.hasU, '正文必须出现 u.rem-mark 标记');
    assert.ok(st.uText.includes('买牛奶') && st.uText.includes('9:30'), '下划线必须覆盖时间+事项整段: ' + st.uText);
    assert.strictEqual(st.underline, 'underline', '必须是下划线样式');

    await page.click('#editor');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(() => document.getElementById('editor').textContent);
    assert.ok(!afterUndo.includes('买牛奶'), 'Ctrl+Z 必须整行撤销回写的时间行，实际: ' + afterUndo);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ③⑥ chip 明显化：蓝色 CTA「添加提醒」+ 两行确认卡 ────────────────────
test('V545-2 光标落时间上 chip 含蓝色「添加提醒」，点后变两行确认卡', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545B');
  try {
    const S = await page.evaluate(() => {
      const d = new Date(Date.now() + 86400e3);
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>开会 ' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' 9:15 记得带材料</div>';
      const tn = ed.querySelector('div').firstChild;
      const idx = tn.nodeValue.indexOf(d.getFullYear() + '-');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
      return true;
    });
    assert.ok(S, '前置就绪');
    await page.waitForTimeout(450);
    const chip = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      const cta = c.querySelector('.chip-cta');
      return {
        visible: !c.classList.contains('hidden'),
        text: c.textContent,
        ctaColor: cta ? getComputedStyle(cta).color : '',
      };
    });
    assert.ok(chip.visible, '未来时间 chip 必须浮出');
    assert.ok(chip.text.includes('添加提醒'), 'chip 必须含「添加提醒」CTA: ' + chip.text);
    assert.ok(!chip.text.includes('设提醒'), '旧文案「设提醒」不得出现');
    assert.strictEqual(chip.ctaColor, 'rgb(37, 99, 235)', 'CTA 必须是蓝色 #2563EB');

    await page.click('#timeChip');
    await page.waitForTimeout(200);
    const fb = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      return {
        feedback: c.classList.contains('feedback'),
        l1: c.querySelector('.chip-ok1') ? c.querySelector('.chip-ok1').textContent : '',
        l2: c.querySelector('.chip-ok2') ? c.querySelector('.chip-ok2').textContent : '',
      };
    });
    assert.ok(fb.feedback, '点添加后必须变两行确认卡');
    assert.strictEqual(fb.l1, '✅ 提醒已添加', '第一行必须是「✅ 提醒已添加」');
    assert.ok(fb.l2.includes('9:15') && fb.l2.includes('记得带材料'), '第二行必须是「时间 · 事项」: ' + fb.l2);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ②④ 未添加的日期无标记；到点确认变灰；删除提醒标记消失 ────────────────
test('V545-3 未添加日期无下划线；确认后变灰 rem-past；删除提醒后标记消失', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545C');
  try {
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>随便写的 2026-12-25 10:00 没设提醒</div>';
    });
    const plain = await page.evaluate(() => !!document.getElementById('editor').querySelector('u.rem-mark'));
    assert.ok(!plain, '未设提醒的日期绝不能有下划线标记');

    const { ymd } = await addViaPanel(page); // 添加「明天 9:30 · 买牛奶」
    const at = await page.evaluate(() => reminders[0] ? reminders[0].at : 0);
    assert.ok(at, '前置：提醒已入库');
    await page.waitForTimeout(700);
    const marked = await page.evaluate(() => {
      const u = document.getElementById('editor').querySelector('u.rem-mark');
      return { has: !!u, past: u ? u.classList.contains('rem-past') : false };
    });
    assert.ok(marked.has, '已设提醒的时间行必须带下划线');
    assert.strictEqual(marked.past, false, '未来提醒不得是灰色');

    await page.evaluate((at0) => { window.markRemDone(at0); }, at); // 到点确认（模拟）
    await page.waitForTimeout(700);
    const grey = await page.evaluate(() => {
      const u = document.getElementById('editor').querySelector('u.rem-mark');
      return u ? u.classList.contains('rem-past') : false;
    });
    assert.ok(grey, '到点确认后正文必须变灰（rem-past）');

    await page.evaluate((at0) => window.removeReminder(at0), at);
    await page.waitForTimeout(700);
    const gone = await page.evaluate(() => !!document.getElementById('editor').querySelector('u.rem-mark'));
    assert.ok(!gone, '删除提醒后下划线必须消失');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑤ 过期时间：chip 零打扰 ────────────────────────────────────────────
test('V545-4 光标落过期时间上 chip 完全不出现（零打扰）', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545D');
  try {
    await page.evaluate(() => {
      const d = new Date(Date.now() - 86400e3);
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>昨天 ' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' 9:00 开过会</div>';
      const tn = ed.querySelector('div').firstChild;
      const idx = tn.nodeValue.indexOf(d.getFullYear() + '-');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    const st = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      return { hidden: c.classList.contains('hidden'), text: c.textContent };
    });
    assert.ok(st.hidden, '过期时间光标移上 chip 必须完全不出现');
    assert.ok(!st.text.includes('已过期'), '不得再有「已过期」文案');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));
