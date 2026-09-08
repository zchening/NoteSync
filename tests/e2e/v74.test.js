// NoteSync E2E（Playwright + 真实 Chromium）—— v7.3.1「返回首页点了没反应」根因修复全旅程验证。
// 结构复用 flow.test.js：setup/teardown + guard + failures + process.exit + unhandledRejection 守卫。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

// 仅吞掉 Playwright/浏览器拆解阶段偶发的未处理 rejection（Windows 环境），不掩盖真实业务错误。
process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

let failures = 0;
function guard(fn) {
  return async (t) => {
    try {
      await fn(t);
    } catch (e) {
      failures++;
      throw e;
    }
  };
}

let server, browser, page, baseURL;

before(async () => {
  ({ server, baseURL, browser } = await setup());
  page = await browser.newPage();
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput', { timeout: 15000 });
});

after(async () => {
  await teardown(browser, server);
  if (failures > 0) process.exitCode = 1;
});

// ── V74E-1 根因X 全旅程（APK 环境）：冷启动自动进笔记 → 菜单返回首页 → 必须停在首页 ──
// 真实浏览器命中测试：注入 Capacitor stub + 预置 last note，验证「点返回首页 → assign('/') →
// init() 不再把用户弹回上次笔记」。jsdom 测不到导航，这条是根因X 唯一的行为闭环。
// 对抗终审加固：①unload 监听踢出 bfcache——否则首页从 bfcache 恢复时 init 不重跑，测试假绿；
// ②点击前清掉 init 冷启动自动跳转自设的标记——否则「新鲜标记唯一来源」是 init 而非 menuHome，
//    删掉 handler 打标测试也绿；③返回后等待 2s 防慢速异步弹回。
test('V74E-1 APK 返回首页不被弹回（根因X全旅程）', guard(async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true };
    window.addEventListener('unload', () => {}); // 踢出 bfcache：让首页 init 每次真实重跑
    localStorage.setItem('notesync_last_note', 'E2EHomeNote');
  });
  // 冷启动：根路径 → 自动跳上次笔记（v5.52 特性）
  await p.goto(baseURL);
  await p.waitForURL('**/E2EHomeNote', { timeout: 8000 });
  await p.waitForSelector('#menuBtn', { timeout: 15000 });
  // 无存储密钥 → 锁定遮罩 #mask 拦截指针，需先隐藏（V63-7 同套路）；本测试只验证跳转链路
  // 并清掉 init 自动跳转自设的标记——让「新鲜标记」的唯一来源变成 menuHome handler/pagehide
  await p.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
    sessionStorage.removeItem('notesync_jumped');
  });
  // 点菜单「返回首页」
  await p.click('#menuBtn');
  await p.waitForSelector('#menuHome', { timeout: 5000 });
  await p.click('#menuHome');
  await p.waitForFunction((b) => location.href === b, baseURL, { timeout: 8000 });
  await p.waitForTimeout(2000); // 若 init() 误判，会在此窗口内弹回上次笔记
  assert.strictEqual(p.url(), baseURL, '返回首页后必须停在首页（不被弹回上次笔记）');
  await ctx.close().catch(() => {});
}));

// ── V74E-2 v5.52 特性保留 + 设计行为：标记过期→自动进笔记；标记新鲜→停在首页 ──
// 对抗终审加固：原用例只测旧格式 '1'（必然过期），是"稻草人"——真实残留形态是上会话的
// 新鲜时间戳。现在双场景覆盖：A=过期时间戳放行（特性保留）；B=新鲜时间戳抑制（设计行为，
// 即「刚回过首页 120s 内重开」不再自动跳转）。unload 踢 bfcache 保证 init 真实重跑。
test('V74E-2 冷启动跳转按标记新鲜度分流（过期放行 / 新鲜抑制）', guard(async () => {
  // 场景 A：过期时间戳（跨冷启动残留 5 分钟）→ 冷启动仍自动进上次笔记
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true };
      window.addEventListener('unload', () => {});
      localStorage.setItem('notesync_last_note', 'E2EHomeNote2');
      sessionStorage.setItem('notesync_jumped', String(Date.now() - 5 * 60 * 1000));
    });
    await p.goto(baseURL);
    await p.waitForURL('**/E2EHomeNote2', { timeout: 8000 });
    assert.ok(p.url().indexOf('E2EHomeNote2') >= 0, '过期标记应放行冷启动自动跳转（v5.52 特性保留）');
    await ctx.close().catch(() => {});
  }
  // 场景 B：新鲜时间戳（刚回过首页 30s）→ 冷启动停在首页（设计行为）
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true };
      window.addEventListener('unload', () => {});
      localStorage.setItem('notesync_last_note', 'E2EHomeNote2b');
      sessionStorage.setItem('notesync_jumped', String(Date.now() - 30 * 1000));
    });
    await p.goto(baseURL);
    await p.waitForSelector('#landingInput', { timeout: 15000 });
    await p.waitForTimeout(1500); // 若 init 误判会在此窗口内弹回上次笔记
    assert.strictEqual(p.url(), baseURL, '新鲜标记（120s 窗口内）应抑制冷启动自动跳转，停在首页');
    await ctx.close().catch(() => {});
  }
}));

