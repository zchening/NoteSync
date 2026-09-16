// v9.3.7 五修守护：问题1 上传模态收键盘 / 问题2 收起态折叠末尾回车 / 问题3 光标落位彩蛋词触发 /
// 问题5 上传成功收键盘（问题4 查看器按钮不透明实底已在 v933.test.js K9 守护）。
// 铁律：行为优先于文本；新断言锚定补丁行；不写布局断言进 jsdom。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');

function ed(w) { return w.document.getElementById('editor'); }
function blocks(w) { return Array.prototype.slice.call(ed(w).children); }
function caretAt(w, node, off) {
  const r = w.document.createRange();
  r.setStart(node, off); r.setEnd(node, off);
  const sel = w.window ? w.window.getSelection() : w.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
}

/* ── 问题2：光标停在收起态折叠标题末尾按回车，须在整组折叠之后另起一块，绝不插进隐藏正文 ── */
test('v9.3.7 问题2：收起态折叠标题末尾回车 → 新块落在整组折叠之后、隐藏正文与折叠结构不动', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]标题</div><div>正文1</div><div>正文2</div>';
  w.applyFolds();
  let b = blocks(w);
  assert.ok(b[0].classList.contains('ns-fold-collapsed'), '标题默认收起');
  assert.ok(b[1].classList.contains('ns-fold-body') && b[1].classList.contains('ns-fold-hide'), '正文1 是隐藏折叠正文');
  assert.ok(b[2].classList.contains('ns-fold-body') && b[2].classList.contains('ns-fold-hide'), '正文2 是隐藏折叠正文');

  // 光标放到标题块可见文字「标题」末尾（标题块 = [span ns-fold-mark][text "标题"]）
  const titleText = b[0].lastChild; // 文本节点 "标题"
  assert.strictEqual(titleText.nodeType, 3, '标题块末子应为文本节点');
  const sel = w.getSelection();
  const r = w.document.createRange();
  r.setStart(titleText, titleText.nodeValue.length);
  r.setEnd(titleText, titleText.nodeValue.length);
  sel.removeAllRanges(); sel.addRange(r);

  ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

  b = blocks(w);
  assert.strictEqual(b.length, 4, '回车后应新增一个块（标题+正文1+正文2+新空块）');
  assert.ok(b[0].classList.contains('ns-fold-collapsed'), '标题仍是收起态折叠');
  assert.ok(b[1].classList.contains('ns-fold-body') && b[1].classList.contains('ns-fold-hide'), '正文1 仍是隐藏折叠正文（没被换行拆走）');
  assert.ok(b[2].classList.contains('ns-fold-body') && b[2].classList.contains('ns-fold-hide'), '正文2 仍是隐藏折叠正文');
  // 关键：新块必须在整组折叠【之后】（末位），而不是插在标题与正文1之间
  const nb = b[3];
  assert.ok(!nb.classList.contains('ns-fold') && !nb.classList.contains('ns-fold-body'), '新块不属于折叠');
  assert.strictEqual((nb.textContent || '').replace(/​/g, '').trim(), '', '新块是空行');
  assert.ok(ed(w).contains(sel.anchorNode || sel.getRangeAt(0).startContainer), '光标仍在编辑器内');
});

/* ── 问题3：光标定位到正文已有的 /dragon 上，经 selectionchange 防抖弹出「进入」确认 ── */
test('v9.3.7 问题3：光标落在正文 /dragon 上 → selectionchange 触发进入确认浮层', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  ed(w).innerHTML = '<div>见 /dragon 里</div>';
  const tn = ed(w).querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf('/dragon');
  ed(w).focus(); // 处理器要求 document.activeElement === editor
  const r = d.createRange();
  r.setStart(tn, idx + 3); r.setEnd(tn, idx + 3); // 落在 /dragon 词内
  w.getSelection().removeAllRanges(); w.getSelection().addRange(r);
  d.dispatchEvent(new w.Event('selectionchange', { bubbles: true }));
  await new Promise(res => setTimeout(res, 340)); // 越过 260ms 防抖
  const ask = d.getElementById('nsAsk');
  assert.ok(ask, '光标定位到彩蛋词后应弹「进入 /dragon？」确认浮层');
  assert.ok(/dragon/.test(ask.textContent || ''), '浮层文案含 dragon');
});

/* ── 问题1：开「拍照/从相册」模态前收键盘（静态锚定补丁行） ── */
test('v9.3.7 问题1：nsUpMenuOpen 开模态前经 dismissKeyboardForTouch 收键盘', () => {
  assert.ok(SRC.includes('dismissKeyboardForTouch(); } catch (e0) {}'),
    'nsUpMenuOpen 须调用带三重守卫的 dismissKeyboardForTouch（禁裸 editor.blur）');
  const i = SRC.indexOf('function nsUpMenuOpen()');
  const body = SRC.slice(i, i + 400);
  assert.ok(i >= 0 && body.includes('dismissKeyboardForTouch'), '收键盘须在 nsUpMenuOpen 函数体内');
});

/* ── 问题5：上传成功后触屏端收键盘（静态锚定补丁行） ── */
test('v9.3.7 问题5：handleImageUpload 成功插入后经 dismissKeyboardForTouch 收键盘', () => {
  const i = SRC.indexOf('async function handleImageUpload');
  const body = SRC.slice(i, i + 700);
  assert.ok(i >= 0 && body.includes('insertImageAtCursor(url)'), '须在插入图片之后');
  assert.ok(body.indexOf('dismissKeyboardForTouch') > body.indexOf('insertImageAtCursor(url)'),
    '收键盘须在 insertImageAtCursor 之后（焦点已回到编辑器再 blur）');
  assert.ok(body.includes('dismissKeyboardForTouch(); } catch (eKb) {}'),
    '须用带守卫的 dismissKeyboardForTouch，禁裸 editor.blur');
});
