// v8.0.1 抽屉菜单「图标列起线齐」真浏览器几何守护（发版闸 R3 建议：静态断言无 computed 层=jsdom 伪绿同族盲区）。
// 断言 #menuMainView 可见行行首 svg 与标签列视口 x 各自全等（±1px）+ 标签不溢出定宽列——对齐性/均衡性任何回潮必红。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

process.on('unhandledRejection', (r) => { const m = String((r && r.message) || r); if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(m)) return; console.error('Unhandled:', m); process.exitCode = 1; });

let ctxS;
before(async () => { ctxS = await setup(); });
after(async () => { await teardown(ctxS.browser, ctxS.server); });

test('M1 桌面+移动双视口九行 svg.x 全等（±1px，v8.0.1 左列对齐）', async () => {
  const { browser, baseURL } = ctxS;
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(baseURL);
    await page.waitForFunction(() => {
      const l = document.getElementById('landing');
      return l && !l.classList.contains('hidden');
    }, undefined, { timeout: 15000 });
    await page.evaluate(() => document.getElementById('menuBtn').click()); // 根路径 landing 盖住页脚，绕 actionability 直接派发
    await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), undefined, { timeout: 3000 });
    const r = await page.evaluate(() => {
      // 只量可见行：#menuFav（收藏笔记）未开笔记时 display:none 属既有设计，隐藏行 rect 全 0 会假报参差
      const rows = [...document.querySelectorAll('#menuMainView .menu-item')].filter(r => r.offsetParent !== null);
      const xs = rows.map(r => r.querySelector('svg').getBoundingClientRect().x);
      // v8.0.2 定宽标签列：文字起线同样必须全等，且长标签「关于 NoteSync」不得溢出列宽
      const labels = rows.map(r => r.querySelector('.mi-l, #menuThemeLabel'));
      window.__miss = labels.filter(Boolean).length;
      window.__lx = labels.filter(Boolean).map(l => l.getBoundingClientRect().x);
      window.__fit = labels.filter(Boolean).map(l => l.scrollWidth - l.clientWidth);
      window.__h = rows.map(r => r.getBoundingClientRect().height);
      return { n: xs.length, spread: Math.max(...xs) - Math.min(...xs),
               labelsN: window.__miss,
               lspread: Math.max(...window.__lx) - Math.min(...window.__lx),
               overflow: Math.max(...window.__fit),
               hspread: Math.max(...window.__h) - Math.min(...window.__h) };
    });
    assert.ok(r.n >= 8, '主菜单可见行图标数应 ≥8（收藏行条件隐藏），实测 ' + r.n);
    assert.ok(r.spread <= 1, '图标列 x 参差应 ≤1px，实测 spread=' + r.spread.toFixed(3) + 'px @' + viewport.width);
    assert.strictEqual(r.labelsN, r.n, '每个可见行都必须有 mi-l/#menuThemeLabel 定宽标签列（缺列=该行脱离对齐体系，产品级红非环境红）');
    assert.ok(r.lspread <= 1, '文字起线 x 参差应 ≤1px，实测 ' + r.lspread.toFixed(3) + 'px @' + viewport.width);
    assert.ok(r.overflow <= 2, '标签不得溢出定宽列（scrollWidth-clientWidth），实测 ' + r.overflow + 'px @' + viewport.width);
    assert.ok(r.hspread <= 1, '行高必须全等（定宽列若换行会撑高=盲区补位），实测 ' + r.hspread.toFixed(2) + 'px @' + viewport.width);
    await page.close();
  }
});

// M2（v8.0.3）：解锁笔记态真点 ☰——收藏笔记行 display 复位且经 renderMenu 注入重写，
// 是 M1(landing 态该列被隐藏过滤) 覆盖不到的真实盲区；三维全等守护注入路径的 mi-l 结构。
test('M2 解锁态收藏行注入重写后九行仍三维全等（v8.0.3 回归钉）', async () => {
  const { browser, baseURL } = ctxS;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'V803Align');
  await page.click('#landingBtn');
  await page.waitForSelector('#pw', { timeout: 10000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => {
    const e = document.getElementById('editor');
    return e && e.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 15000 });
  await page.click('#menuBtn'); // 编辑器态页脚可点，真实点击路径
  await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), undefined, { timeout: 3000 });
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#menuMainView .menu-item')].filter(x => x.offsetParent !== null);
    const svgs = rows.map(x => x.querySelector('svg').getBoundingClientRect());
    const labels = rows.map(x => x.querySelector('.mi-l, #menuThemeLabel'));
    return { n: rows.length,
      hasFav: rows.some(x => x.id === 'menuFav'),
      favLabel: (document.querySelector('#menuFav .mi-l') || {}).textContent || null,
      labelsAll: rows.map(x => !!x.querySelector('.mi-l, #menuThemeLabel')),
      spread: Math.max(...svgs.map(b => b.x)) - Math.min(...svgs.map(b => b.x)),
      labelsN: labels.filter(Boolean).length,
      lspread: Math.max(...labels.filter(Boolean).map(l => l.getBoundingClientRect().x)) - Math.min(...labels.filter(Boolean).map(l => l.getBoundingClientRect().x)),
      hspread: Math.max(...rows.map(x => x.getBoundingClientRect().height)) - Math.min(...rows.map(x => x.getBoundingClientRect().height)) };
  });
  assert.ok(r.hasFav, '前置：解锁态收藏行必须可见（未到=环境/流程问题）');
  assert.ok(r.favLabel, '收藏行标签必须在 mi-l 内（此红=renderMenu 注入重写又脱定宽列）');
  assert.strictEqual(r.labelsN, r.n, '九行全须有定宽标签列');
  assert.strictEqual(r.n, 9, '解锁态主菜单 9 行全可见，实测 ' + r.n);
  assert.ok(r.spread <= 1 && r.lspread <= 1, '九行两列 x 全等，实测 svg=' + r.spread.toFixed(2) + ' label=' + r.lspread.toFixed(2));
  assert.ok(r.hspread <= 1, '行高全等，实测 ' + r.hspread.toFixed(2));
  await page.close();
});

