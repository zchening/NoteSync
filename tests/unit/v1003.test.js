// v10.0.3 守护：折叠组语义改造 + 导出图折叠正文缺缩进/竖线修复。
// 用户报障两症状同源：旧口径「[折叠] 往下折到第一个空行为止」让空行既当排版又当边界——
//   ① 展开态在标题与正文间留个空块 → 组当场截断，原正文整段掉出组、三角再也折不回去；
//   ② 收起态在把手上回车 → Blink 把把手劈成「[折叠]前半句 + 隐藏后半句」，新打的字一并被吞成隐藏正文（字没删，只是看不见）。
// 新口径（用户拍板）：组 = 把手往下，直到 ①下一个 [折叠] 把手 ②[/折叠] 闭合锚 ③文末；空行彻底退出边界判定。
//   把手行回车 = 前半句留把手、后半句（或空新行）挪到锚之后＝组外，组内正文与开合态一律不动。
// 铁律：行为优先于文本；新断言锚定补丁行；不写布局断言进 jsdom。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const MCP = fs.readFileSync(path.join(ROOT, 'tools/notesync-mcp-server.js'), 'utf8');

function ed(w) { return w.document.getElementById('editor'); }
function blocks(w) { return Array.prototype.slice.call(ed(w).children); }
function cls(b) { return b.className || '(裸)'; }
const END = '[/折叠]';
function foldEndOf(b) {
  if (!b) return false;
  if (b.classList && (b.classList.contains('ns-fold-endline') || b.querySelector('span.ns-fold-endmark'))) return true;
  return (b.textContent || '').replace(/[\u200B\u200C\uFEFF\u2060]/g, '').trim().slice(-END.length) === END;
}
function tailOf(b) {
  const n = b && b.lastChild;
  if (!n) return '';
  return (n.nodeType === 3 ? n.nodeValue : (n.textContent || '')).replace(/[\u200B\u200C\uFEFF\u2060]/g, '');
}

/* ── A 组边界语义翻转：无锚＝标题以下全归组；有锚＝折到锚；下一把手收束 ── */
test('V1003-A 边界翻转：空行不再收束、[/折叠] 锚与下一把手才收束', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  // 无锚：标题以下（含空行与其后正文）全归组
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1</div><div><br></div><div>a2</div>';
  w.applyFolds();
  let b = blocks(w);
  assert.ok(b[2].classList.contains('ns-fold-gap'), '组内空行＝空隙（不再是收束点）');
  assert.ok(b[3].classList.contains('ns-fold-body'), '空行之后的 a2 仍在本组（旧口径判它出组＝本次根因）');
  assert.ok(b[3].classList.contains('ns-fold-hide'), '收起态 a2 一并折起');
  // 有挂尾锚：锚之后回到组外
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]</div><div>a2</div>';
  w.applyFolds();
  b = blocks(w);
  assert.ok(b[1].classList.contains('ns-fold-body'), '挂尾行本身是组内最后一行');
  assert.ok(b[1].querySelector('span.ns-fold-endmark'), '行尾锚被包成隐形 span（文本仍在，不丢字）');
  assert.ok(!b[2].classList.contains('ns-fold-body') && !b[2].classList.contains('ns-fold-hide'), '锚之后的行回到组外且可见');
  // 下一把手收束：两处折叠互不吞
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1</div><div>[折叠]乙</div><div>b1</div>';
  w.applyFolds();
  b = blocks(w);
  assert.ok(b[2].classList.contains('ns-fold') && !b[2].classList.contains('ns-fold-hide'), '第二个把手不被第一组吞成正文（旧口径必吞，E4 实锤）');
});