// ── V74E-3 根因Y 真实命中测试：冲突浮卡弹出时，菜单「返回首页」必须可点 ──
// jsdom 无命中测试；此条用真实 Chromium 验证 z90 菜单盖过 confcard(z55, pointer-events:auto)。
// 对抗终审加固：锁 1280x720 视口（命中几何确定性）+ unload 踢 bfcache（返回首页真实重载）。
test('V74E-3 冲突浮卡显示时菜单返回首页仍可点击（根因Y真实命中）', guard(async () => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseURL + 'E2EConflictNote');
  await page.waitForSelector('#menuBtn', { timeout: 15000 });
  // 未解锁页 #mask 会拦截指针——本测试不需要解锁，直接隐藏遮罩（flow.test.js 同套路）
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
    document.getElementById('remoteBar').classList.remove('hidden'); // 冲突浮卡显示（模拟冲突挂起）
    window.addEventListener('unload', () => {}); // 踢出 bfcache：返回首页时 init 真实重跑
  });
  await page.click('#menuBtn');
  await page.waitForSelector('#menuHome', { timeout: 5000 });
  // 真实命中断言（对抗审核补强）：菜单项中心点 elementFromPoint 必须命中 menuHome——
  // 证明 z90 菜单在渲染层盖过 z55 冲突浮卡（仅"点击成功"不足以排除浮卡挡截后的落点漂移）
  const hit = await page.evaluate(() => {
    const el = document.getElementById('menuHome');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const desc = top ? (top.id ? '#' + top.id : top.className ? '.' + String(top.className).split(' ')[0] : top.tagName) : 'null';
    return { desc, ok: !!top && (top.id === 'menuHome' || !!top.closest('#menuHome')) };
  });
  assert.strictEqual(hit.ok, true, '菜单项中心命中点必须落在 menuHome（实际命中: ' + hit.desc + '）');
  await page.click('#menuHome'); // 若 confcard 仍物理拦截，此点击会失败/打不到
  await page.waitForFunction((b) => location.href === b, baseURL, { timeout: 8000 });
  assert.strictEqual(page.url(), baseURL, '冲突卡显示时菜单返回首页必须可点（z90 盖过 confcard z55）');
}));

// ── V74E-4 返回键出口（第二现场）：深链/扫码进入的笔记 → Android 返回键 → 必须停在首页 ──
// 深链进入（扫码配对/分享链接/收藏夹）的笔记从不设跳转标记，旧版返回键落回首页时
// init() 冷启动自动跳转把用户弹回本笔记——笔记页 pagehide 打标后返回键出口不再被劫持。
// 对抗终审加固：unload 踢 bfcache——否则 goBack 从 bfcache 恢复首页、init 不重跑，URL 断言假绿。
test('V74E-4 深链进入笔记 → 返回键 → 停在首页（不被冷启动逻辑弹回）', guard(async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true };
    window.addEventListener('unload', () => {}); // 踢出 bfcache：goBack 后首页 init 真实重跑
  });
  await p.goto(baseURL); // 首页（无 last note → 不自动跳转，留出历史栈首项）
  await p.waitForSelector('#landingInput', { timeout: 15000 });
  // 深链进入笔记（模拟扫码/收藏夹）：init 会写 NOTE_LAST_KEY，但从不设跳转标记
  await p.goto(baseURL + 'E2EBackNote');
  await p.waitForSelector('#menuBtn', { timeout: 15000 });
  await p.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });
  // Android 返回键 = 历史回退 → 落回首页；若笔记页未打标，init() 会再弹回 E2EBackNote
  await p.goBack();
  await p.waitForTimeout(1200); // 给 init() 足够时间完成误判跳转
  assert.strictEqual(p.url(), baseURL, '返回键落回首页必须停留（不被弹回深链笔记）');
  const marker = await p.evaluate(() => Number(sessionStorage.getItem('notesync_jumped')));
  assert.ok(Number.isFinite(marker) && Date.now() - marker < 120000, '笔记页 pagehide 应已写入新鲜跳转标记');
  await ctx.close().catch(() => {});
}));

