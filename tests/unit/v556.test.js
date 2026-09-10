// v5.56 单元测试：真机六连修的回归护栏
// F1 自动解锁补 loadReminder | F2 poll 应用远端同步提醒 | F3 saveLocal 冲突闸门
// F4 远端冲突条形态 | F5 APP 内诊断入口 | F6 冲突两路径 jsdom 行为 | F7 poll 提醒同步 jsdom 行为 | F8 Android/CI 形态
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
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

// ── F1：自动解锁路径补提醒恢复（关标签/杀进程重开后提醒列表恒空的根因）──
test('F1 loadStoredKey 自动解锁分支必须调 loadReminder，且先于 linkify', () => {
  const src = readSrc();
  const idx = src.indexOf('if (await loadStoredKey()) {');
  assert.ok(idx > -1, '应存在自动解锁分支');
  const seg = src.slice(idx, idx + 2600);
  assert.ok(seg.includes('loadReminder(note, cryptoKey)'), '自动解锁路径必须调 loadReminder（此前仅 applyUnlocked 恢复）');
  assert.ok(seg.indexOf('loadReminder(note, cryptoKey)') < seg.indexOf('linkifyEditor()'), 'loadReminder 必须先于 linkify，下划线才画得出');
});

// ── F2：poll 应用远端路径同步提醒（PC 加的提醒手机有文字无下划线的根因）──
test('F2 poll 应用远端时 note.rem 变化必须触发 loadReminder', () => {
  const src = readSrc();
  const idx = src.indexOf('async function poll()');
  assert.ok(idx > -1, '应存在 poll');
  const seg = src.slice(idx, idx + 2600);
  assert.ok(seg.includes('(note.rem || null) !== remCipher'), 'poll 应比较远端 rem 与当前 remCipher');
  assert.ok(seg.includes('loadReminder(note, cryptoKey)'), 'poll 应用远端时应调 loadReminder');
});

// ── F3：saveLocal 冲突闸门在 apiPut 之前（绝不自动覆盖服务端）──
test('F3 saveLocal：pendingRemoteNote 闸门必须先于 apiPut，且草稿已先落', () => {
  const src = readSrc();
  const idx = src.search(/async function saveLocal\([^)]*\)/); // v7.3.3：恢复场景新增 force 参数
  assert.ok(idx > -1, '应存在 saveLocal');
  const seg = src.slice(idx, idx + 1800); // v7.5.0：A1' 早退分支补 clearDraft/探针注释，窗口随之扩宽（顺序断言语义不变）
  const draftIdx = seg.indexOf('writeDraft(');
  const gateIdx = seg.indexOf('if (pendingRemoteNote) {');
  const putIdx = seg.indexOf('apiPut({');
  assert.ok(draftIdx > -1 && gateIdx > draftIdx && putIdx > gateIdx, '顺序应为：落草稿 → 冲突闸门 → apiPut');
});

