// v10.2.2 单元测试：关于弹窗的「App 版本」「检查更新」两行被原生桥现查拖到 1~2 秒后才出现（用户报障：闪一下）
//   病理：点「关于」→ await RemBridge.getVersion()（慢机型 1~2 秒）→ 弹窗和两行一起姗姗来迟；
//         冷启动预热又只挂在 6 秒后的预下载里且仅 Wi-Fi → 头几秒点开必然现查。
//   T1  点「关于」同步开弹窗：弹窗开着、更新行即时在（不被桥拖）
//   T2  慢桥就地补：App 版本行先隐后现（值到位即填，弹窗本身不等桥）
//   T3  冷启动预热：页面加载即查一次版本（不等 6 秒预下载、不限 Wi-Fi）；预热回填后点击 → App 版本行同步显示
const { test } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function app0(getVersionDelay) {
  return loadApp(w => {
    let calls = 0;
    w.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        RemBridge: {
          getVersion: () => new Promise(r => setTimeout(() => { calls++; r({ nativeVersion: '10.2.2' }); }, getVersionDelay)),
        },
      },
    };
    w.__getVersionCalls = () => calls;
  }, 'http://localhost/');
}

/* ── T1 点开即完整（同步帧断言） ───────────────────────────── */
test('T1 点「关于」同步开弹窗：弹窗开着、更新行即时在（不被桥拖 1~2 秒）', async t => {
  const dom = app0(250); t.after(() => dom.window.close());
  const w = dom.window;
  w.document.getElementById('menuAbout').click();
  assert.ok(!w.document.getElementById('aboutMask').classList.contains('hidden'), '弹窗必须同步打开（旧代码等桥 1~2 秒才开＝先看到没版本号的空弹窗）');
  assert.ok(!w.document.getElementById('aboutUpdRow').classList.contains('hidden'), '检查更新行必须同步可见');
  assert.strictEqual(w.document.getElementById('aboutVer').textContent, 'Version 10.2.2', '网页版本行恒即时（顶层 const 不挂 window，钉字面）');
});

/* ── T2 慢桥就地补 ────────────────────────────────────────── */
test('T2 预热未回时点击：弹窗照常即时开；桥慢回后 App 版本行就地出现', async t => {
  const dom = app0(250); t.after(() => dom.window.close());
  const w = dom.window;
  w.document.getElementById('menuAbout').click();
  assert.ok(w.document.getElementById('aboutAppRow').classList.contains('hidden'), '同步帧：App 版本行还没有值（预热未回）→ 暂隐，绝不显示空行');
  await sleep(450);
  const row = w.document.getElementById('aboutAppRow');
  assert.ok(!row.classList.contains('hidden'), '桥回后 App 版本行就地出现');
  assert.strictEqual(w.document.getElementById('aboutAppVer').textContent, 'Version 10.2.2', '就地补的值必须是原生版本号');
});

/* ── T3 冷启动预热 ────────────────────────────────────────── */
test('T3 冷启动预热：加载即查版本（不等 6 秒预下载、不限 Wi-Fi）；回填后点击 App 版本行同步显示', async t => {
  const dom = app0(30); t.after(() => dom.window.close());
  const w = dom.window;
  await sleep(150);
  assert.ok(w.__getVersionCalls() >= 1, '页面加载后就该预热原生版本号（旧代码 6 秒后才查且仅 Wi-Fi）');
  w.document.getElementById('menuAbout').click();
  assert.ok(!w.document.getElementById('aboutAppRow').classList.contains('hidden'), '预热过的版本号点击即显示');
  assert.strictEqual(w.document.getElementById('aboutAppVer').textContent, 'Version 10.2.2', '预热值上屏');
  assert.ok(w.__getVersionCalls() === 1, '预热命中后点开关于不许再查一次桥');
});
