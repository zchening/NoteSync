// v7.8.0 移动端时间悬浮卡回归（用户实测报障：长文本看不见「添加提醒」）
//
// 复现输入：2026-09-15 18:00 明天体检，明早早点送橙子上学+空腹
// 症状（旧版）：#timeChip 是 white-space:nowrap + max-width:92vw 的单行胶囊，时间＋事项把
//   尾随的「添加提醒」整颗裁出可视区——用户以为没有添加入口（整卡其实可点）。
// 本版：三行小卡，宽度 min(86vw,340px)，省略号只落在事项行。本文件用真实 Chromium + 390px
//   窄视口锁死四件事：① CTA 完整在视口内；② CTA 完整在卡片内；③ 事项行恒单行（换行会把
//   按钮顶下去，等于换个方式溢出）；④ 点 CTA 真能加上提醒。
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

// 落地页 → 建笔记 → 解锁 → 编辑器就绪。mobile=true 时是触屏形态（CHIP_HOVER_OK=false，走 caret 路）
async function openEditorCtx(noteName, vw, vh, mobile) {
  const mob = mobile !== false;
  const ctx = await browser.newContext(Object.assign(
    { viewport: { width: vw || 390, height: vh || 844 } },
    mob ? { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } : {}
  ));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
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

// 写入用户实测那一行并把光标放到时间串中间（等 selectionchange 250ms 防抖弹卡）
async function caretOnTime(page, daysAhead, hh, mm, tail) {
  return page.evaluate(([off, h, m, tailTxt]) => {
    const d = new Date();
    d.setDate(d.getDate() + off);
    d.setHours(h, m, 0, 0);
    const p = n => String(n).padStart(2, '0');
    const S = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(h) + ':' + p(m);
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>' + S + ' ' + tailTxt + '</div>';
    const tn = ed.querySelector('div').firstChild;
    const idx = tn.nodeValue.indexOf(S);
    const r = document.createRange();
    r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    document.dispatchEvent(new window.Event('selectionchange'));
    return S;
  }, [daysAhead, hh, mm, tail]);
}

// 等真实条件而非定值 sleep：250ms 防抖 + 解锁解密在整套并发跑时会被饿死（v7.8.0 实测漂移）
async function waitChipShown(page) {
  await page.waitForFunction(() => !document.getElementById('timeChip').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForTimeout(150); // 入场动画落定后再取几何
}

const geom = page => page.evaluate(() => {
  const c = document.getElementById('timeChip');
  const cta = c.querySelector('.chip-cta');
  const what = c.querySelector('.chip-what');
  const box = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  return {
    hidden: c.classList.contains('hidden'),
    card: box(c),
    cta: cta ? box(cta) : null,
    ctaText: cta ? cta.textContent : '',
    what: what ? box(what) : null,
    whatLineH: what ? parseFloat(getComputedStyle(what).lineHeight) : 0,
    whatFont: what ? parseFloat(getComputedStyle(what).fontSize) : 0,
    overflow: what ? what.scrollWidth > what.clientWidth + 1 : false,
    vw: window.innerWidth,
  };
});

// ── M1：390px 窄屏 + 用户原始长文本 → CTA 完整可见可点 ───────────────
test('M1 390px 窄屏长事项：「添加提醒」完整落在视口与卡片内，事项行恒单行', guard(async () => {
  const { ctx, page } = await openEditorCtx('ChipFit390', 390, 844);
  try {
    await caretOnTime(page, 2, 18, 0, '明天体检，明早早点送橙子上学+空腹');
    await waitChipShown(page);
    const g = await geom(page);
    assert.ok(!g.hidden, '前置：光标落时间上必须浮出卡片');
    assert.strictEqual(g.ctaText, '添加提醒', 'CTA 文案不变');
    assert.ok(g.cta.w > 200, '主按钮必须横跨卡片（实测宽 ' + g.cta.w + 'px）');
    assert.ok(g.cta.h >= 42, '主按钮触控高度 ≥42px（实测 ' + g.cta.h + 'px）');
    assert.ok(g.cta.x >= 0 && g.cta.right <= g.vw, 'CTA 必须完整落在视口内（旧版在此整颗被裁出屏幕）');
    assert.ok(g.cta.x >= g.card.x - 0.5 && g.cta.right <= g.card.right + 0.5,
      'CTA 必须在卡片框内: cta=[' + g.cta.x + ',' + g.cta.right + '] card=[' + g.card.x + ',' + g.card.right + ']');
    assert.ok(g.cta.bottom <= g.card.bottom + 0.5, 'CTA 不得顶出卡片下沿');
    assert.ok(g.what.h <= g.whatLineH + 1, '事项行必须恒单行（换行会把按钮顶出卡片）: ' + g.what.h + ' vs ' + g.whatLineH);
    assert.ok(g.what.right <= g.card.right + 0.5 && g.what.x >= g.card.x - 0.5, '事项行不得溢出卡片（自身省略号兜底）');
    assert.ok(g.card.w <= g.vw - 20, '卡片两侧必须留白（实测卡宽 ' + g.card.w + ' / 视口 ' + g.vw + '）');

    await page.click('#timeChip .chip-cta');
    await page.waitForFunction(() => document.getElementById('timeChip').classList.contains('feedback'), null, { timeout: 10000 });
    const st = await page.evaluate(() => ({
      fb: document.getElementById('timeChip').classList.contains('feedback'),
      ok: !!document.querySelector('#timeChip .chip-ok1'),
      n: reminders.length,
    }));
    assert.ok(st.fb && st.ok, '点 CTA 必须原地变「✅ 提醒已添加」确认卡');
    assert.strictEqual(st.n, 1, '点 CTA 必须真的加上提醒（旧版看不见入口，功能其实可点）');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── M2：320px 更窄老机型（iPhone SE1/小米旧机）同样不吞按钮 ─────────
test('M2 320px 极窄屏：CTA 仍完整可见可点', guard(async () => {
  const { ctx, page } = await openEditorCtx('ChipFit320', 320, 720);
  try {
    await caretOnTime(page, 6, 7, 30, '明天体检，明早早点送橙子上学+空腹记得带医保卡');
    await waitChipShown(page);
    const g = await geom(page);
    assert.ok(!g.hidden, '前置：卡片浮出');
    assert.ok(g.cta.x >= 0 && g.cta.right <= g.vw, 'CTA 必须完整落在 320px 视口内');
    assert.ok(g.cta.h >= 42, '主按钮触控高度 ≥42px');
    assert.ok(g.what.h <= g.whatLineH + 1, '事项行恒单行');
    assert.ok(g.overflow, '前置：320px 下 20 字事项确实溢出并被省略号截断（截断代价归事项行）');
    assert.ok(g.what.right <= g.card.right + 0.5, '被截断的事项行仍不得顶破卡片右沿');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── M3：无事项（只写时间）不渲染空行；桌面宽屏同一套排版且卡片限宽 340 ──
test('M3 纯时间无事项不渲染事项行；900px 桌面卡片限宽 340px', guard(async () => {
  const { ctx, page } = await openEditorCtx('ChipFitDesk', 900, 760, false);
  try {
    await caretOnTime(page, 1, 9, 15, '');
    await waitChipShown(page);
    const g = await geom(page);
    assert.ok(!g.hidden, '前置：纯时间也必须浮卡');
    assert.strictEqual(g.what, null, '无事项时不得渲染空事项行');
    assert.ok(Math.abs(g.card.w - 340) < 1, '桌面卡片必须限宽 340px（实测 ' + g.card.w + '）');
    assert.ok(g.cta.x >= 0 && g.cta.right <= g.vw, '桌面 CTA 同样完整可见');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));
