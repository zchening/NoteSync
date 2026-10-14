// v10.2.0 单元测试：长按删除折叠列表（仿 NoteSyncX v3.2.5 报障⑤）+ 删折叠后展开态序号重映射
//   F1  组范围计算：四种组形态（无锚到文末 / 挂尾锚 / 独立行锚 / 空组）各算各的界，绝不跨组
//   F2  长按标题文字 ≥600ms → 确认框；点「取消」→ 正文一个字节不动
//   F3  长按 → 点「删除」→ 整组没；其余组结构与展开态保持；展开集按新序号前移重落库；
//       自建撤销栈 +1，Ctrl+Z 整组找回
//   F4  反向闸（缺一即误触）：鼠标指针 / 三角 span / 正文文字 / 短按即抬 / 移动超 10px / 组字期
//   F5  结构判据（源码级 RAW includes）：600ms/10px 常量、排除 mouse、排除三角、吞 contextmenu、
//       术后链齐全——防回归被「优化」掉
//   F6  删折叠后展开态重映射：长按删除与退格整删 [折叠] 两条路，其后把手的展开态都不许错位
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function app0() {
  const dom = loadApp(w => {
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  }, 'http://localhost/');
  return { dom, w: dom.window, ed: dom.window.document.getElementById('editor') };
}
function blocks(w) { return Array.prototype.slice.call(w.document.getElementById('editor').children); }
function handles(w) { return blocks(w).filter(b => b.classList.contains('ns-fold')); }
function states(w) { return handles(w).map(h => h.classList.contains('ns-fold-open') ? '展开' : '收起'); }
function txt(ed) { return ed.textContent.replace(/[\u200B\u200C\uFEFF\u2060]/g, ''); }
// 合成指针事件（jsdom 无 PointerEvent 构造器，plain Event 挂属性即可——监听器只读这几个字段）
function ptr(w, type, el, opts) {
  const ev = new w.Event(type, { bubbles: true, cancelable: true });
  ev.pointerType = (opts && opts.pointerType) || 'touch';
  ev.clientX = (opts && opts.x) || 0;
  ev.clientY = (opts && opts.y) || 0;
  el.dispatchEvent(ev);
  return ev;
}
const lpDown = (w, el, o) => ptr(w, 'pointerdown', el, o);
const lpMove = (w, el, x, y) => ptr(w, 'pointermove', el, { x, y });
const lpUp = (w, el) => ptr(w, 'pointerup', el);

/* ── F1 组范围：四种形态各算各的界 ─────────────────────────────── */
test('F1 foldGroupBlocksOf：无锚到文末/挂尾锚/独立行锚/空组四种形态，绝不跨组误删', t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  ed.innerHTML =
    '<div>[折叠]甲</div><div>乙</div><div>丙</div>' +            // 组1：无锚，一路到下一个把手
    '<div>[折叠]丁</div><div>戊[/折叠]</div>' +                 // 组2：挂尾锚（span 在正文行内）
    '<div>[折叠]己</div><div>庚</div><div>[/折叠]</div><div>后续行</div>' + // 组3：独立行锚 + 组外行
    '<div>[折叠]辛[/折叠]</div><div>组4后</div>';                // 组4：空组（锚在把手行尾）
  w.applyFolds();
  const hs = handles(w);
  assert.strictEqual(hs.length, 4, '前置：四处把手');
  const g = h => Array.from(w.__foldGroupBlocksOf(h)).map(b => txt(b)); // Array.from：页面内数组是 jsdom realm 的，直接 deepStrictEqual 会因原型不同误红
  assert.deepStrictEqual(g(hs[0]), ['[折叠]甲', '乙', '丙'], '无锚组收到下一个把手前');
  assert.deepStrictEqual(g(hs[1]), ['[折叠]丁', '戊[/折叠]'], '挂尾锚组含锚所在正文行（锚 span 随行走）');
  assert.deepStrictEqual(g(hs[2]), ['[折叠]己', '庚', '[/折叠]'], '独立行锚整块入组，组外行不许进来');
  assert.deepStrictEqual(g(hs[3]), ['[折叠]辛[/折叠]'], '空组只删把手自己');
  assert.deepStrictEqual(Array.from(w.__foldGroupBlocksOf(null)), [], 'null 输入返回空');
  const stray = w.document.createElement('div');
  assert.deepStrictEqual(Array.from(w.__foldGroupBlocksOf(stray)), [], '不在编辑器内的块返回空');
});

