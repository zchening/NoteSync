// v5.54 单元测试：页脚菜单 + 收藏体系 + 过期提醒彻底静默 + 离线口令解锁回退
// E1 菜单 HTML 形态 | E2 REM_DONE 退役 | E3 G6 离线解锁 | E4 原生 60s 容差
// E5 jsdom 收藏读写行为 | E6 通知点击监听落地
// 风格参考 v553.test.js（D 系列）与 helpers.js（loadApp/INDEX_PATH）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, INDEX_PATH } = require('../helpers');

function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}

function readReceiverKt() {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'rem', 'RemReceiver.kt'),
    'utf8');
}

// ── E1：菜单面板与入口存在，返回首页走 assign（留历史） ──
test('E1 页脚菜单 HTML：menuBtn 在 footer 内，面板含返回首页/收藏/收藏夹结构', () => {
  const src = readSrc();
  // menuBtn 必须在 <footer ...> 标签内（页脚最左侧入口）
  const footIdx = src.indexOf('<footer');
  const footEnd = src.indexOf('</footer>', footIdx > -1 ? footIdx : 0);
  assert.ok(footIdx > -1 && footEnd > footIdx, '应存在 <footer> 结构');
  const foot = src.slice(footIdx, footEnd);
  assert.ok(foot.includes('id="menuBtn"'), 'menuBtn 必须位于 footer 标签内');

  // 面板骨架：mask/box + 返回首页 + 收藏按钮 + 收藏夹列表 + 空态
  assert.ok(src.includes('id="menuMask"'), '应存在 menuMask 遮罩');
  assert.ok(src.includes('id="menuBox"'), '应存在 menuBox 面板');
  assert.ok(src.includes('id="menuHome"'), '应存在 menuHome 返回首页项');
  assert.ok(src.includes('id="menuFav"'), '应存在 menuFav 收藏切换项');
  assert.ok(src.includes('id="menuFavList"'), '应存在 menuFavList 收藏列表');
  assert.ok(src.includes('id="menuFavEmpty"'), '应存在 menuFavEmpty 空态');

  // 返回首页与收藏夹行跳转都走 location.assign（保留历史，返回键可退回）
  assert.ok(src.includes("location.assign('/')"), 'menuHome 应走 location.assign(\'/\')');
  assert.ok(src.includes("location.assign('/' + encodeURIComponent(name))"),
    '收藏夹行点击应跳转 / + encodeURIComponent(name)');
  // 遮罩点空白关闭（e.target === menuMask 才收起，点面板内容不关）
  assert.ok(src.includes('if (e.target === menuMask)'), 'menuMask 应有点空白处关闭判定');
});

// ── E2：REM_DONE 整体退役，过滤纯时间判断 ──
test('E2 过期提醒彻底静默：REM_DONE 函数定义全退役，过滤简化为纯时间判断', () => {
  const src = readSrc();
  // 四个函数定义必须 0 命中（注释提及 REM_DONE 字样允许，故断言带 function 前缀的定义形态）
  for (const def of ['function isRemDone', 'function remDoneMap', 'function markRemDone', 'function unmarkRemDone']) {
    assert.ok(!src.includes(def), `不应再有 ${def} 定义（v5.54 退役）`);
  }
  assert.ok(!src.includes('const REM_DONE_KEY'), 'REM_DONE_KEY 常量定义应删除');

  // scheduleReminders 与正文识别的过滤都改为纯时间判断
  assert.ok(src.includes('filter(m => m.at > now)'), '提醒匹配过滤应为 m.at > now 纯时间判断');
  // 补弹分支必须删除：scheduleReminders 内不再出现 showRemCard(overdue
  const schedIdx = src.indexOf('function scheduleReminders');
  assert.ok(schedIdx > -1, '应存在 scheduleReminders 定义');
  const schedSeg = src.slice(schedIdx, schedIdx + 900);
  assert.ok(!schedSeg.includes('showRemCard('), 'scheduleReminders 内不应再调用 showRemCard（过期补弹已删）');
});

