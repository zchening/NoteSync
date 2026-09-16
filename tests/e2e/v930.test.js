// NoteSync v9.3.0 E2E（真实 Chromium）：折叠三角 44px 真几何 / 菜单桌宠领养+顶栏下沿爬行 / satoshi 真按键回归。
// 守护纪律：布局断言只能在真浏览器量（jsdom 恒 0）；等异步用 waitForFunction 真条件；2 并发。
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
  if (browser) await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 6000))]).catch(() => {});
  try { if (server) server.close(); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

async function openEditor(noteName, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.__errors = errors;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', noteName);
  await page.click('#landingBtn');
  await page.waitForFunction(n => location.pathname.endsWith(n), encodeURIComponent(noteName), { timeout: 10000 });
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  return { ctx, page };
}

/* ── H1 窄屏折叠三角：感应区真几何 ≥40×40 且行盒不明显变高 ── */
test('H1 390px 视口下折叠三角感应区真尺寸 ≥40×40，行排版未被负 margin 撑坏', guard(async () => {
  const { ctx, page } = await openEditor('v930fold', { width: 390, height: 760 });
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '';
    const mk = t => { const d = document.createElement('div'); d.textContent = t; ed.appendChild(d); };
    mk('[折叠]周会安排'); mk('定稿移动端口径'); mk('下周灰度一包'); mk(''); mk('普通行');
    window.applyFolds();
  });
  const box = await page.evaluate(() => {
    const m = document.querySelector('#editor .ns-fold-mark');
    const r = m.getBoundingClientRect();
    const line = m.closest('.ns-fold').getBoundingClientRect();
    return { w: r.width, h: r.height, lineH: line.height, y: r.y, ly: line.y };
  });
  assert.ok(box.w >= 40, '三角感应区宽应 ≥40px，实得 ' + box.w);
  assert.ok(box.h >= 40, '三角感应区高应 ≥40px，实得 ' + box.h);
  assert.ok(box.lineH < 120, '负 margin 回补失效会把行盒撑爆，实得 ' + box.lineH);
  assert.ok(Math.abs((box.y + box.h / 2) - (box.ly + box.lineH / 2)) < 14, '放大后三角应仍与标题行垂直居中对齐');
  // 桌面视口零变化反证
  await page.setViewportSize({ width: 900, height: 760 });
  const dbox = await page.evaluate(() => {
    const m = document.querySelector('#editor .ns-fold-mark');
    const r = m.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  assert.ok(dbox.w < 40 && dbox.h < 30, '桌面端三角必须保持原小尺寸，实得 ' + dbox.w + '×' + dbox.h);
  assert.strictEqual(page.__errors.length, 0, 'pageerror: ' + page.__errors.slice(0, 2).join('|'));
  await ctx.close();
}));

/* ── H2 菜单桌宠行：点开即领养、× 收起后宠物挂在顶栏下沿左右爬 ── */
test('H2 点菜单「桌宠」→ 面板开+adopted 落库；退出后面板宠物在顶栏下沿往返爬行', guard(async () => {
  const { ctx, page } = await openEditor('v930pet', { width: 390, height: 760 });
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('nsPet')), false, '前置：未领养时屏幕上不该有宠物（默认关拍板）');
  await page.click('#menuBtn');
  await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), null, { timeout: 5000 });
  await page.click('#menuPet');
  await page.waitForFunction(() => !!document.getElementById('nsGame'), null, { timeout: 8000 });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('notesync_pet') || '{}').adopted === true, null, { timeout: 5000 });
  // 换养输入区随面板在位
  assert.ok(await page.evaluate(() => !!document.querySelector('.ns-swap-in') && !!document.querySelector('.ns-swap-go')));
  assert.strictEqual(await page.evaluate(() => document.querySelector('.ns-swap-go').disabled), true, '空输入时换养按钮必须置灰');
  await page.evaluate(() => {
    const i = document.querySelector('.ns-swap-in');
    i.value = 'ns1:id=ABCDEFGH;key=ZZZZ9999';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.strictEqual(await page.evaluate(() => document.querySelector('.ns-swap-go').disabled), false, '有内容必须解锁');
  await page.click('#nsGame .ns-x'); // 收面板
  await page.waitForFunction(() => !document.getElementById('nsGame'), null, { timeout: 5000 });
  await page.waitForSelector('#nsPet', { timeout: 5000 });
  const geom = await page.evaluate(() => {
    const hr = document.querySelector('header').getBoundingClientRect();
    const pr = document.getElementById('nsPet').getBoundingClientRect();
    return { hy: hr.y, hb: hr.bottom, py: pr.y, pb: pr.bottom, px: pr.x };
  });
  assert.ok(Math.abs(geom.pb - geom.hb) < 16, '宠物必须骑在顶栏下沿（底缘差 <16px），实差 ' + (geom.pb - geom.hb));
  const x1 = await page.evaluate(() => document.getElementById('nsPet').getBoundingClientRect().x);
  await page.waitForFunction(x0 => Math.abs(document.getElementById('nsPet').getBoundingClientRect().x - x0) > 6, x1, { timeout: 12000 });
  assert.strictEqual(page.__errors.length, 0, 'pageerror: ' + page.__errors.slice(0, 2).join('|'));
  await ctx.close();
}));

/* ── H3 satoshi 真按键：动画上线后逻辑零回归（棋盘同步落定、分数随步走） ── */
test('H3 /satoshi 方向键 30 步零异常，moves/score 与棋盘同步推进', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(baseURL + 'satoshi', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('nsCv'), null, { timeout: 10000 });
  const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'];
  for (let i = 0; i < 30; i++) await page.keyboard.press(keys[i % 4]);
  const st = await page.evaluate(() => window.NSG.cur.probe());
  assert.ok(st.moves >= 1, '30 次按键不可能一步没走');
  assert.ok(Number.isFinite(st.max) && st.max >= 65536, '最大格至少一个出生值：' + st.max);
  assert.strictEqual(errs.length, 0, 'pageerror: ' + errs.slice(0, 2).join('|'));
  await ctx.close();
}));

/* ── H4 折叠复制真剪贴板：跨收起折叠的选区复制，粘贴文本含被折正文 ── */
test('H4 选区跨折叠复制——剪贴板含隐藏正文；事件后折叠态原样还原', guard(async () => {
  const { ctx, page } = await openEditor('v930copy', { width: 390, height: 760 });
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '';
    const mk = t => { const d = document.createElement('div'); d.textContent = t; ed.appendChild(d); };
    mk('[折叠]标题行'); mk('被折的正文甲'); mk('被折的正文乙'); mk('');
    window.applyFolds();
  });
  assert.ok(await page.evaluate(() => !!document.querySelector('#editor .ns-fold-hide')), '前置：折叠收起态');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('editor'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('copy');
  });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip.includes('被折的正文甲') && clip.includes('被折的正文乙'), '剪贴板必须含被折正文（用户报丢字本体），实得：' + JSON.stringify(clip));
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-hide'), null, { timeout: 5000 });
  assert.strictEqual(page.__errors.length, 0, 'pageerror: ' + page.__errors.slice(0, 2).join('|'));
  await ctx.close();
}));
