// NoteSync E2E v6.3（Playwright + 真实 Chromium）——覆盖 v6.3 浏览器路径高风险修复：
//   #1  过期时间不给添加入口（chip 不弹 / 面板 .bad 拦截且不关面板）
//   #2  提醒上限只数未来（10 条未来后面板+chip 双路拒绝第 11 条）
//   #3  已推送提醒：时间+事项整段 <s class="rem-done"> 删除线（真实 CSS 生效 + linkify 幂等）
//   #7  历史版本失效置灰（解不开→hist-bad；网络异常→不置灰只提示重试），Playwright 路由喂坏密文
//   #9  返回首页单击直达（桌面真实 click 正常到达，menuTapGuard 不吞不重放）
//   #11 Shift+方向键可跨空行选中（clamp 只在三连击后武装，普通键盘选区不再被截断）
// 结构复用 userbugs.test.js / flow.test.js：setup/teardown + guard + failures + process.exit。
// 坑位备忘：
//   · Playwright waitForFunction 签名是 (fn, arg, options)——options 必须第三参。
//   · applyUnlocked 在 contentEditable=true 之后才 await loadReminder（内部清空 reminders），
//     解锁后直接种数据有竞态窗口 → unlockNote 统一等 400ms 落定；V63-3 干脆走真实解密路径喂数据。
//   · localStorage 残留 KEY_STORE 会让下一条笔记走 loadStoredKey 自动解锁（旧钥解新盐必败），
//     每次解锁前 localStorage.clear() 强制走口令路径。
//   · loadHistList 会把服务端列表 .reverse()（最新在上）——路由喂列表时要倒着给。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { setup, teardown } = require('./harness');

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

before(async () => {
  ({ server, baseURL, browser } = await setup());
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
});

after(async () => {
  await teardown(browser, server);
  process.exit(failures > 0 ? 1 : 0);
});

// ── 工具 ────────────────────────────────────────────────────────────────
// 与 index.html parseTimeMatches 同构的时间格式（月/日不补零、分钟两位）
function fmtAbs(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
    d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}
// 面板 date input 用 YYYY-MM-DD（input[type=date] 只认补零形态）
function fmtDate(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 解锁进入笔记。noteBody 可选：用路由拦截 GET /api/note/<name> 返回自定义 JSON
// （如带固定盐+加密 rem 的笔记体），解锁口令固定 test-pass-v63。
async function unlockNote(name, noteBody) {
  let routed = false;
  if (noteBody) {
    await page.route('**/api/note/' + name, (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(noteBody) });
      return route.continue();
    });
    routed = true;
  }
  try {
    await page.goto(baseURL);
    await page.waitForSelector('#landingInput', { timeout: 15000 });
    // 清残留密钥/笔记名：否则 loadStoredKey() 自动解锁拿旧钥解新盐，rem 必解不开
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await page.fill('#landingInput', name);
    await page.click('#landingBtn');
    await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(name), { timeout: 10000 });
    await page.waitForSelector('#editor');
    await page.fill('#pw', 'test-pass-v63');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', undefined, { timeout: 10000 });
    // applyUnlocked 在 contentEditable=true 之后才 await loadReminder（清空 reminders）——等落定
    await page.waitForTimeout(400);
  } finally {
    if (routed) await page.unroute('**/api/note/' + name);
  }
}

// 把光标放进编辑器根级第一个块的文本节点 offset 处（真实 selectionchange → chip 链路）
async function placeCaret(offset) {
  await page.evaluate((off) => {
    const ed = document.getElementById('editor');
    const tn = (ed.querySelector('div') || ed).firstChild;
    const r = document.createRange();
    r.setStart(tn, Math.min(off, tn.length));
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    ed.focus();
  }, offset);
}