/* ── F2 长按 → 确认框；取消原样 ─────────────────────────────── */
test('F2 长按标题文字 ≥600ms → 确认框；点「取消」后正文一个字节不动', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  ed.innerHTML = '<div>上文</div><div>[折叠]标题A</div><div>正文A</div><div>下文</div>';
  w.applyFolds();
  const before = ed.innerHTML;
  lpDown(w, handles(w)[0], { x: 120, y: 40 });
  await sleep(650);
  assert.ok(w.document.getElementById('foldDeleteOk'), '长按标题必须弹出删除确认框');
  assert.ok(w.document.getElementById('foldDeleteCancel'), '确认框必须有取消钮');
  w.document.getElementById('foldDeleteCancel').click();
  assert.ok(!w.document.getElementById('foldDeleteOk'), '取消后确认框必须关掉');
  assert.strictEqual(ed.innerHTML, before, '取消后正文一个字节都不许动');
});

/* ── F3 长按 → 删除整组 + 状态前移 + 撤销找回 ─────────────────── */
test('F3 长按 → 点「删除」→ 整组没；其余组展开态保持；展开集前移重落库；Ctrl+Z 整组找回', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  w.localStorage.setItem('notesync_fold_open', JSON.stringify({ '': [0, 2] })); // 组1 展开、组3 展开
  ed.innerHTML = '<div>[折叠]甲</div><div>乙</div><div>[折叠]丙</div><div>丁</div><div>[折叠]戊</div><div>己</div>';
  w.applyFolds();
  w.__undoReset(); // 建立撤销栈基线（等同笔记加载完的快照；没有基线 recordIfChanged 无从压栈）
  assert.deepStrictEqual(states(w), ['展开', '收起', '展开'], '前置：三处把手状态就位');
  const u0 = w.__undoState().u;

  lpDown(w, handles(w)[1], { x: 120, y: 40 }); // 长按中间那组的标题
  await sleep(650);
  assert.ok(w.document.getElementById('foldDeleteOk'), '长按必须弹确认框');
  w.document.getElementById('foldDeleteOk').click();

  assert.strictEqual(handles(w).length, 2, '删掉一组后只剩两组');
  assert.strictEqual(txt(ed), '[折叠]甲乙[折叠]戊己', '整组（标题+正文）一起没，其余组一个字不许丢');
  assert.deepStrictEqual(states(w), ['展开', '展开'], '删除后其余组的展开态必须保持（组3 原展开，前移后仍展开）');
  assert.deepStrictEqual(JSON.parse(w.localStorage.getItem('notesync_fold_open'))[''], [0, 1],
    '删组后展开集必须按新序号前移重落库（原 [0,2]→[0,1]；不重映射=其后把手展开态整体错位一格）');
  assert.strictEqual(w.__undoState().u, u0 + 1, '删除必须进自建撤销栈');

  w.undo();
  assert.strictEqual(txt(ed), '[折叠]甲乙[折叠]丙丁[折叠]戊己', 'Ctrl+Z 必须整组找回（内容口径）');
});

