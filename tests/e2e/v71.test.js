// NoteSync E2E v7.1.0——冲突弹窗误报根修回归 + 提醒 UI 四修。
//   V71-1 双页真实链路：A 输入"1"同步 → B 打开看到"1" → B 面板加提醒 → A 轮询两轮 → A 不弹冲突条且内容正常。
//   V71-2 确定性复现：A 应用远端含时间正文（linkify 打标改写 DOM）后远端 v 再 +1——
//         旧版把打标 DOM 当「本机未保存修改」必弹冲突条；v7.1.0 装饰等价判定不弹。
//   V71-3 UI：X 关闭（div 伪按钮）、列表滚动容器、仅 PC 自动聚焦事项输入框。
// 坑位备忘沿 v63.test.js：waitForFunction 的 options 必须第三参；解锁前 localStorage.clear()；
// GCM 密文 = update+final+getAuthTag 拼接；未解锁页 #mask 拦点击需先隐 landing。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { setup, teardown } = require('./harness');
const { startServer: startSyncServer } = require('./server_sync');

process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

let failures = 0;
function guard(fn) {
  return async (t) => {
    try { await fn(t); } catch (e) { failures++; throw e; }
  };
}

let server, browser, page, pageA, pageB, baseURL;
let syncServer, syncBase; // V71-1 专用：真实内存存储 + SSE（harness server 的 /api/* 是 {} 桩）
const PASS = 'test-pass-v71';

before(async () => {
  ({ server, baseURL, browser } = await setup());
  syncServer = await startSyncServer({});
  syncBase = 'http://localhost:' + syncServer.address().port + '/';
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
});

after(async () => {
  await teardown(browser, server);
  try { if (syncServer) syncServer.close(); } catch (e) {}
  process.exit(failures > 0 ? 1 : 0);
});

// ── 工具（沿 v63 套路）────────────────────────────────────────────────
// 单页解锁（page 参数化，支持 A/B 双页）。noteBody 可选：路由喂自定义 note JSON。
async function unlockOn(pg, name, noteBody) {
  let routed = false;
  if (noteBody) {
    await pg.route('**/api/note/' + name, (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(noteBody) });
      return route.continue();
    });
    routed = true;
  }
  try {
    await pg.goto(baseURL);
    await pg.waitForSelector('#landingInput', { timeout: 15000 });
    await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await pg.fill('#landingInput', name);
    await pg.click('#landingBtn');
    await pg.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(name), { timeout: 10000 });
    await pg.waitForSelector('#editor');
    await pg.fill('#pw', PASS);
    await pg.click('#ok');
    await pg.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', undefined, { timeout: 10000 });
    await pg.waitForTimeout(400); // applyUnlocked 落定
  } finally {
    if (routed) await pg.unroute('**/api/note/' + name);
  }
}
function newPage() {
  const pg = browser.newPage();
  return pg.then(p => {
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.__errors = errors;
    return p;
  });
}
// 加密 note body（与 index.html deriveKey 同构：PBKDF2 200k SHA-256 + AES-256-GCM，密文=ct+tag）
function seal(key, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]).toString('base64');
  return { ct: ct, iv: iv.toString('base64') };
}
function derive(pass, saltB64) {
  return crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), Buffer.from(saltB64, 'base64'), 200000, 32, 'sha256');
}