// ── E3：G6 离线口令解锁回退分支完整 ──
test('E3 G6 离线解锁：unlock catch 内离线分支用缓存盐派生 key 解本地缓存', () => {
  const src = readSrc();
  const unlockIdx = src.indexOf('async function unlock(pass)');
  assert.ok(unlockIdx > -1, '应存在 unlock(pass) 函数');

  // unlock 函数体内（下一函数之前）定位离线分支
  const nextFnIdx = src.indexOf('function unlockRemAudio', unlockIdx);
  const seg = src.slice(unlockIdx, nextFnIdx > unlockIdx ? nextFnIdx : unlockIdx + 9000);
  const offIdx = seg.indexOf('if (!navigator.onLine) {');
  assert.ok(offIdx > -1, 'unlock catch 内应有离线分支');

  const branch = seg.slice(offIdx, offIdx + 1200);
  assert.ok(branch.includes('const c = cacheGet()'), '离线分支应先取本地缓存');
  assert.ok(branch.includes('c.ct && c.salt'), '必须有 ct+salt 双守卫（旧缓存无 salt 安全回落）');
  assert.ok(branch.includes('deriveKey(pass, b64ToBuf(c.salt))'), '应用缓存盐派生密钥');
  assert.ok(branch.includes('await decryptText('), '应先用口令校验（解密失败即口令不符）');
  assert.ok(branch.includes('loadCachedBody('), '应走本地缓存进笔记');
  assert.ok(branch.includes('startSync()'), '进笔记后应启动同步');

  // cachePut 定义带 salt 字段（新缓存可离线派生）
  assert.ok(src.includes('salt: obj.salt || null'), 'cachePut 应落 salt 字段');
});

// ── E4：原生迟到闹钟 60 秒容差静默 ──
test('E4 RemReceiver 迟到闹钟容差：超过 60 秒或 at 非法直接丢弃', () => {
  const kt = readReceiverKt();
  const idx = kt.indexOf('if (at <= 0 || System.currentTimeMillis() - at > 60_000L) return');
  assert.ok(idx > -1, 'onReceive 开头应有 60 秒容差丢弃');
  // 容差判定必须在通知渠道创建之前（丢弃路径零副作用）
  const chIdx = kt.indexOf('createNotificationChannel', idx);
  assert.ok(chIdx > idx, '容差丢弃应发生在通知渠道创建之前');
});

// ── E5：jsdom 行为——收藏读写/截断/过滤 + 首页隐藏收藏按钮 ──
test('E5 jsdom：收藏 writeFavs/readFavs 读写与 20 条截断；首页 renderMenu 隐藏收藏按钮', () => {
  const dom = loadApp(); // http://localhost/ → landing 分支，noteId 为空
  const w = dom.window;

  assert.equal(typeof w.readFavs, 'function', 'readFavs 应为顶层函数挂 window');
  assert.equal(typeof w.writeFavs, 'function', 'writeFavs 应为顶层函数挂 window');
  assert.equal(typeof w.renderMenu, 'function', 'renderMenu 应为顶层函数挂 window');

  // 基本读写（跨 realm 数组不能 deepStrictEqual——jsdom vm 原型不同，用序列化比对）
  w.writeFavs(['alpha', 'beta']);
  assert.equal(JSON.stringify(w.readFavs()), JSON.stringify(['alpha', 'beta']), '写入后应原序读出');

  // 超上限截断到 20，保留最前（最新收藏 unshift 在前）
  const big = Array.from({ length: 25 }, (_, i) => 'note-' + i);
  w.writeFavs(big);
  const got = w.readFavs();
  assert.equal(got.length, 20, '写入 25 条应截断到 FAVS_MAX=20');
  assert.equal(got[0], 'note-0', '截断应保留队首（最新收藏）');

  // 非字符串项过滤（readFavs 防御：污染数据不致崩）
  w.localStorage.setItem('notesync_favs', JSON.stringify(['ok', 3, null, 'x']));
  assert.equal(JSON.stringify(w.readFavs()), JSON.stringify(['ok', 'x']), '非字符串项应被过滤掉');

  // 损坏 JSON 不抛错返回空数组
  w.localStorage.setItem('notesync_favs', '{oops');
  assert.equal(w.readFavs().length, 0, '损坏数据应回空数组');

  // 首页（noteId 为空）renderMenu 后收藏按钮隐藏
  w.renderMenu();
  const favBtn = w.document.getElementById('menuFav');
  assert.ok(favBtn, 'menuFav 元素应存在');
  assert.ok(favBtn.classList.contains('hidden'), '首页无笔记可收藏，menuFav 应隐藏');

  dom.window.close(); // 释放 jsdom 资源，否则 node --test 进程不退出（SIGTERM）
});

// ── E6：原生通知点击事件落地（v5.57 起不再弹提醒面板；v6.0 恢复监听=跨笔记跳转，依旧严禁弹面板） ──
test('E6 通知点击不得 toggleRemPanel（v5.57 行为变更护栏，v6.0 跳转语义不放宽）', () => {
  const src = readSrc();
  // v6.0：监听恢复（跨笔记跳转到提醒所属笔记），但「点通知再弹提醒面板」的旧形态仍不得回潮
  assert.ok(!/rem-notify-click'[^\n]*toggleRemPanel/.test(src), '通知点击不得再打开提醒面板');
  assert.ok(/rem-notify-click[\s\S]{0,400}location\.assign\('\/' \+ encodeURIComponent\(/.test(src), 'v6.0：监听必须走跨笔记跳转（location.assign），不是弹面板');
});
