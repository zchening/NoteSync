// NoteSync v8.2.0 E2E（真实 Chromium）：彩蛋段行为验证。
// E1 皮肤三态环（真实连点 logo 7×3 全圈）· E2 节日雨浮层与自清 · E3 数字梗粒子（真实键盘输入）
// E4 深夜徽章随时间自动挂/收（跟随运行时刻，动态断言防脆）。
// 守护纪律：等动画/定时器一律真条件轮询（waitForFunction），禁定值 sleep 判绿。
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
async function tapLogoSeven(page) {
  for (let i = 0; i < 7; i++) await page.click('header .brand svg', { delay: 20 });
}

// ── E1 皮肤三态环：7×3 连点走完 默认→A→B→默认，标签文案逐一核对 ──
test('E1 连点 logo 7 次沿皮肤环前进，标签在 #versionToast 位闪现，整圈回默认', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V820SkinRing');
  try {
    await tapLogoSeven(page);
    await page.waitForFunction(() => document.body.classList.contains('skin-a'), null, { timeout: 4000 });
    const toast1 = page.locator('#versionToast');
    await toast1.waitFor({ state: 'visible', timeout: 4000 });
    assert.strictEqual(await toast1.textContent(), '复古 · 终端绿');
    assert.strictEqual(await page.locator('header .brand b').textContent(), 'NOTE-SYNC.EXE', 'A 态字标');
    assert.ok(await page.locator('#skinFx').count(), 'A 态有覆膜层');
    await page.waitForFunction(() => !document.getElementById('versionToast')?.classList.contains('show'), null, { timeout: 4000 }); // 标签自动收
    await tapLogoSeven(page);
    await page.waitForFunction(() => document.body.classList.contains('skin-b'), null, { timeout: 4000 });
    assert.strictEqual(await page.locator('#versionToast').textContent(), '复古 · 打字机纸');
    assert.strictEqual(await page.locator('header .brand b').textContent(), 'N O T E S Y N C', 'B 态字标');
    await tapLogoSeven(page);
    await page.waitForFunction(() => !document.body.classList.contains('skin-a') && !document.body.classList.contains('skin-b'), null, { timeout: 4000 });
    assert.ok(await page.waitForFunction(() => {
      const t = document.getElementById('versionToast');
      return !!t && t.textContent === '已恢复默认';
    }, null, { timeout: 4000 }).catch(() => false), '回默认应弹「已恢复默认」标签');
    assert.strictEqual(await page.locator('header .brand b').textContent(), 'NoteSync', '字标还原');
    await page.waitForFunction(() => !document.getElementById('skinFx'), null, { timeout: 4000 }); // 覆膜层移除
    // 皮肤不持久化：reload 后必回默认
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('editor'), null, { timeout: 10000 });
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('skin-a') || document.body.classList.contains('skin-b'))), '刷新后皮肤自动退出');
    assert.deepStrictEqual(page.__errors || [], [], '全程无页面 JS 报错');
  } finally { await ctx.close(); }
}));

// ── E2 节日雨：粒子浮层真实可见、6 秒档自清、不打断输入 ──
test('E2 nsRainStart 起雨后粒子渲染可见、到时自动清屏、编辑器仍可输入', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V820Rain');
  try {
    await page.evaluate(() => window.nsRainStart('cj', 2500));
    await page.waitForFunction(() => {
      const r = document.getElementById('nsRain');
      return r && !r.classList.contains('hidden') && r.querySelectorAll('i').length === 30;
    }, null, { timeout: 4000 });
    const first = page.locator('#nsRain i').first();
    const bb = await first.boundingBox();
    assert.ok(bb && bb.height > 8, '粒子必须有真实渲染尺寸（浮层不是空壳）');
    await page.waitForFunction(() => document.getElementById('nsGreet').classList.contains('show'), null, { timeout: 4000 });
    assert.match(await page.locator('#nsGreet').textContent(), /过年好/, '问候卡文案随节日');
    await page.click('#editor');
    await page.keyboard.type('雨中也') // 雨层 pointer-events:none，输入必须照常
    await page.waitForFunction(() => document.getElementById('nsRain').classList.contains('hidden'), null, { timeout: 6000 });
    assert.strictEqual(await page.evaluate(() => document.getElementById('nsRain').querySelectorAll('i').length), 0, '自清后无残留粒子');
    assert.ok((await page.locator('#editor').textContent()).includes('雨中也'), '打字内容不受雨影响');
  } finally { await ctx.close(); }
}));

