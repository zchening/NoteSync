// NoteSync v9.3.4 守护：用户七项反馈落码。纪律：静态断言锚到补丁行独有串（防恒真），能上行为的上行为。
// 覆盖：#1 移动拍照上传 / #2 dragon·brick 音量 / #3 更新弹窗去标题+字重 / #5 查看器主按钮方案A /
//       #6 更新下载崩溃(Kotlin) / #7 返回键关大图 / #4 图片莫名丢失复现路径回归。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const { loadApp } = require('../helpers');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.resolve(ROOT, 'index.html'), 'utf8');
const KT = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'update', 'UpdatePlugin.kt'), 'utf8');

test('T1 #1 移动拍照上传：二选一菜单 + capture=environment 调相机，桌面仍直开文件框', () => {
  assert.ok(SRC.includes("fileInput.setAttribute('capture', 'environment')"), '拍照须给隐藏 file input 设 capture=environment');
  assert.ok(SRC.includes("if (CHIP_HOVER_OK) { pickUploadFile(false); return; } nsUpMenuOpen();"),
    'uploadBtn 须按 CHIP_HOVER_OK 分支：桌面直开、纯触屏弹二选一（联动门同谓词）');
  assert.ok(SRC.includes("id = 'nsUpModal'") && SRC.includes("mask.className = 'mask'") && SRC.includes("box.className = 'box'"),
    '上传须为扫码配对同款居中模态（.mask+.box），不再是 #nsUpMenu 底部条');
  assert.ok(SRC.includes("'拍 照'") && SRC.includes("bAlb.className = 'ghost-btn'") && !SRC.includes("id = 'nsUpMenu'"),
    '模态含主按钮「拍 照」+ ghost「从相册选择」，旧 #nsUpMenu 已退役');
});

test('T2 #2 dragon/brick 音量：音色级 gain 乘子，仅这两条 gain:8（v9.3.5 试听定档），其余零变化', () => {
  assert.ok(SRC.includes("dragon:  { w: ['square'], h: [1], a: 0.004, d: 0.1, r: 0, gain: 8 }"), 'dragon 音色 gain:8');
  assert.ok(SRC.includes("brick:   { cut: 2600, cut1: 900, q: 0.9, a: 0.002, d: 0.07, gain: 8 }"), 'brick 音色 gain:8');
  assert.ok(SRC.includes('(o.g == null ? 0.4 : o.g) * (v.gain || 1)'), 'tone() 输出增益须乘音色 gain（缺省 1）');
  assert.ok(SRC.includes('(o.g == null ? 0.34 : o.g) * (v.gain || 1)'), 'nz() 输出增益须乘音色 gain（缺省 1）');
  assert.ok(!/(snake|tank|satoshi|bitcoin|spacex|tesla|mirror|pet):\s*\{[^}]*gain:/.test(SRC), '其余音色不得被加 gain（只动 dragon/brick）');
});

test('T3 #3 更新弹窗：删「发现新版本」小标题（h1.upd-cap 与其 CSS 移除）、#updNotes 加字重 500 且仍 --fg（零新色）', () => {
  assert.ok(!SRC.includes('<h1 class="upd-cap">'), '顶部 h1.upd-cap 小标题须删除');
  assert.ok(!SRC.includes('.upd-cap{'), '.upd-cap 样式规则须删除');
  assert.ok(SRC.includes('#updNotes{font-size:13.5px;line-height:1.95;color:var(--fg);font-weight:500'),
    '#updNotes 须保持 --fg 颜色、仅加字重 500（方案B，无新色值）');
});

test('T4 #6 更新下载崩溃修：UpdatePlugin.kt 用合法 VISIBILITY_VISIBLE，禁 VISIBILITY_HIDDEN 回潮', () => {
  assert.ok(KT.includes('req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)'),
    '必须用合法值 VISIBILITY_VISIBLE（下载期间显示通知，进度 JS 轮询、下完插件自拉安装器）');
  assert.ok(!KT.includes('setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)'),
    '禁回潮：VISIBILITY_HIDDEN(=2) 被 setNotificationVisibility 拒绝 → 「Invalid value for visibility: 2」');
});

