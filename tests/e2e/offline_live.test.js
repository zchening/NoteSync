// NoteSync E2E（Playwright + 真实 Chromium）：v5.50 运行时断网感知回归
// v5.49 只覆盖「打开即离线」；本测锁死「页面开着断网/恢复」的运行时路径：
//   1) 在线解锁并保存到「已同步」→ context.setOffline(true) 模拟断网（页面保持打开）
//      → offline 事件 0 秒感知：页脚变「离线」+ 底部弹「离线 · 上次同步于 X」条，正文保持
//   2) setOffline(false) 恢复 → online 事件 → 削抖后 poll 成功 → 自动回「已同步」+ 收条
const { test, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server_sync');

const PASS = 'testpass';
const NOTE = 'offlinelive';
const TEXT = 'live-offline-650';

let failures = 0;
function guard(fn) {
  return async (t) => {
    try { await fn(t); } catch (e) { failures++; throw e; }
  };
}

const servers = [];
const browsers = [];
function teardown() {
  return Promise.race([
    Promise.all([
      Promise.all(browsers.map((b) => b.close().catch(() => {}))),
      Promise.all(servers.map((s) => { try { s.close(); } catch (e) {} return Promise.resolve(); })),
    ]),
    new Promise((r) => setTimeout(r, 6000)),
  ]).catch(() => {});
}
after(async () => {
  await teardown();
  process.exit(failures > 0 ? 1 : 0);
});

test('运行时断网：页脚立即「离线」+弹条；恢复后自动回「已同步」并收条', guard(async () => {
  const server = await startServer();
  servers.push(server);
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(baseURL + NOTE);
  await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', PASS);
  await page.click('#ok');
  await page.waitForFunction(
    () => { const ed = document.getElementById('editor'); return ed && ed.getAttribute('contenteditable') === 'true'; },
    { timeout: 15000 }
  );
  await page.click('#editor');
  await page.keyboard.type(TEXT);
  await page.waitForFunction(
    () => document.getElementById('statustext').textContent === '已同步',
    { timeout: 10000 }
  );

  // ── 断网（页面保持打开）：offline 事件 0 秒感知 ──
  await context.setOffline(true);
  await page.waitForFunction(
    () => document.getElementById('statustext').textContent === '离线' &&
          !document.getElementById('offlineBar').classList.contains('hidden'),
    { timeout: 3000 }
  );
  const offTime = await page.evaluate(() => document.getElementById('offlineTime').textContent.trim());
  assert.ok(offTime && offTime !== '—', '离线条应显示真实上次同步时间，实际: ' + offTime);
  const bodyKept = await page.evaluate(
    (t) => document.getElementById('editor').textContent.replace(/\u200B/g, '').includes(t),
    TEXT
  );
  assert.ok(bodyKept, '断网后正文应保持');

  // ── 恢复联网：online 事件 → 削抖 → poll 成功 → 回「已同步」+收条 ──
  await context.setOffline(false);
  await page.waitForFunction(
    () => document.getElementById('statustext').textContent === '已同步' &&
          document.getElementById('offlineBar').classList.contains('hidden'),
    { timeout: 10000 }
  );
  assert.deepStrictEqual(errors, [], '断网/恢复全程不应有 pageerror');
}));