/* ── B 锚的渲染幂等与两形态 ── */
test('V1003-B 锚渲染幂等：连跑多次不重复包 span、不叠 [/折叠]、独立行锚压 0 高', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]</div><div>a2</div>';
  w.applyFolds(); w.applyFolds(); w.applyFolds();
  const b = blocks(w);
  assert.strictEqual(b[1].querySelectorAll('span.ns-fold-endmark').length, 1, '挂尾锚 span 只有一枚');
  assert.strictEqual(b[1].textContent, 'a1[/折叠]', '[/折叠] 文本不翻倍、不丢字');
  assert.strictEqual(b[1].querySelector('span.ns-fold-endmark').textContent, '[/折叠]', '隐形 span 里就是那 4 个字');
  // 独立行形态（组内无正文可挂时的兜底，也接受用户手写）
  ed(w).innerHTML = '<div>[折叠]甲</div><div>[/折叠]</div><div>a2</div>';
  w.applyFolds();
  const c = blocks(w);
  assert.ok(c[1].classList.contains('ns-fold-endline'), '整行只有 [/折叠] → 打 ns-fold-endline');
  assert.ok(!c[1].classList.contains('ns-fold-body'), '独立行锚不属于正文');
  assert.ok(!c[2].classList.contains('ns-fold-hide'), '锚之后的行在组外');
  assert.ok(SRC.includes('#editor .ns-fold-endline{height:0;line-height:0;overflow:hidden;opacity:0;font-size:0}'), '独立行锚 0 高不占位（锚定执法行）');
  assert.ok(SRC.includes('#editor span.ns-fold-endmark{font-size:0}'), '挂尾锚隐形（锚定执法行）');
});

/* ── C 把手行回车落点（用户拍板的新规则，替掉 v9.3.7 只挡一格的守卫） ── */
test('V1003-C 把手行回车：前半句留把手、后半句挪到锚后＝组外、组内正文不动', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]我是标题后面还有字</div><div>正文1</div><div>正文2</div>';
  w.applyFolds();
  // 光标落在标题可见文字中间（"我是标题" 之后）
  const titleText = blocks(w)[0].lastChild;
  const r = w.document.createRange();
  r.setStart(titleText, 4); r.setEnd(titleText, 4);
  w.getSelection().removeAllRanges(); w.getSelection().addRange(r);
  ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const b = blocks(w);
  assert.ok(b[0].classList.contains('ns-fold'), '把手仍是把手（标记不被劈开）');
  assert.strictEqual(b[0].textContent.replace('[折叠]', ''), '我是标题', '光标前的字留在把手行');
  assert.ok(b[1].classList.contains('ns-fold-body') && b[1].textContent.indexOf('正文1') === 0, '组内正文1 一个字没动');
  assert.ok(b[2].classList.contains('ns-fold-body'), '组内正文2 仍在组内');
  assert.ok(b[2].textContent.indexOf('[/折叠]') > 0, '自动补了闭合锚（挂在组内最后一行行尾）');
  const moved = b[3];
  assert.ok(!moved.classList.contains('ns-fold') && !moved.classList.contains('ns-fold-body'), '被挪出的后半句在组外（不属折叠）');
  assert.ok(moved.textContent.indexOf('后面还有字') >= 0, '后半句整体挪到整组之后');
  // 末尾回车：不劈标题，只另起组外新行
  ed(w).innerHTML = '<div>[折叠]标题乙</div><div>b1</div>';
  w.applyFolds();
  const t2 = blocks(w)[0].lastChild;
  const r2 = w.document.createRange();
  r2.setStart(t2, t2.nodeValue.length); r2.setEnd(t2, t2.nodeValue.length);
  w.getSelection().removeAllRanges(); w.getSelection().addRange(r2);
  ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const c = blocks(w);
  assert.strictEqual(c[0].textContent.replace('[折叠]', ''), '标题乙', '末尾回车不许劈标题（旧形态：把手被劈成两半）');
  assert.ok(c[c.length - 1] !== c[0] && !c[c.length - 1].classList.contains('ns-fold-body'), '新块落在整组之后＝组外');
  assert.ok(!SRC.includes("blk.classList.contains('ns-fold-collapsed')"), '禁回潮：v9.3.7「只挡收起态标题末尾那一格」的旧判据');
});

