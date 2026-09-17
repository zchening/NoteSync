// v9.3.9 彩蛋词弹窗契约回归（用户报：/pet 等词「移上去常不弹、移开不消失、折叠里不弹、和添加提醒不一致」）
// 本版把彩蛋确认层改成与正文「添加提醒」time-chip 同一模型：hover/光标落到词上→弹在词旁，移开→自动收；
// 触屏点词→弹且【停住不闪】（锁 P0：曾有 document 秒删）、点空白→收。不修改任何业务代码。
// 并发纪律：本文件属 e2e，跑法 `node --test --test-concurrency=2 --test-force-exit e2e/*.test.js`（cwd=tests）。
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
function guard(fn) {
  return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } };
}
let server, browser, baseURL;

before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  if (browser) await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]).catch(() => {});
  try { if (server) server.close(); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

// 落地页→建/开笔记→解锁→把正文塞进 /pet，返回 page 与 /pet 的屏幕中心坐标
async function openWithPet(name, mobile) {
  const ctx = await browser.newContext(Object.assign(
    { viewport: { width: mobile ? 390 : 1100, height: mobile ? 844 : 800 } },
    mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}
  ));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', name);
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(name), { timeout: 10000 });
  await page.waitForSelector('#editor', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => !document.getElementById('mask').classList.contains('hidden') === false, undefined, { timeout: 8000 })
    .catch(() => {});
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>先记一笔&nbsp;</div><div>忙里 /pet 偷个闲</div>';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(650); // 让 linkify 防抖跑完，别在重建中途测
  const box = await page.evaluate(() => {
    const tn = [...document.getElementById('editor').querySelectorAll('*')].concat(document.getElementById('editor').childNodes)
      .flatMap((n) => (n.nodeType === 3 ? [n] : (n.childNodes ? [...n.childNodes].filter((c) => c.nodeType === 3) : [])))
      .find((t) => /\/pet/.test(t.nodeValue));
    if (!tn) return null;
    const idx = tn.nodeValue.indexOf('/pet');
    const r = document.createRange(); r.setStart(tn, idx); r.setEnd(tn, idx + 4);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, top: b.top, left: b.left };
  });
  assert.ok(box, '正文里应能找到 /pet 文本节点');
  return { ctx, page, box };
}
const hasAsk = () => (pg) => pg.evaluate(() => !!document.getElementById('nsAsk'));

test('EP-1 桌面：鼠标移进 /pet 弹在词旁、移开自动收（锚定非底部、非赖 6 秒）', guard(async () => {
  const { ctx, page, box } = await openWithPet('EggHoverPc', false);
  const hoverOk = await page.evaluate(() => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches));
  if (!hoverOk) { console.log('EP-1 SKIP: headless 无 hover:fine'); assert.ok(true); await ctx.close(); return; }
  await page.mouse.move(box.x, box.y);
  await page.waitForFunction(() => !!document.getElementById('nsAsk'), undefined, { timeout: 4000 });
  // 锚定：弹窗带 inline top（贴词旁），而不是旧的 bottom:76px 细条
  const anchored = await page.evaluate(() => {
    const b = document.getElementById('nsAsk');
    return b.style.top !== '' && (b.textContent.indexOf('/pet') >= 0);
  });
  assert.ok(anchored, '弹窗应锚定在 /pet 词旁（inline top + 含 /pet 文案）');
  await page.mouse.move(20, 760); // 移到远离词的空白
  await page.waitForFunction(() => !document.getElementById('nsAsk'), undefined, { timeout: 4000 });
  assert.ok(!(await page.evaluate(() => !!document.getElementById('nsAsk'))), '移开词后弹窗应自动消失');
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
  await ctx.close();
}));

test('EP-2 触屏：点中 /pet 弹窗停住不闪（锁 P0）、点空白才收', guard(async () => {
  const { ctx, page, box } = await openWithPet('EggTapMobile', true);
  await page.touchscreen.tap(box.x, box.y);
  await page.waitForFunction(() => !!document.getElementById('nsAsk'), undefined, { timeout: 4000 });
  await page.waitForTimeout(500); // 关键：旧 bug 是同次 click 冒泡到 document 秒删——等一拍看还在不在
  assert.ok(await page.evaluate(() => !!document.getElementById('nsAsk')), '触屏点词后弹窗应停住（不得被秒删）');
  await page.touchscreen.tap(20, 700); // 点编辑器空白/外部
  await page.waitForFunction(() => !document.getElementById('nsAsk'), undefined, { timeout: 4000 });
  assert.ok(!(await page.evaluate(() => !!document.getElementById('nsAsk'))), '点空白应收起');
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
  await ctx.close();
}));

test('EP-3 点「进入」才启动游戏，未点不启动', guard(async () => {
  const { ctx, page, box } = await openWithPet('EggEnter', true);
  await page.touchscreen.tap(box.x, box.y);
  await page.waitForFunction(() => !!document.getElementById('nsAsk'), undefined, { timeout: 4000 });
  assert.ok(!(await page.evaluate(() => !!document.getElementById('nsGame'))), '未确认前不得启动');
  await page.click('#nsAsk .ns-go');
  await page.waitForFunction(() => !!document.querySelector('.ns-pet-panel') || !!document.getElementById('nsGame'), undefined, { timeout: 5000 });
  assert.ok(await page.evaluate(() => /pet/.test(String(window.NSG && window.NSG.route))), '确认后进 /pet');
  // P0 锁：进游戏后打字绝不能写进正文（.ns-go 已 blur 编辑器）
  const before = await page.evaluate(() => document.getElementById('editor').innerText);
  await page.keyboard.type('XYZqwe');
  const after = await page.evaluate(() => document.getElementById('editor').innerText);
  assert.strictEqual(after, before, '进入游戏后键盘输入不得改动正文（红线③：游戏不碰数据）');
  assert.ok(!/XYZqwe/.test(after), '打进去的垃圾字符不得出现在正文');
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
  await ctx.close();
}));
