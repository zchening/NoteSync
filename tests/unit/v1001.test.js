// v10.0.1 守护：两报障根修——
// ①导出图页头右上 noteId 刻印「字母下半截没了」：盒子高=字号(11px/1)+overflow:hidden 裁掉 g/p/q/y/j 下伸，行高提 1.6；
// ②OTA「下载已取消/失败」：同 url 在跑单被互撤重下（预下载↔手动撞车）——原生桥改「在跑单接管」，JS 侧预下载落盘+让位、
//   重试补 size（旧版漏传退「>1MB 即复用」直通坏件）、failed 提示上屏 reason 码。
// 前提修正记档：v9.3.2/v9.5.4 起 /api/latest 已把下载地址重写为境内 biji /dl/vX.Y.Z.apk（G9d 钉死），GitHub 直链不在本次范围。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const KT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/update/UpdatePlugin.kt'), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const MCP = fs.readFileSync(path.join(ROOT, 'tools/notesync-mcp-server.js'), 'utf8');

test('V1001-A 导出页头刻印裁字：行高 1.6、省略号承重件不拆、旧裁字形态禁回潮', () => {
  const i = SRC.indexOf('stamp.style.cssText');
  assert.ok(i > 0, 'renderNotePng 刻印行缺失');
  const seg = SRC.slice(i, i + 260);
  assert.ok(seg.includes('font:11px/1.6 var(--mono)'), '刻印行高必须 11px/1.6（盒子容得下 g/p/q/y/j 下伸）');
  assert.ok(seg.includes('overflow:hidden') && seg.includes('text-overflow:ellipsis'), '省略号承重（overflow:hidden+45% 限宽）不许顺手拆');
  assert.ok(!SRC.includes('font:11px/1 var(--mono)'), '禁回潮：盒子高=字号的 11px/1 刻印（用户实拍「字母下半显示不全」根因）');
  assert.ok(SRC.includes('font:12px/1 var(--mono)'), '日期段 12px/1 不动——纯数字无下伸字母，改动范围精准');
});

test('V1001-B 原生桥在跑单接管：先挂接后判件，删件只会是终态残件', () => {
  const iAttach = KT.indexOf('findActiveTask(dm, url, f.absolutePath)');
  const iExists = KT.indexOf('if (f.exists())');
  const iDelete = KT.indexOf('try { f.delete() } catch');
  assert.ok(iAttach > 0 && KT.includes('ret.put("attached", true)') && KT.includes('ret.put("id", activeId)'), '缺在跑单接管分支');
  assert.ok(iAttach < iExists && iAttach < iDelete, '挂接必须在判件/删件之前——旧序「删在写文件再重下」就是截断件与 gone 的来源');
  assert.ok(!KT.includes('半成品残留：撤旧任务'), '禁回潮：无差别「撤旧单+删半成品+从零重下」');
  assert.ok(KT.includes('STATUS_PENDING') && KT.includes('STATUS_RUNNING') && KT.includes('STATUS_PAUSED'), 'findActiveTask 只认三种未完成态');
  const bodyStart = KT.indexOf('private fun findActiveTask');
  const body = KT.slice(bodyStart, KT.indexOf('/** downloadState', bodyStart));
  assert.ok(bodyStart > 0 && body.length > 100, 'findActiveTask 函数体定位失败');
  assert.ok(!body.includes('setFilterById'), '兜底全查不得按 id 过滤（进程重启后内存映射已清零，正是要找回 unknown id 的单）');
  assert.ok(KT.includes('DownloadManager.COLUMN_URI') && KT.includes('DownloadManager.COLUMN_LOCAL_URI'), '远端 url 与落盘路径双指纹匹配');
});

test('V1001-C web 侧撞车三修：busy 标记、重试补 size、reason 上屏', () => {
  assert.ok(SRC.includes('window.__updBusy = true;'), '手动下载须置 busy（预下载让位判据）');
  assert.ok(SRC.includes("clearInterval(updTimer); window.__updBusy = false;"), 'done/终态须清 busy——不清则本会话永不再预下载');
  assert.ok(SRC.includes('y.onclick = () => nsUpdDownload(url, tag, size);'), '重试必须带上 size');
  assert.ok(!SRC.includes('y.onclick = () => nsUpdDownload(url, tag);'), '禁回潮：重试丢 size→expectedBytes=0 退「>1MB 即复用」把截断件直通安装');
  assert.ok(SRC.includes("st.error ? '（' + st.error + '）' : ''"), 'failed 提示必须上屏 dm-reason 码（黑盒变线索，用户口径「点重试」保留）');
});

test('V1001-D 三 bump 10.0.1 + 双壳逐字节', () => {
  assert.ok(SRC.includes("const APP_VERSION = '10.1.1';"), 'APP_VERSION 应 10.0.1');
  assert.ok(GRADLE.includes('versionCode 1011') && GRADLE.includes('versionName "10.1.1"'), 'gradle 应 1001/10.0.1');
  assert.ok(MCP.includes("version: '10.1.1'"), 'MCP serverInfo 应 10.0.1');
  const a = fs.readFileSync(path.join(ROOT, 'www/index.html'));
  const b = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'));
  const c = fs.readFileSync(path.join(ROOT, 'index.html'));
  assert.ok(a.equals(c) && b.equals(c), '双壳必须与根 index.html 逐字节一致');
});
