// v5.58 单元测试：五连修的回归护栏
// H1 冲突卡加宽醒目+文案定稿 | H2 离线条移入状态栏 | H3 页脚/菜单全端加大
// H4 三端菜单统一+网页扫码 | H5 盐根治（服务端空盐保护/前端兜底/自愈/诊断）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

function readSrc() {
  return fs.readFileSync(INDEX_PATH, 'utf8');
}
function readServer() {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
}

// ── H1：冲突卡加宽更醒目 + 文案定稿（v7.4.0：检测到同步冲突 / 保留本机 / 使用云端）──
test('H1 confcard 加宽 420 + 强调条 + 文案「其他设备上有更新…」+ 按钮保留本机/使用云端', () => {
  const src = readSrc();
  assert.ok(src.includes('width:min(92vw,420px)'), '浮卡应加宽到 min(92vw,420px)（用户反馈太窄实锤）');
  assert.ok(src.includes('border-top:3px solid var(--accent)'), '浮卡应有顶部强调色条（更醒目）');
  assert.ok(src.includes('min-height:44px'), '冲突卡按钮应 44px 触控高');
  assert.ok((src.match(/>检测到同步冲突<\/div>/g) || []).length === 2, '两卡标题应为「检测到同步冲突」');
  assert.ok((src.match(/其他设备上有更新，与本地改动冲突。/g) || []).length >= 3, '两卡正文 + draftMsg 动态分支应为 v7.4.0 拍板文案（共 3 处）');
  assert.ok((src.match(/>保留本机<\/button>/g) || []).length === 2, '两卡主按钮应为「保留本机」');
  assert.ok((src.match(/>使用云端<\/button>/g) || []).length === 2, '两卡次按钮应为「使用云端」');
  assert.ok(!src.includes('发现冲突：选哪边'), 'v7.3.x 旧标题应退役');
  assert.ok(!src.includes('使用新版本') && !src.includes('发现另一台设备'), 'v7.3.x 旧按钮/正文文案应退役');
  assert.ok(!src.includes('保留本机修改') && !src.includes('使用服务器版本'), 'v5.57 旧按钮文案应退役');
  assert.ok(!src.includes('服务器上有更新的内容，本机还有未保存的修改'), 'v5.57 旧正文应退役');
});

