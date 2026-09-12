// v6.3 验收测试（2026-09-07）：11 项用户实测问题修复
// #1/#4 过期时间入口（pushShort 顺延退役 + chipActivate 等结果）|#2 上限只数未来
// #3 fired 删除线 |#5 冷启动直达笔记 |#6 CSP self |#7 历史迁移+置灰
// #8 关于弹窗 |#9 菜单手势兜底 |#11 选区钳制三击门控 |MCP Server + baseV
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const readSrc = () => require('fs').readFileSync(INDEX_PATH, 'utf8');
const ROOT = path.join(__dirname, '..', '..');
const readRel = rel => require('fs').readFileSync(path.join(ROOT, rel), 'utf8');

// ── #6 PC 扫码：CSP script-src 必须含 'self'（Caddyfile 双域 + install.sh nginx 模板）──
test('V63-1 CSP script-src 加 self（扫码根因：同源 jsQR.js 被旧 CSP 拦截）', () => {
  const caddy = readRel('Caddyfile');
  const hits = caddy.match(/script-src 'self' 'unsafe-inline' cdn\.jsdelivr\.net/g) || [];
  assert.ok(hits.length === 2, 'Caddyfile 两处 CSP 都应含 self（实测 ' + hits.length + '）');
  const nginx = readRel('install.sh');
  assert.ok(nginx.includes("script-src 'self' 'unsafe-inline' cdn.jsdelivr.net"), 'install.sh CSP 应含 self');
  const src = readSrc();
  assert.ok(src.includes("[scan] /jsQR.js 加载失败"), 'loadJsQR onerror 必须留诊断日志');
});

