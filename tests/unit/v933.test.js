// NoteSync v9.3.3 守护：用户八项反馈中的五处修复（A1 图片丢失 / A2 恐龙误退+reset / A3 保存反馈 / A4 彩蛋 hover / C 折叠三角）。
// 纪律：静态断言锚到补丁行独有串（防恒真），能上行为的上行为。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.resolve(ROOT, 'index.html'), 'utf8');

test('K1 图片丢失根因修：含 img/媒体/嵌入的空 DIV 不再判为空块（防 cleanup 删首尾孤立图片）', () => {
  assert.ok(SRC.includes("!n.querySelector('img,iframe,video,audio,canvas,svg,object,embed,input,hr,table')"),
    'isBlankBlock 必须排除含媒体/嵌入的块');
});

test('K2 恐龙误退根因修：结束卡空白=重开不退壳；reset 清 duck/heldDuck/introTap/holdT', () => {
  assert.ok(SRC.includes("if (e.target === card) { fx('tap'); restart(g); }"), '死亡卡背景点击须重开而非 closeShell 退壳');
  assert.ok(SRC.includes("heldDuck = false; introTap = false; if (holdT) { clearTimeout(holdT); holdT = null; }"),
    'reset 必须清我 v9.3.2 新增标志，防「再来一局」首点被吞/残留低头');
  assert.ok(!SRC.includes("if (e.target === card) closeShell()"), '旧的「点卡背景即收壳退笔记」禁回潮');
});

test('K3 保存到相册反馈可见：toast 层级抬到查看器 #nsZoom(88) 之上', () => {
  const m = /\.upload-status\{[^}]*z-index:(\d+)/.exec(SRC);
  assert.ok(m && Number(m[1]) > 88, '.upload-status z-index 必须 > 查看器 88，否则查看器内保存成功 toast 看不见');
});

test('K4 彩蛋 hover 命中放宽：hover 专用正则容忍尾随标点且防 /peter；敲字通道严格锚不变', () => {
  assert.ok(SRC.includes('NS_EGG_HOVER_RE') && SRC.includes("(?![A-Za-z0-9])"), 'hover 须用不锚行尾、(?![A-Za-z0-9]) 防误命中的专用正则');
  assert.ok(SRC.includes('var m = NS_EGG_HOVER_RE.exec('), 'nsEggAtPoint 须走 hover 正则（旧 NS_EGG_RE $ 锚漏尽中文尾标点）');
  assert.ok(SRC.includes("var NS_EGG_RE = /(^|[^A-Za-z0-9_\\-])\\/(mirror|snake|dragon|brick|satoshi|bitcoin|tank|spacex|tesla|pet)$/"), '敲字通道严格 NS_EGG_RE 保留不动');
});

test('K5 折叠三角两态等大：▶ 追加 VS15 强制文本呈现，与 ▼ 同尺寸', () => {
  assert.ok(SRC.includes("content:'\\25B6\\FE0E'"), '折叠收起三角须用 ▶+VS15 文本呈现（防 emoji 画大 vs ▼ 偏小不一致）');
});

test('K6 行为：进 /dragon 结束卡唤出→点空白重开，壳仍在、历史不动', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.history.back = function () { try { this.replaceState({}, '', '/'); } catch (e) {} };
  w.nsRouteEgg('dragon');
  const path0 = w.eval("location.pathname");
  w.eval("window.nsGameEnd('被撞到', [['躲过', '0 个']])");
  const over = w.document.querySelector('.ns-over');
  assert.ok(over && !over.classList.contains('hidden'), '结束卡唤出');
  const ev = new w.MouseEvent('click', { bubbles: true });
  Object.defineProperty(ev, 'target', { value: over });
  over.dispatchEvent(ev);
  assert.ok(w.document.getElementById('nsGame'), '点结束卡空白不得收壳（用户「跳着跳着回笔记页」根因）');
  assert.strictEqual(w.eval("location.pathname"), path0, '空白点击不得改历史路径');
});

test('K7 图片键盘：触屏点正文 IMG 在 pointerdown 阶段 preventDefault（防弹键盘），click 仍达→放大不受影响', () => {
  assert.ok(SRC.includes("else if (e.target && e.target.tagName === 'IMG' && editor.contains(e.target)) e.preventDefault();"),
    'pointerdown 触屏分支须含 IMG preventDefault（旧 mousedown 拦截在触屏来不及挡聚焦）');
});

test('K8 B2 移动端确认弹层 M2：按 CHIP_HOVER_OK 分支，移动挂 .ns-ask-m 金胶囊，桌面方案1「要开始吗？」保留', () => {
  assert.ok(SRC.includes("b.className = 'ns-ask-m'"), '移动端须挂 .ns-ask-m');
  assert.ok(SRC.includes("进入 <b class=\"ns-w\">/' + id + '</b>？"), '移动端 M2 文案「进入 /x？」');
  assert.ok(SRC.includes('<span>要开始吗？</span>') && SRC.includes('CHIP_HOVER_OK'), '桌面方案1（要开始吗？/不了）保留、按设备分支');
  assert.ok(SRC.includes('#nsAsk.ns-ask-m .ns-go{border:0;background:var(--accent);color:var(--box-bg)'), 'M2 主按钮吃令牌（无新色字面量）');
});

test('K9 B1 V3：查看器主按钮改金边金字（透明底 + foil-gold-hi），旧「accent 底/box-bg 字」禁回潮', () => {
  assert.ok(SRC.includes('#nsZoom .nz-bar button.nz-pri{background:transparent;color:var(--foil-gold-hi);border-color:var(--foil-gold-hi)}'),
    '.nz-pri 须为 V3 金边金字');
  assert.ok(!SRC.includes('.nz-bar button.nz-pri{background:var(--accent);color:var(--box-bg)}'), '旧「金底近黑字=像禁用」禁回潮');
});