// ── V74E-5 口令框 X（maskClose）返回首页：锁定态 → X → 停在首页不被弹回 ──
// 根因X 的另一入口：锁定遮罩的 X 也回首页，且必须同样不被冷启动自动跳转弹回。
// 对抗终审加固：点击前清掉 init 自动跳转自设的标记 + unload 踢 bfcache + 等待 2s。
test('V74E-5 口令框 X 返回首页不被弹回（maskClose 路径全旅程）', guard(async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true };
    window.addEventListener('unload', () => {}); // 踢出 bfcache：返回首页时 init 真实重跑
    localStorage.setItem('notesync_last_note', 'E2EXNote');
  });
  await p.goto(baseURL);
  await p.waitForURL('**/E2EXNote', { timeout: 8000 }); // 冷启动自动进上次笔记
  await p.waitForSelector('#mask', { timeout: 15000 });
  // 清掉 init 自动跳转自设的标记——X 点击后的新鲜标记只能来自 maskClose handler/pagehide
  await p.evaluate(() => sessionStorage.removeItem('notesync_jumped'));
  await p.click('#maskClose'); // 锁定态口令框右上角 X
  await p.waitForFunction((b) => location.href === b, baseURL, { timeout: 8000 });
  await p.waitForTimeout(2000);
  assert.strictEqual(p.url(), baseURL, '口令框 X 返回首页后必须停留（不被弹回 E2EXNote）');
  await ctx.close().catch(() => {});
}));

// ── V74E-6 用户实报现场：手动输名进入（从未设标记）→ 菜单返回首页 → 必须停留 ──
// 这是用户上报「点了没反应」的原始入口形态：非冷启动进入的笔记从不设跳转标记，
// 点返回首页若 handler/pagehide 未打标，首页 init 会再把用户弹回刚进入的笔记。
test('V74E-6 手动输名进入 → 菜单返回首页 → 停在首页（用户实报现场全旅程）', guard(async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true };
    window.addEventListener('unload', () => {}); // 踢出 bfcache：让首页 init 每次真实重跑
    localStorage.removeItem('notesync_last_note'); // 首页不自动跳转，先落 landing
  });
  await p.goto(baseURL);
  await p.waitForSelector('#landingInput', { timeout: 15000 });
  await p.fill('#landingInput', 'E2EManualNote');
  await p.click('#landingBtn');
  await p.waitForFunction((n) => location.pathname.endsWith(n), 'E2EManualNote', { timeout: 10000 });
  await p.waitForSelector('#menuBtn', { timeout: 15000 });
  await p.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });
  // 进入时从未打标（手动输名入口）；点返回首页后首页 init 若弹回则断言红
  await p.click('#menuBtn');
  await p.waitForSelector('#menuHome', { timeout: 5000 });
  await p.click('#menuHome');
  await p.waitForFunction((b) => location.href === b, baseURL, { timeout: 8000 });
  await p.waitForTimeout(2000);
  assert.strictEqual(p.url(), baseURL, '手动输名进入的笔记点返回首页必须停留（不被弹回）');
  await ctx.close().catch(() => {});
}));

// ── V74E-7 根因Y 补档：提醒卡（#remCard z80）显示时菜单返回首页仍可点 ──
// E3 只对冲突卡（z55）做命中断言；remCard 是居中模态卡（z80），与居中菜单盒几何重叠概率
// 更高——用同款 elementFromPoint 断言 z90 菜单盖过 z80 提醒卡。
test('V74E-7 提醒卡显示时菜单返回首页仍可点（z90 盖过 remCard z80）', guard(async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.goto(baseURL + 'E2ERemNote');
  await p.waitForSelector('#menuBtn', { timeout: 15000 });
  await p.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
    document.getElementById('remCard').classList.remove('hidden'); // 提醒卡显示（居中模态 z80）
    window.addEventListener('unload', () => {});
  });
  await p.click('#menuBtn');
  await p.waitForSelector('#menuHome', { timeout: 5000 });
  const hit = await p.evaluate(() => {
    const el = document.getElementById('menuHome');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const desc = top ? (top.id ? '#' + top.id : top.className ? '.' + String(top.className).split(' ')[0] : top.tagName) : 'null';
    return { desc, ok: !!top && (top.id === 'menuHome' || !!top.closest('#menuHome')) };
  });
  assert.strictEqual(hit.ok, true, '提醒卡显示时菜单项中心命中点必须落在 menuHome（实际命中: ' + hit.desc + '）');
  await ctx.close().catch(() => {});
}));
