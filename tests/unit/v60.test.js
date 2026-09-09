// v6.0 单元测试：十连修的回归护栏
// T1 空 ct 落盐覆写 + localVer 落后误报远端冲突（数据级 P0）
// T2 页脚离线条并入正文 | T3 右下角刷新按钮 | T4 菜单图标细线 SVG 化
// T5 修改口令（Y 简单式）+ 旧设备「口令已变更」检测
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

// ── T1：新建笔记误报「发现另一台设备上的更新」（数据级 P0）──
// 旧版落盐硬写 ct:'' —— 既清空并发端正文，又丢弃返回 v 让 localVer 落后；
// 落后者遇上 SSE 触发的 poll 即被判成「远端有更新 + 本机未保存」。
test('T1 落盐不写空 ct + 接回 v + 在途写入闸门 + 服务端空 ct 保护', () => {
  const src = readSrc();
  const sv = readServer();

  assert.ok(!/apiPut\(\{\s*ct:\s*''/.test(src), '不得再用空 ct 覆写服务端（会清空并发端刚写入的正文）');
  assert.ok(src.includes("const rr = await apiPut({ ct: note.ct || '', iv: note.iv || '', salt: currentSaltB64() });"), '落盐应回写 GET 到的 ct/iv');
  assert.ok(src.includes("if (rr && typeof rr.v === 'number') { localVer = rr.v; note.v = rr.v; }"), '落盐必须接回 v 回写 localVer，并同步 note.v 防 applyUnlocked 用旧快照覆盖回 0');

  assert.ok(src.includes('let inflightWrites = 0;'), '应有在途写入计数');
  assert.ok(src.includes('inflightWrites++;'), 'apiPut 发出时应 +1');
  assert.ok(src.includes('if (inflightWrites > 0) inflightWrites--;'), '响应回来应 -1（finally 保证）');
  assert.ok(src.includes('if (inflightWrites > 0) return;'), 'poll 应跳过在途窗口，别把自增的 v 当成别人的更新');

  assert.ok(sv.includes("(typeof obj.ct === 'string' && obj.ct) ? obj.ct : (cur.ct || '')"), '服务端 PUT 应空 ct 保留原正文（旧版客户端仍在硬发空串）');
  assert.ok(sv.includes("(typeof obj.iv === 'string' && obj.iv) ? obj.iv : (cur.iv || '')"), '服务端 PUT 应空 iv 保留原 iv');
  assert.ok(sv.includes('ct: ctIn, iv: ivIn'), '写入应使用兜底后的 ct/iv');
});

// ── T2：页脚离线条并入状态栏正文（灰点 离线 · 最后同步：MM-DD hh:mm 浑然一体）──
test('T2 离线条文案「· 最后同步：」+ 与状态文字同字号同色（胶囊样式退役）', () => {
  const src = readSrc();
  assert.ok(src.includes('· 最后同步：'), '文案应为「· 最后同步：」');
  assert.ok(!src.includes('离线·同步时间：'), '旧文案「离线·同步时间：」应退役');
  assert.ok(src.includes('function fmtSyncShort(ts)'), '应有短格式时间函数（不带年份）');
  assert.ok(src.includes('t.textContent = ts ? fmtSyncShort(ts) : '), '离线条应走短格式');
  assert.ok(/\.offlinebar\{[^}]*font-size:inherit/.test(src), '离线条应继承页脚字号，不再 11px 小字');
  assert.ok(!/\.offlinebar\{[^}]*border:1px/.test(src), '离线条不应再有胶囊边框');
  assert.ok(!/\.offlinebar\{[^}]*border-radius:999px/.test(src), '离线条不应再有胶囊圆角');
  assert.ok(!/\.offlinebar\{[^}]*padding:3px/.test(src), '离线条不应再有胶囊内边距');
});

// ── T3：右下角刷新按钮 ──
test('T3 右下角刷新按钮：1.7px 细线 + 44px 触控 + 复用 poll 冲突判定', () => {
  const src = readSrc();
  const footIdx = src.indexOf('<footer id="foot">');
  const btnIdx = src.indexOf('id="refreshBtn"');
  assert.ok(footIdx > -1 && btnIdx > footIdx, '刷新按钮应在 footer 内');
  assert.ok(src.includes('#refreshBtn{position:absolute;right:10px'), '应贴右下角');
  assert.ok(/#refreshBtn\{[^}]*min-height:44px/.test(src), '触控区应 44px');
  assert.ok(src.slice(btnIdx, btnIdx + 400).includes('stroke-width="1.7"'), '图标应是 1.7px 细线，与顶栏同族');
  assert.ok(src.includes('#refreshBtn.spinning svg{animation:spin'), '刷新中应有旋转反馈');
  assert.ok(src.includes("if (!cryptoKey) { showUploadStatus('请先解锁'); return; }"), '未解锁应明确提示，不静默');
  assert.ok(src.includes('if (busy || inflightWrites > 0) {') && src.includes("showUploadStatus('正在保存中"), '保存/写入在途时不重复拉，且给轻提示不再纯静默（v7.5.1）');
  assert.ok(!src.includes('if (busy || inflightWrites > 0) return;'), '旧的忙/在途纯静默 return 应退役');
  assert.ok(src.includes('try { await poll(); }'), '复用 poll——有未保存改动时走冲突卡，绝不静默覆盖');
});

// ── T4：菜单前缀 Unicode 字形 → 1.7px 细线 SVG ──
test('T4 菜单项细线 SVG 图标 + Unicode 字形前缀退役 + 收藏按钮动态图标', () => {
  const src = readSrc();
  // v7.0.1：菜单图标独立加大 26px（flex 布局，行框解耦）
  assert.ok(src.includes('.menu-item svg{width:26px;height:26px;flex:none}'), 'v7.0.1 菜单 SVG 应 26px（flex）');
  assert.ok(!src.includes('>⌂ ') && !src.includes('>▸ ') && !src.includes('>▣ ') && !src.includes('>◐ ') && !src.includes('>⎋ ') && !src.includes('>⌁ ') && !src.includes('>‹ '), 'Unicode 字形前缀应全部退役');
  assert.ok(!src.includes("'★ 收藏笔记'") && !src.includes("'☆ 取消收藏'"), '收藏按钮不再用纯文本（textContent 会清掉 SVG）');
  assert.ok(src.includes("favBtn.innerHTML = (faved ? STAR_IN_SVG : STAR_OUT_SVG) + (faved ? '取消收藏' : '收藏笔记');"), '收藏按钮图标应随状态用 innerHTML 重写');
  assert.ok((src.match(/<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"/g) || []).length >= 12, 'v6.1 菜单全部条目图标（含返回/新增/关于）应升级为 1.9px 线宽');
});

// ── T5：修改口令（Y 简单式）──
test('T5 修改口令：旧口令显式验证 → 新盐轮换 → 本机密钥/缓存/草稿全部换新', () => {
  const src = readSrc();
  const passIdx = src.indexOf('id="menuPass"'), lockIdx = src.indexOf('id="menuLock"');
  assert.ok(passIdx > -1 && passIdx < lockIdx, '「修改口令」菜单项应存在且在「退出锁定」之前');
  assert.ok(src.includes('id="cpMask"') && src.includes('id="cpOld"') && src.includes('id="cpNew"') && src.includes('id="cpNew2"'), '改口令面板应含旧口令 + 新口令两遍输入');
  assert.ok(src.includes('async function cpVerify()'), '应有旧口令验证步骤');
  assert.ok(/cpVerify[\s\S]{0,900}await deriveKey\(pass, saltBuf\)[\s\S]{0,200}await decryptText\(note\.ct, note\.iv, k\)/.test(src), '验证必须重派生并解开服务端当前密文，不能只信内存密钥');
  assert.ok(src.includes('crypto.getRandomValues(new Uint8Array(16))'), '应生成 16 字节新随机盐');
  assert.ok(/cpRotate[\s\S]{0,1400}await deriveKey\(p1, saltNew\)/.test(src), '新密钥必须由新口令+新盐派生');
  assert.ok(/cpRotate[\s\S]{0,2400}apiPut\(\{ ct: enc\.ct, iv: enc\.iv, salt: bufToB64\(saltNew\), rem: remOut(?:, baseV: localVer)? \}\)/.test(src), 'PUT 应携带新盐与非空 ct（服务端 v5.58 只挡空盐，非空直接采纳；v7.3.3 补 baseV 乐观并发红线8）');
  assert.ok(/cpRotate[\s\S]{0,3200}localStorage\.setItem\(KEY_STORE, bufToB64\(await crypto\.subtle\.exportKey\('raw', keyNew\)\)\)/.test(src), '改完必须更新本机记住的密钥');
  assert.ok(/cpRotate[\s\S]{0,3600}cachePut\(\{ ct: enc\.ct, iv: enc\.iv, v: r\.v, salt: bufToB64\(saltNew\)/.test(src), '离线缓存必须换新密文，绝不能留旧密钥的缓存');
  assert.ok(/cpRotate[\s\S]{0,4000}clearDraft\(\)/.test(src), '旧密钥加密的草稿必须清除');
});

// ── T5b：其他设备「口令已变更」检测（Y 简单式的配套，防旧内容覆盖服务端）──
test('T5b 旧设备检测：记住的密钥解不开服务端密文 → 清本机数据 + 明确提示', () => {
  const src = readSrc();
  assert.ok(src.includes("err.textContent = '口令已变更，请输入新口令';"), '应提示「口令已变更」而不是干巴巴解密失败');
  assert.ok(/catch \(e\) \{[\s\S]{0,200}localStorage\.removeItem\(KEY_STORE\);[\s\S]{0,120}cacheClear\(\); clearDraft\(\);[\s\S]{0,200}cryptoKey = null;[\s\S]{0,120}mask\.classList\.remove\('hidden'\);/.test(src), '解密失败应清 KEY_STORE/缓存/草稿并弹口令框，防止旧内容被保存覆盖服务端');
});

// ── T6：历史版本（菜单二级视图 + 密文快照环）──
test('T6 历史版本 UI：菜单入口 + 二级视图（列表/空态/返回/手动打点）', () => {
  const src = readSrc();
  const histIdx = src.indexOf('id="menuHistEntry"'), passIdx = src.indexOf('id="menuPass"');
  assert.ok(histIdx > -1 && histIdx < passIdx, '「历史版本」菜单项应存在且在「修改口令」之前');
  for (const id of ['menuHistView', 'menuHistBack', 'menuHistList', 'menuHistEmpty', 'menuHistSave']) {
    assert.ok(src.includes('id="' + id + '"'), '二级视图应含 ' + id);
  }
  assert.ok(src.includes('async function snapshotHistory(html, manual)'), '快照函数应存在');
  assert.ok(src.includes('now - lastAutoSnap < 60000'), '自动快照应 60s 节流——打字场景不能每 300ms 挤掉一个老版本');
  assert.ok(src.includes("fetchRetry(NOTE_API + '/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ct: enc.ct, iv: enc.iv, manual: !!manual }) }, 0)"), '快照上传失败应静默放弃（重试 0 次），快照是保险不是主链路');
  assert.ok(src.includes('async function loadHistList()'), '历史列表加载函数应存在');
  assert.ok(src.includes("fetchRetry(NOTE_API + '/history/' + item.ts, { cache: 'no-store' }, 1)"), '单条快照应按 ts 拉取且禁缓存');
  assert.ok((src.match(/await decryptText\(j2\.ct, j2\.iv, cryptoKey\)/g) || []).length >= 2, '预览与恢复都必须在本机解密（零知识：服务端只见密文）');
  assert.ok(src.includes("showUploadStatus('已保存当前版本')") && src.includes('snapshotHistory(editor.innerHTML, true)'), '手动打点入口应存在且明确反馈');
  assert.ok(src.includes("if (!cryptoKey) { showUploadStatus('请先解锁'); return; }"), '未解锁不应静默');
});

// ── T6b：历史版本语义（恢复不删历史 + 自动快照双挂点 + 服务端快照环）──
test('T6b 历史版本语义：恢复走 saveLocal 绝不删历史 + saveLocal/persistReminders 双挂点 + 服务端 FIFO 环', () => {
  const src = readSrc();
  const sv = readServer();

  // 恢复 = 用户显式拍板：作废远端挂起 → 应用正文 → 正常保存（v+1，其他设备经 poll 收到）
  assert.ok(/const html = await decryptText\(j2\.ct, j2\.iv, cryptoKey\);[\s\S]{0,80}pendingRemoteNote = null; hideRemoteBar\(\);[\s\S]{0,80}editor\.innerHTML = html; lastHtml = html;[\s\S]{0,80}lastRestoreAt = Date\.now\(\);[\s\S]{0,320}saveLocal\(true\);/.test(src), '恢复应作废远端挂起、标记恢复窗口并走 saveLocal(true) 强制落库，生成新版本而非回退');
  assert.ok(src.includes('历史不删'), '恢复语义必须注明「历史不删」——防误删的最后保障');

  // 自动快照：两处保存成功路径都挂「上一版」
  assert.ok(src.includes('const prevHtml = lastHtml; // v6.0：自动快照存「保存前的上一版」'), 'saveLocal 应在 PUT 前抓上一版');
  assert.ok(src.includes('if (prevHtml && prevHtml !== html) snapshotHistory(prevHtml, false);'), 'saveLocal 成功后应快照上一版');
  assert.ok(src.includes('const prevHtml2 = lastHtml; // v6.0：自动快照存「保存前的上一版」，与 saveLocal 同规则'), 'persistReminders 应同样抓上一版（改提醒也是正文保存）');
  assert.ok(src.includes('if (prevHtml2 && prevHtml2 !== html) snapshotHistory(prevHtml2, false);'), 'persistReminders 成功后应快照上一版');

  // 服务端：快照环
  assert.ok(sv.includes('const HISTORY_MAX = 10;'), '快照环上限应为 10 条');
  assert.ok(sv.includes("path.join(NOTES_DIR, id + '.hist.json')"), '快照应独立存 <id>.hist.json，与主笔记文件隔离');
  assert.ok(sv.includes('function readHist(id)') && sv.includes('function writeHist(id, h)'), '快照读写 helper 应成对存在');
  assert.ok(sv.includes('let idx = hist.list.findIndex(x => !x.manual); // 手动打点优先保留，先挤自动'), 'FIFO 挤出应优先挤自动快照，手动打点不被冲掉');
  assert.ok(sv.includes('if (!last || last.ct !== item.ct || last.iv !== item.iv)'), '相同密文应去重——连打多次不浪费环容量');
  assert.ok(/if \(!obj \|\| typeof obj\.ct !== 'string' \|\| !obj\.ct \|\| typeof obj\.iv !== 'string' \|\| !obj\.iv\)/.test(sv), '空密文快照应拒收（快照没意义还占环位）');
  // history 路由代码形态（url.includes('/history')) {）——不匹配注释
  const histApiIdx = sv.indexOf("url.includes('/history')) {");
  // 主笔记读取分支以 ")) {" 结尾（后无条件追加），以此与 SSE/history 等 endsWith/includes 修饰分支区分
  const mainGetIdx = sv.indexOf("req.method === 'GET' && url.startsWith('/api/note/')) {");
  assert.ok(histApiIdx > -1 && histApiIdx < mainGetIdx, 'history 路由必须先于主 /api/note/ 分支（ID_RE 不含斜杠，放后面会被主分支吃掉）');
  assert.ok(sv.split('checkLimit(ip, id)').length >= 3, '历史读写也应限流，防刷');
});

// ── T7：PC 扫码兜底（桌面 Chrome/Edge 与 iOS Safari 无 BarcodeDetector → 动态 jsQR）──
test('T7 扫码兜底：jsQR 动态加载 + 逐帧 canvas 解码 + 服务端静态路由 + 库文件在位', () => {
  const src = readSrc();
  const sv = readServer();

  // 入口：不再见 BarcodeDetector 就劝退——先给 jsQR 一次机会
  assert.ok(src.includes('function loadJsQR()'), '应有 jsQR 动态加载函数');
  assert.ok(src.includes("s.src = '/jsQR.js';"), '脚本应从同源 /jsQR.js 加载');
  assert.ok(/if \(!useDetector && !\(await loadJsQR\(\)\)\)/.test(src), '无 BarcodeDetector 应先尝试 jsQR，都不可用才给失败提示（v6.1 文案分流）');
  assert.ok(!/typeof window\.BarcodeDetector === 'undefined' \|\| !navigator\.mediaDevices/.test(src), '旧入口（无 BarcodeDetector 即劝退）应退役');
  // getUserMedia 检查必须独立保留（连摄像头 API 都没有才直接退出）
  assert.ok(src.includes("if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {"), '摄像头 API 缺失仍应直接退出');
  // jsQR 帧循环
  assert.ok(src.includes("const detector = useDetector ? new window.BarcodeDetector() : null;"), 'detector 与 jsQR 应二选一');
  assert.ok(src.includes("window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })"), 'jsQR 逐帧解码应就位（attemptBoth 提升屏幕反光场景识别率）');
  assert.ok(src.includes("cvs.getContext('2d', { willReadFrequently: true })"), 'canvas 应声明 willReadFrequently（getImageData 每帧调用）');
  assert.ok(/if \(hit && hit\.data\) \{ cleanup\(\); resolve\(hit\.data\); \}/.test(src), '解码命中应 cleanup 并返回');
  // 350ms 节流保持
  assert.ok(/}, 350\);/.test(src), '帧循环 350ms 节流不变');

  // 服务端路由 + 库文件
  assert.ok(sv.includes("if (url === '/jsQR.js') {"), 'server.js 应有 /jsQR.js 静态路由');
  assert.ok(/'Cache-Control': 'public, max-age=31536000, immutable'/.test(sv), 'jsQR.js 应 immutable 长缓存（内容随版本演进，不担心失效）');
  const lib = fs.readFileSync(path.join(__dirname, '..', '..', 'jsQR.js'), 'utf8');
  assert.ok(lib.length > 100000 && lib.length < 300000, 'jsQR.js 库文件应在位（127KB 量级）');
  assert.ok(lib.includes('jsQR'), '库文件应含 jsQR UMD 全局定义');
});

// ── T8：APP 图标全套（C 衬线 N 修正版：对角线左上→右下，拉丁 N）──
function pngSize(p) {
  const b = fs.readFileSync(p);
  return [b.readUInt32BE(16), b.readUInt32BE(20)]; // IHDR 宽高
}
test('T8 图标全套：各密度 launcher/round/foreground + 暖纸白背景 + 通知图标 N 形 + 遗留退役', () => {
  const RES = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'res');
  const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
  for (const [dpi, size] of Object.entries(LAUNCHER)) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const p = path.join(RES, 'mipmap-' + dpi, name);
      assert.ok(fs.existsSync(p), name + ' @' + dpi + ' 应在位');
      assert.deepStrictEqual(pngSize(p), [size, size], name + ' @' + dpi + ' 应为 ' + size + 'px');
    }
  }
  for (const [dpi, size] of Object.entries(FOREGROUND)) {
    const p = path.join(RES, 'mipmap-' + dpi, 'ic_launcher_foreground.png');
    assert.ok(fs.existsSync(p), 'foreground @' + dpi + ' 应在位');
    assert.deepStrictEqual(pngSize(p), [size, size], 'foreground @' + dpi + ' 应为 ' + size + 'px');
  }
  const ps = path.join(RES, 'ic_launcher-playstore.png');
  assert.ok(fs.existsSync(ps) && pngSize(ps)[0] === 512, 'Play Store 512 应在位');

  const bg = fs.readFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), 'utf8');
  assert.ok(bg.includes('#F7F2E9'), 'adaptive 背景应为暖纸白 #F7F2E9（C 衬线 N 定稿）');
  const anydpi = fs.readFileSync(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8');
  assert.ok(anydpi.includes('@color/ic_launcher_background') && anydpi.includes('@mipmap/ic_launcher_foreground'), 'adaptive XML 引用应保持（@color 背景 + @mipmap 前景）');

  const notif = fs.readFileSync(path.join(RES, 'drawable', 'ic_notification.xml'), 'utf8');
  assert.ok(notif.includes('M6,4h2.5l7,12.5V4H18v16h-2.5l-7,-12.5V20H6Z'), '通知小图标应为实心 N（对角线左上→右下，拉丁 N——绝不画反）');
  assert.ok(!notif.includes('18,16v-5c0,-3.07'), '旧铃铛形状应退役');

  assert.ok(!fs.existsSync(path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml')), 'Capacitor 默认遗留 foreground vector 应退役（零引用）');
  assert.ok(!fs.existsSync(path.join(RES, 'drawable', 'ic_launcher_background.xml')), 'drawable 下遗留背景 vector 应退役（零引用）');
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'tools', 'gen_icons.py')), '图标生成脚本应在位（可复现）');
});

// ── T9：跨笔记提醒推送（A 设提醒 → 切到 B → A 到点仍推送，点击进 A）──
function readAndroid(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', rel), 'utf8');
}
test('T9 跨笔记提醒：原生分区 upsert + 跨分区稳定 uid + 通知点击带 noteId + JS 跳转', () => {
  const plugin = readAndroid(path.join('rem', 'RemPlugin.kt'));
  const receiver = readAndroid(path.join('rem', 'RemReceiver.kt'));
  const main = readAndroid(path.join('MainActivity.java'));
  const src = readSrc();

  // 原生：分区存储 + 分区 upsert
  assert.ok(plugin.includes('data class Reminder(val at: Long, val text: String, val idx: Int = 0, val noteId: String = "")'), 'Reminder 应带 noteId');
  assert.ok(plugin.includes('fun partCipher(noteId: String) = "cipher_n_" + noteId'), '分区存储 key 应就位');
  assert.ok(plugin.includes('fun stableUid(noteId: String, at: Long): Int'), '跨分区稳定 uid 应就位（旧 idx 跨分区互撞）');
  assert.ok(plugin.includes('val nid = call.getString("noteId") ?: ""'), 'sync 应读 noteId 参数');
  assert.ok(plugin.includes('for (r in readPartition(context, nid)) cancelAlarm(context, r)'), 'sync 只取消本分区旧闹钟（其他笔记零影响——全量镜像根因就此根治）');
  assert.ok(plugin.includes('putString(partCipher(nid), c)'), '落盘应写本分区，不再是单份 KEY_CIPHER');
  assert.ok(plugin.includes('private fun migrateLegacy(context: Context)'), '旧单份存储应迁移（并按旧 idx 清残留闹钟）');
  assert.ok(plugin.includes('for (r in legacy) if (r.at > now) scheduleAlarm(context, r)'), '迁移项必须按新 stableUid 重排未来闹钟（P1：只取消不重排 = 升级后旧提醒静默失效）');
  assert.ok(plugin.includes('putExtra("noteId", r.noteId)'), '闹钟 intent 应带 noteId');
  assert.ok(plugin.includes('stableUid(r.noteId, r.at)'), 'PendingIntent requestCode 应用稳定 uid');
  // 通知点击链
  assert.ok(receiver.includes('putExtra("noteId", noteId)'), '通知点击 intent 应带 noteId');
  assert.ok(receiver.includes('nm.notify(uid, notif)'), '通知 id 应用稳定 uid（旧 idx 多分区互撞）');
  // MainActivity：冷启动接住 + dispatch 带 noteId
  assert.ok(main.includes('RemPlugin.ACTION_NOTIFY_CLICK.equals(cold.getAction())'), '冷启动也应接住通知点击（进程被杀后点通知拉起）');
  assert.ok(main.includes('detail:{noteId:" + nidJson + "}}'), 'dispatch 应带 noteId 详情');
  // JS：分区同步 + 跳转
  assert.ok(src.includes("rb.sync({ list: reminders.map(r => ({ at: r.at, text: r.text })), noteId: noteId })"), 'sync 应带 noteId');
  assert.ok(src.includes("if (typeof noteId === 'undefined' || !noteId) { window.__lastNativeSync = 'skip-no-note'; return; }"), '首页应跳过同步（不污染分区）');
  assert.ok(src.includes("location.assign('/' + encodeURIComponent(nid))"), '通知点击其他笔记应直接跳转');
});
