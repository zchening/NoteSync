// NoteSync v5.29 独立回归验证（Playwright + 真实 Chromium）
//
// 针对"主题/深色模式对抗"改动的针对性验证，独立于既有测试套件。
// 覆盖 team-lead 要求的逐条断言：
//   ① 系统深色/浅色下，手动切日间 body 仍为浅色 #FBFBF8，切夜间为 #0F0F11
//   ② 刷新后主题回到时间规则（不持久化）
//   ③ #theme-override 始终是 <html> 最后一个元素子节点，全文档仅 1 个
//   ④ ?themedi 诊断浮层开启时渲染且不影响交互；关闭时 DOM 不存在 #themeDiag
//   ⑤ 落地页/解锁弹窗/顶栏/页脚/删除线配色两套色板均符合预期
//   ⑥ 主流程：落地页→口令解锁→打字→删除线→Ctrl+Z→复制→导出 不受 override/MO 影响
//   ⑦ MutationObserver 连续注入后仍唯一且置末，无死循环
// 不修改任何业务代码。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server');

// 仅吞掉拆解阶段偶发的浏览器/rejection 噪声，不掩盖真实业务错误
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

// 开一个带指定 colorScheme 的页面（模拟系统浅色/深色）
async function openPage(colorScheme, query = '') {
  const ctx = await browser.newContext({ colorScheme, viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await page.goto(baseURL + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 15000 });
  return { ctx, page };
}

const LIGHT_BG = 'rgb(251, 251, 248)';
const DARK_BG = 'rgb(15, 15, 17)';
const LIGHT_MUTED = 'rgb(152, 149, 138)';
const DARK_MUTED = 'rgb(122, 120, 111)';
const LIGHT_BOX = 'rgb(255, 255, 255)';
const DARK_BOX = 'rgb(23, 23, 26)';

// ── ① 系统配色下手动切日间/夜间，body 背景正确 ───────────────────────
test('V529-1 系统深色与浅色下：切日间 body=浅色, 切夜间 body=深色', guard(async () => {
  for (const cs of ['dark', 'light']) {
    const { ctx, page } = await openPage(cs);
    try {
      await page.evaluate(() => window.applyTheme(false));
      await page.waitForFunction(
        (c) => getComputedStyle(document.body).backgroundColor === c,
        LIGHT_BG, { timeout: 5000 });
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        LIGHT_BG, `系统${cs}下切日间 body 背景应为 ${LIGHT_BG}`);

      await page.evaluate(() => window.applyTheme(true));
      await page.waitForFunction(
        (c) => getComputedStyle(document.body).backgroundColor === c,
        DARK_BG, { timeout: 5000 });
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        DARK_BG, `系统${cs}下切夜间 body 背景应为 ${DARK_BG}`);

      assert.deepStrictEqual(page.__errors, [], `系统${cs}下不应有页面 JS 错误`);
    } finally { await ctx.close(); }
  }
}));

// ── ② 刷新回到时间规则（不持久化）────────────────────────────────────
test('V529-2 刷新后主题回到时间规则，手动态不持久化；且 override 仍唯一置末', guard(async () => {
  const { ctx, page } = await openPage('dark');
  try {
    const expectDark = await page.evaluate(() => window.shouldBeDark());
    // 手动切到与时间规则相反
    await page.evaluate((d) => window.applyTheme(!d), expectDark);
    const cur = await page.evaluate(() => document.body.classList.contains('dark'));
    assert.strictEqual(cur, !expectDark, '手动切换应生效');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 15000 });
    const after = await page.evaluate(() => document.body.classList.contains('dark'));
    assert.strictEqual(after, expectDark, '刷新后应回到时间规则，手动态不应持久化');

    const ov = await page.evaluate(() => {
      const o = document.getElementById('theme-override');
      return {
        count: document.querySelectorAll('#theme-override').length,
        isLast: o && document.documentElement.lastElementChild === o,
        next: o ? o.nextSibling : 'missing',
      };
    });
    assert.strictEqual(ov.count, 1, '刷新后 override 应唯一');
    assert.strictEqual(ov.isLast, true, '刷新后 override 应在 <html> 末尾');
    assert.strictEqual(ov.next, null, '刷新后 override 无后继兄弟');
  } finally { await ctx.close(); }
}));

