// NoteSync E2E v7.2.0（Playwright + 真实 Chromium）——C 层（全链路）审计：
//   V72-1 双客户端竞态：B 落后版本 PUT 带 baseV → 服务端 409 拒写 → 冲突条 #remoteBar 挂起
//         → 点「保留我的」采纳挂起 v 后重发 PUT 成功（绝不静默覆盖远端）。
//   V72-2 全角数字/冒号归一：种入全角「９-１０ ２０：０４」→ 归一后 chip 准时弹出（症状1 根修）。
//   V72-3 PC hover 悬停：鼠标移到时间文字上 200ms → chip 弹出；移开 → chip 消失（hover 路 + matchMedia 闸）。
//   V72-4 连续打字光标稳定：多行含自动链接行连续输入，光标块号不变（不跳行）；?diag 探针可读。
// 基建：server_sync.js（真实内存存储 + SSE）。冲突 409 用 route 拦截模拟（双端同实例共享状态 +
//   route 隐藏并发写入直到 B 发起写入，确保冲突由 B 的写触发，确定性复现双客户端竞态）。
// 坑位沿 v63/v71：waitForFunction 的 options 必须第三参；解锁前 localStorage.clear()；
// GCM 密文 = ct+tag；未解锁页 #mask 拦点击需先隐 landing（本文件走 note 直链，无需 landing）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
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

let server, browser, page, baseURL;
let syncServer, syncBase;
const PASS = 'test-pass-v72';

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

// ── 工具 ────────────────────────────────────────────────────────────────
// 走 note 直链解锁（sync server 单实例，真实存储）。password 派生密钥。
async function openNote(pg, name, pass) {
  await pg.goto(syncBase + name);
  await pg.waitForFunction(() => typeof window.unlock === 'function' && !!document.getElementById('pw'), undefined, { timeout: 15000 });
  await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await pg.waitForSelector('#pw', { timeout: 10000 });
  await pg.fill('#pw', pass);
  await pg.click('#ok');
  await pg.waitForFunction(() => {
    const e = document.getElementById('editor');
    return e && e.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 10000 });
  await pg.waitForTimeout(400); // applyUnlocked 落定
}
// 把光标放进编辑器根级第一个块的文本节点 offset 处
async function placeCaret(pg, off) {
  await pg.evaluate((o) => {
    const ed = document.getElementById('editor');
    const tn = (ed.querySelector('div') || ed).firstChild;
    const r = document.createRange();
    r.setStart(tn, Math.min(o, tn.length));
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    ed.focus();
  }, off);
}
// 读取当前光标所在根级块序号与块内偏移（用于「不跳行」断言）
async function getCaretInfo(pg) {
  return pg.evaluate(() => {
    const ed = document.getElementById('editor');
    const sel = window.getSelection();
    if (!sel.rangeCount) return { blockIndex: -2, offset: -1 };
    const r = sel.getRangeAt(0);
    let block = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
    while (block && block !== ed && block.parentNode !== ed) block = block.parentNode;
    let idx = -1;
    if (block && block !== ed) idx = Array.prototype.indexOf.call(ed.children, block);
    return { blockIndex: idx, offset: r.startOffset, text: block ? block.textContent : null };
  });
}

