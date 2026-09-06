// NoteSync v5.44 独立回归验证（Playwright + 真实 Chromium）
//
// 逐字针对用户四条 bug 反馈：
//   ① 打开提醒面板默认选中「分钟」段（桌面环境守卫：触屏设备不自动聚焦，防键盘挤偏面板复发）
//   ② 事项框 placeholder 精简为「事项」（括号补语「（可留空）」删除）
//   ③ 到点提醒卡片（#remCard）必须处于页面正中心，标题「提醒」与正文「时间 · 事项」必须居中
//      （根因：通用 rise 动画 to 帧 transform:none 抹掉 translate(-50%,-50%) 居中偏移）
//   ④ 到点提醒有声音：音频全局解锁（首次手势解锁 AudioContext + 静音 buffer，响铃复用全局 ctx）
// 不修改任何业务代码。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium, devices } = require('playwright');
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
    finally { t.diagnostic && null; }
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

// 桌面环境：落地页 → 输入笔记名 → 口令解锁 → 编辑器就绪
async function openDesktopEditor() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'V544Verify');
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent('V544Verify'), { timeout: 10000 });
  await page.waitForSelector('#editor', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  return { ctx, page };
}

// ── ③ 到点卡片：正中心 + 标题/正文居中 ──────────────────────────────
test('V544-1 到点卡片处于页面正中心，标题「提醒」与正文「时间 · 事项」居中，挂 remRise 入场', guard(async () => {
  const { ctx, page } = await openDesktopEditor();
  try {
    await page.evaluate(() => window.showRemCard([{ at: Date.now() - 60e3, text: '为什么呢' }], false));
    await page.waitForSelector('#remCard:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(700); // remRise 入场 0.5s：等动画结束后再量位置（from 帧带 +14px 下移）

    const m = await page.evaluate(() => {
      const card = document.getElementById('remCard');
      const r = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      const title = getComputedStyle(document.getElementById('remCardTitle'));
      const when = card.querySelector('.rem-when');
      return {
        w: window.innerWidth, h: window.innerHeight,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        anim: cs.animationName,
        cardAlign: cs.textAlign,
        titleAlign: title.textAlign,
        whenAlign: when ? getComputedStyle(when).textAlign : 'missing',
        text: when ? when.textContent : '',
      };
    });
    assert.ok(Math.abs(m.cx - m.w / 2) <= 2, `卡片水平中心应=视口中心（${m.cx} vs ${m.w / 2}）——"不在正中心"根因`);
    assert.ok(Math.abs(m.cy - m.h / 2) <= 2, `卡片垂直中心应=视口中心（${m.cy} vs ${m.h / 2}）——"不在正中心"根因`);
    assert.strictEqual(m.anim, 'remRise', '#remCard 必须挂 remRise 专用入场（rise to 帧 transform:none 会抹掉居中偏移）');
    assert.strictEqual(m.cardAlign, 'center', '整卡必须 text-align:center');
    assert.strictEqual(m.titleAlign, 'center', '标题「提醒」必须居中');
    assert.strictEqual(m.whenAlign, 'center', '正文「时间　事项」必须居中');
    assert.ok(m.text.includes('为什么呢') && m.text.includes('　'), '正文应含「时间　事项」文案（v5.47 分隔符=全角空格）: ' + m.text);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ①+② 打开面板：v5.55 滚轮时代——桌面聚焦小时滚轮 + placeholder 精简 ──
test('V544-2 桌面端打开面板小时滚轮默认聚焦（↑↓可调），placeholder=「事项」', guard(async () => {
  const { ctx, page } = await openDesktopEditor();
  try {
    await page.click('#remBtn'); // 用户真实路径：点菜单栏闹钟图标
    await page.waitForSelector('#remPanel', { timeout: 5000 });
    const m = await page.evaluate(() => {
      const hh = document.querySelector('#remBoxForm .rem-wheel-hh');
      const mm = document.querySelector('#remBoxForm .rem-wheel-mm');
      const item = document.querySelector('#remBoxForm input.rem-item');
      return {
        focused: document.activeElement === hh,
        hhVal: hh ? hh.dataset.val : null,
        mmVal: mm ? mm.dataset.val : null,
        hhCount: hh ? hh.querySelectorAll('.rem-wheel-it').length : 0,
        mmCount: mm ? mm.querySelectorAll('.rem-wheel-it').length : 0,
        desktop: window.matchMedia('(hover:hover) and (pointer:fine)').matches,
        placeholder: item ? item.placeholder : null,
      };
    });
    assert.ok(m.desktop, 'Playwright 桌面 context 应命中 hover:fine 守卫');
    assert.ok(m.focused, '桌面端打开面板小时滚轮必须默认聚焦（v5.55：滚轮 ↑↓ 微调的前提；mask 显示后才聚焦）');
    assert.strictEqual(m.hhCount, 24, '小时滚轮必须 24 项（00-23）');
    assert.strictEqual(m.mmCount, 60, '分钟滚轮必须 60 项（00-59）');
    assert.ok(m.hhVal !== null && m.mmVal !== null, '默认 +5 分钟值仍应填好');
    assert.strictEqual(m.placeholder, '事项', 'placeholder 必须精简为「事项」（括号补语已删）');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ① 守卫反向：移动端（触屏）不自动聚焦，面板仍正常 ────────────────────
test('V544-3 移动端（触屏设备模拟）打开面板不自动聚焦（防软键盘挤偏面板复发）', guard(async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landingInput', { timeout: 15000 });
    await page.fill('#landingInput', 'V544Mobile');
    await page.click('#landingBtn');
    await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent('V544Mobile'), { timeout: 10000 });
    await page.waitForSelector('#editor', { timeout: 15000 });
    await page.fill('#pw', 'test-pass-123');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });

    await page.click('#remBtn');
    await page.waitForSelector('#remPanel', { timeout: 5000 });
    const m = await page.evaluate(() => {
      const hh = document.querySelector('#remBoxForm .rem-wheel-hh');
      return {
        desktop: window.matchMedia('(hover:hover) and (pointer:fine)').matches,
        focused: document.activeElement === hh,
        hhVal: hh ? hh.dataset.val : null,
      };
    });
    assert.ok(!m.desktop, '移动设备模拟应命中 coarse 指针（非桌面环境）');
    assert.ok(!m.focused, '触屏设备不得自动聚焦时间控件（v5.43 教训：聚焦弹软键盘压缩视口致面板偏离正中心）');
    assert.ok(m.hhVal !== null, '默认 +5 分钟值仍应填好');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ④ 声音：全局音频解锁（手势后 ctx 存在且 running，响铃复用不新建）──────
test('V544-4 首次手势解锁全局 AudioContext，响铃复用（playRemSound 不再新建 suspended 实例）', guard(async () => {
  const { ctx, page } = await openDesktopEditor();
  try {
    const before = await page.evaluate(() => {
      try { return window.remAudioCtx ? window.remAudioCtx.state : (typeof remAudioCtx !== 'undefined' ? remAudioCtx && remAudioCtx.state : 'absent'); }
      catch (e) { return 'err:' + e.message; }
    });
    // 真实手势（点击编辑器）→ 解锁监听器应创建全局 ctx
    await page.click('#editor');
    const after = await page.evaluate(() => {
      try { return typeof remAudioCtx !== 'undefined' && remAudioCtx ? remAudioCtx.state : 'null'; }
      catch (e) { return 'err:' + e.message; }
    });
    assert.ok(after === 'running' || before === 'running', `手势后全局音频 ctx 应处于 running（before=${before}, after=${after}）——响铃可发声的前置条件`);
    // 响铃调用必须不抛错（复用全局 ctx，不再新建）
    await page.evaluate(() => { window.playRemSound(); });
    const still = await page.evaluate(() => {
      try { return typeof remAudioCtx !== 'undefined' && remAudioCtx ? remAudioCtx.state : 'null'; }
      catch (e) { return 'err:' + e.message; }
    });
    assert.strictEqual(still, 'running', '响铃后 ctx 仍为 running（复用而非重建）');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));