/* ── D 光标/退格护栏：隐形锚不是停靠点，删把手联动删锚 ── */
test('V1003-D 护栏：光标不许停在锚内/锚后、锚行不许停靠、删把手联动清锚', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  assert.ok(/const em = caretAtFoldEndMark\(r\);[\s\S]{0,160}foldEndBeforePos\(em\)/.test(SRC), '归一化必须先把「锚内/锚后」的光标弹回锚之前（在那儿打字会把锚顶到行中间→整组散架）');
  assert.ok(SRC.includes("eb.classList.contains('ns-fold-endline')"), '独立行锚（0 高）不许当停靠点：光标落进去就近弹到可见行');
  assert.ok(SRC.includes('try { removeFoldAnchorAfter(handle); } catch (err) {}'), '删 [折叠] 把手必须联动删掉本组锚（否则行尾留下无主 [/折叠]）');
  // 行为：删把手后锚真的没了
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]</div><div>a2</div>';
  w.applyFolds();
  const mark = ed(w).querySelector('.ns-fold-mark');
  const rr = w.document.createRange();
  rr.setStartAfter(mark); rr.setEnd(rr.startContainer, rr.startOffset);
  w.getSelection().removeAllRanges(); w.getSelection().addRange(rr);
  ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  assert.ok(ed(w).textContent.indexOf('[/折叠]') < 0, '把手删掉后闭合锚一并清除');
  assert.ok(!ed(w).querySelector('.ns-fold'), '把手已不再是折叠');
  assert.ok(ed(w).textContent.indexOf('a1') >= 0 && ed(w).textContent.indexOf('a2') >= 0, '删把手一个字正文都不丢');
});

/* ── E 导出图修复：折叠正文缩进+左竖线在导出副本里也要生效，锚不露字 ── */
test('V1003-E 导出图：.ns-export 复刻缩进与左引导线，锚在出图里隐形', () => {
  assert.ok(SRC.includes("'.ns-export .ns-fold-body{margin-left:.5em;padding-left:1em;border-left:2px solid var(--line)}'"),
    '导出副本必须逐字复刻基规则（基规则锁 #editor，离屏副本吃不到＝本次报障根因）');
  assert.ok(SRC.includes("'.ns-export .ns-fold-gap{margin-left:.5em;padding-left:1em;border-left:2px solid var(--line)}'"),
    '组内空隙同样要有引导线（否则线在空行处断开）');
  assert.ok(SRC.includes("tmp.querySelectorAll('.ns-fold-endmark').forEach(mk => { mk.setAttribute('data-ns-export-end', '1'); })"),
    '导出副本内的闭合锚打属性标');
  assert.ok(SRC.includes("'[data-ns-export-end]{font-size:0}'"), '出图里锚不露字');
  assert.ok(SRC.includes('.ns-export .ns-fold-endline{height:0;line-height:0;overflow:hidden;opacity:0;font-size:0}'), '独立行锚出图也不占位');
  // 基规则与复刻串必须逐字同（防两路分叉）
  const base = SRC.match(/#editor \.ns-fold-body\{[^}]*\}/)[0];
  const copy = SRC.match(/\.ns-export \.ns-fold-body\{[^}]*\}/)[0];
  assert.strictEqual(copy.replace('.ns-export', '#editor'), base, '导出复刻与编辑器基规则必须一字不差');
  assert.ok(SRC.includes('max-height overflow transform'), 'SVG 快渲白名单仍含 overflow（margin/padding/border-left 早在白名单，两路同源）');
});

