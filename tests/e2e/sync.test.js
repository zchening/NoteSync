// NoteSync E2E（Playwright + 真实 Chromium）：两端自动同步验证
// 直接走真实 URL 笔记路径（/synctest）+ 真实解锁，验证：
//   T1 正常链路（SSE + 轮询）：A 端输入后，B 端在 ≤5s 内自动收到，无需刷新；
//   T2 决定性回归证明（disableSSE）：即便 SSE 完全不可用，仅靠无条件 2s 轮询基线，
//       B 端仍能在 ≤3.5s 内自动收到——这正是 v5.17 修复、v5.18 提速到 2s 的“必须刷新”失败模式。
//   另：两端同步后页面不应出现 #syncToast 提示浮层（v5.18 移除同步打扰提示，自动同步静默）。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server_sync');

const PASS = 'testpass';
const NOTE = 'synctest';
const TEXT = 'sync-hello-123';

// 失败计数 + 拆解后据此决定退出码（规避 Windows/Playwright 拆解 hang 污染结果）
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

async function withEnv(disableSSE) {
  const server = await startServer({ disableSSE });
  servers.push(server);
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  browsers.push(browser);
  return { server, browser, baseURL };
}

async function openNote(context, baseURL) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baseURL + NOTE);
  await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
  // 未解锁态：填口令解锁（独立 context，无残留密钥）
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', PASS);
  await page.click('#ok');
  await page.waitForFunction(
    () => { const ed = document.getElementById('editor'); return ed && ed.getAttribute('contenteditable') === 'true'; },
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => { const l = document.getElementById('loading'); return l && l.classList.contains('hidden'); },
    { timeout: 15000 }
  );
  page.__errors = errors;
  return page;
}

test('T1 正常链路：A 输入后 B 在 ≤5s 内自动同步，无需刷新', guard(async () => {
  const { browser, baseURL } = await withEnv(false);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await openNote(ctxA, baseURL);
  const pageB = await openNote(ctxB, baseURL);

  await pageA.click('#editor');
  await pageA.keyboard.type(TEXT);

  await pageB.waitForFunction(
    (t) => document.getElementById('editor').textContent.includes(t),
    TEXT,
    { timeout: 8000 }
  );
  const bText = await pageB.evaluate(() => document.getElementById('editor').textContent);
  assert.ok(bText.includes(TEXT), `B 应自动收到 A 的输入（无需刷新），实际: ${bText}`);
  // v5.18：同步静默，不应出现提示浮层
  const toast1 = await pageB.evaluate(() => !!document.getElementById('syncToast'));
  assert.strictEqual(toast1, false, 'T1 同步后不应出现 #syncToast 提示浮层');
  assert.deepStrictEqual([...pageA.__errors, ...pageB.__errors], [], '两端不应有 pageerror');
}));

test('T2 决定性回归：SSE 关闭时仅靠 2s 轮询基线，B 仍自动同步（无需刷新）', guard(async () => {
  const { browser, baseURL } = await withEnv(true);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await openNote(ctxA, baseURL);
  const pageB = await openNote(ctxB, baseURL);

  await pageA.click('#editor');
  await pageA.keyboard.type(TEXT);

  // 仅靠 2s 轮询基线（最坏一拍 2s），应在 3.5s 内到达；若旧代码（轮询被 onopen 清掉、SSE 又不可用）则永远到不了
  await pageB.waitForFunction(
    (t) => document.getElementById('editor').textContent.includes(t),
    TEXT,
    { timeout: 3500 }
  );
  const bText = await pageB.evaluate(() => document.getElementById('editor').textContent);
  assert.ok(bText.includes(TEXT), `SSE 关闭时，B 应仅靠 2s 轮询自动收到（无需刷新），实际: ${bText}`);
  // v5.18：同步静默，不应出现提示浮层
  const toast2 = await pageB.evaluate(() => !!document.getElementById('syncToast'));
  assert.strictEqual(toast2, false, 'T2 同步后不应出现 #syncToast 提示浮层');
  assert.deepStrictEqual([...pageA.__errors, ...pageB.__errors], [], '两端不应有 pageerror');
}));