// M3（v8.0.4）：解锁→点「收藏笔记」→进「收藏夹」二级——金星列/mono名/右箭头/眉标/胶囊圆角全链实证（行族重设计回归钉）
test('M3 收藏二级页新形态全链生效（收藏动作→二级渲染）', async () => {
  const { browser, baseURL } = ctxS;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'V804Fav');
  await page.click('#landingBtn');
  await page.waitForSelector('#pw', { timeout: 10000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => {
    const e = document.getElementById('editor');
    return e && e.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 15000 });
  await page.click('#menuBtn');
  await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), undefined, { timeout: 3000 });
  await page.click('#menuFav'); // 收藏当前笔记（renderMenu 同步刷新）
  await page.click('#menuFavEntry');
  await page.waitForFunction(() => !document.getElementById('menuFavView').classList.contains('hidden'), undefined, { timeout: 3000 });
  const r = await page.evaluate(() => {
    const row = document.querySelector('#menuFavList .fav-row');
    const kick = document.querySelector('#menuFavList .list-kicker');
    const cs = row && getComputedStyle(row);
    return {
      row: !!row, star: !!(row && row.querySelector('svg.fav-star path.gf')),
      name: row && row.querySelector('.fav-name') && row.querySelector('.fav-name').textContent,
      go: !!(row && row.querySelector('svg.fav-go')),
      radius: cs && cs.borderRadius, minH: cs && cs.minHeight,
      kick: kick && kick.textContent,
    };
  });
  assert.ok(r.row && r.star && r.go, '收藏行=金星列+右箭头结构完整（缺=注入重写脱形）');
  assert.strictEqual(r.name, 'V804Fav', 'mono 名列文本=笔记名');
  assert.strictEqual(r.radius, '10px', '胶囊圆角与主菜单同族');
  assert.ok(r.kick && r.kick.includes('1'), '眉标计数跟渲染');
  await page.close();
});

// M4（v8.0.5）：解锁→进历史二级→手动打点→行/眉标/展开态全链实证（历史二级页重设计回归钉）
test('M4 历史二级页新形态全链生效（打点→列表→预览展开）', async () => {
  const { browser, baseURL } = ctxS;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'V805Hist');
  await page.click('#landingBtn');
  await page.waitForSelector('#pw', { timeout: 10000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => {
    const e = document.getElementById('editor');
    return e && e.getAttribute('contenteditable') === 'true';
  }, undefined, { timeout: 15000 });
  await page.click('#editor');
  await page.keyboard.type('M4 打点前提内容'); // snapshotHistory 空正文守卫(!html)静默 return——须有内容再打点
  await page.click('#menuBtn');
  await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), undefined, { timeout: 3000 });
  await page.click('#menuHistEntry');
  await page.waitForFunction(() => !document.getElementById('menuHistView').classList.contains('hidden'), undefined, { timeout: 3000 });
  await page.click('#menuHistSave'); // 手动打点（loadHistList 自动刷新）
  await page.waitForFunction(() => document.querySelectorAll('#menuHistList .hist-item').length >= 1, undefined, { timeout: 10000 });
  const r1 = await page.evaluate(() => {
    const row = document.querySelector('#menuHistList .hist-item');
    const kick = document.querySelector('#menuHistList .list-kicker');
    const cs = getComputedStyle(row);
    return { radius: cs.borderRadius,
      clock: !!(row.querySelector('svg.hist-clock') && row.querySelector('svg.hist-clock path.g')),
      mono: /monospace/.test(getComputedStyle(row.querySelector('.hist-meta')).fontFamily),
      kick: kick && kick.textContent };
  });
  assert.ok(r1.clock, '行首时钟列含金指针（缺=注入脱形）');
  assert.strictEqual(r1.radius, '10px', '胶囊圆角同族');
  assert.ok(r1.mono, 'mono 时间列');
  assert.ok(r1.kick && r1.kick.indexOf('版本 · ') === 0, '眉标计数在位: ' + r1.kick);
  await page.click('#menuHistList .hist-item .hist-btns button'); // 预览展开（异步：拉密文+本机解密）
  await page.waitForFunction(() => {
    const row = document.querySelector('#menuHistList .hist-item');
    return row && row.classList.contains('hist-open') && !!row.querySelector('.hist-preview');
  }, undefined, { timeout: 8000 });
  const r2 = await page.evaluate(() => {
    const row = document.querySelector('#menuHistList .hist-item');
    return { open: row.classList.contains('hist-open'), pv: !!row.querySelector('.hist-preview') };
  });
  assert.ok(r2.open && r2.pv, '预览展开=行级 hist-open+内联构图');
  await page.close();
});
