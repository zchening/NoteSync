// v5.55 单元测试：推送桥 P0 修复（Capacitor 真实形态）+ 时/分滚轮 + 菜单二级视图
// + poll 跳过提示 + ?diag 诊断 + Android 离线主文档缓存/前台不推（源码形态）
// E1 桥修复源码形态 | E2 jsdom 真机形态 mock | E3 精确闹针自检 | E4 滚轮行为
// E5 菜单二级视图 | E6 去「菜单」标题+去删除按钮 | E7 poll 跳过提示 | E8 diag 行 | E9 Android 形态
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}
function readAndroid(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', rel), 'utf8');
}

function freshApp(extra, pageUrl) {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
    if (typeof extra === 'function') extra(w);
  }, pageUrl);
  return { dom, window: dom.window, editor: dom.window.document.getElementById('editor') };
}
function mockFetch(window, note, putV) {
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: putV }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

// ── E1：推送桥 P0 修复源码形态 ──
test('E1 syncRemindersToNative：Capacitor.Plugins.RemBridge 优先 + {list} 调用形态', () => {
  const src = readSrc();
  const body = src.match(/async function syncRemindersToNative\(\) \{([\s\S]*?)\n\}/);
  assert.ok(body, '函数体应可匹配');
  const code = body[1];
  assert.ok(code.includes('cap.Plugins && cap.Plugins.RemBridge'), '应优先读 Capacitor.Plugins.RemBridge（真机真实暴露路径——v5.51 起 window.RemBridge 恒 null 的断点）');
  assert.ok(code.includes('window.RemBridge'), '回退 window.RemBridge 保 jsdom 兼容');
  assert.ok(code.includes("typeof rb.sync !== 'function'"), '应守卫 rb.sync 存在');
  assert.ok(code.includes('rb.sync({ list:'), '调用必须是 {list:[...]} 对象形态（Kotlin 端 call.getArray("list")；此前传裸数组参数必丢）');
  assert.ok(code.includes('window.__remNativeScheduled'), '排程读数应落 window.__remNativeScheduled 供 ?diag 展示');
});