// ── H2：离线条移入页脚状态栏 + 文案「离线·同步时间：X」──
test('H2 offlineBar 在 footer 内 + 新文案 + 悬浮条 CSS 退役', () => {
  const src = readSrc();
  const footIdx = src.indexOf('<footer id="foot">');
  const barIdx = src.indexOf('id="offlineBar"');
  assert.ok(footIdx > -1 && barIdx > footIdx && barIdx < footIdx + 300, 'offlineBar 应在 footer 标签内部');
  assert.ok(src.includes('· 最后同步：'), '文案应为「· 最后同步：」（v6.0 起并入状态栏正文、去掉年份）');
  assert.ok(!src.includes('上次同步于'), '旧文案「上次同步于」应退役');
  assert.ok(!src.includes('.offlinebar:not(.hidden)+.upload-status'), '悬浮条错位规则应随悬浮条退役');
  assert.ok(!/\.offlinebar\{position:fixed/.test(src), 'offlinebar 不应再是 fixed 悬浮条');
});

// ── H3：页脚加高 + ☰/菜单项全端加大（不再只限 APP）──
test('H3 页脚 min-height 46 + menuBtn 22px/44px 触控 + 菜单项 42px 全局（v7.0.1 瘦身）', () => {
  const src = readSrc();
  assert.ok(/footer\{[^}]*min-height:46px/.test(src), '页脚应 min-height 46px');
  assert.ok(/footer\{[^}]*padding:14px 18px/.test(src), '页脚应加高（padding 14px）');
  assert.ok(/#menuBtn\{[^}]*font-size:22px/.test(src), '☰ 应放大到 22px');
  assert.ok(/#menuBtn\{[^}]*min-height:44px/.test(src), '☰ 点击区应 ≥44px');
  assert.ok(/\.menu-item\{[^}]*min-height:42px/.test(src), 'v7.0.1 菜单项应 min-height 42px（48→42 瘦身）');
  assert.ok(/\.menu-item\{[^}]*font-size:15px/.test(src), 'v6.2 菜单项应 15px（16→15 回调）');
  assert.ok(!src.includes('body.native-app .menu-item') && !src.includes('body.native-app #menuBtn'), 'APP 专属加大规则应并入全局');
});

// ── H4：三端菜单统一 + 网页端扫码 ──
test('H4 native-only 退役 + 顶栏两枚全平台隐藏 + scanWithWebCamera', () => {
  const src = readSrc();
  assert.ok(!src.includes('native-only'), 'native-only 机制应整体退役（三端布局一致）');
  assert.ok(!src.includes("classList.add('native-app')"), 'native-app 钩子应随 CSS 退役');
  assert.ok(src.includes('#themeBtn, #lock{display:none}'), '顶栏日夜间/退出锁定应全平台隐藏（v5.58 起不只 APP）');
  assert.ok(src.includes('async function scanWithWebCamera()'), '应有网页端扫码函数');
  assert.ok(src.includes("typeof window.BarcodeDetector !== 'undefined'"), '网页扫码应探测 BarcodeDetector 支持（v6.0 起不支持时走 jsQR 兜底而非直接劝退）');
  // v6.1：提示文案分流——不再一律「请用 APP」（PC 网页端本就支持扫码）
  assert.ok(src.includes('当前环境无法调用摄像头（需 HTTPS）'), 'mediaDevices 缺失应提示 HTTPS 而非「请用 APP」');
  assert.ok(src.includes('扫码组件加载失败，请稍后重试'), 'jsQR 加载失败应有独立提示');
  assert.ok(src.includes('未检测到可用摄像头'), '无摄像头设备应有独立提示');
  assert.ok(src.includes('await scanWithWebCamera()'), 'menuScan 应有网页端分支（无插件时走自写扫码层）');
  assert.ok(src.includes('getUserMedia({ video: { facingMode: \'environment\' } })'), '网页扫码应走后置摄像头');
});

// ── H5：盐根治——服务端空盐保护 + 前端兜底/自愈/诊断 ──
test('H5 server.js 空盐不覆写 + currentSaltB64 三处兜底 + 自愈 + 诊断盐状态', () => {
  const sv = readServer();
  assert.ok(sv.includes("(typeof obj.salt === 'string' && obj.salt) ? obj.salt : (cur.salt || '')"), '服务端 PUT 应空盐保留原盐（正确口令恒定解密失败的根因）');

  const src = readSrc();
  assert.ok(src.includes('function currentSaltB64()'), '应有 currentSaltB64 兜底函数');
  assert.ok((src.match(/currentSaltB64\(\)/g) || []).length >= 4, 'PUT 盐应全部走 currentSaltB64（含定义/注释外三处调用）');
  assert.ok(!src.includes('salt: bufToB64(serverSalt)'), '不得再直接 bufToB64(serverSalt)（null 产出空串曾冲掉服务端盐）');
  const offIdx = src.indexOf('serverSalt = b64ToBuf(c.salt); // v5.58：离线解锁路径也落地 serverSalt');
  assert.ok(offIdx > -1, '离线缓存解锁路径应落地 serverSalt');
  assert.ok(src.includes('let healed = false;') && src.includes('if (!healed) { await reportFail(); return; }'), '解锁失败应先走缓存盐自愈，两步都不过才计失败');
  assert.ok(src.includes('if (!note.salt) { try { const rr2 = await apiPut({ ct: note.ct, iv: note.iv, salt: c.salt }); if (rr2 && typeof rr2.v === \'number\') { localVer = rr2.v; note.v = rr2.v; } } catch (e2) {} }'), '自愈成功应回写服务端盐并接回 v（v6.0 起同步 localVer；v7.5.1 起同步 note.v 防 applyUnlocked 覆盖）');
  assert.ok(src.includes("'salt=' + (typeof serverSalt !== 'undefined' && serverSalt ? 'ok' : 'NONE')"), '诊断应含服务端盐状态');
  assert.ok(src.includes("'  cacheSalt='"), '诊断应含缓存盐状态');
});
