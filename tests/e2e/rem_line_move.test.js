// v7.7.0 回归：用户报障五步「行首回车移动提醒 → 对端不同步 / 冲突弹条」全链路复现断言
// 步骤（与用户手报一一对应）：
//   S2 PC 第一行经悬浮卡添加提醒（2026-9-20 8:00 / 0800）→ app 秒级出现提醒
//   S3 PC 光标行首最前回车（提醒移到第二行）→ app ≤6s 静默同步（旧 bug：服务器版本根本不推进）
//   S4 PC 光标第二行行首 Backspace 删空行（提醒回第一行）→ app 同步（旧 bug：Blink 克隆样式假变更）
//   S5 PC 再回车（提醒又到第二行）→ app 静默采纳，绝不再弹「检测到同步冲突」（旧 bug 命中点）
// 断言：每步双端 bars 全隐藏、pendingRemote 恒 false、终局 localVer===serverV、正文行结构双端一致。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server_sync');

const PASS = 'testpass';
const NOTE = 'remline520'; // server_sync ID_RE 仅 [A-Za-z0-9]

let failures = 0;
const servers = [];
const browsers = [];
function guard(fn) {
  return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } };
}
after(async () => {
  await Promise.race([
    Promise.all([
      Promise.all(browsers.map(b => b.close().catch(() => {}))),
      Promise.all(servers.map(s => { try { s.close(); } catch (e) {} return Promise.resolve(); })),
    ]),
    new Promise(r => setTimeout(r, 6000)),
  ]).catch(() => {});
  process.exit(failures > 0 ? 1 : 0);
});

async function openNote(context, baseURL) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseURL + NOTE);
  await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', PASS);
  await page.click('#ok');
  await page.waitForFunction(() => {
    const ed = document.getElementById('editor');
    return ed && ed.getAttribute('contenteditable') === 'true';
  }, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 15000 });
  page.__errors = errors;
  return page;
}
const localVer = page => page.evaluate(() => localVer);
const serverV = page => page.evaluate(nid =>
  fetch('/api/note/' + nid).then(r => r.json()).then(j => j.v || 0), NOTE);
const barsHidden = page => page.evaluate(() =>
  document.getElementById('draftBar').classList.contains('hidden') &&
  document.getElementById('remoteBar').classList.contains('hidden'));
const notPending = page => page.evaluate(() => !pendingRemoteNote);
async function caretAtBlockStart(page, blockIdx) {
  await page.evaluate(i => {
    const ed = document.getElementById('editor');
    ed.focus();
    const b = ed.children[Math.min(i, ed.children.length - 1)] || ed;
    const r = document.createRange();
    r.setStart(b, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); // 测试页专用，app 红线不约束测试脚本
  }, blockIdx);
}

test('R0 五步行首编辑：全程零弹条、每步对端秒级静默同步、终局版本收敛', guard(async () => {
  const server = await startServer({ disableSSE: false });
  servers.push(server);
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  browsers.push(browser);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await openNote(ctxA, baseURL);
  const pageB = await openNote(ctxB, baseURL);

  // ── S2：PC 第一行输入时间+事项 → 光标落时间弹「添加提醒」→ 点卡真添加 ──
  await pageA.evaluate(() => { document.getElementById('editor').innerHTML = '<div>2026-09-20 8:00 0800</div>'; });
  await caretAtBlockStart(pageA, 0);
  await pageA.evaluate(() => {
    const b = document.getElementById('editor').firstElementChild.firstChild;
    const r = document.createRange(); r.setStart(b, 3); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await pageA.waitForFunction(() => {
    const c = document.getElementById('timeChip');
    return !c.classList.contains('hidden') && c.textContent.indexOf('添加提醒') >= 0;
  }, { timeout: 6000 });
  await pageA.click('#timeChip');
  await pageA.waitForFunction(() => document.getElementById('timeChip').textContent.indexOf('已添加') >= 0, { timeout: 6000 });
  await pageA.waitForFunction(() => document.getElementById('editor').innerHTML.indexOf('rem-mark') >= 0, { timeout: 8000 });
  // B 秒级同步提醒行
  await pageB.waitForFunction(() => document.getElementById('editor').textContent.indexOf('0800') >= 0, { timeout: 8000 }) ;
  assert.ok(await barsHidden(pageA) && await barsHidden(pageB), 'S2 全程不得弹条');

  // ── S3：行首回车（提醒移到第二行）。旧 bug：终态漏存，服务器版本不动，B 永远停在第一行 ──
  await caretAtBlockStart(pageA, 0);
  await pageA.keyboard.press('Enter');
  await pageB.waitForFunction(() => {
    const ed = document.getElementById('editor');
    const first = ed.children[0];
    return first && !first.textContent.trim() && (ed.children[1] || {}).textContent && ed.children[1].textContent.indexOf('0800') > -1;
  }, { timeout: 10000 });
  assert.ok(await barsHidden(pageB), 'S3 B 不得弹条');
  assert.ok(await notPending(pageB), 'S3 B 不得挂起远端');

  // ── S4：第二行行首 Backspace 删空行（提醒回第一行）。旧 bug：Blink 克隆样式假变更落库 ──
  await caretAtBlockStart(pageA, 1);
  await pageA.keyboard.press('Backspace');
  await pageB.waitForFunction(() => {
    const ed = document.getElementById('editor');
    return ed.children.length >= 1 && ed.children[0].textContent.indexOf('0800') > -1;
  }, { timeout: 10000 });
  assert.ok(await barsHidden(pageB) && await barsHidden(pageA), 'S4 全程不得弹条');

  // ── S5：再次回车（提醒又到第二行）。旧 bug：B 假脏 → 合并失败 → 弹「检测到同步冲突」──
  await caretAtBlockStart(pageA, 0);
  await pageA.keyboard.press('Enter');
  await pageB.waitForFunction(() => {
    const ed = document.getElementById('editor');
    const first = ed.children[0];
    return first && !first.textContent.trim() && ed.children[1] && ed.children[1].textContent.indexOf('0800') > -1;
  }, { timeout: 10000 });
  await pageA.waitForTimeout(2500); // 让双端各自的轮询/回填全部落定
  assert.ok(await barsHidden(pageB), 'S5 B 绝不弹「检测到同步冲突」（回归主断言）');
  assert.ok(await notPending(pageB), 'S5 B 无挂起远端');
  assert.ok(await barsHidden(pageA), 'S5 A 不得弹条');

  // 终局：版本收敛 + 正文一致 + 零 pageerror
  const [va, vb, vs] = await Promise.all([localVer(pageA), localVer(pageB), serverV(pageA)]);
  assert.strictEqual(va, vs, 'A localVer 应收敛服务器版本');
  assert.strictEqual(vb, vs, 'B localVer 应收敛服务器版本（期望秒级同步，零拍板）');
  const [ta, tb] = await Promise.all([
    pageA.evaluate(() => document.getElementById('editor').textContent),
    pageB.evaluate(() => document.getElementById('editor').textContent),
  ]);
  assert.strictEqual(tb, ta, 'B 终局正文应与 A 一致');
  assert.deepStrictEqual(pageA.__errors, [], 'A 零 pageerror');
  assert.deepStrictEqual(pageB.__errors, [], 'B 零 pageerror');
}));