// ── #1/#4 短格式时间不再顺延明年 ──
test('V63-2 pushShort 顺延明年退役：已过短格式一律标 expired', () => {
  const src = readSrc();
  assert.ok(!/resolveTimeAt\(now\.getFullYear\(\) \+ 1/.test(src), '不得再把今年已过时间顺延明年');
  const seg = src.slice(src.indexOf('const pushShort'), src.indexOf('const reShort'));
  assert.ok(seg.includes('v6.3'), 'pushShort 应带 v6.3 注释说明');
});

// ── #1 chipActivate 等 addReminder 结果，失败不弹成功卡 ──
test('V63-3 chipActivate 改 async 并按结果决定反馈', () => {
  const src = readSrc();
  assert.ok(src.includes('async function chipActivate(e)'), 'chipActivate 应为 async');
  assert.ok(/const ok = await addReminder\(at, item, src\);/.test(src), '必须 await addReminder（v8.1.6 起第三参带出处指纹）');
  assert.ok(/if \(!ok\) \{ chipDeleteAt = null; hideTimeChip\(\); return; \}/.test(src), '失败必须收 chip，不得弹「✅ 提醒已添加」');
});

// ── #2 addReminder：过去时间拒绝 + 上限只数未来 ──
test('V63-4 addReminder 三道闸门：过去拒绝/未来计数/返回布尔', () => {
  const src = readSrc();
  assert.ok(/已过去的时间不能设提醒/.test(src), '过去时间应有明确拒绝提示');
  assert.ok(/reminders\.filter\(r => r\.at > Date\.now\(\)\)\.length >= REM_MAX/.test(src), '上限只统计未过期条目（过期条目不占额）');
  assert.ok(/push\(\{ at: at, text: text \|\| '', fired: false, src: srcNew \}\)/.test(src), "新增条目应带 fired:false（v8.1.6 起另带出处指纹 srcNew）");
});

// ── #2/#3 normalizeRemList：未来 slice + fired 条目 FIFO 保留 ──
test('V63-5 normalizeRemList 拆未来/已推送两段，REM_DONE_MAX 有界', () => {
  const src = readSrc();
  assert.ok(/const REM_DONE_MAX = 20;/.test(src), '应定义 REM_DONE_MAX=20');
  assert.ok(/const future = all\.filter\(r => r\.at > now\)\.slice\(0, REM_MAX\);/.test(src), '未来条目封顶 REM_MAX');
  assert.ok(/const done = all\.filter\(r => r\.at <= now\)\.slice\(-REM_DONE_MAX\);/.test(src), '已推送条目 FIFO 保留（删除线数据源）');
  assert.ok(/fired: !!r\.fired/.test(src), '应迁移 fired 字段');
});

// ── #3 删除线渲染链路 + fired 标记落库 ──
test('V63-6 fired 标记与整段删除线链路完整', () => {
  const src = readSrc();
  assert.ok(/entry\.fired = true/.test(src), '到点触发应置 fired');
  assert.ok(/async function markExpiredFired\(\)/.test(src), '应存在 markExpiredFired（关页期间到点的补记）');
  assert.ok(/await markExpiredFired\(\);/.test(src), 'loadReminder 必须调用补记');
  assert.ok(/kind: 'rem-done'/.test(src), 'remMatchesFor 应产出 rem-done 区间');
  assert.ok(/s\.className = 'rem-done'/.test(src), 'buildLinkSafe 应生成 s.rem-done');
  assert.ok(/remDones\.forEach/.test(src), 'linkify 先拆阶段应处理 s.rem-done');
  assert.ok(/#editor s\.rem-done\{text-decoration:line-through/.test(src), '删除线样式（用户指定写法）');
  // 面板路径：失败不回写正文
  assert.ok(/addReminder\(at, text, fmtRemInsert\(at\)\)\.then\(ok => \{/.test(src), '面板添加必须按结果决定是否回写正文（v8.1.6 起 src 与写回正文行同串）');
});

// ── #5 Android 冷启动直达目标笔记 ──
test('V63-7 MainActivity 冷启动通知点击直达笔记 URL', () => {
  const main = require('fs').readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'MainActivity.java'), 'utf8');
  assert.ok(main.includes('bridge.getWebView().loadUrl(target)'), '冷启动应直接 loadUrl 到目标笔记');
  assert.ok(main.includes('nid.matches("[A-Za-z0-9_-]{1,64}")'), 'noteId 必须过 ID 白名单再拼 URL');
  assert.ok(main.includes('cold-start notify click -> direct load'), '应留诊断日志');
});

// ── #8 关于弹窗 ──
test('V63-8 关于弹窗：标题去撇号 + 版本两行对齐结构（v7.0 重排后仍守住）', () => {
  const src = readSrc();
  assert.ok(src.includes('id="aboutTitle">关于NoteSync</h1>'), '标题应为「关于NoteSync」（用户拍板文案）');
  assert.ok(!src.includes("关于Note'Sync"), '旧撇号标题必须全部退役（含注释）');
  assert.ok(src.includes('id="aboutAppRow"'), 'App 版本行应整行显隐');
  assert.ok(src.includes("$('#aboutVer').textContent = 'Version ' + APP_VERSION;"), '版本值应为三段式 Version X.Y.Z');
  assert.ok(src.includes('id="aboutAuthorName">@zchening</span>'), '作者行应为「@zchening」（用户拍板文案）');
  assert.ok(src.includes('#aboutTitle{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:1px}'), '标题应小号低字距衬线（v7.0 用户反馈）');
  assert.ok(src.includes("#aboutTitle::after{content:'';display:block;width:52px;height:1px"), '金线应细长（52x1，用户反馈）');
  assert.ok(src.includes('.about-row{display:flex;justify-content:center;align-items:baseline;gap:10px;line-height:2;font-size:12.5px}'), '两行信息应作为整体与标题居中（用户反馈）');
  assert.ok(src.includes('.about-v{width:110px;text-align:left;'), '值列应定宽保证行间左右缘整齐（用户反馈）');
  assert.ok(src.includes('#aboutAuthor{display:flex;justify-content:center;align-items:baseline;gap:10px;margin:6px auto 0}'), '作者行应与标题居中对齐（用户反馈）');
  assert.ok(src.includes('#aboutAuthorName{width:110px;text-align:left;font-family:var(--serif);color:var(--accent);font-weight:400;font-size:14px'), '作者应金色衬线不加粗（用户反馈）');
});

// ── #9 菜单手势兜底 ──
test('V63-9 menuTapGuard：吞 click 补激活 + 迟到真实 click 防重复', () => {
  const src = readSrc();
  assert.ok(src.includes('function menuTapGuard'), '应有菜单手势兜底');
  assert.ok(/setTimeout\(\(\) => \{\s*\n\s*if \(gotClick\) return;/.test(src), '真实 click 已到则不补');
  assert.ok(/e\.stopPropagation\(\); e\.preventDefault\(\); return; \} \/\/ 迟到的真实 click：吞掉/.test(src), '迟到真实 click 应被吞掉防重复执行');
});

// ── #11 选区钳制三击门控 ──
test('V63-10 选区钳制仅三击后生效（Shift+方向键跨空行解放）', () => {
  const src = readSrc();
  assert.ok(src.includes('clampArmedUntil'), '应有钳制开闸窗口');
  assert.ok(/e\.detail >= 3\) clampArmedUntil = Date\.now\(\) \+ 400/.test(src), '三击（detail>=3）开 400ms 窗口');
  assert.ok(/if \(Date\.now\(\) > clampArmedUntil\) return;/.test(src), '非三击手势 selectionchange 不得干预选区');
  assert.ok(src.includes('window.__clampOverflowSelection'), '测试钩子 __clampOverflowSelection 保留');
});

// ── #7 服务端：按 ts 覆写快照 + baseV 乐观并发 ──
test('V63-11 server.js 新端点与 baseV 409', () => {
  const srv = require('fs').readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(srv.includes("url.match(/^\\/api\\/note\\/([^/]+)\\/history\\/(\\d+)$/)"), '应有 PUT /history/:ts 路由');
  assert.ok(srv.includes("'version conflict'"), 'baseV 不符应返回 409 version conflict');
  assert.ok(srv.includes("typeof obj.baseV === 'number'"), 'baseV 必须是 opt-in（不破坏现有客户端）');
  // 客户端迁移调用
  const src = readSrc();
  assert.ok(/async function migrateHistoryKeys\(keyOld, keyNew\)/.test(src), '应存在历史快照换钥函数');
  assert.ok(/migrateHistoryKeys\(keyOld, keyNew\);/.test(src), 'cpRotate 必须调用迁移');
  // 历史置灰
  assert.ok(/function markHistBad\(row, pv, rs\)/.test(src), '应有置灰标识函数');
  assert.ok(/\.hist-item\.hist-bad\{opacity:\.5;border-style:dashed/.test(src), '失效版本应有置灰样式（v8.0.5 升格虚线胶囊：opacity .5+dashed）');
});

// ── #10 MCP Server ──
test('V63-12 MCP Server 存在且语法有效，含四工具与口令 env 约定', () => {
  const fs = require('fs');
  const mcpPath = path.join(ROOT, 'tools', 'notesync-mcp-server.js');
  assert.ok(fs.existsSync(mcpPath), 'tools/notesync-mcp-server.js 应存在');
  const code = fs.readFileSync(mcpPath, 'utf8');
  new (require('vm').Script)(code); // 语法编译烟测（不执行）
  assert.ok(code.includes("'note_locate'") && code.includes("'note_read'") && code.includes("'note_edit'") && code.includes("'note_remind'"), '四工具齐备');
  assert.ok(code.includes('NOTESYNC_PASSPHRASE'), '口令走 env（不进对话不进 git）');
  assert.ok(code.includes('PBKDF2_ITER = 200000'), '迭代次数与 web 端一致');
  assert.ok(code.includes("format: 'image'") || code.includes("'image'"), 'note_read 应支持 image 形态');
});

// ── MCP 跨机接入：/mcp/ 公开下载路由 + 一键 setup 脚本 ──
test('V63-13 /mcp/ 公开下载路由与 setup 脚本约定', () => {
  const fs = require('fs');
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(srv.includes("'/mcp/notesync-mcp-server.js'") && srv.includes("'/mcp/setup-notesync-mcp.js'"), 'server.js 应有 /mcp/ 双文件下载路由');
  assert.ok(srv.includes("path.join(APP_DIR, 'tools', url.split('/').pop())"), '下载路由应精确白名单（无穿越面）');
  const setupPath = path.join(ROOT, 'tools', 'setup-notesync-mcp.js');
  assert.ok(fs.existsSync(setupPath), 'tools/setup-notesync-mcp.js 应存在');
  const code = fs.readFileSync(setupPath, 'utf8');
  new (require('vm').Script)(code); // 语法编译烟测（不执行）
  assert.ok(code.includes('mcp.json'), 'setup 应写 mcp.json');
  assert.ok(code.includes("'.bak-'"), '写配置前必须备份原 mcp.json');
  assert.ok(code.includes('process.execPath'), 'command 应用当前 node 绝对路径（WorkBuddy 自带 node 免装）');
  assert.ok(!/PASSPHRASE\s*[:=]\s*['"][^'"]{4,}['"]/.test(code), 'setup 脚本本身不得硬编码任何口令');
});
