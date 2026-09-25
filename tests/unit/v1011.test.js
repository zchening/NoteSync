// v10.1.1 单元测试——三修回归护栏
// T 组：T1 MCP/服务端/客户端三端笔记名小写归一（治「大写名凭据派生不匹配 → PUT 403」）
// S 组：A8 删除线 beforeinput 拦截（治「Blink 跨格式边界删除把 <s> 尾字符弹成裸文本」）+ ?diag 探针
// F 组：F16 折叠开合上方正文跳行（滚动条槽恒定 + 三角等大同形墨迹盒）
// V 组：版本 pin（三源一致由 version_pins 测试守，这里钉字面）
// 每条都按「撤掉对应修复必红」下钉，不做恒真断言。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = () => fs.readFileSync(INDEX_PATH, 'utf8');
const SRV = () => fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const MCP_PATH = path.join(ROOT, 'tools', 'notesync-mcp-server.js');
const MCP_SRC = () => fs.readFileSync(MCP_PATH, 'utf8');
const GRADLE = () => fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');

// ── T 组：T1 三端归一化 ──
test('V1011-T1a server.js extractId 归一化小写', () => {
  const s = SRV();
  assert.ok(/return decodeURIComponent\(m\[1\]\)\.toLowerCase\(\);/.test(s),
    'extractId 必须归一化——GET /api/note/XL 与档案 xl 必须同源，否则凭据闸 403');
});
test('V1011-T1b server.js SSE 流 id 归一化', () => {
  const s = SRV();
  const seg = s.slice(s.indexOf("url.replace(/\\/stream$/"));
  assert.ok(seg.length > 0 && /\.toLowerCase\(\)/.test(seg.slice(0, 300)),
    'SSE 订阅 id 必须与 extractId 同口径归一，防大写变体订阅错频道');
});
test('V1011-T1c server.js claim 端点 cid 归一化', () => {
  const s = SRV();
  assert.ok(/cid = decodeURIComponent\(.+\)\.toLowerCase\(\);/.test(s),
    'claim 端点必须归一化——认领建立凭据档案时落小写名');
});
test('V1011-T1d index.html 主路由 noteId 归一化', () => {
  const s = SRC();
  const seg = s.slice(s.indexOf('const noteId = nsRouteHit'), s.indexOf('const noteId = nsRouteHit') + 400);
  assert.ok(/\.toLowerCase\(\)/.test(seg), '主路由 noteId 必须小写——deriveWriteKey/localStorage/GET/PUT 全链共用此名');
});
test('V1011-T1e index.html parsePairLink 行为：扫码大写名归一为小写', () => {
  const { loadApp } = require('../helpers');
  const dom = loadApp();
  try {
    const f = dom.window.parsePairLink;
    assert.equal(typeof f, 'function', 'parsePairLink 应挂 window');
    assert.equal(f('https://note.xuyinji.com.cn/XL#k=abc'), '/xl#k=abc', '大写名必须归一小写，否则扫码打开大写笔记凭据派生错位');
    assert.equal(f('https://biji.xuyinji.com.cn/XL'), '/xl', '双域名同样归一');
    assert.equal(f('/XL'), '/xl', '裸路径同样归一');
    assert.equal(f('/normal'), '/normal', '小写名原样');
  } finally { dom.window.close(); }
});
test('V1012-T1f MCP assertName 行为：归一并返回小写名；非法名拒绝', () => {
  process.env.NOTESYNC_PASSPHRASE = 'test-pass-v1011';
  process.env.NOTESYNC_CACHE_DIR = path.join(os.tmpdir(), 'ns-mcp-v1011-test');
  const mcp = require(MCP_PATH);
  assert.equal(mcp.assertName('XL'), 'xl', '大写名必须归一返回小写——写入凭据按名字逐字符派生');
  assert.equal(mcp.assertName('Mixed_Case-9'), 'mixed_case-9', '混合大小写同样归一');
  assert.throws(() => mcp.assertName('bad name'), /笔记名/, '空格非法名拒绝');
  assert.throws(() => mcp.assertName(''), /笔记名/, '空名拒绝');
});
test('V1012-T1g MCP 源码：resolveNames/工具调用点走 assertName 归一', () => {
  const s = MCP_SRC();
  assert.ok(/function assertName\(name\) \{[^}]*toLowerCase\(\)/.test(s),
    'assertName 本体必须先归一再校验并返回归一结果');
  const hits = (s.match(/assertName\(/g) || []).length;
  assert.ok(hits >= 7, 'assertName 调用点应覆盖全部 name 入口（实际 ' + hits + ' 处）');
});

// ── S 组：A8 删除线 beforeinput 拦截 ──
test('V1011-S1 拦截器挂 #editor，入口闸四连（组字期/删除类型/选区/跨块）', () => {
  const s = SRC();
  const i = s.indexOf("editor.addEventListener('beforeinput'");
  assert.ok(i > -1, '拦截器应挂在 editor 上');
  const seg = s.slice(i, i + 900);
  assert.ok(/isComposing\) return/.test(seg), '组字期绝不拦');
  assert.ok(/deleteContentBackward/.test(seg) && /deleteContentForward/.test(seg), '只拦同块内单字符删除');
  assert.ok(/collapsed\) return/.test(seg), '选区删除交原生（其拆分产物两侧仍带 <s>）');
  assert.ok(/nsBlockOf\(pv\) !== nsBlockOf\(sc\)/.test(seg) || /nsBlockOf\(nx\) !== nsBlockOf\(sc\)/.test(seg),
    '跨块退格/前删交原生（块合并语义不碰）');
});
test('V1011-S2 拦截核心语义：preventDefault + 手动删字符保 <s> + 空壳移除 + input 重派发', () => {
  const s = SRC();
  const i = s.indexOf('到这里 = 同块内跨 <s> 边界删 <s> 内字符：拦截，手动删');
  assert.ok(i > -1, '拦截注释锚点存在');
  const seg = s.slice(i, i + 1400);
  assert.ok(/e\.preventDefault\(\)/.test(seg), '必须 preventDefault 挡住 Blink 原生删除（弹出根因）');
  assert.ok(/nodeValue\.slice\(0, tOff\) \+ tNode\.nodeValue\.slice\(tOff \+ 1\)/.test(seg),
    '手动删字符保持 <s> 结构完整');
  assert.ok(/sp\.remove\(\)/.test(seg), '空壳 <s> 按口径移除');
  assert.ok(/new Event\('input', \{ bubbles: true \}\)/.test(seg), '撤销记录/保存/linkify 与原生同路径');
});
test('V1011-S3 辅助函数四件套存在', () => {
  const s = SRC();
  for (const fn of ['function nsBlockOf(', 'function nsTextNodeFrom(', 'function nsPrevTextNode(', 'function nsNextTextNode(']) {
    assert.ok(s.includes(fn), '缺少 ' + fn);
  }
});
test('V1011-S4 ?diag 探针行：strike s=/sBare= 删除线完整性取证', () => {
  const s = SRC();
  assert.ok(/'strike: s=' \+ sAll\.length/.test(s) && /sBare=' \+ sAll\.filter/.test(s),
    '探针行必须存在——用户报障「末字母失去删除线」时复制即定位，sBare 增长=弹出复发');
  assert.ok(/s:not\(\.rem-done\)/.test(s), '探针统计手打删除线，排除 rem-done 已推送标记');
});