// ── ③ #theme-override 始终唯一且置末 ────────────────────────────────
test('V529-3 #theme-override 始终是 <html> 最后子节点且全文档仅 1 个（两种系统配色）', guard(async () => {
  for (const cs of ['dark', 'light']) {
    const { ctx, page } = await openPage(cs);
    try {
      await page.evaluate(() => { window.applyTheme(false); window.applyTheme(true); window.applyTheme(false); });
      const info = await page.evaluate(() => {
        const ov = document.getElementById('theme-override');
        return {
          count: document.querySelectorAll('#theme-override').length,
          isLast: ov && document.documentElement.lastElementChild === ov,
          parent: ov ? ov.parentNode === document.documentElement : false,
          next: ov ? ov.nextSibling : 'missing',
        };
      });
      assert.strictEqual(info.count, 1, `系统${cs}下 override 应唯一`);
      assert.strictEqual(info.isLast, true, `系统${cs}下 override 应在末尾`);
      assert.strictEqual(info.parent, true, `系统${cs}下 override 应挂在 documentElement`);
      assert.strictEqual(info.next, null, `系统${cs}下 override 无后继兄弟`);
    } finally { await ctx.close(); }
  }
}));

// ── ④ ?themedi 诊断浮层 ──────────────────────────────────────────────
test('V529-4 ?themedi 开启时渲染诊断浮层且按钮可交互；关闭时不存在 #themeDiag', guard(async () => {
  // 关闭态
  const { ctx: c1, page: p1 } = await openPage('light', '');
  try {
    const hasOff = await p1.evaluate(() => !!document.getElementById('themeDiag'));
    assert.strictEqual(hasOff, false, '无 ?themedi 时不应存在 #themeDiag');
  } finally { await c1.close(); }

  // 开启态
  const { ctx: c2, page: p2 } = await openPage('dark', '?themedi');
  try {
    await p2.waitForSelector('#themeDiag', { timeout: 5000 });
    const ok = await p2.evaluate(() => {
      const d = document.getElementById('themeDiag');
      return !!(d && d.querySelector('#tdBody') && d.querySelector('#tdBtns'));
    });
    assert.strictEqual(ok, true, '#themeDiag 应渲染读数区与按钮区');

    // 交互：点第一个按钮（切日间）应改主题且不抛错
    await p2.click('#themeDiag #tdBtns button');
    await p2.waitForTimeout(200);
    const after = await p2.evaluate(() => document.body.classList.contains('dark'));
    assert.strictEqual(after, false, '点击诊断"切日间"后应为浅色，说明浮层可交互');
    assert.deepStrictEqual(p2.__errors, [], '?themedi 开启时不应抛 JS 错误');
  } finally { await c2.close(); }
}));

// ── ⑤ 两套色板配色符合 THEME_PALETTE ───────────────────────────────
test('V529-5 两种主题下落地页/解锁弹窗/顶栏/页脚/删除线配色符合 THEME_PALETTE', guard(async () => {
  const expect = {
    light: { bg: LIGHT_BG, muted: LIGHT_MUTED, box: LIGHT_BOX },
    dark: { bg: DARK_BG, muted: DARK_MUTED, box: DARK_BOX },
  };
  for (const [mode, dark] of [['light', false], ['dark', true]]) {
    const { ctx, page } = await openPage('light', '');
    try {
      await page.evaluate((d) => window.applyTheme(d), dark);
      await page.waitForFunction((d) => document.body.classList.contains('dark') === d, dark, { timeout: 5000 });
      const res = await page.evaluate(() => {
        const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
        document.getElementById('mask').classList.remove('hidden'); // 让 .box 可见可量
        const ed = document.getElementById('editor');
        ed.innerHTML = '<s>del</s>';
        return {
          boxBg: cs('.box') ? cs('.box').backgroundColor : null,
          headerColor: cs('header') ? cs('header').color : null,
          footerColor: cs('footer') ? cs('footer').color : null,
          landingBg: cs('#landing') ? cs('#landing').backgroundColor : null,
          sColor: cs('#editor s') ? cs('#editor s').color : null,
        };
      });
      const e = expect[mode];
      assert.strictEqual(res.boxBg, e.box, `[${mode}] .box 背景应=${e.box}`);
      assert.strictEqual(res.headerColor, e.muted, `[${mode}] header 颜色应=muted(${e.muted})`);
      assert.strictEqual(res.footerColor, e.muted, `[${mode}] footer 颜色应=muted(${e.muted})`);
      assert.strictEqual(res.landingBg, e.bg, `[${mode}] #landing 背景色应=${e.bg}`);
      assert.strictEqual(res.sColor, e.muted, `[${mode}] 删除线 s 颜色应=muted(${e.muted})`);
    } finally { await ctx.close(); }
  }
}));

