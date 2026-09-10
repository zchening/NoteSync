// v8.0.1 抽屉菜单「图标列起线齐」真浏览器几何守护（发版闸 R3 建议：静态断言无 computed 层=jsdom 伪绿同族盲区）。
// 断言 #menuMainView 九行行首 svg 视口 x 全等（±1px）——任何让 .menu-item 回到整组居中/参差的改动必红。
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
    }, { timeout: 15000 });
    await page.evaluate(() => document.getElementById('menuBtn').click()); // 根路径 landing 盖住页脚，绕 actionability 直接派发
    await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), { timeout: 3000 });
    const r = await page.evaluate(() => {
      // 只量可见行：#menuFav（收藏笔记）未开笔记时 display:none 属既有设计，隐藏行 rect 全 0 会假报参差
      const xs = [...document.querySelectorAll('#menuMainView .menu-item')]
        .filter(r => r.offsetParent !== null)
        .map(r => r.querySelector('svg').getBoundingClientRect().x);
      return { n: xs.length, spread: Math.max(...xs) - Math.min(...xs) };
    });
    assert.ok(r.n >= 8, '主菜单可见行图标数应 ≥8（收藏行条件隐藏），实测 ' + r.n);
    assert.ok(r.spread <= 1, '图标列 x 参差应 ≤1px，实测 spread=' + r.spread.toFixed(3) + 'px @' + viewport.width);
    await page.close();
  }
});