// ── V63-1：#1/#4 chip 链路 ─────────────────────────────────────────────
test('V63-1 过期时间 chip 不弹；未来时间弹 chip，点击添加出确认卡（#1/#4）', guard(async () => {
  await unlockNote('ChipTest');
  const pastStr = fmtAbs(Date.now() - 3600e3);
  const futureStr = fmtAbs(Date.now() + 86400e3);

  // 过期：光标落在时间上，chip 必须保持隐藏（不给添加入口，含 30s 阈值口径）
  await page.evaluate((h) => { document.getElementById('editor').innerHTML = h; }, '<div>' + pastStr + ' 交接</div>');
  await placeCaret(3);
  await page.waitForTimeout(700); // chip 防抖 250ms + 余量
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('timeChip').classList.contains('hidden')),
    true,
    '过期时间不应弹 chip'
  );

  // 未来：chip 弹出且带「添加提醒」CTA
  await page.evaluate((h) => { document.getElementById('editor').innerHTML = h; }, '<div>' + futureStr + ' 站会</div>');
  await placeCaret(3);
  await page.waitForFunction(() => {
    const c = document.getElementById('timeChip');
    return !c.classList.contains('hidden') && c.textContent.indexOf('添加提醒') >= 0;
  }, undefined, { timeout: 4000 });

  // 点击 chip → await addReminder 成功 → 两行确认卡（不再与失败提示同屏打架）
  await page.click('#timeChip');
  await page.waitForFunction(() => document.getElementById('timeChip').textContent.indexOf('已添加') >= 0, undefined, { timeout: 4000 });
  const st = await page.evaluate(() => ({
    n: reminders.length,
    text: reminders[0] && reminders[0].text,
    hidden: document.getElementById('timeChip').classList.contains('hidden'),
  }));
  assert.strictEqual(st.n, 1, 'chip 添加后应有 1 条提醒');
  assert.strictEqual(st.text, '站会', '事项应取时间同行后文');
  assert.strictEqual(st.hidden, false, '成功后 3 秒内应显示确认卡');
  assert.strictEqual(page.__errors.length, 0, 'chip 链路不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V63-2：#1 面板链路 ─────────────────────────────────────────────────
test('V63-2 面板：过去时间拒绝且面板不关；未来成功收面板并回写正文（#1）', guard(async () => {
  await unlockNote('PanelTest');
  await page.evaluate(() => { document.getElementById('editor').innerHTML = '<div>锚点</div>'; });
  await placeCaret(1); // 打开面板前保存选区，供 insertRemLine 回写正文

  await page.click('#remBtn');
  await page.waitForSelector('#remBoxForm button', { timeout: 5000 });

  // 过去：日期改昨天 → 点添加 → 面板保持打开，不产生提醒
  await page.evaluate((d) => { document.querySelector('#remBoxForm input[type=date]').value = d; }, fmtDate(Date.now() - 86400e3));
  await page.click('#remBoxForm button');
  await page.waitForTimeout(400);
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('remMask').classList.contains('hidden')),
    false,
    '过去时间添加被拒后面板应保持打开'
  );
  assert.strictEqual(await page.evaluate(() => reminders.length), 0, '过去时间不应产生提醒');

  // 未来：成功 → 面板收起 + 正文回写「时间　事项」
  await page.evaluate((d) => { document.querySelector('#remBoxForm input[type=date]').value = d; }, fmtDate(Date.now() + 86400e3));
  await page.fill('#remBoxForm .rem-item', '写周报');
  await page.click('#remBoxForm button');
  await page.waitForFunction(() => document.getElementById('remMask').classList.contains('hidden'), undefined, { timeout: 5000 });
  const st2 = await page.evaluate(() => ({
    n: reminders.length,
    text: reminders[0] && reminders[0].text,
    body: document.getElementById('editor').textContent,
  }));
  assert.strictEqual(st2.n, 1, '未来时间应成功添加 1 条');
  assert.strictEqual(st2.text, '写周报');
  assert.ok(st2.body.indexOf('写周报') >= 0, '面板添加成功应回写正文光标处: ' + JSON.stringify(st2.body));
  assert.strictEqual(page.__errors.length, 0, '面板链路不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V63-3：#2 上限只数未来 ─────────────────────────────────────────────
test('V63-3 10 条未来后，面板与 chip 双路拒绝第 11 条（#2）', guard(async () => {
  // 不直接种数据（有 loadReminder 清空竞态），改走真实解密路径：路由喂「固定盐+加密 rem」，
  // Node 侧用与 deriveKey 同构的 PBKDF2(200k,SHA-256)+AES-256-GCM 造密文。
  const pass = 'test-pass-v63';
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, 200000, 32, 'sha256');
  const list = [];
  for (let i = 1; i <= 10; i++) list.push({ at: Date.now() + 86400e3 + i * 3600e3, text: 't' + i, fired: false });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ctBuf = Buffer.concat([c.update(JSON.stringify({ list }), 'utf8'), c.final(), c.getAuthTag()]); // WebCrypto 密文=ct+tag
  const noteBody = {
    salt: salt.toString('base64'),
    v: 7,
    rem: JSON.stringify({ ct: ctBuf.toString('base64'), iv: iv.toString('base64') }),
  };
  await unlockNote('MaxTest', noteBody);
  assert.strictEqual(await page.evaluate(() => reminders.length), 10, '喂入的 10 条提醒应经真实解密载入');

  await page.click('#remBtn');
  await page.waitForSelector('#remBoxForm button', { timeout: 5000 });

  // 面板路径：拒绝 + 面板不关 + 列表不变
  await page.evaluate((d) => { document.querySelector('#remBoxForm input[type=date]').value = d; }, fmtDate(Date.now() + 86400e3));
  await page.fill('#remBoxForm .rem-item', '第11条');
  await page.click('#remBoxForm button');
  await page.waitForFunction(() => document.getElementById('uploadStatus').textContent.indexOf('提醒最多') === 0, undefined, { timeout: 5000 });
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('remMask').classList.contains('hidden')),
    false,
    '上限拒绝后面板不应收起（v6.3：只有成功才收）'
  );
  assert.strictEqual(await page.evaluate(() => reminders.length), 10, '第 11 条不应被加入');

  // chip 路径：拒绝 + chip 收起
  await page.evaluate(() => { toggleRemPanel(false); });
  await page.evaluate((h) => { document.getElementById('editor').innerHTML = h; }, '<div>' + fmtAbs(Date.now() + 2 * 3600e3) + ' 复盘</div>');
  await placeCaret(3);
  await page.waitForFunction(() => !document.getElementById('timeChip').classList.contains('hidden'), undefined, { timeout: 4000 });
  await page.click('#timeChip');
  await page.waitForFunction(() => document.getElementById('uploadStatus').textContent.indexOf('提醒最多') === 0, undefined, { timeout: 5000 });
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('timeChip').classList.contains('hidden')),
    true,
    '上限拒绝后 chip 应收起（不再弹「已添加」假卡）'
  );
  assert.strictEqual(await page.evaluate(() => reminders.length), 10, 'chip 路径同样不应突破上限');
  assert.strictEqual(page.__errors.length, 0, '上限链路不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V63-4：#3 已推送删除线 ─────────────────────────────────────────────
test('V63-4 已推送提醒：时间+事项整段 s.rem-done 删除线且 linkify 幂等（#3）', guard(async () => {
  await unlockNote('StrikeTest');
  // 与 parseTimeMatches 完全同构的解析，保证 reminders.at 与正文文本解析值逐位一致
  const seg = await page.evaluate(() => {
    const d = new Date(Date.now() - 3600e3);
    const str = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
      d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime();
    return { str, at };
  });
  await page.evaluate((s) => {
    document.getElementById('editor').innerHTML = '<div>' + s.str + '　交接文档</div>';
    reminders.push({ at: s.at, text: '交接文档', fired: true });
    linkifyEditor();
  }, seg);
  await page.waitForSelector('#editor s.rem-done', { timeout: 5000 });
  const st = await page.evaluate(() => {
    const s = document.querySelector('#editor s.rem-done');
    return {
      txt: s.textContent,
      deco: getComputedStyle(s).textDecorationLine,
      marks: document.querySelectorAll('#editor u.rem-mark').length,
      count: document.querySelectorAll('#editor s.rem-done').length,
    };
  });
  assert.ok(st.txt.indexOf(seg.str) === 0 && st.txt.indexOf('交接文档') > 0, '删除线应覆盖时间+事项整段: ' + JSON.stringify(st.txt));
  assert.strictEqual(st.deco, 'line-through', '真实 CSS 应生效（text-decoration）');
  assert.strictEqual(st.marks, 0, '已推送条目不应再留下划线');
  // 幂等：再跑一轮 linkify，删除线拆掉重建后仍恰好 1 条、内容不变
  await page.evaluate(() => { linkifyEditor(); });
  const st2 = await page.evaluate(() => ({
    count: document.querySelectorAll('#editor s.rem-done').length,
    txt: (document.querySelector('#editor s.rem-done') || { textContent: '' }).textContent,
  }));
  assert.strictEqual(st2.count, 1, '重复 linkify 不应产生重复或丢失');
  assert.strictEqual(st2.txt, st.txt, '重建后删除线内容应不变');
  assert.strictEqual(page.__errors.length, 0, '删除线链路不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V63-5：#11 Shift+方向键跨空行 ──────────────────────────────────────
test('V63-5 Shift+向下/向右可跨过空行选中第三行（#11）', guard(async () => {
  await unlockNote('SelTest');
  const setCaretEnd = () => page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = 'AAA<div><br></div><div>BBB</div>';
    const tn = ed.firstChild;
    const r = document.createRange();
    r.setStart(tn, 3);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    ed.focus();
  });
  await setCaretEnd();
  // 向下：≤3 次内必须能选到第三行 BBB（回归：此前 clamp 每次 selectionchange 都跑会截断跨块选区）
  let got = '';
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Shift+ArrowDown');
    got = await page.evaluate(() => window.getSelection().toString());
    if (got.indexOf('BBB') >= 0) break;
  }
  assert.ok(got.indexOf('BBB') >= 0, 'Shift+向下应能跨过空行选中第三行: ' + JSON.stringify(got));

  await setCaretEnd();
  // 向右：≤8 次内必须能跨过空行进入第三行
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+ArrowRight');
    got = await page.evaluate(() => window.getSelection().toString());
    if (got.indexOf('BBB') >= 0) break;
  }
  assert.ok(got.indexOf('BBB') >= 0, 'Shift+向右应能跨过空行选中第三行: ' + JSON.stringify(got));
  assert.strictEqual(await page.evaluate(() => window.getSelection().isCollapsed), false, '选区不应塌缩');
}));

// ── V63-6：#7 历史版本失效置灰 vs 网络异常区分 ─────────────────────────
test('V63-6 历史版本：密文解不开置灰，网络异常只提示重试（#7）', guard(async () => {
  await unlockNote('HistTest');
  const T_OK1 = Date.now() - 60000, T_OK2 = Date.now() - 120000, T_NET = Date.now() - 180000;
  // loadHistList 对服务端列表 .reverse()（最新在上）——倒着喂使行序=最新在上：
  // row0=T_OK1(预览→置灰) row1=T_OK2(恢复→置灰) row2=T_NET(网络异常→不置灰)
  await page.route('**/history', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ list: [ { ts: T_NET, manual: false }, { ts: T_OK2, manual: false }, { ts: T_OK1, manual: true } ] }),
    });
  });
  await page.route('**/history/*', (route) => {
    const m = route.request().url().match(/history\/(\d+)$/);
    if (m && +m[1] === T_NET) return route.abort();
    // ct=base64('ABCDEFG') 7 字节 < 16 字节 GCM tag → decryptText 必抛 → 走「该版本不可用」通道
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ct: 'QUJDREVGRw==', iv: 'MTIzNDU2' }) });
  });

  await page.click('#menuBtn');
  await page.waitForSelector('#menuHistEntry', { timeout: 5000 });
  await page.click('#menuHistEntry');
  await page.waitForFunction(() => document.querySelectorAll('#menuHistList .hist-item').length === 3, undefined, { timeout: 8000 });
  const rows = page.locator('#menuHistList .hist-item');

  // 1) 网络异常：只提示重试，不置灰（可重试语义）
  await rows.nth(2).locator('button', { hasText: '预览' }).click();
  await page.waitForFunction(() => document.getElementById('uploadStatus').textContent.indexOf('网络异常') >= 0, undefined, { timeout: 8000 });
  const netRow = await page.evaluate(() => {
    const r = document.querySelectorAll('#menuHistList .hist-item')[2];
    return { bad: r.classList.contains('hist-bad'), disabled: r.querySelector('button').disabled };
  });
  assert.strictEqual(netRow.bad, false, '网络异常不应置灰（用户可重试）');
  assert.strictEqual(netRow.disabled, false, '网络异常不应禁用按钮');

  // 2) 密文解不开：置灰 + 双按钮禁用 + meta 追加「不可用」
  await rows.nth(0).locator('button', { hasText: '预览' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#menuHistList .hist-item')[0].classList.contains('hist-bad'), undefined, { timeout: 5000 });
  const badRow = await page.evaluate(() => {
    const r = document.querySelectorAll('#menuHistList .hist-item')[0];
    return {
      meta: r.querySelector('.hist-meta').textContent,
      pvDisabled: r.querySelectorAll('button')[0].disabled,
      rsDisabled: r.querySelectorAll('button')[1].disabled,
    };
  });
  assert.ok(badRow.meta.indexOf('不可用') >= 0, 'meta 应追加「不可用」: ' + badRow.meta);
  assert.strictEqual(badRow.pvDisabled, true, '失效版本预览按钮应禁用');
  assert.strictEqual(badRow.rsDisabled, true, '失效版本恢复按钮应禁用');

  // 3) 恢复路径同样置灰（同一条 catch 通道）
  await rows.nth(1).locator('button', { hasText: '恢复' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#menuHistList .hist-item')[1].classList.contains('hist-bad'), undefined, { timeout: 5000 });

  await page.unroute('**/history');
  await page.unroute('**/history/*');
  assert.strictEqual(page.__errors.length, 0, '历史链路不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── V63-7：#9 返回首页单击直达（桌面回归） ─────────────────────────────
test('V63-7 返回首页：单击直达（#9）', guard(async () => {
  await page.goto(baseURL + 'NavTest');
  await page.waitForSelector('#menuBtn', { timeout: 15000 });
  // 未解锁页 #mask 会拦截指针——本测试不需要解锁，直接隐藏遮罩（flow.test.js 同套路）
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });
  await page.click('#menuBtn');
  await page.waitForSelector('#menuHome', { timeout: 5000 });
  await page.click('#menuHome'); // 只点一次
  await page.waitForFunction((base) => location.href === base, baseURL, { timeout: 8000 });
  assert.strictEqual(page.url(), baseURL, '一次点击应直接回到首页（tap guard 不应吞掉真实 click）');
}));
