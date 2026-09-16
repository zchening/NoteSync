// NoteSync v9.3.5 守护：本轮 4 项 App/编辑体验修（#2 内联图退格整删 / #5 单击图片关大图 / #6 开大图不弹键盘 / #7 折叠空标题行光标不消失）。
// 纪律：静态断言锚到补丁行独有串（防恒真）；能上行为的上行为。#1/#3/#4 分别由 v934 T1/T2 与 v933 K9 随版翻转覆盖。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const { loadApp } = require('../helpers');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.resolve(ROOT, 'index.html'), 'utf8');

test('U1 #2 内联图退格整删：imgBeforeCaret 助手 + keydown 分支 + remove', () => {
  assert.ok(SRC.includes('function imgBeforeCaret(range)'), '须有 imgBeforeCaret 助手');
  assert.ok(SRC.includes('imgPrev = imgBeforeCaret(sel.getRangeAt(0));') && SRC.includes('imgPrev.remove();'),
    '退格护栏须在无折叠标记时按「紧贴图片左侧」原子整删该图');
});

test('U2 #2 行为：光标落在文字中间图片左侧，imgBeforeCaret 命中该图、非零位不误判', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document, ed = d.getElementById('editor');
  ed.innerHTML = '<div>一二三<img src="http://localhost/x.png">四五六</div>';
  const div = ed.firstChild;
  let img = null, tail = null;
  Array.prototype.forEach.call(div.childNodes, n => { if (n.tagName === 'IMG') img = n; if (n.nodeType === 3 && n.nodeValue.indexOf('四') === 0) tail = n; });
  assert.ok(img && tail, '结构：文本-图-文本');
  const r0 = d.createRange(); r0.setStart(tail, 0); r0.collapse(true);
  assert.strictEqual(w.imgBeforeCaret(r0), img, '紧贴图片左侧（offset0）须命中该图');
  const r1 = d.createRange(); r1.setStart(tail, 1); r1.collapse(true);
  assert.strictEqual(w.imgBeforeCaret(r1), null, '文本中段（offset>0）不命中，交给默认逐字退格');
});

test('U3 #5 单击图片关大图：up 里 touch 单指无位移 → nsImgCloseZoom；pointerdown/move 跟踪 tap', () => {
  assert.ok(SRC.includes("NS_IMG.tapId = e.pointerId; NS_IMG.tapSX = e.clientX; NS_IMG.tapSY = e.clientY; NS_IMG.tapMoved = false;"),
    'pointerdown 单指须记 tap 起点');
  assert.ok(SRC.includes("NS_IMG.pinch = Math.hypot(a.x - b.x, a.y - b.y); NS_IMG.base = NS_IMG.scale; NS_IMG.tapId = null;"),
    '第二指落下须作废 tap（双指缩放不误关）');
  assert.ok(SRC.includes("e.clientX - NS_IMG.tapSX, e.clientY - NS_IMG.tapSY) > 12) NS_IMG.tapMoved = true;"),
    '位移超阈须置 tapMoved（拖拽平移不误关）');
  assert.ok(SRC.includes("if (e.pointerType === 'touch' && NS_IMG.tapId === e.pointerId && !NS_IMG.tapMoved) { NS_IMG.tapId = null; nsImgCloseZoom(); return; }"),
    'pointerup 触摸单指无位移须关大图回正文');
});

test('U4 #6 开大图不弹键盘：只调带组字/焦点三重守卫的 dismissKeyboardForTouch，禁裸 editor.blur（R1 P1 教训）', () => {
  assert.ok(SRC.includes('触屏打开大图收一次输入法'), '#6 开大图须收输入法');
  const openBody = SRC.slice(SRC.indexOf('function nsImgOpenZoom'));
  assert.ok(openBody.slice(0, openBody.indexOf('function nsImgEsc')).includes('dismissKeyboardForTouch()'),
    '打开大图须经 dismissKeyboardForTouch 收键盘');
  assert.ok(!SRC.includes('if (!nsHoverPointer()) { try { editor.blur();'),
    '禁回潮：裸 editor.blur 无 isComposing 守卫会在组字期吞字');
});

test('U5 #7 折叠空标题行光标不消失：无可见标题字时归上一可见行尾', () => {
  assert.ok(SRC.includes("(fblock.textContent || '').replace(FOLD_MARK, '').trim().length > 0"), '须判三角后同行是否有可见标题字');
  assert.ok(SRC.includes('if (!hasVisibleTitle) { foldJumpToPrevLineEnd(fblock); return true; }'),
    '空标题折叠：光标归上一可见行尾（非破坏、不自动展开），不再停在零宽标记边消失');
});