/* ── E2 导出行为：副本带 ns-fold-body/gap 类、编辑器 DOM 零渗透、正文零写入 ── */
test('V1003-E2 行为：收起折叠导出，副本内正文类在位、锚隐形 span 在位、编辑器零渗透', async t => {
  const bag = {};
  const dom = loadApp(w => {
    w.html2canvas = (node, opts) => {
      bag.node = node; bag.opts = opts;
      return Promise.resolve({ toBlob: cb => cb(new w.Blob(['fake'], { type: 'image/png' })) });
    };
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  ed(w).innerHTML = '<div>[折叠]标题</div><div>正文1</div><div>正文2[/折叠]</div><div>组外行</div>';
  w.applyFolds();
  const before = ed(w).innerHTML;
  await w.renderNotePng();
  assert.ok(bag.node.querySelector('.ns-fold-body'), '导出副本里正文块仍带 ns-fold-body（新 CSS 才有得吃）');
  assert.ok(bag.node.querySelector('[data-ns-export-end]'), '副本内锚被打属性标');
  assert.ok(!ed(w).querySelector('[data-ns-export-end]'), '编辑器 DOM 零渗透');
  assert.strictEqual(ed(w).innerHTML, before, '导出不得改正文一个字');
});

/* ── F 等价口径：包不包锚 span 不算内容差异；真改字必须判不等 ── */
test('V1003-F 等价口径：闭合锚 span 是装饰，锚文本本身是真实内容', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const bare = '<div>[折叠]甲</div><div>a1[/折叠]</div><div>a2</div>';
  const wrapped = '<div class="ns-fold ns-fold-collapsed"><span class="ns-fold-mark">[折叠]</span>甲</div><div class="ns-fold-body ns-fold-hide">a1<span class="ns-fold-endmark">[/折叠]</span></div><div>a2</div>';
  assert.ok(w.isDecorativelyEqual(bare, wrapped), 'applyFolds 包锚 span 不得被当成内容改动（防假脏/幻影撤销）');
  assert.ok(w.isPlaceholderEqual(bare, wrapped), '占位等价同口径');
  const realEdit = wrapped.replace('a1<', 'a1改<');
  assert.ok(!w.isDecorativelyEqual(bare, realEdit), '真改一个字必须判不等（豁免不得吞掉真实差异）');
});

/* ── H 闸内命中五修（R1-P1 / R2-P0-1 / P0-2 / P1-3 / P1-4 / P1-5 / P1-6 / P2-8 / P2-9） ── */
function caretInBlock(w, blockIdx, charOff) {
  const ed0 = ed(w);
  const blk = ed0.children[blockIdx];
  const tn = (function (b) { const ns = b.childNodes; for (let i = 0; i < ns.length; i++) if (ns[i].nodeType === 3 && ns[i].nodeValue) return ns[i]; return null; })(blk);
  assert.ok(tn, '测试前置：块内有可落光标的文本');
  const off = charOff === 'end' ? tn.nodeValue.length : Math.floor(tn.nodeValue.length / 2);
  const r = w.document.createRange(); r.setStart(tn, off); r.setEnd(tn, off);
  const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
function pressEnter(w) {
  ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

test('V1003-H1 组末行以链接收尾时，锚必须落在块真末尾且不显裸字（旧写法插到链接前→foldEndKind 认不出→组散架）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>组内前文<a href="https://x.com/a" data-url="1">官网</a></div>';
  w.applyFolds();
  caretInBlock(w, 0, 'end');
  pressEnter(w);
  const b = blocks(w);
  const anchored = b[1];
  assert.ok(foldEndOf(anchored), '组末行末尾必须有锚：' + JSON.stringify(b.map(x => x.textContent)));
  assert.strictEqual(tailOf(anchored), '[/折叠]', '锚必须挂在块的最后（旧写法回头找文本节点 → 插到链接前面）');
  assert.ok(anchored.querySelector('span.ns-fold-endmark'), '锚被包成隐形 span，不以裸文本显形');
  const a = anchored.querySelector('a');
  assert.ok(a && a.getAttribute('href') === 'https://x.com/a', '原链接与 href 一字未动');
  const nb = b[b.length - 1];
  assert.ok(nb !== anchored && !nb.classList.contains('ns-fold-body') && !nb.classList.contains('ns-fold-hide'), '新块落在锚之后＝组外（旧缺陷：被吞进收起的组）');
});

test('V1003-H2 把手行含链接/删除线时回车：节点整体搬运，href 与行内格式绝不丢', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]看<a href="https://important.example/x" data-url="1">重要链接</a>后面</div><div>正文一</div>';
  w.applyFolds();
  caretInBlock(w, 0, 'mid');
  pressEnter(w);
  const html = ed(w).innerHTML;
  assert.ok(html.indexOf('important.example/x') >= 0, 'href 必须原样保留（旧实现 textContent 往返 → 链接永久丢失并同步上云）');
  const moved = Array.prototype.find.call(ed(w).children, x => x.textContent.indexOf('重要链接') >= 0 && !x.classList.contains('ns-fold'));
  assert.ok(moved && moved.querySelector('a'), '被挪出的后半句仍是真 <a> 节点：' + html);
});