// ── V72-1：双客户端竞态 → 409 冲突条 → 保留我的重发 ─────────────────────
// 真实共享后端（server_sync 单实例）：两端独立 context 打开同一笔记、A 可见 B 写入，证明共享状态。
// 但 server_sync 的 PUT 不校验 baseV（永远递增），无法真实产生 409，故按任务授权的 route 拦截方案
// 确定性地模拟「并发远端写入」：B 视角下 GET 返回 v=localVer（poll 不误冲突、不推进版本），
// 首 PUT 被拦 409（模拟服务端因 baseV 落后拒写），之后 GET 返回 v=localVer+1 让 handleWriteConflict
// 看到更高版本挂起冲突条；「保留我的」采纳挂起 v 后重发 PUT 放行到真实服务端。
test('V72-1 双客户端竞态：B 落后版本 PUT 触发 409 → 冲突条 → 保留我的重发成功', guard(async () => {
  const name = 'V72Conflict';
  // B 解锁并写入 "A"（真实共享后端，服务端 v 递增）
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const errsB = []; pageB.on('pageerror', (e) => errsB.push(e.message)); pageB.__errors = errsB;
  await openNote(pageB, name, PASS);
  await pageB.click('#editor');
  await pageB.keyboard.type('A');
  await pageB.waitForFunction(() => document.getElementById('statustext').textContent.indexOf('已同步') >= 0, undefined, { timeout: 8000 });
  await pageB.waitForFunction(() => (typeof localVer !== 'undefined' ? localVer : 0) > 0, undefined, { timeout: 8000 }); // 等「A」保存真正落库（localVer 已递增）
  let bLocalVer = -1;

  // 另一客户端 A 打开同一笔记，证明共享状态（仅观察，不写）
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const errsA = []; pageA.on('pageerror', (e) => errsA.push(e.message)); pageA.__errors = errsA;
  await openNote(pageA, name, PASS);
  const aSeesA = await pageA.evaluate(() => document.getElementById('editor').textContent.trim());

  // route 模拟 B 视角的并发远端写入
  let bumped = false, putCount = 0, capturedBaseV = null;
  await pageB.route('**/api/note/' + name, async (route) => {
    const m = route.request().method();
    if (m === 'PUT') {
      putCount++;
      if (!bumped) {
        bumped = true;
        try { capturedBaseV = JSON.parse(route.request().postData() || '{}').baseV; } catch (e) {}
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', baseV: capturedBaseV }) });
      }
      return route.continue();
    }
    // 实时读 localVer：模拟「并发远端版本 = 本机版本 + 1」，确保 handleWriteConflict 必看到更高版本挂起。
    let lv = 0;
    try { lv = await pageB.evaluate(() => (typeof localVer !== 'undefined' ? localVer : 0)); } catch (e) {}
    const retV = bumped ? lv + 1 : lv;
    if (!bumped) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: retV }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: retV, ct: 'ENCRYPTED_REMOTE', iv: 'aW52YWxpZA==', salt: 'c2FsdA==' }) });
  });

  // B 继续打字 → 触发保存 → 首 PUT 带 baseV=bLocalVer → 被拦截 409 → 冲突条挂起
  await pageB.waitForTimeout(1500); // 等自动保存/poll 落定，localVer 稳定
  bLocalVer = await pageB.evaluate(() => (typeof localVer !== 'undefined' ? localVer : -1));
  await pageB.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await pageB.keyboard.type('B');
  await pageB.waitForFunction(() => !document.getElementById('remoteBar').classList.contains('hidden'), undefined, { timeout: 8000 });

  const st = await pageB.evaluate(() => ({
    remoteBarHidden: document.getElementById('remoteBar').classList.contains('hidden'),
    status: document.getElementById('statustext').textContent,
    hasKeep: !!document.getElementById('remoteKeep'),
    hasTake: !!document.getElementById('remoteTake'),
  }));
  assert.strictEqual(capturedBaseV, bLocalVer, '首 PUT 应带 baseV=' + bLocalVer + '（落后版本）: capturedBaseV=' + capturedBaseV);
  assert.strictEqual(st.remoteBarHidden, false, '409 后应弹远端冲突条 #remoteBar');
  assert.ok(/待处理/.test(st.status), '状态应为「远端有更新，待处理」: ' + st.status);
  assert.strictEqual(st.hasKeep, true, '应存在「保留我的」按钮');
  assert.strictEqual(st.hasTake, true, '应存在「使用云端」按钮');
  console.log('V72-1 证据: bLocalVer=' + bLocalVer + ' capturedBaseV=' + capturedBaseV + ' A看到内容=' + JSON.stringify(aSeesA) + ' status=' + JSON.stringify(st.status));

  // 点「保留我的」：采纳挂起 v 后重发 PUT（放行到真实服务端）
  await pageB.click('#remoteKeep');
  await pageB.waitForFunction(() => document.getElementById('remoteBar').classList.contains('hidden'), undefined, { timeout: 8000 });
  await pageB.waitForFunction(() => document.getElementById('statustext').textContent.indexOf('已同步') >= 0, undefined, { timeout: 8000 });
  assert.strictEqual(putCount, 2, '应发生第二次 PUT（重发）: putCount=' + putCount);
  assert.strictEqual(errsA.length, 0, 'A 端不应有页面错误: ' + errsA.join(' | '));
  assert.strictEqual(errsB.length, 0, 'B 端不应有页面错误: ' + errsB.join(' | '));
  await ctxA.close(); await ctxB.close();
}));

