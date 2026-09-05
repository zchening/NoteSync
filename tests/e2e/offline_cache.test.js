// NoteSync E2E（Playwright + 真实 Chromium）：v5.49 离线阅读「上次同步正文」回归
// 真实路径：
//   1) 在线解锁（KEY_STORE 落地）→ 输入并保存 → 正文密文被 cachePut 进 localStorage
//   2) 拦截 /api/** 模拟服务器不可达（页面本身仍可加载）
//   3) 重新加载 → init 走 loadStoredKey 路径，apiGet 失败 → loadCachedBody 解密缓存密文
//   4) 断言：编辑器展示上次同步正文 + 底部浮出「离线 · 上次同步于 X」状态条
// 锁死 v5.47/5.48 的「离线打开只能看到旧草稿/空白」缺陷回归。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server_sync');

const PASS = 'testpass';
const NOTE = 'offlinecache';
const TEXT = 'offline-cache-body-987';

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

async function openNote(context, baseURL) {
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
  await page.waitForFunction(
    () => { const l = document.getElementById('loading'); return l && l.classList.contains('hidden'); },
    { timeout: 15000 }
  );
  page.__errors = errors;
  return page;
}

test('离线回退：服务器不可达时用缓存密文展示上次同步正文 + 底部状态条', guard(async () => {
  const server = await startServer();
  servers.push(server);
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  browsers.push(browser);
  const context = await browser.newContext();
  const page = await openNote(context, baseURL);

  // 输入并等待保存（保存成功即 cachePut 写入 localStorage 密文缓存）
  await page.click('#editor');
  await page.keyboard.type(TEXT);
  await page.waitForFunction(
    (note) => {
      const raw = localStorage.getItem('notesync_cache_' + note);
      if (!raw) return false;
      try { return JSON.parse(raw).ct && JSON.parse(raw).ct.length > 0; } catch { return false; }
    },
    NOTE,
    { timeout: 10000 }
  );
  const cacheBefore = await page.evaluate((note) => localStorage.getItem('notesync_cache_' + note), NOTE);
  assert.ok(cacheBefore && JSON.parse(cacheBefore).ct, '保存后应立即写入非空缓存密文');
  // 缓存只存密文，绝不存明文
  assert.ok(!cacheBefore.includes(TEXT), '缓存中不应出现明文正文（零知识属性）');

  // 拦截所有 /api 请求，模拟服务器不可达（页面本身仍可加载）
  await page.route('**/api/**', (r) => r.abort());

  // 重新加载：走 loadStoredKey 路径，apiGet 失败 → loadCachedBody 解密缓存
  await page.reload();
  await page.waitForFunction(
    () => {
      const bar = document.getElementById('offlineBar');
      const t = document.getElementById('offlineTime');
      const ed = document.getElementById('editor');
      if (!bar || bar.classList.contains('hidden')) return false;
      if (!t || !t.textContent.trim()) return false;
      // 编辑器 textContent 含零宽空格(\u200B)，比对前剥离
      if (!ed || !ed.textContent.replace(/\u200B/g, '').includes('offline-cache-body-987')) return false;
      return true;
    },
    { timeout: 15000 }
  );

  const result = await page.evaluate(() => ({
    offlineVisible: !document.getElementById('offlineBar').classList.contains('hidden'),
    offlineTime: document.getElementById('offlineTime').textContent.trim(),
    hasBody: document.getElementById('editor').textContent.replace(/\u200B/g, '').includes('offline-cache-body-987'),
    editable: document.getElementById('editor').getAttribute('contenteditable') === 'true',
  }));
  assert.strictEqual(result.offlineVisible, true, '断网重载后应浮出离线状态条');
  assert.ok(result.offlineTime.length > 0, '离线状态条应显示上次同步时间');
  assert.strictEqual(result.hasBody, true, '断网重载后应展示上次同步的正文（而非空白/旧草稿）');
  assert.strictEqual(result.editable, true, '断网重载后编辑器应可编辑');
  assert.deepStrictEqual(page.__errors, [], '离线回退过程不应有 pageerror');
}));