// ── E2：jsdom 行为——真机形态 mock，桥真被调到且参数形态正确 ──
// v6.0：走真实笔记路由（pageUrl 带 noteId）——分区 upsert 后首页会跳过同步，landing 场景不再触发 sync
test('E2 jsdom：Capacitor.Plugins.RemBridge mock 收到 {list} 形态（这是 v5.51 起漏测三年的盲区）', async t => {
  const calls = [];
  const app = freshApp(w => {
    w.Capacitor = {
      isNativePlatform: () => false, // 不触发 APK 冷启动跳转
      Plugins: {
        RemBridge: {
          sync: async arg => { calls.push(arg); return { scheduled: arg && arg.list ? arg.list.length : 0, failed: 0 }; },
          requestExactAlarm: async () => ({ canScheduleExactAlarms: true })
        }
      }
    };
  }, 'http://localhost/pushnote');
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('<div>x</div>', key);
  mockFetch(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  assert.ok(calls.length >= 1, '解锁后应调用原生 sync（loadReminder 挂点）');
  const arg0 = calls[calls.length - 1];
  assert.ok(arg0 && Array.isArray(arg0.list), '调用参数必须是 {list:[...]} 对象形态');

  editor.innerHTML = '<div>x</div>';
  const at = Date.now() + 3600e3;
  await window.addReminder(at, '推我');
  const arg = calls[calls.length - 1];
  assert.equal(arg.list.length, 1, '加提醒后应同步 1 条到原生层');
  assert.equal(arg.list[0].at, at, '时间戳原样传递');
  assert.equal(arg.list[0].text, '推我', '文案原样传递');
  assert.equal(arg.noteId, 'pushnote', 'v6.0：sync 必须带 noteId（原生按分区 upsert，切笔记不清其他笔记的闹钟）');
  assert.equal(window.__remNativeScheduled, 1, '排程读数落 __remNativeScheduled（?diag 显示）');
});

// ── E3：精确闹针权限自检形态 ──
test('E3 ensureExactAlarmPermission：仅 APK、只引导一次（localStorage 标记）', () => {
  const src = readSrc();
  const body = src.match(/async function ensureExactAlarmPermission\(\) \{([\s\S]*?)\n\}/);
  assert.ok(body, '函数体应可匹配');
  const code = body[1];
  assert.ok(code.includes('isNativeApp()'), '必须仅 APK 环境执行');
  assert.ok(code.includes("notesync_exact_alarm_asked"), '必须有「只引导一次」localStorage 标记');
  assert.ok(code.includes('requestExactAlarm'), '应调用原生 requestExactAlarm');
  assert.ok(code.includes('window.__remExactAlarm'), '权限读数应落 __remExactAlarm 供 ?diag 展示');
  // 挂点：loadReminder 内
  const lrIdx = src.indexOf('async function loadReminder');
  assert.ok(lrIdx > -1, '应存在 loadReminder');
  const lrSeg = src.slice(lrIdx, lrIdx + 900);
  assert.ok(lrSeg.includes('ensureExactAlarmPermission()'), 'loadReminder 应挂 ensureExactAlarmPermission');
});

// ── E4：滚轮 jsdom 行为——存在/默认值/钳制/滚动同步 ──
test('E4 jsdom：时/分滚轮存在，默认值=当前+5min，setWheelVal 越界钳制，scroll 同步 dataset', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const noteCt = await window.encryptText('x', key);
  mockFetch(window, {}, 6);
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  editor.innerHTML = '<div>y</div>';
  window.toggleRemPanel(true);
  const panel = window.document.getElementById('remPanel');
  const hhWh = panel.querySelector('.rem-wheel-hh');
  const mmWh = panel.querySelector('.rem-wheel-mm');
  assert.ok(hhWh && mmWh, '两列滚轮必须存在');
  assert.equal(hhWh.querySelectorAll('.rem-wheel-it').length, 24, '小时滚轮 24 项');
  assert.equal(mmWh.querySelectorAll('.rem-wheel-it').length, 60, '分钟滚轮 60 项');

  // 默认值 = 当前 +5min（±2 分钟容差对齐 R12 口径）
  const hv = window.getWheelVal('hh'), mv = window.getWheelVal('mm');
  const dateInp = panel.querySelector('input[type="date"]');
  const picked = new Date(+dateInp.value.slice(0, 4), +dateInp.value.slice(5, 7) - 1, +dateInp.value.slice(8, 10), hv, mv).getTime();
  assert.ok(Math.abs(Date.now() + 300000 - picked) < 120000, '默认必须是当前 +5 分钟');

  // 越界钳制
  window.setWheelVal('mm', 99);
  assert.equal(window.getWheelVal('mm'), 59, 'mm 99 应钳到 59');
  window.setWheelVal('hh', -3);
  assert.equal(window.getWheelVal('hh'), 0, 'hh -3 应钳到 0');
  window.setWheelVal('hh', 25);
  assert.equal(window.getWheelVal('hh'), 23, 'hh 25 应钳到 23');

  // scroll 事件同步 dataset（真浏览器滚动后取值同步）。
  // 注意：顶层 const REM_WHEEL_ITEM_H=50 不挂 window（ES 规范），这里直接写字面量
  mmWh.scrollTop = 150; // 3 项高
  mmWh.dispatchEvent(new window.Event('scroll'));
  assert.equal(window.getWheelVal('mm'), 3, 'scrollTop=3 项高 → 值应为 3');

  // 选中项 .cur 标记跟随
  const cur = mmWh.querySelectorAll('.rem-wheel-it.cur');
  assert.equal(cur.length, 1, '应恰好一项 .cur');
  assert.equal(cur[0].textContent, '03', '.cur 应落在 03 项');
  window.toggleRemPanel(false);
});

// ── E5：菜单二级视图 jsdom 行为 ──
test('E5 jsdom：菜单主视图 ↔ 收藏夹二级视图切换', () => {
  const dom = loadApp(); // landing 分支（noteId 为空）
  const w = dom.window;
  const d = w.document;
  const mainView = d.getElementById('menuMainView');
  const favView = d.getElementById('menuFavView');
  assert.ok(mainView && favView, '两个视图容器必须存在');

  d.getElementById('menuBtn').click();
  assert.ok(!d.getElementById('menuMask').classList.contains('hidden'), '点 menuBtn 应打开菜单');
  assert.ok(!mainView.classList.contains('hidden'), '打开菜单默认回主视图');
  assert.ok(favView.classList.contains('hidden'), '二级视图默认隐藏');

  // 写入两条收藏后进二级
  w.writeFavs(['alpha', 'beta']);
  d.getElementById('menuFavEntry').click();
  assert.ok(mainView.classList.contains('hidden'), '点收藏夹后主视图隐藏');
  assert.ok(!favView.classList.contains('hidden'), '二级视图显示');
  const rows = d.querySelectorAll('#menuFavList .fav-row');
  assert.equal(rows.length, 2, '二级列表应渲染 2 条收藏');

  d.getElementById('menuFavBack').click();
  assert.ok(!mainView.classList.contains('hidden'), '‹ 返回应回主视图');
  assert.ok(favView.classList.contains('hidden'), '二级视图重新隐藏');

  dom.window.close();
});

// ── E6：去「菜单」标题 + 去删除按钮（用户拍板） ──
test('E6 menuBox 无「菜单」标题；收藏列表无 ✕ 删除按钮', () => {
  const src = readSrc();
  const boxIdx = src.indexOf('id="menuBox"');
  assert.ok(boxIdx > -1, '应存在 menuBox');
  const boxSeg = src.slice(boxIdx, boxIdx + 900);
  assert.ok(!boxSeg.includes('<h1>菜单</h1>'), 'menuBox 内不得再有「菜单」标题（用户要求去掉）');
  assert.ok(!src.includes('menuFavHead'), 'menuFavHead 旧标题应退役');
  assert.ok(!src.includes('fav-del'), 'fav-del 删除按钮应整段退役（唯一删除入口 = 笔记内取消收藏）');
});

