// v9.5.4 守护：①OTA 精确字节校验（JS 传 expectedBytes；Kotlin 复用/done 精确比对+坏文件即删）②版本固定名下载 URL（server.js 白名单路由+push 脚本）③启动自愈（onRenderProcessGone 重建+onResume 10min 陈旧 reload）④首拉 8s 超时落离线（withTimeout 包 init/unlock 的 apiGet）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const UPD = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/update/UpdatePlugin.kt'), 'utf8');
const ACT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/MainActivity.java'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const PUSH = fs.readFileSync(path.join(ROOT, 'tools/push_latest_apk.py'), 'utf8');

test('v9.5.4 OTA 精确校验：JS 三处传 expectedBytes，Kotlin 复用/done 精确比对且坏文件即删', () => {
  assert.ok(SRC.includes('expectedBytes: size || 0'), 'nsUpdDownload downloadApk 传 expectedBytes');
  assert.ok(SRC.includes('expectedBytes: apk.size || 0'), '预下载路径传 expectedBytes');
  assert.ok(SRC.includes('function updReset(url, tag, size)'), 'updReset 带 size 形参');
  assert.ok(UPD.includes('val expectedBytes = (call.getInt("expectedBytes") ?: 0).coerceAtLeast(0).toLong()'), 'Kotlin 解析 expectedBytes（可空安全，缺 key 不 NPE）');
  assert.ok(!UPD.includes('call.getInt("expectedBytes").takeIf'), '禁回潮：getInt 结果直接 takeIf 拆箱（缺 key NPE 被外层 try 吞成 ok:false，旧 JS 下载必坏）');
  assert.ok(UPD.includes('if (f.length() == expectedBytes)'), '复用要求精确相等');
  assert.ok(/坏文件即删/.test(UPD), '大小不符删坏文件重下');
  assert.ok(UPD.includes('f.length() == total'), 'done 校验 total 精确比对');
});

test('v9.5.4 版本固定名下载：server.js 白名单路由 + push 脚本上传副本且 URL 指向它', () => {
  assert.ok(SRV.includes(String.raw`/^\/dl\/(latest|v\d+(?:\.\d+)*)\.apk$/`), 'server.js /dl 白名单正则（无穿越面）');
  assert.ok(PUSH.includes('def versioned_dl_url(tag)'), 'push 脚本版本 URL 助手');
  assert.ok(PUSH.includes('browser_download_url": versioned_dl_url(meta.get("tag_name", ""))'), 'latest_app.json 下载 URL 指版本副本');
  assert.ok(PUSH.includes('apk/%s.apk" % tag'), '上传不可变版本副本');
});

test('v9.5.4 启动自愈：onRenderProcessGone 重建（进程内一次）+ onResume 10 分钟陈旧 reload', () => {
  assert.ok(ACT.includes('public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail)'), 'onRenderProcessGone 已消费（类名无 Web 前缀，CI 编译终裁）');
  assert.ok(!ACT.includes('WebRenderProcessGoneDetail'), '禁回潮错类名 WebRenderProcessGoneDetail（不存在，CI 必挂 cannot find symbol）');
  assert.ok(ACT.includes('didRendererGoneRecreate'), '进程内仅一次重建防循环');
  assert.ok(ACT.includes('recreate(); return true;'), '重建并消费回调（不消费系统按未处理杀 App）');
  assert.ok(ACT.includes('private static boolean didRendererGoneRecreate'), '防循环旗标必须 static（recreate 后实例字段归零＝循环，闸 R1/R2 双路命中）');
  assert.ok(ACT.includes('10 * 60_000L'), 'onResume 10 分钟陈旧守卫');
  assert.ok(ACT.includes('pausedAt = System.currentTimeMillis();'), 'onPause 记时间戳');
  // push 脚本：json 必须最后落（两个 APK put 之后），杜绝 /api/latest 指向不存在文件的 404 窗口
  const iApk = PUSH.indexOf('上传顺序倒装');
  const iVer = PUSH.indexOf('已上传（不可变副本）');
  const iJson = PUSH.indexOf('URL 切换零 404 窗口');
  assert.ok(iApk > -1 && iVer > iApk && iJson > iVer, '上传顺序：latest.apk → 版本副本 → json 最后（闸 R1-P1）');
});

test('v9.5.4 首拉超时：withTimeout 8s 包 init 自动解锁与手动 unlock 的 apiGet，后台同步不包', () => {
  assert.ok(SRC.includes('function withTimeout(p, ms)'), 'withTimeout 助手在位');
  assert.ok(SRC.includes('note = await withTimeout(apiGet(), 8000);'), '两处首拉（init/unlock）带超时');
  const n = (SRC.match(/withTimeout\(apiGet\(\), 8000\)/g) || []).length;
  assert.strictEqual(n, 2, '恰好 2 处首拉超时（后台同步 apiGet 不激进超时）');
});