test('T5 #7 查看器历史接线：NS_IMG.pushed、open 压同 URL 历史、popstate 只消费本查看器弹出', () => {
  assert.ok(/var NS_IMG = \{[\s\S]*?pushed: false \}/.test(SRC), 'NS_IMG 须含 pushed 标志（初值 false）');
  assert.ok(SRC.includes("history.pushState({ nsZoom: 1 }, '')"), 'open 须压一条同 URL 历史');
  assert.ok(SRC.includes('function nsImgRemoveZoom()'), '须有不碰历史的同步拆除函数');
  assert.ok(SRC.includes('nsImgRemoveZoom(); nsImgMenuClose();'), 'open 清旧须走不碰历史的 remove（防与 pushState 抢异步 back）');
  assert.ok(SRC.includes("window.addEventListener('popstate', function () {"),
    '须注册 popstate 监听（安卓返回键经 wv.goBack 落到本页）');
  assert.ok(SRC.includes('if (!NS_IMG.pushed) return;'),
    'popstate 体内：非本查看器压入的弹出直接 return，完全不干预（不与游戏/路由 onPop 抢历史）');
  assert.ok(SRC.includes('if (NS_IMG.pushed) { NS_IMG.pushed = false; if (had) { try { history.back(); } catch (e) {} } }'),
    '用户/Esc 关闭：同步拆除后 back() 抵消压入，保持返回键计数一致');
});

test('T6 #7 行为：进大图压入历史+浮层在场；收到 popstate → 关大图回正文、历史路径不变', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  assert.strictEqual(d.getElementById('nsZoom'), null, '初始无查看器');
  const img = d.createElement('img'); img.src = 'http://localhost/pic.png';
  w.nsImgOpenZoom(img);
  assert.ok(d.getElementById('nsZoom'), '打开后查看器浮层存在');
  assert.strictEqual(w.NS_IMG.open, true); assert.strictEqual(w.NS_IMG.pushed, true, '打开须压入历史标志');
  const path0 = w.eval("location.pathname");
  w.dispatchEvent(new w.Event('popstate')); // 模拟安卓返回键经 wv.goBack 落到本页
  assert.strictEqual(d.getElementById('nsZoom'), null, '返回键须关掉大图');
  assert.strictEqual(w.NS_IMG.open, false); assert.strictEqual(w.NS_IMG.pushed, false, '关闭须复位 pushed');
  assert.strictEqual(w.eval("location.pathname"), path0, '同 URL 历史：关大图不得改路径（回正文非回退到上一页）');
});

test('T7 #7 行为：重开不同图不重复压历史、X 关闭后 pushed 复位', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  const a = d.createElement('img'); a.src = 'http://localhost/a.png';
  w.nsImgOpenZoom(a);
  const b = d.createElement('img'); b.src = 'http://localhost/b.png';
  w.nsImgOpenZoom(b); // 重开不同图：沿用已压那条，pushed 仍 true、只剩一个浮层
  assert.strictEqual(d.querySelectorAll('#nsZoom').length, 1, '重开只保留一个查看器');
  assert.strictEqual(w.NS_IMG.pushed, true);
  w.nsImgCloseZoom(); // 用户关闭：同步拆除 + back 抵消
  assert.strictEqual(d.getElementById('nsZoom'), null);
  assert.strictEqual(w.NS_IMG.pushed, false);
});

test('T8 #4 行为回归：仅含 <img> 的空 DIV 不算空块，首行清空后 cleanup 不得吞掉图片（用户复现路径）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document, ed = d.getElementById('editor');
  ed.innerHTML = '<div>一二三</div><div><img src="http://localhost/x.png"></div>';
  const imgDiv = ed.lastElementChild;
  assert.strictEqual(w.isBlankBlock(imgDiv), false, '含 img 的块即便无文字也不是空块');
  ed.firstChild.textContent = ''; // 模拟「删除第一行后面部分文字」后首块变空
  w.cleanupLeadingTrailingBreaks();
  assert.ok(ed.querySelector('img'), '首尾清理后图片必须仍在（旧 bug：图片直接没了）');
});
