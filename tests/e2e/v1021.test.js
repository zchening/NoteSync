// NoteSync E2E（Playwright + 真实 Chromium）：v10.2.1 更新弹窗长文回归（用户报障）
//   v10.2.0 真机实锤：/api/latest 的 body 是两条 ~900/450 字的单行段落，更新弹窗 #updNotes
//   无高度上限 → 正文撑爆弹窗，「立即更新」按钮被顶出屏幕看不见。
//   本测用真实形状的 latest_app.json（summary 空、body 超长单行）真点「检查更新」，量三件事：
//   1) #updYes 按钮必须整体在视口内（bottom ≤ innerHeight）
//   2) #updNotes 必须可滚动（scrollHeight > clientHeight = 上限生效，正文进滚动区）
//   3) 兜底正文每行 ≤61 字（60 字掐断 + 省略号）
const { test, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server_sync');

const PASS = 'testpass';
const NOTE = 'upddlg1021';

const LONG_BODY = [
  '## v10.2.1 完整更新详情',
  '',
  '两条用户诉求（仿 NoteSyncX）。',
  '',
  '- ①长按删除折叠列表：' + '折叠组此前没有任何删掉整组的路，手势确认框组界重映射撤销找回一整条链，判据单测六条端到端十八项全绿。'.repeat(14),
  '- ②APK 26MB→3MB 级：' + '移除随包 ML Kit 扫码插件，扫码全靠同源 jsQR 纯 JS 解码，旧壳兼容挂点保留零成本。'.repeat(8),
  '- ③判据与守护：' + '判据先红后改，行为级与源码级双档钉住，变异反撤全部转红，防回归被顺手优化掉。'.repeat(10),
  '- ④发版链路：' + 'tag 触发云构建出包，OTA 推升级元数据，网页部署热更，四层判据全绿才算完成。'.repeat(10),
  '',
  '**Full Changelog**: https://github.com/zchening/NoteSync/compare/v10.2.0...v10.2.1',
].join('\n');

const LATEST = {
  tag_name: 'v10.3.0', // 必须 > index.html 的 APP_VERSION 才会弹窗
  assets: [{ name: 'app-release.apk', browser_download_url: 'https://biji.xuyinji.com.cn/dl/v10.3.0.apk', size: 3524754 }],
  summary: [],
  body: LONG_BODY,
};

let failures = 0;
const servers = [];
const browsers = [];
after(async () => {
  await Promise.all([
    Promise.all(browsers.map((b) => b.close().catch(() => {}))),
    Promise.all(servers.map((s) => { try { s.close(); } catch (e) {} return Promise.resolve(); })),
  ]).catch(() => {});
  process.exit(failures > 0 ? 1 : 0);
});

test('更新弹窗：长 body 时按钮仍在视口内、正文区可滚动、兜底行已掐断', async t => {
  const server = await startServer();
  servers.push(server);
  const baseURL = `http://localhost:${server.address().port}/`;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } }); // 手机档视口
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(baseURL + NOTE);
  await page.waitForSelector('#pw', { timeout: 10000 });
  await page.fill('#pw', PASS);
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
    && document.getElementById('mask').classList.contains('hidden'), { timeout: 20000 });

  // 拦 /api/latest：换成"比当前版新 + 超长 body"的 latest_app.json（v10.2.0 真实形状）
  await page.route('**/api/latest*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(LATEST),
  }));

  await page.evaluate(() => nsCheckUpdate());
  await page.waitForSelector('#updMask:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => (document.getElementById('updNotes').textContent || '').length > 0, null, { timeout: 5000 });

  const geo = await page.evaluate(() => {
    const yes = document.getElementById('updYes').getBoundingClientRect();
    const ne = document.getElementById('updNotes');
    const texts = Array.from(ne.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue);
    return {
      yesBottom: yes.bottom,
      vh: window.innerHeight,
      scrollable: ne.scrollHeight > ne.clientHeight,
      lineLens: texts.map((s) => s.length),
      modalShown: !document.getElementById('updMask').classList.contains('hidden'),
    };
  });

  assert.ok(geo.modalShown, '长 body 也要正常弹窗');
  assert.ok(geo.yesBottom <= geo.vh, `「立即更新」按钮必须在视口内（bottom=${geo.yesBottom.toFixed(0)} > vh=${geo.vh} 就是被顶出屏的形状）`);
  assert.ok(geo.scrollable, '正文区必须可滚动（max-height 上限生效，scrollHeight > clientHeight）');
  for (const len of geo.lineLens) assert.ok(len <= 61, '兜底行必须 ≤61 字：' + len);
  assert.deepStrictEqual(errors, [], '全程无页面脚本报错');
});