// ── F 组：F16 折叠开合上方正文跳行 ──
test('V1011-F1 #editor scrollbar-gutter:stable（滚动条出现/消失不再跳 8px）', () => {
  const s = SRC();
  const i = s.indexOf('#editor{');
  assert.ok(i > -1);
  const seg = s.slice(i, i + 600);
  assert.ok(/scrollbar-gutter:stable/.test(seg), '#editor 必须恒留滚动条槽，折叠开合才不会整篇重排');
});
test('V1011-F2 两态三角等大墨迹盒（收起 8×8 = 展开 8×8 旋转全等，行盒占宽相等）', () => {
  const s = SRC();
  const i = s.indexOf('#editor .ns-fold-mark{font-size:0');
  assert.ok(i > -1, '桌面 .ns-fold-mark 规则存在');
  const seg = s.slice(i, i + 400);
  assert.ok(!/width:14px/.test(seg), '不得用定宽格子（inline-flex 会让 ::before 脱离行内流、top:-6px 补偿失准，v1004 E4 实测 -4.0px）');
  assert.ok(/padding:0 3px/.test(seg), '保持 v10.1.0 行内流几何（E4/E8 闸钉死）');
  const cb = s.indexOf('#editor .ns-fold-mark::before{');
  assert.ok(cb > -1, '收起态 ::before 规则存在');
  const cseg = s.slice(cb, cb + 400);
  assert.ok(/border-top:4px solid transparent/.test(cseg) && /border-bottom:4px solid transparent/.test(cseg) && /border-left:8px solid currentColor/.test(cseg),
    '收起态墨迹盒必须 8w×8h（与展开态旋转 90° 全等且占宽相等，两态行盒占宽差归零→换行点恒定）');
  const ob = s.indexOf('.ns-fold-open>.ns-fold-mark::before{');
  assert.ok(ob > -1, '展开态 ::before 规则存在');
  const oseg = s.slice(ob, ob + 300);
  assert.ok(/border-top:8px solid currentColor/.test(oseg) && /border-left:4px solid transparent/.test(oseg) && /border-right:4px solid transparent/.test(oseg),
    '展开态墨迹盒 8w×8h（border-top:8px + 左右各 4px，与收起态旋转全等）');
  const narrow = s.indexOf('#editor .ns-fold-mark{display:inline-flex');
  assert.ok(narrow > -1 && /width:44px/.test(s.slice(narrow, narrow + 300)), '窄屏 44px 规则仍在（媒体查询覆盖）');
});

// ── V 组：版本 pin ──
test('V1011-V1 版本三源字面 pin', () => {
  const s = SRC();
  assert.ok(s.includes("const APP_VERSION = '10.1.2';"), 'APP_VERSION');
  assert.ok(s.includes("const BUILD_DATE = '2026-09-26';"), 'BUILD_DATE');
  assert.ok(/versionCode 1012\b/.test(GRADLE()), 'gradle versionCode');
  assert.ok(/versionName "10\.1\.2"/.test(GRADLE()), 'gradle versionName');
  assert.ok(/version: '10\.1\.2'/.test(MCP_SRC()), 'MCP serverInfo version');
});