test('V1003-H3 把手自挂锚 [折叠]标题[/折叠] = 空组且已闭合（不特判会显裸字并吞掉后面所有行）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]标题[/折叠]</div><div>后面这行</div>';
  w.applyFolds();
  const b = blocks(w);
  assert.ok(b[0].querySelector('span.ns-fold-endmark'), '把手行尾的锚被包成隐形 span（不显裸字）');
  assert.strictEqual(b[0].textContent, '[折叠]标题[/折叠]', '文本一字不丢');
  assert.ok(!b[1].classList.contains('ns-fold-body') && !b[1].classList.contains('ns-fold-hide'), '后面那行不归本组（组已被自己的锚闭合）');
});

test('V1003-H4 跨组扫描按类认把手：甲无锚乙有锚时，补锚不许越过乙、更不许删错组的锚', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1</div><div>[折叠]乙</div><div>b1[/折叠]</div><div>尾</div>';
  w.applyFolds();
  caretInBlock(w, 0, 'end');                                      // 光标在甲把手末尾
  pressEnter(w);
  const b = blocks(w);
  const anchorIdx = b.findIndex(x => foldEndOf(x));
  assert.ok(anchorIdx >= 0 && anchorIdx <= 2, '甲的锚只能落在甲组范围内（找到位置 ' + anchorIdx + '）：' + JSON.stringify(b.map(x => x.textContent)));
  assert.ok(b[b.length - 1].textContent.indexOf('尾') >= 0 && !b[b.length - 1].classList.contains('ns-fold-hide'), '乙组之后的「尾」没被误伤');
});

test('V1003-H5 无主锚清扫：上方没有折叠的孤立 [/折叠] 行压 0 高，绝不成裸字（两端各补一次的残锚）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>普通一行</div><div>[/折叠]</div><div>另一行</div>';
  w.applyFolds();
  const b = blocks(w);
  assert.ok(b[1].classList.contains('ns-fold-endline'), '孤立锚行必须被扫成 0 高不占位');
  assert.ok(SRC.includes('#editor .ns-fold-endline{height:0;line-height:0;overflow:hidden;opacity:0;font-size:0}'), '清扫样式在位');
});

test('V1003-H6 闸内源码锚：搬节点函数/回车兜底 try/组字三判/快渲长写白名单', () => {
  assert.ok(/function foldSplitPoint\(block, visHead\)/.test(SRC), '拆把手行靠 foldSplitPoint 定位 + Range.extractContents 搬节点（禁 textContent 往返）');
  assert.ok(SRC.includes('frag = cut.extractContents();'), '后半句按节点搬走（链接/删除线/提醒标记原样）');
  assert.ok(SRC.includes('let foldHandled = false;') && SRC.includes('document.execCommand(\'insertParagraph\');') , '回车分支任何一步抛错都要回落原生换行（禁"把手行回车失灵"）');
  assert.ok(SRC.includes("if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey) return;"), '组字守卫三判（e.isComposing + keyCode 229 + 模块级 isComposing）——安卓 WebView 单判不可靠');
  assert.ok(SRC.includes('border-left-width border-left-style border-left-color'), 'SVG 快渲白名单补 border-left 长写（简写个别内核 getPropertyValue 返空 + foreignObject 内 var(--line) 不解析）');
  assert.ok(SRC.includes('function isFoldHandleBlock(b)'), '跨组扫描统一走 isFoldHandleBlock（渲染后把手首子是 span，foldLeadInfo 会漏判）');
  assert.ok(SRC.includes('function stripFoldEndMarkFrom(block)'), '异常回滚要能撤掉本次刚补的锚（不撤则锚甩在行中成裸字）');
  assert.ok(SRC.includes('if (foldAnchorJustAdded)'), '只在"本次真补了锚"时撤锚，别误删用户原有的锚');
  assert.ok(SRC.includes('function foldHasVisualChild(b)'), 'hasVisual 只看块直属子节点（querySelector 全子树会把嵌图/嵌套 br 误判成 tail）');
});

