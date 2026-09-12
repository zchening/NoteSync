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

// ── E5 v8.2.1：光标前判定——文中打字与「数字紧邻（3点666）」不再被吞（v8.2.0 两处误杀实锤回归）──
test('E5 文中光标处敲 666 与 「下午3点」尾敲 666 均触发一次爆发', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V821Caret');
  try {
    await page.click('#editor');
    await page.keyboard.type('明天下午3点接橙子');
    await page.waitForFunction(() => !document.querySelector('.ns-burst'), null, { timeout: 6000 });
    // 句尾紧贴数字「子」前非数字 → 基线；重点复现 v8.2.0 误杀场景：文本以数字收尾再敲 666
    await page.evaluate(() => { const ed = document.getElementById('editor'); ed.textContent = ''; ed.focus(); });
    await page.keyboard.type('开会15');
    await page.waitForFunction(() => !document.querySelector('.ns-burst'), null, { timeout: 6000 });
    await page.keyboard.type('666'); // 「15」后紧跟 666：v8.2.0 前位数字规则吞，v8.2.1 必爆
    await page.waitForFunction(() => document.querySelector('.ns-burst i')?.textContent === '🔥', null, { timeout: 4000 });
    assert.ok(true);
    // 文中打字：光标移回「开会15|666」的 15 与 6 之间敲一个 6 —— 光标前缀 '开会16'? 简化：
    // 重开一句，光标定位句中再敲 666，验证判定面是光标前而非全文尾
    await page.evaluate(() => {
      const ed = document.getElementById('editor'); ed.textContent = ''; ed.focus();
    });
    await page.keyboard.type('AB尾部');
    // 把光标挪到「AB」后（句中），敲 666——全文尾是「尾部」非数字，v8.2.0 不爆；光标前缀成串，v8.2.1 爆
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const tn = ed.firstChild;
      const r = document.createRange(); r.setStart(tn, 2); r.collapse(true);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.waitForFunction(() => !document.querySelector('.ns-burst'), null, { timeout: 6000 });
    await page.keyboard.type('666');
    await page.waitForFunction(() => document.querySelector('.ns-burst i')?.textContent === '🔥', null, { timeout: 4000 });
    const txt = await page.evaluate(() => document.getElementById('editor').textContent);
    assert.ok(txt.includes('AB666尾部'), '文中插入生效且正文零污染: ' + txt);
  } finally { await ctx.close(); }
}));

// ── E6 v8.2.2：移动端（390px）深夜=header 只挂 emoji 小胶囊 + 解锁出 5 秒全文气泡，顶栏零溢出 ──
test('E6 移动端 emoji-only 徽章 + 深夜 5 秒问候气泡，header 不溢出', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    // 固定深夜钟点（23:30），深夜态与真实运行时刻解耦；2026-09-12 非节日 → 走「无雨→气泡」分支
    const RealDate = Date;
    Date = class extends RealDate {
      constructor(...a) { if (a.length === 0) { super(2026, 8, 12, 23, 30, 0); } else { super(...a); } }
      static now() { return new RealDate(2026, 8, 12, 23, 30, 0).getTime(); }
    };
  });
  try {
    const page = await ctx.newPage();
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landingInput');
    await page.fill('#landingInput', 'V822Mobile');
    await page.click('#landingBtn');
    await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent('V822Mobile'), { timeout: 10000 });
    await page.fill('#pw', 'test-pass-123');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
    // ⓪ 气泡门是视口谓词（非设备判据）：390px 必命中 max-width:560 —— 先断言，避免慢机 5 秒 TTL 被后续步骤吃空
    assert.strictEqual(await page.evaluate(() => window.nsNarrowViewport()), true, '窄窗门必须命中（视口谓词，与 CSS 同源）');
    // ① 解锁瞬间的 5 秒深夜气泡：出现→含全文→按时自收（置前，防漂移）
    await page.waitForFunction(() => {
      const g = document.getElementById('nsGreet');
      return g && g.classList.contains('show') && g.textContent.includes('夜深了');
    }, null, { timeout: 5000 });
    // ② header：emoji 胶囊挂上，文案在 DOM 但被 CSS 收起（只显领头 emoji）
    await page.waitForFunction(() => {
      const el = document.getElementById('nsBadge');
      return el && el.classList.contains('show') && el.querySelector('.ns-be').textContent === '🌙';
    }, null, { timeout: 6000 });
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#nsBadge .ns-bt')).display), 'none',
      '移动端文案必须 CSS 收起（emoji-only 终拍）');
    assert.strictEqual(await page.evaluate(() => document.querySelector('#nsBadge .ns-bt').textContent), '夜深了，写完这条就睡',
      '文案仍在 DOM（供桌面/读屏复用），只藏显示');
    const beBox = await page.locator('#nsBadge .ns-be').boundingBox();
    assert.ok(beBox && beBox.width > 8, 'emoji 必须真实渲染');
    await page.waitForFunction(() => !document.getElementById('nsGreet').classList.contains('show'), null, { timeout: 9000 });
    // ③ 顶栏零横向溢出（emoji-only 小胶囊入链不挤压顶栏图标）
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, '390px 下 header 不得横向溢出（超出 ' + overflow + 'px）');
    assert.deepStrictEqual(page.__errors || [], [], '无页面 JS 报错');
  } finally { await ctx.close(); }
}));
