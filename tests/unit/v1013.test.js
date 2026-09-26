// v10.1.3 把手块内软换行硬化守护：手机输入法回车常走同块 <br>（软换行），
// 「行首 [折叠] + <br> + 正文」形态下 br 后半行分不到块级缩进/引导线、还跟着标题整块收起。
// 修法 = applyFolds 扫描前在第一个直属 br 处劈块（br 前=标题、br 后=独立正文块）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');

function ed(w) { return w.document.getElementById('editor'); }
function blocks(w) { return Array.prototype.slice.call(ed(w).children); }
function inGroup(b) { return b.classList.contains('ns-fold-body') || b.classList.contains('ns-fold-gap'); }
function typeFold(w) {
  const ev = new w.InputEvent('input', { inputType: 'insertText', bubbles: true, data: ']' });
  ed(w).dispatchEvent(ev);
}

/* ── H1 单 br：标题与首行正文同块 → 劈开后正文独立成块、正常入组有缩进 ── */
test('H1 软换行形态 [折叠]哈哈<br>1，橙子 → 劈块后"1，橙子"独立入组（用户实锤症状）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]哈哈<br>1，橙子：尿不湿→内裤</div><div>2，橙子吃桃子</div><div>8，银吉iPhone备份</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b[0].textContent, '[折叠]哈哈', '标题块只剩 br 前半（不含"1，橙子"）');
  assert.ok(b[0].classList.contains('ns-fold'), '标题块 = 把手');
  assert.ok(!/<br>/.test(b[0].innerHTML), '标题块内 br 已随劈块带走');
  assert.strictEqual(b[1].textContent, '1，橙子：尿不湿→内裤', '"1，橙子"劈成独立块');
  assert.ok(inGroup(b[1]) && b[1].classList.contains('ns-fold-body'), '"1，橙子"正常进组、有 body 标记（缩进+竖线恢复）');
  assert.ok(inGroup(b[2]) && inGroup(b[3]), '后续行照旧入组');
  assert.strictEqual(b[3].textContent, '8，银吉iPhone备份[/折叠]', '锚仍挂组内末行行尾');
});

/* ── H2 双 br：中间隔伪空行 → 劈出独立块，不再出现"半行贴标题" ── */
test('H2 双 br 形态 哈哈<br><br>1，橙子 → 劈出首行带软空行的独立块，整块入组有缩进', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]哈哈<br><br>1，橙子：尿不湿→内裤</div><div>8，银吉iPhone备份</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b[0].textContent, '[折叠]哈哈', '标题块不含 br 后内容');
  assert.ok(inGroup(b[1]), 'br 后内容独立成块并进组（有缩进有竖线，不再贴标题）');
  assert.ok(!/<br>/.test(b[0].innerHTML), '标题块内无残留 br');
});

/* ── H3 尾 br：[折叠]哈哈<br> → 劈出空行块 → 按口径空组，空行块在组外 ── */
test('H3 尾 br 形态 [折叠]哈哈<br> → 劈出空行块，按「标题下紧跟空行 = 空组」处理', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]哈哈<br></div><div>1，橙子：尿不湿→内裤</div><div>8，银吉iPhone备份</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b[0].textContent, '[折叠]哈哈[/折叠]', '空组：锚挂标题行尾');
  assert.ok(!inGroup(b[1]) || b[1].textContent.indexOf('1，橙子') === 0, '劈出的空行块/后续正文不入组');
  assert.ok(!inGroup(b[2]), '后续正文留在组外');
});

/* ── H4 存量：不键入（无 armed）也劈 —— 已保存的 br 形态笔记打开即修 ── */
test('H4 存量 br 形态（无键入）打开同样硬化', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]哈哈<br>1，橙子：尿不湿→内裤</div><div>8，银吉iPhone备份</div>';
  w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b[0].textContent, '[折叠]哈哈', '存量也劈：标题块不含 br 后半行');
  assert.ok(inGroup(b[1]) && b[1].classList.contains('ns-fold-body'), '"1，橙子"独立入组有缩进');
});

/* ── H5 无 br 的把手零影响（回归钉）── */
test('H5 正常把手（无 br）不劈不动', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]哈哈</div><div>1，橙子：尿不湿→内裤</div><div>8，银吉iPhone备份</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b.length, 3, '块数不变（不额外劈块）');
  assert.strictEqual(b[0].textContent, '[折叠]哈哈', '把手行原样');
  assert.ok(inGroup(b[1]) && inGroup(b[2]), '正文照旧入组');
});

/* ── H6 源码钉：硬化逻辑在 applyFolds 内、只认直属 br、用 Range 搬运 ── */
test('H6 源码钉：软换行硬化存在且口径正确', t => {
  assert.ok(/1\.5\) v10\.1\.3：把手块内软换行硬化/.test(SRC), '硬化步骤在位');
  assert.ok(/const hardTargets = Array\.prototype\.filter\.call\(editor\.children, b => b\.nodeType === 1 && foldLeadInfo\(b\)\);/.test(SRC),
    '只处理行首 [折叠] 的块（foldLeadInfo 同口径）');
  assert.ok(/if \(n\.nodeType === 1 && n\.tagName === 'BR'\) \{ br = n; break; \}/.test(SRC), '只认直属子节点 br');
  assert.ok(/const frag = tail\.extractContents\(\);/.test(SRC), '用 Range.extractContents 搬运（保行内格式，禁 textContent 往返）');
  assert.ok(/if \(frag\.firstChild && frag\.firstChild\.nodeType === 1 && frag\.firstChild\.tagName === 'BR'\) frag\.removeChild\(frag\.firstChild\);/.test(SRC),
    '劈出的新块丢弃首枚 br（硬块自带换行语义）');
});