test('V1003-H9 闸 R2三审-①：回车分支中途抛错要"像没按过"——不新增块、不吞字、不留裸锚、绝不二次换行', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]我是标题后面还有字</div><div>正文一</div>';
  w.applyFolds();
  const n0 = blocks(w).length;
  caretInBlock(w, 0, 'mid');
  const orig = w.document.createTreeWalker;                       // 让 foldSplitPoint 中途抛错 → 走 catch 回滚
  w.document.createTreeWalker = function () { throw new Error('stubbed mid-flight failure'); };
  let threw = false;
  try { pressEnter(w); } catch (e) { threw = true; }
  w.document.createTreeWalker = orig;
  assert.strictEqual(threw, false, '监听器自身绝不让异常冒出（否则后续 keydown 处理链全断）');
  const b = blocks(w);
  assert.strictEqual(b.length, n0, '抛错路径不许新增任何块（旧写法漏 return → 掉到通用分支再劈一次，多一枚空块）：' + JSON.stringify(b.map(x => x.textContent)));
  assert.strictEqual(b[0].textContent, '[折叠]我是标题后面还有字', '把手行原样：后半句没蒸发、也没落进组内');
  assert.strictEqual(b[1].textContent, '正文一', '组内正文没被动过');
  assert.strictEqual(ed(w).textContent.indexOf('[/折叠]'), -1, '本次没留下半截锚/裸锚');

  // 第二段：让"摘出后半句之后、落锚那一刻"抛错（createTextNode 在 ensureFoldEndAnchor 内且未被包）
  // → 必须把摘出去的后半句回塞把手行、且不留下半个锚，整体"像没按过"
  const origTN = w.document.createTextNode.bind(w.document);
  let boom = true;
  w.document.createTextNode = function (txt) {
    if (boom && String(txt) === '[/折叠]') { boom = false; throw new Error('stubbed anchor-create failure'); }
    return origTN(txt);
  };
  const n1 = blocks(w).length;
  caretInBlock(w, 0, 'mid');
  let threw2 = false;
  try { pressEnter(w); } catch (e) { threw2 = true; }
  w.document.createTextNode = origTN;
  assert.strictEqual(threw2, false, '抛错不外冒');
  const c = blocks(w);
  assert.strictEqual(c.length, n1, '落锚时抛错也不许多出块：' + JSON.stringify(c.map(x => x.textContent)));
  assert.strictEqual(c[0].textContent, '[折叠]我是标题后面还有字', '后半句必须原样回到把手行（不蒸发、不重复）');
  assert.strictEqual(ed(w).textContent.indexOf('[/折叠]'), -1, '不许留下半截锚');
});

test('V1003-H7 空折叠组出组回车：锚挂把手行尾，绝不新增 0 高"幽灵行"', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  // 真·空组：把手后面什么都没有（无锚时"标题以下全归组"，有下文就不算空组）
  ed(w).innerHTML = '<div>[折叠]只有标题</div>';
  w.applyFolds();
  caretInBlock(w, 0, 'end');
  pressEnter(w);
  let b = blocks(w);
  assert.ok(b[0].querySelector('span.ns-fold-endmark'), '空组的锚挂在把手行行尾：' + JSON.stringify(b.map(x => x.textContent)));
  assert.strictEqual(b[0].textContent, '[折叠]只有标题[/折叠]', '把手文本一字不丢');
  assert.ok(!Array.prototype.some.call(b, x => x.textContent.replace(/[\u200B]/g, '').trim() === '[/折叠]'), '没有多出一条只装锚的隐形行');
  assert.strictEqual(b.length, 2, '只多了"用户那一行"');
  // 空组的另一种形态：紧挨着下一个把手（甲组内无正文）
  ed(w).innerHTML = '<div>[折叠]甲</div><div>[折叠]乙</div><div>b1</div>';
  w.applyFolds();
  caretInBlock(w, 0, 'end');
  pressEnter(w);
  b = blocks(w);
  assert.ok(b[0].querySelector('span.ns-fold-endmark'), '甲的锚挂在甲把手行尾，不越界到乙：' + JSON.stringify(b.map(x => x.textContent)));
  const yi = b.find(x => x.classList.contains('ns-fold') && x.textContent.indexOf('乙') >= 0);
  assert.ok(yi, '乙仍是独立把手');
  const bb1 = b.find(x => x.textContent.indexOf('b1') >= 0);
  assert.ok(bb1 && bb1.classList.contains('ns-fold-body'), 'b1 归乙组（甲已自挂锚闭合，不会跨组吞乙的正文）');
  assert.ok(b.indexOf(bb1) > b.indexOf(yi), '顺序仍是 甲→新行→乙→b1：' + JSON.stringify(b.map(x => x.textContent)));
});

