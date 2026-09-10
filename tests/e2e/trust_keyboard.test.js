// v7.9.1 首页信任行「贴底 + 键盘期淡出」真浏览器防回归（发版闸 R2/R3 双路命中 P0 的守门用例）
// 语义：#landing>* 的 rise 动画 fill-mode:both 会把 to 帧 opacity:1 以动画级联永久压过
//   .trust-away 的 opacity:0——jsdom 无动画级联，静态断言全绿也抓不到（伪绿前科复现），
//   只有真实 Chromium 读 getComputedStyle 才能证明淡出真的生效。修复=对 .trust 改 animation-fill-mode:backwards。
// 异步等待一律 waitForFunction 等 computed opacity 真实值（红线：禁定值 sleep）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

process.on('unhandledRejection', (r) => { const m = String((r && r.message) || r); if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(m)) return; console.error('Unhandled:', m); process.exitCode = 1; });

let ctxS;
before(async () => { ctxS = await setup(); });
after(async () => { await teardown(ctxS.browser, ctxS.server); });

const opExpr = `parseFloat(getComputedStyle(document.querySelector('#landing .trust')).opacity)`;
async function op(page) { return page.evaluate(`(${opExpr})`); }

test('K1 focus 淡出/blur 淡回在 computed 层真实生效（动画级联闸）', async () => {
  const { browser, baseURL } = ctxS;
  const page = await browser.newPage();
  await page.goto(baseURL); // 根路径 → init() landing 分支
  await page.waitForFunction(() => {
    const l = document.getElementById('landing');
    return l && !l.classList.contains('hidden');
  }, { timeout: 15000 });
  await page.waitForFunction(`${opExpr} >= 0.99`, { timeout: 5000 });
  assert.ok(true); // 入场 rise（.42s 延迟+.7s 时长）跑完=全显
  const op0 = await op(page);
  assert.ok(op0 >= 0.99, '入场动画结束后信任行应全显，实测 ' + op0);

  await page.focus('#landingInput');
  await page.waitForFunction(() => document.getElementById('landing').classList.contains('trust-away'), { timeout: 3000 });
  await page.waitForFunction(`${opExpr} <= 0.05`, { timeout: 2000 })
    .catch(() => { throw new assert.AssertionError({ message: 'focus 后 computed opacity 未归零——rise fill:both 再次动画级锁死淡出（v7.9.1 闸 P0 回归），须保持 animation-fill-mode:backwards' }); });

  await page.evaluate(() => document.getElementById('landingInput').blur());
  await page.waitForFunction(() => !document.getElementById('landing').classList.contains('trust-away'), { timeout: 3000 });
  await page.waitForFunction(`${opExpr} >= 0.95`, { timeout: 2000 });
  await page.close();
});

// v8.0.0 用户报修守门：安卓「返回/收起键」收键盘常不触发 blur——旧逻辑淡出类永久卡住，
// 「底部三个图标不见了」。修法=视口回弹兜底淡回（resizes-content 内核）。K2 全程不 blur。
test('K2 键盘收起不收 blur：视口回弹 computed 层真实淡回（v8.0.0 根因回归）', async () => {
  const { browser, baseURL } = ctxS;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL);
  await page.waitForFunction(() => {
    const l = document.getElementById('landing');
    return l && !l.classList.contains('hidden');
  }, { timeout: 15000 });
  await page.waitForFunction(`${opExpr} >= 0.99`, { timeout: 5000 });

  await page.focus('#landingInput');
  await page.waitForFunction(() => document.getElementById('landing').classList.contains('trust-away'), { timeout: 3000 });
  await page.setViewportSize({ width: 390, height: 500 }); // 键盘弹起=视口压缩；focus 保持
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'landingInput', { timeout: 2000 });
  await page.waitForFunction(`${opExpr} <= 0.05`, { timeout: 2000 });
  assert.ok(true); // 键盘期：淡出且仍聚焦

  await page.setViewportSize({ width: 390, height: 844 }); // 收起键盘=视口回弹，全程不 blur
  await page.waitForFunction(() => !document.getElementById('landing').classList.contains('trust-away'), { timeout: 3000 })
    .catch(() => { throw new assert.AssertionError({ message: '视口回弹后仍 trust-away——onResizeTrust 兜底失效（blur 不触发内核下用户报修 bug 复发）' }); });
  await page.waitForFunction(`${opExpr} >= 0.95`, { timeout: 2000 });
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'landingInput');
  assert.ok(focused, '前置守护：K2 必须始终未 blur（证明淡回来自视口兜底而非 blur 通道）');
  await page.close();
});