// ── V71-1：双页真实链路（冲突回归主场景）────────────────────────────
// 用 server_sync.js（真实内存存储 + SSE）：harness server 的 /api/* 是 {} 桩，无存储。
// A/B 各自独立 context（localStorage 隔离，都走口令解锁），沿 sync.test.js 套路。
test('V71-1 双页：A 输入同步 → B 面板加提醒 → A 两轮 poll 不弹冲突条', guard(async () => {
  async function openSyncNote(pg) {
    await pg.goto(syncBase + 'V71Sync');
    await pg.waitForFunction(() => typeof window.unlock === 'function', undefined, { timeout: 15000 });
    await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await pg.waitForSelector('#pw', { timeout: 15000 });
    await pg.fill('#pw', PASS);
    await pg.click('#ok');
    await pg.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', undefined, { timeout: 10000 });
    await pg.waitForTimeout(400); // applyUnlocked 落定
  }

  const ctxA = await browser.newContext();
  pageA = await ctxA.newPage();
  const errsA = [];
  pageA.on('pageerror', (e) => errsA.push(e.message));
  pageA.__errors = errsA;
  await openSyncNote(pageA);

  // A 输入 "1"，等 800ms 防抖保存完成（B 端可见 = 真实落库）
  await pageA.click('#editor');
  await pageA.keyboard.type('1');
  await pageA.waitForFunction(() => document.getElementById('statustext').textContent.indexOf('已同步') >= 0, undefined, { timeout: 8000 });

  // B 独立 context 解锁同一笔记，等编辑器出现 "1"
  const ctxB = await browser.newContext();
  pageB = await ctxB.newPage();
  const errsB = [];
  pageB.on('pageerror', (e) => errsB.push(e.message));
  pageB.__errors = errsB;
  await openSyncNote(pageB);
  await pageB.waitForFunction(() => document.getElementById('editor').textContent.trim() === '1', undefined, { timeout: 8000 });

  // B 走面板 UI 加提醒（明天 10:00 写周报）——真实 UI 路径
  await pageB.click('#remBtn');
  await pageB.waitForSelector('#remBoxForm button', { timeout: 5000 });
  const tomorrow = await pageB.evaluate(() => {
    const d = new Date(Date.now() + 86400e3);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  await pageB.evaluate((d) => { document.querySelector('#remBoxForm input[type=date]').value = d; }, tomorrow);
  await pageB.evaluate(() => {
    const hh = document.querySelector('#remBoxForm .rem-wheel-hh');
    const mm = document.querySelector('#remBoxForm .rem-wheel-mm');
    hh.scrollTop = 10 * 50; // 10 点
    mm.scrollTop = 0;
  });
  await pageB.fill('#remBoxForm .rem-item', '写周报');
  await pageB.click('#remBoxForm button');
  await pageB.waitForFunction(() => document.getElementById('remMask').classList.contains('hidden'), undefined, { timeout: 8000 }); // 成功才收面板
  await pageB.waitForTimeout(1500); // B 端 insertRemLine 后的 saveLocal(800ms) 落定

  // A 端等两轮 poll（POLL_INTERVAL=2000）+ 打标 400ms + linkify 防抖余量
  await pageA.waitForTimeout(5200);

  // 断言：A 不弹冲突条、正文完整、无页面错误
  const st = await pageA.evaluate(() => ({
    remoteBar: document.getElementById('remoteBar').classList.contains('hidden'),
    draftBar: document.getElementById('draftBar').classList.contains('hidden'),
    body: document.getElementById('editor').textContent,
    status: document.getElementById('statustext').textContent,
  }));
  assert.strictEqual(st.remoteBar, true, 'A 端不得弹远端冲突条（v7.1.0 装饰等价根修）');
  assert.strictEqual(st.draftBar, true, 'A 端不得弹草稿冲突条');
  assert.ok(st.body.indexOf('写周报') >= 0, 'A 端应同步到 B 回写的时间行: ' + JSON.stringify(st.body));
  assert.strictEqual(pageA.__errors.length, 0, 'A 端不应有页面错误: ' + pageA.__errors.join(' | '));
  assert.strictEqual(pageB.__errors.length, 0, 'B 端不应有页面错误: ' + pageB.__errors.join(' | '));
  await ctxA.close(); await ctxB.close();
  pageA = pageB = null;
}));

// ── V71-2：确定性复现——打标 DOM + 远端 v 再 +1 不弹冲突条 ──────────
test('V71-2 打标重写后远端 v+1：装饰等价不弹冲突条（旧版必弹的确定性复现）', guard(async () => {
  const pass = PASS;
  const salt = crypto.randomBytes(16).toString('base64');
  const key = derive(pass, salt);
  const body1 = seal(key, '<div>1</div>');
  const at = (() => { const d = new Date(Date.now() + 86400e3); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 30).getTime(); })();
  const remIv = crypto.randomBytes(12);
  const rc = crypto.createCipheriv('aes-256-gcm', key, remIv);
  const remCt = Buffer.concat([rc.update(JSON.stringify({ list: [{ at: at, text: '写周报', fired: false }] }), 'utf8'), rc.final(), rc.getAuthTag()]).toString('base64');
  const rem = JSON.stringify({ ct: remCt, iv: remIv.toString('base64') });
  const tomorrowStr = (() => { const d = new Date(Date.now() + 86400e3); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
  const body2 = seal(key, '<div>' + tomorrowStr + ' 10:30　写周报</div>');

  const note1 = { salt: salt, v: 1, ct: body1.ct, iv: body1.iv };
  await unlockOn(page, 'V71Mark', note1);
  assert.ok(true, '解锁载入 v1');

  // 第一级：远端 v2 = 含时间行正文 + rem → poll 应用后 linkify 打标改写 DOM
  const note2 = { salt: salt, v: 2, ct: body2.ct, iv: body2.iv, rem: rem };
  await page.route('**/api/note/V71Mark', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(note2) });
    return route.continue();
  });
  await page.waitForFunction(() => document.querySelectorAll('#editor u.rem-mark').length >= 1, undefined, { timeout: 10000 });
  await page.waitForTimeout(600); // 打标落地

  // 第二级：远端 v3（正文同 v2）→ 旧版把打标 DOM 判为「本机未保存修改」弹冲突条
  const note3 = { salt: salt, v: 3, ct: body2.ct, iv: body2.iv, rem: rem };
  await page.unroute('**/api/note/V71Mark');
  await page.route('**/api/note/V71Mark', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(note3) });
    return route.continue();
  });
  await page.waitForTimeout(5200); // 两轮 poll

  const st = await page.evaluate(() => ({
    remoteBar: document.getElementById('remoteBar').classList.contains('hidden'),
    status: document.getElementById('status').textContent,
    marks: document.querySelectorAll('#editor u.rem-mark').length,
    body: document.getElementById('editor').textContent,
  }));
  assert.strictEqual(st.remoteBar, true, '打标重写 + 远端更新并存时不得弹冲突条（装饰等价根修核心断言）');
  assert.ok(st.marks >= 1, '时间行应保持下划线标记');
  assert.ok(st.body.indexOf('写周报') >= 0, '正文应完整: ' + JSON.stringify(st.body));
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
  await page.unroute('**/api/note/V71Mark');
}));