// ── F4：远端冲突条 DOM/CSS/wiring 形态 ──
test('F4 remoteBar 冲突条：DOM + 错位 CSS + 双按钮 wiring', () => {
  const src = readSrc();
  assert.ok(src.includes('id="remoteBar"'), '应有 remoteBar DOM');
  assert.ok(src.includes('id="remoteKeep"') && src.includes('id="remoteTake"'), '应有保留本机修改/使用服务器版本两按钮');
  assert.ok(src.includes('#remoteBar{top:96px}'), 'remoteBar 应与 draftBar 错位（top:96px）');
  assert.ok(src.includes("$('#remoteKeep').addEventListener('click'"), 'remoteKeep 应有 wiring');
  assert.ok(src.includes("$('#remoteTake').addEventListener('click'"), 'remoteTake 应有 wiring');
  // v5.57：条式退役，改扫码配对同款浮卡（排版挤压/按钮出框实锤后的重做）
  assert.ok(src.includes('class="conflictbar hidden"'), 'remoteBar/draftBar 应为 conflictbar 浮卡');
  assert.ok(!/id="remoteBar" class="hintbar/.test(src), 'remoteBar 不应再是 hintbar 单行条');
});

// ── F5：APP 内诊断入口形态（无地址栏/笔记名不能含 ? 的解法）──
test('F5 菜单诊断项 + __toggleDiag 免 URL 开关 + 跨重载标记 + 缓存诊断行', () => {
  const src = readSrc();
  // v6.1：菜单「诊断」一级项退役（入口收进「关于 Note Sync」彩蛋），浮层开关与标记保留给 ?diag
  assert.ok(!src.includes('id="menuDiag"'), 'v6.1 菜单不应再有「诊断」一级项');
  assert.ok(src.includes('id="menuAbout"'), 'v6.1 菜单应有「关于 NoteSync」项');
  assert.ok(src.includes('window.__toggleDiag'), 'diag 浮层应暴露免 URL 开关（?diag 通道保留）');
  assert.ok(src.includes('notesync_diag'), '应有跨重载保持标记');
  assert.ok(src.includes('mainDocCache='), '诊断应含主文档缓存读数');
  assert.ok(src.includes('pendingRemote='), '诊断应含远端挂起读数');
});

// ── F6：jsdom 行为——未保存改动时 poll 挂起远端（不消费版本），两条拍板路径 ──
test('F6 冲突全流程：挂起不消费版本 → 用服务器版 → 再造冲突 → 保留我的触发 PUT', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await makeKey();
  const baseCt = await window.encryptText('<div>base</div>', key);
  const remoteCt = await window.encryptText('<div>remote</div>', key);
  let note = { v: 5, ct: baseCt.ct, iv: baseCt.iv, salt: 'x' };
  let putCount = 0;
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') { putCount++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 9 }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
  await window.applyUnlocked(key, note);
  const bar = window.document.getElementById('remoteBar');
  assert.ok(bar.classList.contains('hidden'), '初始无冲突条');

  // 本机未保存改动 + 远端推进 v6 → poll 必须挂起而非吞噬
  editor.innerHTML = '<div>local-unsaved</div>';
  note = { v: 6, ct: remoteCt.ct, iv: remoteCt.iv, salt: 'x' };
  await window.poll();
  assert.ok(!bar.classList.contains('hidden'), '未保存改动下远端更新应亮冲突条');
  assert.equal(editor.innerHTML, '<div>local-unsaved</div>', '本机未保存内容不得被远端覆盖');
  assert.ok((window.__pollSkipCount || 0) >= 1, '挂起应计入诊断');
  const skip1 = window.__pollSkipCount;
  await window.poll();
  assert.equal(window.__pollSkipCount, skip1 + 1, '版本号未被消费：再次 poll 仍进挂起分支（旧版此处永久吞噬）');
  assert.equal(putCount, 0, '拍板前不得有任何 PUT');

  // 路径一：用服务器版
  window.document.getElementById('remoteTake').click();
  await sleep(120);
  assert.equal(editor.innerHTML, '<div>remote</div>', '用服务器版后应显示远端内容');
  assert.ok(bar.classList.contains('hidden'), '拍板后条应收起');
  assert.equal(putCount, 0, '用服务器版不产生 PUT');

  // 路径二：再造一次冲突 → 保留我的 → PUT 覆盖远端
  // v7.2.0：第二次远端内容必须真实不同（remote2）——症状4修复后 poll 三级分类：
  // 远端解密 html 与 lastHtml 严格相等=级0 静默消费版本不亮条（防 rem-fired 类空 bump 误报）。
  editor.innerHTML = '<div>local2</div>';
  const remote2Ct = await window.encryptText('<div>remote2</div>', key);
  note = { v: 10, ct: remote2Ct.ct, iv: remote2Ct.iv, salt: 'x' };
  await window.poll();
  assert.ok(!bar.classList.contains('hidden'), '再次冲突应再亮条');
  window.document.getElementById('remoteKeep').click();
  await sleep(150);
  assert.ok(putCount >= 1, '保留我的应触发 PUT（用户明确覆盖远端）');
  assert.ok(bar.classList.contains('hidden'), '保留我的后条应收起');
});