// ── E3 数字梗粒子：真实敲 666 冒泡且正文一字不多；连打 6666 不再触发 ──
test('E3 真实打字 666 触发一次粒子爆发，正文只含所敲字符；6666 全程只触发一次', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V820Digits');
  try {
    await page.click('#editor');
    await page.keyboard.type('666');
    await page.waitForFunction(() => !!document.querySelector('.ns-burst i'), null, { timeout: 4000 });
    const burst = await page.evaluate(() => ({
      n: document.querySelectorAll('.ns-burst i').length,
      em: document.querySelector('.ns-burst i')?.textContent
    }));
    assert.strictEqual(burst.n, 5, '一簇 5 粒');
    assert.strictEqual(burst.em, '🔥', '666 配 🔥');
    assert.strictEqual((await page.locator('#editor').textContent()).trim(), '666', '粒子绝不往正文塞字');
    await page.keyboard.type('6'); // 第 4 个 6 → 前一位仍是数字 → 不得再起新簇（旧簇允许仍在自散动画中）
    await page.waitForFunction(() => !document.querySelector('.ns-burst i'), null, { timeout: 6000 }); // 等旧簇全散
    await page.keyboard.type('6'); // 6666|6 结尾仍是数字串 → 静默
    await page.waitForTimeout(250); // 仅给异步冒泡一点发酵窗口再反向断言（非定值等待判绿，判据是「不存在爆发节点」）
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.ns-burst').length), 0, '数字串连打不得重复触发');
    await page.keyboard.type(' 520');
    await page.waitForFunction(() => document.querySelector('.ns-burst i')?.textContent === '💕', null, { timeout: 4000 });
    // 闸 P1-2 回归：梗在尾持续存在时任意续打只爆过那一次——233 成梗爆发后同尾连敲三键不再爆
    await page.waitForFunction(() => !document.querySelector('.ns-burst i'), null, { timeout: 6000 });
    await page.keyboard.type('哈233');
    await page.waitForFunction(() => document.querySelector('.ns-burst i')?.textContent === '😂', null, { timeout: 4000 });
    await page.keyboard.type('！'); // 尾脱离梗形（解除上膛）
    await page.keyboard.type('233'); // 再入梗形 = 新一次爆发
    await page.waitForFunction(() => document.querySelectorAll('.ns-burst').length >= 2, null, { timeout: 4000 });
    const burstTotal = await page.evaluate(() => document.querySelectorAll('.ns-burst').length);
    assert.ok(burstTotal <= 2, '同尾持续态不得三连爆（实际 ' + burstTotal + '）');
  } finally { await ctx.close(); }
}));

// ── E4 深夜徽章：断言与运行时刻的钟点一致（22-06 必挂 🌙，其余时刻若无节日必无）──
test('E4 徽章自动评估：与页面加载时刻的深夜/节日判定逐一对齐', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V820Badge');
  try {
    const expect = await page.evaluate(() => {
      const b = window.nsBadgeAt(new Date());
      return b ? { em: b.em, tx: b.tx } : null;
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('nsBadge');
      const shown = el.classList.contains('show');
      return shown === !!window.nsBadgeAt(new Date());
    }, null, { timeout: 6000 });
    const dom = await page.evaluate(() => {
      const el = document.getElementById('nsBadge');
      return { shown: el.classList.contains('show'), em: el.querySelector('.ns-be').textContent };
    });
    assert.strictEqual(dom.shown, !!expect, '徽章挂收必须等于状态机判定');
    if (expect) assert.strictEqual(dom.em, expect.em, '徽章 emoji 与判定一致');
    if (expect) {
      const bb = await page.locator('#nsBadge').boundingBox();
      assert.ok(bb && bb.y < 60 && bb.height > 10, '徽章应渲染在顶栏内');
    }
    assert.deepStrictEqual(page.__errors || [], [], '徽章评估不得抛页面错误');
  } finally { await ctx.close(); }
}));