// ── E7：poll 未保存改动挂起（v5.56 起不再消费版本号——合并吞噬修复）──
test('E7 poll 跳过提示：不消费版本号 + stash 快照 + 冲突条 + 诊断计数', () => {
  const src = readSrc();
  // v7.4.0：unsaved 判定扩为「装饰等价 + 占位等价」双豁免，锚点随形态更新
  const idx = src.indexOf('const unsaved = !isDecorativelyEqual(editor.innerHTML, lastHtml) && !isPlaceholderEqual(editor.innerHTML, lastHtml);');
  assert.ok(idx > -1, '应有未保存判定（v5.56 起不再要求正聚焦；v7.1.0 装饰等价 / v7.4.0 占位等价不算未保存）');
  // 段取「unsaved → 挂起分支 showRemoteBar 收尾」，不把级2 本机净路径（含 localVer = note.v）裹进来
  const end = src.indexOf('showRemoteBar()', idx);
  assert.ok(end > -1, '挂起分支应存在诊断计数');
  const seg = src.slice(idx, end + 20);
  assert.ok(seg.includes('pendingRemoteNote = note;'), '挂起应 stash 远端快照');
  assert.ok(!seg.includes('localVer = note.v'), '挂起分支不得消费版本号（旧版吞噬远端更新的根因）');
  assert.ok(seg.includes('__pollSkipCount'), '跳过应计入 __pollSkipCount 供 ?diag 展示');
  assert.ok(seg.includes('showRemoteBar()'), '挂起应亮冲突条');
  assert.ok(seg.includes('远端有更新，待处理'), '状态栏应显示真相');
});

// ── E8：?diag 新增原生桥 + 同步诊断行 ──
test('E8 ?diag 诊断行：bridge/scheduled/exact + sse/lastSync/skip', () => {
  const src = readSrc();
  const diagIdx = src.indexOf("id = 'caretDiag'");
  assert.ok(diagIdx > -1, '应存在 caretDiag 浮层');
  // v6.1：采样体抽到 window.collectDiagLines（浮层与诊断模态共用），从函数定义处取段断言
  const clIdx = src.indexOf('window.collectDiagLines = function');
  assert.ok(clIdx > -1, 'v6.1 应存在 collectDiagLines 共用采样函数');
  const seg = src.slice(clIdx, clIdx + 4600);
  assert.ok(seg.includes("bridge="), '诊断应含 bridge 连通读数');
  assert.ok(seg.includes("scheduled="), '诊断应含原生排程数');
  assert.ok(seg.includes("exact="), '诊断应含精确闹针权限读数');
  assert.ok(seg.includes("sse="), '诊断应含 SSE 连接状态');
  assert.ok(seg.includes("skip="), '诊断应含 poll 跳过计数');
});

// ── E9：Android 源码形态——主文档缓存 + 前台不推通知 ──
test('E9 Android：MainActivity 主文档拦截缓存 + RemReceiver 前台跳过', () => {
  const main = readAndroid('MainActivity.java');
  assert.ok(main.includes('shouldInterceptRequest'), 'MainActivity 应拦 shouldInterceptRequest');
  assert.ok(main.includes('isForMainFrame()'), '只拦主文档请求');
  assert.ok(main.includes('cached_index.html'), '应落盘 cached_index.html');
  assert.ok(main.includes('fetchMainDoc') && main.includes('readMainDoc') && main.includes('saveMainDoc'), '抓取/读/写三函数应齐');
  assert.ok(main.includes('RemPlugin.isForeground = true'), 'onResume 应置前台标志');
  assert.ok(main.includes('RemPlugin.isForeground = false'), 'onPause 应置非前台标志');

  const plugin = readAndroid(path.join('rem', 'RemPlugin.kt'));
  assert.ok(plugin.includes('var isForeground = false'), 'RemPlugin 应声明 isForeground（默认 false=推通知，安全方向正确）');

  const receiver = readAndroid(path.join('rem', 'RemReceiver.kt'));
  assert.ok(receiver.includes('if (RemPlugin.isForeground) return'), 'RemReceiver 前台时应跳过通知（JS 卡片已负责）');
  // 前台判定必须在 60s 容差之后、通知渠道创建之前
  const tolIdx = receiver.indexOf('60_000L');
  const fgIdx = receiver.indexOf('RemPlugin.isForeground');
  const chIdx = receiver.indexOf('createNotificationChannel', fgIdx);
  assert.ok(tolIdx > -1 && fgIdx > tolIdx && chIdx > fgIdx, '顺序应为：容差 → 前台判定 → 渠道创建');
});
