// NoteSync v9.3.6 守护：#4 关大图吞幽灵重开 / A PC 统一金胶囊 pill / B 仅 Wi-Fi 静默预下载（web + Kotlin）。
// #1 三板豁免、K8 pill 退役、G4b 确定性化 分别由 v933 K9/K8 与 v930 G4b 覆盖。纪律：静态锚到补丁行、能上行为上行为。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.resolve(ROOT, 'index.html'), 'utf8');
const KT = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'update', 'UpdatePlugin.kt'), 'utf8');

test('V1 #4 关大图吞幽灵重开：拆除打 closedAt 戳 + 编辑器图片 click 500ms 内不重开', () => {
  assert.ok(SRC.includes('NS_IMG.closedAt = Date.now();'), '真关掉查看器须打 closedAt 时间戳');
  assert.ok(SRC.includes('if (NS_IMG.closedAt && Date.now() - NS_IMG.closedAt < 500) return;'),
    '编辑器图片 click 须在关窗后短窗内吞掉同一次手势的幽灵重开（修「点图关窗又立刻再放大」）');
});

test('V2 A PC/移动统一金胶囊 pill：nsAskConfirm 不再按 CHIP_HOVER_OK 分桌面细条', () => {
  const fn = SRC.slice(SRC.indexOf('function nsAskConfirm'), SRC.indexOf('function nsAskConfirm') + 700);
  assert.ok(fn.includes("b.className = 'ns-ask-m'"), 'nsAskConfirm 恒挂 .ns-ask-m');
  assert.ok(!fn.includes('要开始吗'), '桌面「方案1 细条」分支已移除（PC 与移动同款 pill）');
});

test('V3 B web：冷启动静默预下载钩子 + wifiOnly + 仅一次', () => {
  assert.ok(SRC.includes('async function nsPrefetchUpdate()'), '须有 nsPrefetchUpdate 预下载函数');
  assert.ok(SRC.includes('br.downloadApk({ url: apk.browser_download_url, tag, wifiOnly: true })'), '预下须带 wifiOnly:true');
  assert.ok(SRC.includes('window.__prefetchTag === tag') && SRC.includes('setTimeout(nsPrefetchUpdate,'), '本会话同版本只预下一次 + 冷启动延时触发');
  assert.ok(SRC.includes('if (nsVerCmp(tag, base) <= 0) return;'), '无新版须直接返回，不预下');
});

test('V4 B kotlin：downloadApk 支持 wifiOnly（非 Wi-Fi 跳过 + 仅 Wi-Fi 网络类型）+ isOnWifi', () => {
  assert.ok(KT.includes('val wifiOnly = call.getBoolean("wifiOnly") ?: false'), 'downloadApk 读 wifiOnly 参数');
  assert.ok(KT.includes('if (wifiOnly && !isOnWifi())'), 'wifiOnly 且非 Wi-Fi → 跳过（不偷跑蜂窝、不留排队通知）');
  assert.ok(KT.includes('if (wifiOnly) DownloadManager.Request.NETWORK_WIFI'), '预下载网络类型收窄为仅 Wi-Fi');
  assert.ok(KT.includes('private fun isOnWifi(): Boolean') && KT.includes('NetworkCapabilities.TRANSPORT_WIFI'), 'isOnWifi 用 ConnectivityManager/NetworkCapabilities 判定');
});

test('V5 B 权限：AndroidManifest 必须有 ACCESS_NETWORK_STATE（否则 isOnWifi 抛异常被吞→仅 Wi-Fi 预下载真机永不动作，R2 P1）', () => {
  const man = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.ok(man.includes('android.permission.ACCESS_NETWORK_STATE'), '缺 ACCESS_NETWORK_STATE → getNetworkCapabilities SecurityException → 预下载恒判非 Wi-Fi');
});