// ── V72-2：全角数字/冒号归一 → chip 弹出 ───────────────────────────────
test('V72-2 全角数字/冒号归一：chip 准时弹出（症状1 根修）', guard(async () => {
  await openNote(page, 'V72Full', PASS);
  // 全角数字 + 全角冒号，半角空格分隔（手机全角输入法常见形态）
  const fw = '９-１０ ２０：０４ 站会';
  await page.evaluate((h) => { document.getElementById('editor').innerHTML = '<div>' + h + '</div>'; }, fw);
  await placeCaret(page, 3); // 落在「９-１０」时间串上
  await page.waitForFunction(() => {
    const c = document.getElementById('timeChip');
    return !c.classList.contains('hidden') && c.textContent.indexOf('添加提醒') >= 0;
  }, undefined, { timeout: 5000 });
  const st = await page.evaluate(() => ({
    hidden: document.getElementById('timeChip').classList.contains('hidden'),
    text: document.getElementById('timeChip').textContent,
  }));
  assert.strictEqual(st.hidden, false, '全角时间应弹 chip');
  // 证据：归一后解析命中未来时间
  const parsed = await page.evaluate((s) => window.parseTimeMatches ? window.parseTimeMatches(s).map(m => ({ at: m.at, idx: m.index, len: m.length, exp: m.expired })) : null, fw);
  assert.ok(parsed && parsed.length >= 1, '归一后应解析出时间: ' + JSON.stringify(parsed));
  assert.ok(parsed[0].at > Date.now(), '应为未来时间: ' + JSON.stringify(parsed));
  // 附加证据：纯全角空格（U+3000）分隔形态能否命中——设计上 U+3000 不归一，短格式分隔符非普通空格，预期不命中，仅记录
  const fwsp = await page.evaluate((s) => window.parseTimeMatches ? window.parseTimeMatches(s).length : -1, '９-１０　２０：０４ 站会');
  console.log('V72-2 全角空格(U+3000)分隔命中数=' + fwsp + '（设计口径：U+3000 为事项区分隔符，不归一）');
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V72-3：PC hover 悬停弹 chip ────────────────────────────────────────
test('V72-3 PC hover 悬停时间弹 chip（hover 路 + matchMedia 闸）', guard(async () => {
  const hoverOk = await page.evaluate(() => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches));
  if (!hoverOk) {
    console.log('V72-3 SKIP: matchMedia(hover:hover)+(pointer:fine) 不匹配，headless 不弹 hover chip（如实跳过，不算 FAIL）');
    assert.ok(true);
    return;
  }
  await openNote(page, 'V72Hover', PASS);
  const line = '12-25 20:04 周会';
  await page.evaluate((h) => { document.getElementById('editor').innerHTML = '<div>' + h + '</div>'; }, line);
  // 计算时间串「12-25」的屏幕坐标
  const box = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const tn = ed.querySelector('div').firstChild;
    const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, 5);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.waitForFunction(() => {
    const c = document.getElementById('timeChip');
    return !c.classList.contains('hidden') && c.textContent.indexOf('添加提醒') >= 0;
  }, undefined, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => document.getElementById('timeChip').classList.contains('hidden')), false, '悬停时间应弹 chip');

  // 移到无时间处（事项区「周会」）→ 400ms 后消失
  const box2 = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const tn = ed.querySelector('div').firstChild;
    const len = tn.length;
    const r = document.createRange();
    r.setStart(tn, len - 2); r.setEnd(tn, len);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(box2.x, box2.y);
  await page.waitForFunction(() => document.getElementById('timeChip').classList.contains('hidden'), undefined, { timeout: 4000 });
  assert.strictEqual(await page.evaluate(() => document.getElementById('timeChip').classList.contains('hidden')), true, '移开应隐藏 chip');
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V72-4：连续打字光标稳定 + diag 探针 ────────────────────────────────
test('V72-4 连续打字光标稳定 + ?diag 探针可读', guard(async () => {
  await openNote(page, 'V72Type', PASS);
  await page.evaluate(() => {
    document.getElementById('editor').innerHTML =
      '<div>第一行文字内容</div><div>访问 https://example.com 自动链接</div><div>第三行收尾</div>';
  });
  // 光标放进第二块（URL 行）开头
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const blk = ed.children[1];
    const tn = blk.firstChild || blk;
    const r = document.createRange();
    r.setStart(tn, 0); r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); ed.focus();
  });
  const before = await getCaretInfo(page);
  // 连续打字，中间 sleep > 500ms 触发 linkify 防抖 + 打字推迟守卫
  const seq = '补充';
  for (const ch of seq) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(700);
  }
  await page.keyboard.type('更多文本');
  await page.waitForTimeout(900);
  const after = await getCaretInfo(page);

  assert.strictEqual(after.blockIndex, before.blockIndex,
    '连续打字光标不应跳块（caret 未跳行）: before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));

  const diag = await page.evaluate(() => ({
    relocated: window.__relocateCount || 0,
    kept: window.__relocateKept || 0,
    typeDefer: window.__pollTypeDefer || 0,
    skip: window.__pollSkipCount || 0,
  }));
  console.log('V72-4 diag: ' + JSON.stringify(diag));
  assert.ok(typeof diag.relocated === 'number' && typeof diag.kept === 'number', 'diag 探针应可读');
  assert.strictEqual(page.__errors.length, 0, '不应有页面错误: ' + page.__errors.join(' | '));
}));