test('V1003-H8 闸二轮回修：空行挂锚不塌行高、组外/重复/行尾 br 的锚一律不露字', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  // 裸字判据：块内所有"不在隐形 span 里"的文本拼起来不得出现 [/折叠]
  function naked(b) {
    let out = '';
    const walk = w.document.createTreeWalker(b, w.NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && n.parentElement.closest && n.parentElement.closest('span.ns-fold-endmark, span.ns-fold-mark')) ? 2 /*SKIP*/ : 1
    });
    let n; while ((n = walk.nextNode())) out += n.nodeValue;
    return out.replace(/[\u200B\u200C\uFEFF\u2060]/g, '');
  }
  // ① R2-P2-a：组末行是空行时挂锚 → 该行仍要有行高（不得被扫成 0 高 endline）
  ed(w).innerHTML = '<div>[折叠]甲</div><div>正文</div><div><br></div>';
  w.applyFolds();
  caretInBlock(w, 0, 'end');
  pressEnter(w);
  let b = blocks(w);
  const blankHost = b.find(x => naked(x).indexOf('[/折叠]') < 0 && x.querySelector && x.querySelector('span.ns-fold-endmark') && x.querySelector('br'));
  assert.ok(blankHost, '空行上的锚被包成隐形 span 且该行仍在：' + JSON.stringify(b.map(x => ({ t: x.textContent, c: cls(x) }))));
  assert.ok(!blankHost.classList.contains('ns-fold-endline'), '空行没被误判成"整行只有锚"而塌成 0 高');
  // ② R2-P2-b：组外行尾的裸锚（重复锚/手写）就地隐形
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠][/折叠]</div><div>尾</div>';
  w.applyFolds();
  b = blocks(w);
  assert.strictEqual(naked(b[1]).indexOf('[/折叠]'), -1, '两枚锚都不许露字：' + JSON.stringify(naked(b[1])));
  assert.ok(b[1].querySelectorAll('span.ns-fold-endmark').length >= 1, '锚被包进隐形 span');
  // ③ R2-P2-c：锚后面还跟着行尾 <br> 时也要包
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]<br></div><div>尾</div>';
  w.applyFolds();
  b = blocks(w);
  assert.strictEqual(naked(b[1]).indexOf('[/折叠]'), -1, '行尾 br 不影响锚隐形：' + JSON.stringify(naked(b[1])));
  // ④ 组外独立一行手写 [/折叠] 仍按整行锚压 0 高（不显形）
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]</div><div>[/折叠]</div>';
  w.applyFolds();
  b = blocks(w);
  assert.ok(b[2].classList.contains('ns-fold-endline'), '组外孤立整行锚压 0 高');
});

/* ── G 三 bump + 双壳逐字节 ── */
test('V1003-G 三 bump 10.0.3 + 双壳逐字节', () => {
  assert.ok(SRC.includes("const APP_VERSION = '10.1.2';"), 'APP_VERSION 应 10.0.3');
  assert.ok(GRADLE.includes('versionCode 1012') && GRADLE.includes('versionName "10.1.2"'), 'gradle 应 1003/10.0.3');
  assert.ok(MCP.includes("version: '10.1.2'"), 'MCP serverInfo 应 10.0.3');
  const a = fs.readFileSync(path.join(ROOT, 'www/index.html'));
  const b = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'));
  const c = fs.readFileSync(path.join(ROOT, 'index.html'));
  assert.ok(a.equals(c) && b.equals(c), '双壳必须与根 index.html 逐字节一致');
});