// ── F7：jsdom 行为——poll 应用远端时恢复提醒并同步原生层 ──
test('F7 poll 拿到远端新提醒：loadReminder 生效 + 原生 sync 收到新列表', async t => {
  const calls = [];
  const app = freshApp(w => {
    w.Capacitor = {
      isNativePlatform: () => false,
      Plugins: {
        RemBridge: {
          sync: async arg => { calls.push(arg); return { scheduled: arg && arg.list ? arg.list.length : 0, failed: 0 }; },
          requestExactAlarm: async () => ({ canScheduleExactAlarms: true })
        }
      }
    };
  }, 'http://localhost/f7note'); // v6.0：分区 upsert 后首页跳过同步，必须走真实笔记路由
  t.after(() => app.dom.window.close());
  const { window } = app;
  const key = await makeKey();
  const bodyCt = await window.encryptText('<div>b</div>', key);
  const at = Date.now() + 3600e3;
  const remEnc = await window.encryptText(JSON.stringify({ list: [{ at: at, text: '远端提醒' }] }), key);
  const remStr = JSON.stringify(remEnc);
  let note = { v: 5, ct: bodyCt.ct, iv: bodyCt.iv, salt: 'x', rem: null };
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 9 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
  await window.applyUnlocked(key, note);
  const baseCalls = calls.length;

  // 远端推进：正文不变、rem 新增 → poll 应用路径必须恢复提醒
  note = { v: 6, ct: bodyCt.ct, iv: bodyCt.iv, salt: 'x', rem: remStr };
  await window.poll();
  assert.ok(calls.length > baseCalls, '远端 rem 变化应触发原生 sync');
  const last = calls[calls.length - 1];
  assert.equal(last.list.length, 1, '原生层应收到 1 条远端提醒');
  assert.equal(last.list[0].text, '远端提醒', '提醒文案原样恢复');
  assert.equal(last.list[0].at, at, '提醒时间原样恢复');
});

// ── F8：Android/CI 形态——assets 三级兜底 + cacheInfo + 版本号 5.56 + tag 注入 ──
test('F8 MainActivity assets 兜底 + RemPlugin.cacheInfo + build.gradle/CI 版本号治本', () => {
  const main = readAndroid('MainActivity.java');
  assert.ok(main.includes('readAssetMainDoc'), 'MainActivity 应有 assets 末级兜底');
  assert.ok(main.includes('"public/index.html"'), '内置壳路径应为 assets/public/index.html');
  assert.ok(main.includes('interceptCount') && main.includes('fetchFailCount') &&
            main.includes('cacheHitCount') && main.includes('assetHitCount'), '应有四枚拦截诊断计数');

  const plugin = readAndroid(path.join('rem', 'RemPlugin.kt'));
  assert.ok(plugin.includes('fun cacheInfo'), 'RemPlugin 应有 cacheInfo 只读诊断方法');
  assert.ok(plugin.includes('MainActivity.interceptCount'), 'cacheInfo 应读 MainActivity 计数');

  const gradle = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'build.gradle'), 'utf8');
  assert.ok(gradle.includes('versionCode 806'), 'build.gradle versionCode 应随 APP_VERSION bump（标签不带版本注，v8.0.3 起根治第三连同族漂移）');
  assert.ok(gradle.includes('versionName "8.0.6"'), 'build.gradle versionName 应 bump 为 8.0.6');

  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'build-apk.yml'), 'utf8');
  assert.ok(wf.includes('GITHUB_REF_NAME#v'), 'CI 应从 tag 注入 versionName（v5.55 APK 自报 5.54 的治本）');
  assert.ok(wf.includes('versionCode $CODE'), 'CI 应注入 versionCode');
});