/* ── F4 反向闸：一个误触都不许有 ─────────────────────────────── */
test('F4 反向闸：鼠标/三角/正文/短按即抬/移动超10px/组字期，一个都不弹确认框', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  ed.innerHTML = '<div>上文</div><div>[折叠]标题A</div><div>正文A</div><div>下文</div>';
  w.applyFolds();
  const head = handles(w)[0];
  const mark = head.querySelector(':scope > .ns-fold-mark');
  const body = blocks(w)[2];
  const modal = () => w.document.getElementById('foldDeleteOk');

  lpDown(w, head, { pointerType: 'mouse' }); await sleep(650);           // 桌面鼠标按住＝拖选
  assert.ok(!modal(), '鼠标指针不弹');
  lpDown(w, mark, { x: 5, y: 5 }); await sleep(650);                      // 慢按三角＝误触风险位
  assert.ok(!modal(), '三角 span 不弹（留给点按开合）');
  lpDown(w, body, { x: 60, y: 20 }); await sleep(650);                    // 正文文字
  assert.ok(!modal(), '正文文字不弹');
  lpDown(w, head, { x: 120, y: 40 }); lpUp(w, head); await sleep(650);    // 短按即抬
  assert.ok(!modal(), '600ms 内抬起不弹');
  lpDown(w, head, { x: 120, y: 40 }); lpMove(w, head, 120, 90); await sleep(650); // 移动 50px＝滚动
  assert.ok(!modal(), '移动超 10px（滚动意图）不弹');
  ed.dispatchEvent(new w.Event('compositionstart'));                       // 组字期
  lpDown(w, head, { x: 120, y: 40 }); await sleep(650);
  assert.ok(!modal(), '组字期不弹（红线9）');
  ed.dispatchEvent(new w.Event('compositionend'));
  lpDown(w, head, { x: 120, y: 40 }); await sleep(650);                    // 恢复后应恢复长按
  assert.ok(modal(), '组字结束后长按应恢复（门控不能卡死）');
  w.document.getElementById('foldDeleteCancel').click();
});

/* ── F5 结构判据（源码级 RAW） ───────────────────────────────── */
test('F5 结构判据：阈值/排除项/术后链齐全（防回归被「优化」掉）', () => {
  assert.ok(SRC.includes('FOLD_LP_MS = 600'), '长按阈值必须是 600ms（与 NoteSyncX 同）');
  assert.ok(SRC.includes('FOLD_LP_SLOP = 10'), '滚动取消阈值必须是 10px');
  assert.ok(SRC.includes("e.pointerType === 'mouse'"), '必须排除桌面鼠标');
  assert.ok(SRC.includes("el.closest('span.ns-fold-mark')"), '三角 span 不参与长按（留给点按开合）');
  assert.ok(SRC.includes('pointercancel'), '必须有 pointercancel 取消路径（系统打断）');
  const doAt = SRC.indexOf('function foldDeleteDo');
  assert.ok(doAt >= 0, '缺 foldDeleteDo 执行函数');
  const DO = SRC.slice(doAt, SRC.indexOf('window.__foldGroupBlocksOf'));
  assert.ok(DO.includes('persistFoldStates'), '删除后必须重落库展开态（删组后把手序号前移）');
  assert.ok(DO.includes('recordIfChanged'), '删除必须进自建撤销栈（Ctrl+Z 找回）');
  assert.ok(DO.includes('foldRemapOpenAfterDelete'), '删除前必须按新序号重映射展开态');
});

/* ── F6 退格整删 [折叠]：展开态同样不许错位 ───────────────────── */
test('F6 退格整删中间组的 [折叠]：其后把手的展开态必须原样（序号重映射）', t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w, ed } = app;
  w.localStorage.setItem('notesync_fold_open', JSON.stringify({ '': [0, 2] })); // 组1 展开、组3 展开
  ed.innerHTML = '<div>[折叠]甲</div><div>乙</div><div>[折叠]丙</div><div>丁</div><div>[折叠]戊</div><div>己</div>';
  w.applyFolds();
  const head = handles(w)[1];
  const mark = head.querySelector(':scope > .ns-fold-mark');
  // 光标落在 [折叠] 标记文字内部：跨行合并监听判 beforeTxt='[折'≠整标记直接放行，
  // 整删 [折叠] 的护栏接手（v9.x 既有路径）。注意不能放「标记之后」——那一位在 prev 是折叠正文时
  // 归 v10.0.4 跨边界合并管，两条路径互斥是设计使然。
  w.setCaret(mark.firstChild, 2);
  ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));

  assert.strictEqual(handles(w).length, 2, '整删 [折叠] 后剩两处把手');
  assert.deepStrictEqual(states(w), ['展开', '展开'], '其后把手（原组3 展开）删了中间组后仍必须展开——序号前移但状态不错位');
  assert.deepStrictEqual(JSON.parse(w.localStorage.getItem('notesync_fold_open'))[''], [0, 1],
    '退格删组后展开集同样必须前移重落库');
});