// ── ⑥ 主流程回归（真实导航 + 交互）──────────────────────────────────
test('V529-6 主流程：落地页→口令解锁→打字→删除线→Ctrl+Z→复制→导出 不受 override/MO 影响', guard(async () => {
  const { ctx, page } = await openPage('light', '');
  try {
    await page.waitForSelector('#landing:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await page.fill('#landingInput', 'vtest');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('#landingBtn'),
    ]);
    await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 15000 });
    await page.waitForSelector('#pw', { timeout: 8000 });
    await page.fill('#pw', 'pass123');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });

    // 打字
    await page.click('#editor');
    await page.type('#editor', 'Hello world', { delay: 8 });
    // 全选 + 删除线
    await page.keyboard.press('Control+a');
    await page.click('#strikeBtn');
    await page.waitForTimeout(200);
    const hasS = await page.evaluate(() => !!document.querySelector('#editor s'));
    assert.strictEqual(hasS, true, '删除线应生效');

    const before = await page.evaluate(() => document.getElementById('editor').innerHTML);
    // Ctrl+Z 撤销
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => document.getElementById('editor').innerHTML);
    assert.notStrictEqual(after, before, 'Ctrl+Z 应产生撤销效果（editor 内容变化）');

    // 复制（不应抛错）
    await page.click('#copyBtn');
    await page.waitForTimeout(150);
    // 导出图片（html2canvas 未加载应优雅返回，不抛错；overflow 应恢复）
    await page.click('#exportImgBtn');
    await page.waitForFunction(() => document.getElementById('editor').style.overflow === '', { timeout: 10000 })
      .catch(() => {});
    const overflow = await page.evaluate(() => document.getElementById('editor').style.overflow);
    assert.strictEqual(overflow, '', '导出后 editor.overflow 应恢复为空');

    assert.deepStrictEqual(page.__errors, [], '主流程全程不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑦ MutationObserver 无死循环实证 ─────────────────────────────────
test('V529-7 连续注入 30 个样式后 override 仍唯一且置末，DOM 不暴涨（无死循环）', guard(async () => {
  const { ctx, page } = await openPage('dark', '');
  try {
    await page.evaluate(() => window.applyTheme(false));
    const res = await page.evaluate(async () => {
      const de = document.documentElement;
      const before = de.childElementCount;
      const t0 = Date.now();
      for (let i = 0; i < 30; i++) {
        const s = document.createElement('style');
        s.textContent = 'body{background:#000!important}';
        de.appendChild(s);
        await new Promise((r) => setTimeout(r, 0));
      }
      await new Promise((r) => setTimeout(r, 150));
      const ov2 = document.getElementById('theme-override');
      return {
        before,
        after: de.childElementCount,
        count: document.querySelectorAll('#theme-override').length,
        isLast: de.lastElementChild === ov2,
        elapsed: Date.now() - t0,
      };
    });
    assert.strictEqual(res.count, 1, 'override 应始终唯一');
    assert.strictEqual(res.isLast, true, 'override 应始终在 <html> 末尾');
    assert.ok(res.elapsed < 5000, `不应死循环，应在数秒内完成（实际 ${res.elapsed}ms）`);
    assert.ok(res.after <= res.before + 35, `DOM 子节点不应暴涨（before=${res.before}, after=${res.after}）`);
  } finally { await ctx.close(); }
}));
