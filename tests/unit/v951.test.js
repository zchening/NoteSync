// v9.5.1 守护：移动端「不该弹却弹/不收起键盘」三修——①导出钮入口收键盘 ②主题钮收键盘 ③面板存提醒写回正文后收键盘。
// 判据：触屏态（jsdom matchMedia 恒 false → CHIP_HOVER_OK=false）focus 编辑器后触发对应动作，activeElement 必须离开 editor。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');
function ed(w) { return w.document.getElementById('editor'); }

/* ── 静态锚：三处 dismiss 必须锚在补丁行原位，防被挪动后恒真 ── */
test('v9.5.1 静态锚：exportImage 首行 / themeBtn 处理器首行 / insertRemLine 末尾 各钉一处 dismiss', () => {
  assert.ok(/async function exportImage\(\) \{\s*\n\s*dismissKeyboardForTouch\(\);/.test(SRC),
    'exportImage 入口第一句必须是 dismissKeyboardForTouch()');
  assert.ok(/themeBtn\.addEventListener\('click', \(\) => \{\s*\n\s*dismissKeyboardForTouch\(\);/.test(SRC),
    'themeBtn click 处理器第一句必须是 dismissKeyboardForTouch()');
  const i = SRC.indexOf('function insertRemLine');
  const body = SRC.slice(i, SRC.indexOf('function placeCaretAfterReminderLine', i));
  assert.ok(i > 0 && /placeCaretAfterReminderLine\(\);\s*\n[^\n]*\n[^\n]*\n\s*dismissKeyboardForTouch\(\);/.test(body),
    'insertRemLine 末尾（placeCaretAfterReminderLine 之后）必须 dismiss');
  assert.ok(SRC.includes('(!CHIP_HOVER_OK || isNativeApp()) && !isComposing'),
    '闸 R1/R2 双路命中必修：dismiss 判据须含 isNativeApp——App 壳内误报 hover/fine 也强制收键盘');
});

/* ── 行为：触屏态导出后，编辑器必须已失焦（键盘收起），且不改正文 ── */
test('v9.5.1 行为：触屏态点导出 → 编辑器 blur（键盘收），正文零写入', async t => {
  const dom = loadApp(w => {
    w.html2canvas = (node, opts) => Promise.resolve({ toBlob: cb => cb(new w.Blob(['x'], { type: 'image/png' })) });
    w.URL.createObjectURL = () => 'blob:fake'; w.URL.revokeObjectURL = () => {}; // jsdom 缺实现，补桩让回退阶梯跑到 showImagePreview 不中断
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  ed(w).innerHTML = '<div>测试内容</div>';
  const before = ed(w).innerHTML;
  ed(w).focus();
  assert.strictEqual(w.document.activeElement, ed(w), '前置：编辑器已聚焦');
  await w.exportImage(); // 走完整回退阶梯（jsdom 无 clipboard/share/原生桥 → 最后落 showImagePreview，不抛错）
  assert.notStrictEqual(w.document.activeElement, ed(w), '导出后编辑器必须已失焦（触屏收键盘）');
  assert.strictEqual(ed(w).innerHTML, before, '导出全程不改正文');
});

/* ── 行为：触屏态点主题钮 → 编辑器 blur ── */
test('v9.5.1 行为：触屏态点主题钮 → 编辑器 blur（键盘收），主题真实翻转', async t => {
  const dom = loadApp();
  t.after(() => dom.window.close());
  const w = dom.window;
  ed(w).focus();
  assert.strictEqual(w.document.activeElement, ed(w), '前置：编辑器已聚焦');
  const wantBefore = w.eval('themeWantsDark');
  w.document.getElementById('themeBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.notStrictEqual(w.document.activeElement, ed(w), '切主题后编辑器必须已失焦');
  assert.strictEqual(w.document.body.classList.contains('dark'), !wantBefore,
    'body.dark 必须翻转到 themeWantsDark 反态（闸 R2 点名：禁恒真断言）');
});

/* ── 行为：触屏态存提醒 → 写回正文成功且末尾 blur 收键盘（承接 V732-B7 翻转让出的触屏语义） ── */
test('v9.5.1 行为：触屏态 insertRemLine → 提醒写回正文 + 末尾 blur 收键盘', t => {
  const dom = loadApp();
  t.after(() => dom.window.close());
  const w = dom.window;
  w.eval('cryptoKey = {};'); // insertRemLine 门禁
  ed(w).innerHTML = '<div>base</div>';
  ed(w).focus();
  const r = w.document.createRange();
  r.selectNodeContents(ed(w).firstChild);
  r.collapse(false);
  w.setSel(r);
  w.insertRemLine(Date.now() + 7200e3, '写周报');
  assert.ok(ed(w).textContent.includes('写周报'), '提醒应写回正文');
  assert.ok(/<div><br><\/div>$/.test(ed(w).innerHTML), '末尾应仍含 placeCaretAfterReminderLine 的空块');
  assert.notStrictEqual(w.document.activeElement, ed(w), '触屏态存完提醒编辑器必须已失焦（收键盘）');
});
