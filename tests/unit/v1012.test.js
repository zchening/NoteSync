// v10.1.2 折叠建组定界守护（用户拍板）：键入 [折叠] 那一刻按「空行切」定界并落闭合锚，
// 之后边界由锚冻结——组内可自由打空行。存量无锚组仍按 v10.0.3「标题以下全归组」，行为不变。
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
// 走真实链路：先把 [折叠] 敲出来（模拟键入 → input 门控置位），再让 applyFolds 自己定界
function typeFold(w) {
  const ev = new w.InputEvent('input', { inputType: 'insertText', bubbles: true, data: ']' });
  ed(w).dispatchEvent(ev);
}

/* ── S1 场景一：甲 / 空行 / A → 空组，空行与 A 全在组外（用户报障原型）── */
test('S1 建组时标题下紧随空行 → 空组，锚挂把手行尾，空行与其后正文都不入组', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div><br></div><div>A</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.ok(b[0].classList.contains('ns-fold'), '甲 = 把手行');
  assert.ok(!inGroup(b[1]), '空行必须在组外（用户口径：建组时不吞空行）');
  assert.ok(!inGroup(b[2]), 'A 必须在组外');
  assert.ok(!b[1].classList.contains('ns-fold-hide'), '组外空行不得被收起');
  assert.ok(!b[2].classList.contains('ns-fold-hide'), '组外正文不得被收起');
  assert.strictEqual(b[0].textContent, '[折叠]甲[/折叠]', '空组：锚挂把手行尾，[折叠] 文本与锚都留在 DOM');
});

/* ── S2 场景二：甲 / 乙 / 丙丁 / 空行 / A → 组内＝乙、丙丁 ── */
test('S2 建组时连续非空行入组，遇第一个空行停（空行与 A 在组外）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>乙</div><div>丙丁</div><div><br></div><div>A</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.ok(inGroup(b[1]), '乙 入组');
  assert.ok(inGroup(b[2]), '丙丁 入组');
  assert.ok(!inGroup(b[3]), '空行留在组外');
  assert.ok(!inGroup(b[4]), 'A 留在组外');
  assert.strictEqual(b[2].textContent, '丙丁[/折叠]', '锚挂组内最后一行（丙丁）行尾');
});

/* ── S3 一路无空行到文末：全归组，锚挂末行（用户拍板同样补锚）── */
test('S3 建组时下方一路无空行 → 全归组，锚挂末行行尾', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>乙</div><div>丙</div>';
  typeFold(w);
  w.applyFolds();
  const b = blocks(w);
  assert.ok(inGroup(b[1]) && inGroup(b[2]), '无空行 → 全归组（与 v10.0.3 观感一致）');
  assert.strictEqual(b[2].textContent, '丙[/折叠]', '锚挂末行行尾');
});

/* ── S4 组内插空行不越界（用户口径：展开后可自由输入空行）── */
test('S4 定界后组内插入空行，边界不动（锚之前一切恒在组内）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>乙</div><div>丙丁</div><div><br></div><div>A</div>';
  typeFold(w);
  w.applyFolds();
  // 用户口径场景三：组内排成「空、空、乙、空、空、丙丁」——空行全在锚（丙丁行尾）之前
  const b0 = blocks(w);
  const mk = () => { const d = w.document.createElement('div'); d.innerHTML = '<br>'; return d; };
  b0[1].before(mk()); b0[1].before(mk());      // 乙 之前两行空行
  b0[1].after(mk()); b0[1].after(mk());        // 乙 之后、丙丁 之前两行空行
  w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b.length, 9, '插完 4 个空行后共 9 块');
  assert.ok(b[0].classList.contains('ns-fold'), '甲 仍是把handle');
  for (const i of [1, 2, 4, 5]) {
    assert.ok(b[i].classList.contains('ns-fold-gap'), '组内第 ' + i + ' 行空行归入组内空隙');
    assert.ok(inGroup(b[i]), '组内空行必须在组内（边界不因空行收缩）');
  }
  assert.ok(inGroup(b[3]) && inGroup(b[6]), '乙 与 丙丁 仍在组内');
  assert.strictEqual(b[6].textContent, '丙丁[/折叠]', '锚仍在组内最后一行行尾');
  assert.ok(!inGroup(b[7]) && !inGroup(b[8]), '组外空行与 A 仍在组外');
});

/* ── S5 非键入不触发定界（粘贴整段不得被切开）── */
test('S5 粘贴（insertFromPaste）不触发建组定界，沿用无锚全归组', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div><br></div><div>A</div>';
  const ev = new w.InputEvent('input', { inputType: 'insertFromPaste', bubbles: true });
  ed(w).dispatchEvent(ev);
  w.applyFolds();
  const b = blocks(w);
  assert.ok(inGroup(b[1]), '粘贴来的折叠不切 → 空行仍归组内（v10.0.3 现状）');
  assert.ok(inGroup(b[2]), '粘贴来的折叠不切 → 后续正文仍归组内');
  assert.ok(!/\[\/折叠\]/.test(b[2].textContent), '粘贴不补锚');
});

/* ── S6 存量无锚组不受影响（不键入即不切）── */
test('S6 不键入时 applyFolds 不改变存量无锚组（标题以下全归组）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>乙</div><div><br></div><div>A</div>';
  w.applyFolds();
  w.applyFolds();
  const b = blocks(w);
  assert.ok(inGroup(b[1]) && inGroup(b[2]) && inGroup(b[3]), '无锚组保持 v10.0.3：空行与 A 都在组内');
  assert.ok(!/\[\/折叠\]/.test(ed(w).textContent), '未键入不得凭空补锚');
});

/* ── S7 已定界的组不重复切（幂等）── */
test('S7 已挂锚的组再次键入后不重复定界', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>乙</div><div>丙丁</div><div><br></div><div>A</div>';
  typeFold(w);
  w.applyFolds();
  const before = blocks(w)[2].textContent;
  typeFold(w);
  w.applyFolds();
  assert.strictEqual(blocks(w)[2].textContent, before, '二次定界不得再挂一枚锚');
});

/* ── S8 源码钉：门控 + 组尾回车接管 + 只认键入 ── */
test('S8 源码钉：建组定界只认键入，且组尾回车有接管分支', t => {
  assert.ok(/foldSeedArmed\s*=\s*true/.test(SRC), 'input 监听应能置位 foldSeedArmed');
  assert.ok(/it === 'insertText' \|\| it\.indexOf\('insertComposition'\) === 0/.test(SRC),
    '只有 insertText / insertCompositionText 键入才置位（粘贴/撤销一律不切）');
  assert.ok(/if \(seedArmed && prevHandles\.indexOf\(b\) < 0\)/.test(SRC), '只对「本帧新增的把手」定界');
  assert.ok(/const seedArmed = foldSeedArmed; foldSeedArmed = false;/.test(SRC), '标志取用即清，异常路径不留 armed');
  assert.ok(/const esT = \(bT && bT !== editor\) \? hasTailEndMark\(bT\) : false;/.test(SRC),
    '组尾行（挂尾锚那行）行尾回车应有接管，防锚被甩成独立 0 高幽灵行');
  assert.ok(/function seedFoldGroup\(handle\)/.test(SRC), 'seedFoldGroup 应存在');
  assert.ok(/if \(isBlankFoldLine\(b\)\) break;/.test(SRC), '建组扫描应在第一个空行处停止');
});
