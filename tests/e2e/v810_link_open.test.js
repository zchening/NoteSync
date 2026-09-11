// v8.1.0 链接打开方式真浏览器守护：二级页几何对齐（visibility 占位零漂移）+ 三路真实分流
// L1 几何：二级页 返回/应用内/系统浏览器 三行图标列与文字列 x 全等；点选前后坐标必须纹丝不动
//        （display:none 金勾会在选中瞬间把未选中行推回居中=用户点名的漂移病根）
// L2 Web 默认：真点链接 → 弹新标签（popup 事件），主窗口不动
// L3 Web 应用内：localStorage=inapp → 当前标签真导航，零 popup
// L4 APK 桩：window.Capacitor.LinkOpen 桩 → openExternal 收到 url，零 popup 零导航（绕弹窗的实证）
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

process.on('unhandledRejection', (r) => { const m = String((r && r.message) || r); if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(m)) return; console.error('Unhandled:', m); process.exitCode = 1; });

let ctxS;
before(async () => { ctxS = await setup(); });
after(async () => { await teardown(ctxS.browser, ctxS.server); });

async function unlockedPage(viewport) {
  const page = await ctxS.browser.newPage({ viewport: viewport || { width: 390, height: 844 } });
  await page.goto(ctxS.baseURL);
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'V810Link');
  await page.click('#landingBtn');
  await page.waitForSelector('#pw', { timeout: 10000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').getAttribute('contenteditable') === 'true', undefined, { timeout: 15000 });
  return page;
}
async function measureLinkView(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#menuLinkView .menu-item')].filter(r => r.offsetParent !== null);
    const ix = rows.map(r => r.querySelector('svg').getBoundingClientRect().x);
    const lx = rows.map(r => r.querySelector('.mi-l').getBoundingClientRect().x);
    return { n: rows.length, spread: Math.max(...ix) - Math.min(...ix), lspread: Math.max(...lx) - Math.min(...lx),
             ix, lx };
  });
}

test('L1 二级页三行左起笔全等 + 点选金勾显隐零漂移', async () => {
  const page = await unlockedPage();
  await page.click('#menuBtn');
  await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'));
  await page.click('#menuLink');
  await page.waitForFunction(() => !document.getElementById('menuLinkView').classList.contains('hidden'));
  const before = await measureLinkView(page);
  assert.strictEqual(before.n, 3, '二级页可见行数=返回+应用内+系统浏览器');
  assert.ok(before.spread <= 1 && before.lspread <= 1, '三行两列 x 全等（±1px），实测 ' + before.spread + '/' + before.lspread);
  await page.click('#linkOptInapp'); // 选中切换：金勾从隐藏变显示
  const after = await measureLinkView(page);
  assert.ok(after.spread <= 1 && after.lspread <= 1, '切换后仍全等');
  assert.deepStrictEqual(after.ix.map(v => Math.round(v)), before.ix.map(v => Math.round(v)), '点选前后图标列坐标逐行不动（visibility 占位实证）');
  assert.deepStrictEqual(after.lx.map(v => Math.round(v)), before.lx.map(v => Math.round(v)), '文字列不动');
  const sel = await page.evaluate(() => ({
    inapp: document.getElementById('linkOptInapp').classList.contains('sel'),
    browser: document.getElementById('linkOptBrowser').classList.contains('sel'),
    ls: localStorage.getItem('notesync_link_open'),
  }));
  assert.ok(sel.inapp && !sel.browser && sel.ls === 'inapp', '点选=互斥金勾+本机键落盘');
  await page.close();
});

test('L2 Web 默认：真点链接弹新标签，主窗口不动', async () => {
  const page = await unlockedPage();
  const target = ctxS.baseURL + 'v810target';
  await page.evaluate(t => {
    document.getElementById('editor').innerHTML = '<a id="lke2e" href="' + t + '">go</a>';
  }, target);
  const popupP = page.waitForEvent('popup', { timeout: 4000 });
  await page.evaluate(() => document.getElementById('lke2e').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  const popup = await popupP;
  await popup.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  assert.ok(popup.url().includes('v810target'), '新标签落在目标地址，实测 ' + popup.url());
  assert.ok(page.url().includes('V810Link'), '主窗口仍停在笔记页');
  await popup.close();
  await page.close();
});

test('L3 Web 应用内：当前标签真导航，零新标签', async () => {
  const page = await unlockedPage();
  const target = ctxS.baseURL + 'v810inapp';
  await page.evaluate(() => localStorage.setItem('notesync_link_open', 'inapp'));
  let popped = false;
  page.on('popup', () => { popped = true; });
  await page.evaluate(t => {
    document.getElementById('editor').innerHTML = '<a id="lke2e2" href="' + t + '">go</a>';
  }, target);
  await page.evaluate(() => document.getElementById('lke2e2').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForFunction(() => location.pathname.includes('v810inapp'), undefined, { timeout: 8000 });
  assert.ok(!popped, '应用内=当前标签跳转，不许弹新标签');
  await page.close();
});

test('L4 APK 桩（Capacitor.LinkOpen）：openExternal 收到 url，绕开一切弹窗与导航', async () => {
  const page = await unlockedPage();
  await page.evaluate(() => {
    window.__ext = []; window.__inapp = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: { LinkOpen: {
      openExternal: o => { window.__ext.push(o.url); return Promise.resolve({ ok: true }); },
      openInApp: o => { window.__inapp.push(o.url); return Promise.resolve({ ok: true }); },
    } } };
  });
  let popped = false;
  page.on('popup', () => { popped = true; });
  await page.evaluate(() => {
    document.getElementById('editor').innerHTML = '<a id="lke2e3" href="https://example.com/apk">go</a>';
  });
  await page.evaluate(() => document.getElementById('lke2e3').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForFunction(() => window.__ext.length === 1, undefined, { timeout: 4000 });
  assert.strictEqual(await page.evaluate(() => window.__ext[0]), 'https://example.com/apk');
  assert.ok(!popped, 'APK 默认路径零 window.open（Capacitor 确认弹窗的触发源被绕开）');
  // 切应用内 → openInApp
  await page.evaluate(() => localStorage.setItem('notesync_link_open', 'inapp'));
  await page.evaluate(() => document.getElementById('lke2e3').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForFunction(() => window.__inapp.length === 1, undefined, { timeout: 4000 });
  assert.ok(page.url().includes('V810Link'), '主 WebView 停在笔记页不动（子页归原生 Activity 管）');
  await page.close();
});