// ── V71-3：UI 四修（X 关闭 / 滚动容器 / PC 聚焦）────────────────────
test('V71-3 X 关闭、列表滚动容器、仅 PC 聚焦事项输入框', guard(async () => {
  await unlockOn(page, 'V71Ui');

  // ① 桌面端打开面板：最终焦点 = #remBoxForm .rem-item（focusRemItemInput A 方案）
  await page.click('#remBtn');
  await page.waitForSelector('#remBoxForm button', { timeout: 5000 });
  const foc = await page.evaluate(() => ({
    item: document.activeElement === document.querySelector('#remBoxForm .rem-item'),
    tag: document.activeElement.tagName,
  }));
  assert.ok(foc.item, '桌面端面板应聚焦事项输入框（got ' + foc.tag + '）');

  // ② remPanelX 是 div 伪按钮且在 #remBoxForm 之外；点击关面板
  const xinfo = await page.evaluate(() => {
    const x = document.getElementById('remPanelX');
    const form = document.getElementById('remBoxForm');
    return { tag: x.tagName, cls: x.className, outside: !form.contains(x), beforeForm: x.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false };
  });
  assert.strictEqual(xinfo.tag, 'DIV', 'remPanelX 必须是 div 伪按钮（v5.39 铁律）');
  assert.strictEqual(xinfo.cls, 'box-x', 'remPanelX 应复用 .box-x');
  assert.ok(xinfo.outside && xinfo.beforeForm, 'remPanelX 必须在 #remBoxForm 之外（v63 裸选择器约束）');
  await page.click('#remPanelX');
  await page.waitForFunction(() => document.getElementById('remMask').classList.contains('hidden'), undefined, { timeout: 4000 });

  // ③ 列表滚动容器：overflow-y:auto + 限高
  const scroll = await page.evaluate(() => {
    const card = getComputedStyle(document.getElementById('remCardList'));
    const box = getComputedStyle(document.getElementById('remBoxList'));
    return { cardOv: card.overflowY, cardMax: parseFloat(card.maxHeight), boxOv: box.overflowY, boxMax: parseFloat(box.maxHeight) };
  });
  assert.strictEqual(scroll.cardOv, 'auto', '#remCardList 应 overflow-y:auto');
  assert.strictEqual(scroll.boxOv, 'auto', '#remBoxList 应 overflow-y:auto');
  assert.ok(scroll.cardMax > 0 && scroll.cardMax <= 440, '#remCardList 限高应生效: ' + scroll.cardMax);
  assert.ok(scroll.boxMax > 0 && scroll.boxMax <= 440, '#remBoxList 限高应生效: ' + scroll.boxMax);

  // ④ remCard X 关闭卡片（showRemCard 真实弹出）
  await page.evaluate(() => { showRemCard([{ at: Date.now() - 60000, text: '迟到的事', fired: true }], true); });
  await page.waitForFunction(() => !document.getElementById('remCard').classList.contains('hidden'), undefined, { timeout: 4000 });
  const cx = await page.evaluate(() => {
    const x = document.getElementById('remCardX');
    return { tag: x.tagName, cls: x.className, pos: getComputedStyle(x).position };
  });
  assert.strictEqual(cx.tag, 'DIV', 'remCardX 必须是 div 伪按钮');
  assert.strictEqual(cx.cls, 'box-x', 'remCardX 应复用 .box-x');
  assert.strictEqual(cx.pos, 'absolute', 'remCardX 应绝对定位右上');
  await page.click('#remCardX');
  await page.waitForFunction(() => document.getElementById('remCard').classList.contains('hidden'), undefined, { timeout: 4000 });
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
}));
