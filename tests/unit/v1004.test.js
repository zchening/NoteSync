// v10.0.4 守护：①折叠三角两态等大（改画几何三角）②折叠组外第一行行首退格 = 按折叠语义跨行合并（只认退格）
// 铁律：行为优先于文本；新断言锚定补丁行；不写布局断言进 jsdom（①的像素等大由 e2e 真测量守）。
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
function plain(w) { return (ed(w).textContent || '').replace(/[\u200B\u200C\uFEFF\u2060]/g, ''); }
function charSig(w) { return plain(w).split('').sort().join(''); }   // 字符多重集（拼接会改顺序，判丢字只能比多重集）
function caretAtBlockStart(w, blockIdx) {
  const blk = blocks(w)[blockIdx];
  ed(w).focus();                                   // 必须先 focus 再落选区：app 的 focus 链会重定位光标
  const r = w.document.createRange(); r.setStart(blk, 0); r.collapse(true);
  const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
  return blk;
}
function key(w, k) { ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
const FX = '<div>[折叠]阳台清单</div><div>花肥、喷壶[/折叠]</div><div>后面这行别删我</div>';

/* ── ① 三角：两态同一套几何，旧"两个不同码位"禁回潮 ── */
test('V1004-A1 两态三角改为边框画的几何形，尺寸成对（v10.1.1：8px 长边 + 8px 底边，8w×8h 盒旋转 90° 全等）', () => {
  const base = SRC.match(/#editor \.ns-fold-mark::before\{([^}]*)\}/);
  const open = SRC.match(/#editor \.ns-fold-open>\.ns-fold-mark::before\{([^}]*)\}/);
  assert.ok(base && open, '两条 ::before 规则都在位');
  assert.ok(/content:''/.test(base[1]) && /border-left:8px solid currentColor/.test(base[1]), '收起＝右向三角（8px 长边，currentColor 吃 --muted）');
  assert.ok(/border-top:8px solid currentColor/.test(open[1]) && /border-left:4px solid transparent/.test(open[1]), '展开＝下向三角，同一 8px 长边（两态必然等大）');
  assert.ok(/border-bottom:4px solid transparent/.test(base[1]) && /border-right:4px solid transparent/.test(open[1]), '底边 4+4=8px 两态互换，旋转关系精确（v10.1.1 F16：两态占宽 8px 相等，跳行根因归零）');
  assert.ok(!/#editor \.ns-fold-mark::before\{[^}]*content:'\\25B6/.test(SRC), '禁回潮：收起不再用 ▶ 码位（字体决定大小）');
  assert.ok(!SRC.includes("#editor .ns-fold-open>.ns-fold-mark::before{content:'▼'}"), '禁回潮：展开不再用 ▼ 码位');
  const mob = SRC.match(/@media \(max-width:560px\)\{\s*#editor \.ns-fold-mark::before\{([^}]*)\}/);
  assert.ok(mob && /border-left:9px solid currentColor/.test(mob[1]), '移动档同构成对放大（9px 长边）');
  assert.ok(mob && /top:0/.test(mob[1]), '移动档必须归零桌面的 top 墨迹补偿（感应区 inline-flex 已居中，叠加会偏上）');
  assert.ok(/top:-6px/.test(base[1]), '桌面三角墨迹中心实测比文字低 6.0px，基规则须带 top:-6px 校准');
  assert.ok(SRC.includes("@media print{#editor .ns-fold-hide{display:block}#editor .ns-fold-mark{font-size:inherit}#editor .ns-fold-mark::before,#editor .ns-fold-open>.ns-fold-mark::before{content:'';display:none;border:0;width:0;height:0;top:0}}"),
    '打印去三角必须两态都连边框清零（展开态选择器特异度更高，只写基规则会被压过）');
  assert.ok(SRC.includes('[data-ns-export]::before{content:"\\\\25BC"'), '导出副本仍走 ▼ 字形（快慢两条导出路径同源，本版不动）');
});

/* ── ② 收起态：整行并到标题末尾，隐藏正文一字不动 ── */
test('V1004-B1 折叠收起 → 组外第一行行首退格 = 整行拼到标题末尾、隐藏正文一字不少、零丢字', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = FX;
  w.applyFolds();
  const sig0 = charSig(w);
  assert.ok(blocks(w)[0].classList.contains('ns-fold-collapsed'), '前置：默认收起');
  assert.ok(blocks(w)[1].classList.contains('ns-fold-hide'), '前置：正文隐藏');
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  const b = blocks(w);
  assert.strictEqual(b.length, 2, '两行并成一行');
  assert.strictEqual(b[0].textContent, '[折叠]阳台清单后面这行别删我', '整行拼到标题末尾：' + b[0].textContent);
  assert.ok(b[1].classList.contains('ns-fold-hide') && b[1].textContent.indexOf('花肥、喷壶') === 0, '隐藏正文原样未动：' + b[1].textContent);
  assert.strictEqual(charSig(w), sig0, '字符多重集一字不差（旧行为这里会整段吞字）');
});

/* ── ② 展开态：整行并到组内正文最后一行末尾，锚仍在行尾 ── */
test('V1004-B2 折叠展开 → 组外第一行行首退格 = 整行拼到组内正文最后一行末尾，闭合锚仍留行尾', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = FX;
  w.applyFolds();
  const sig0 = charSig(w);
  ed(w).querySelector('.ns-fold-mark').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));   // 展开
  assert.ok(blocks(w)[0].classList.contains('ns-fold-open'), '前置：已展开');
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  const b = blocks(w);
  assert.strictEqual(b[1].textContent, '花肥、喷壶后面这行别删我[/折叠]', '拼到组内正文尾且锚在行尾：' + b[1].textContent);
  const es = b[1].lastElementChild;
  assert.ok(es && es.classList.contains('ns-fold-endmark'), '锚 span 仍是该行最后一个子节点（没被挤到中间）');
  assert.strictEqual(charSig(w), sig0, '零丢字（字符多重集不变）');
});

/* ── ② 边界：不该拦的不拦 ── */
test('V1004-B3 只在"上一块是已闭合折叠组尾行"时接管；普通行之间、组内行、回车键都交回原生', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  // 普通两行之间：不许接管（不 preventDefault → jsdom 下 DOM 不变）
  ed(w).innerHTML = '<div>第一行</div><div>第二行</div>';
  w.applyFolds();
  caretAtBlockStart(w, 1);
  const ev = ed(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  assert.strictEqual(blocks(w).length, 2, '普通行退格未被接管（仍由原生处理，jsdom 无原生删除故 DOM 不变）');
  // 组内行（展开态正文第二行）行首退格：属于组内 → 不接管（闸 R2-P1：a2 那种"组外第一行"本就该接管，旧用例口径反了）
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1</div><div>a2[/折叠]</div><div>外行</div>';
  w.applyFolds();
  ed(w).querySelector('.ns-fold-mark').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  assert.strictEqual(blocks(w).length, 4, '组内行行首退格未被接管（块数不变）：' + JSON.stringify(blocks(w).map(x => x.textContent)));
  // 回车：本规则只认退格 → 标题不许被改写、那一行不许被并上去（jsdom 无原生换行，走 app 兜底分支多一块属正常）
  ed(w).innerHTML = FX;
  w.applyFolds();
  caretAtBlockStart(w, 2);
  key(w, 'Enter');
  const be = blocks(w);
  assert.strictEqual(be[0].textContent, '[折叠]阳台清单', '回车保持原生：标题未被拼改');
  assert.ok(plain(w).indexOf('后面这行别删我') >= 0, '回车未被拼接成一行（该行文字仍在原处）');
});

/* ── 闸 R1/R2/R3 三路共同命中的三个形态（必修回归钉） ── */
test('V1004-B5 组尾是"独立行锚"（0 高隐形行）时也必须接管，绝不把可见行并进看不见的行', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>[/折叠]</div><div>外面这行</div>';
  w.applyFolds();
  assert.ok(blocks(w)[1].classList.contains('ns-fold-endline'), '前置：第二块被扫成 0 高独立行锚');
  const sig0 = charSig(w);
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  const b = blocks(w);
  assert.strictEqual(b.length, 2, '接管后并成一行（旧写法交回 Blink → 可见行被吸进 0 高隐形行，"整行凭空消失"）：' + JSON.stringify(b.map(x => x.textContent)));
  assert.strictEqual(b[0].textContent, '[折叠]甲外面这行', '落点是标题末尾，不是那条隐形行');
  assert.strictEqual(charSig(w), sig0, '零丢字');
});

test('V1004-B6 无锚组（存量笔记）+ 紧邻下一把手行首退格 → 接管且零丢字（旧写法实测丢 9 字）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]标题A</div><div>正文A1</div><div>[折叠]标题B</div>';
  w.applyFolds();
  const sig0 = charSig(w);
  assert.ok(!plain(w).includes('[/折叠]'), '前置：这组没有锚（正是报障形态）');
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  const b = blocks(w);
  assert.strictEqual(b.length, 2, '两行并一行：' + JSON.stringify(b.map(x => x.textContent)));
  assert.strictEqual(b[0].textContent, '[折叠]标题A[折叠]标题B', '整行（含它的 [折叠] 字样）按用户规则拼到上一组标题末尾');
  assert.strictEqual(charSig(w), sig0, '零丢字（旧行为这里标题B 掉进隐藏正文，实测 31→22 字）');
});

test('V1004-B7 空行并入展开组：只删不搬，绝不在锚前留"幽灵换行"', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]</div><div><br></div>';
  w.applyFolds();
  ed(w).querySelector('.ns-fold-mark').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const sig0 = charSig(w);
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  const b = blocks(w);
  assert.strictEqual(b.length, 2, '空行被删掉而不是搬进正文：' + JSON.stringify(b.map(x => x.textContent)));
  assert.ok(b[1].innerHTML.indexOf('<br>') < 0, '正文块里没被塞进多余换行：' + b[1].innerHTML);
  assert.ok(b[1].textContent === 'a1[/折叠]', '锚与正文原样：' + b[1].textContent);
  assert.strictEqual(charSig(w), sig0, '零丢字');
});

test('V1004-B8 合并后光标必须落在"看得见"的块上（闸 R2-P0：光标留在 display:none 行里＝打字进黑洞）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).innerHTML = FX;
  w.applyFolds();
  caretAtBlockStart(w, 2);
  key(w, 'Backspace');
  const s = w.getSelection();
  assert.ok(s && s.rangeCount, '有选区');
  let n = s.getRangeAt(0).startContainer;
  while (n && n.parentNode && n.parentNode !== ed(w)) n = n.parentNode;
  assert.ok(n && n !== ed(w), '光标仍在编辑器内某块');
  assert.ok(!n.classList.contains('ns-fold-hide'), '光标所在块必须可见（不得落在收起的隐藏正文里）：' + n.className);
  assert.ok(n.classList.contains('ns-fold'), '收起态合并后光标落在标题块：' + n.className);
});

/* ── 闸 R2-P0 补（真鼠标收起那条路不发 selectionchange）：隐藏块里的退格必须被拦，开合后必须显式归一 ── */
test('V1004-B10 光标已在隐藏正文块里时按退格：必须拦下并就地弹回把手，一个字都不许掉（闸 R2-P0）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  ed(w).contentEditable = 'true';
  ed(w).focus();
  // 手工摆出"刚被真鼠标收起、选区原地没动"的现场（jsdom 不解析 display，正好能造出 Blink 那种陈旧选区）
  ed(w).innerHTML = '<div class="ns-fold ns-fold-collapsed"><span class="ns-fold-mark">[折叠]</span>标题一二三</div><div class="ns-fold-body ns-fold-hide">正文甲甲</div><div>后面这行</div>';
  const hide = ed(w).querySelector('.ns-fold-hide');
  const r = w.document.createRange(); r.setStart(hide.firstChild, 2); r.collapse(true);
  const sel0 = w.getSelection(); sel0.removeAllRanges(); sel0.addRange(r);
  const sig0 = charSig(w);
  const ev = new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
  ed(w).dispatchEvent(ev);
  assert.strictEqual(ev.defaultPrevented, true, '隐藏块里的退格必须 preventDefault——让回原生＝Blink 跳过无盒子的隐藏块直接和把手行合并，连正文带标题尾字一起吃掉并自动同步上云');
  assert.strictEqual(charSig(w), sig0, '拦下这一记的同时必须零丢字');
  const s = w.getSelection();
  let n = s && s.rangeCount ? s.getRangeAt(0).startContainer : null;
  if (n && n.nodeType === 3) n = n.parentElement;
  while (n && n.parentNode && n.parentNode !== ed(w)) n = n.parentNode;
  assert.ok(n && n.classList && n.classList.contains('ns-fold'), '光标须被弹回该组把手（可见处）：' + (n && n.className));
  assert.ok(!(n.classList && n.classList.contains('ns-fold-hide')), '光标不得仍停在隐藏块里');
});

test('V1004-B11 源码锚：开合后显式归一（不依赖事件）+ 感应区补件不画像素 + 行尾 <br> 不随整行搬走（闸 R2-P0/P1/P2③）', () => {
  const click = SRC.slice(SRC.indexOf('// 点行首三角开合'), SRC.indexOf('// ── v9.3.0：编辑器内选择复制'));
  assert.ok(click.includes('try { applyFolds(); }'), '开合处理器仍在位');
  assert.ok(click.indexOf('foldCaretNormalize()') > click.indexOf('applyFolds()'), '收起后必须紧跟一次显式 foldCaretNormalize()：真鼠标点三角时 mousedown 被 preventDefault＝选区原地不动、selectionchange 压根不派发，只挂事件的守卫一次都不会跑（E6 那种 element.click() 是假绿）');
  const bs = SRC.slice(SRC.indexOf("if (e.key !== 'Backspace'"), SRC.indexOf('// 护栏：光标落在 [折叠] 标记内或紧随其后时按退格'));
  assert.ok(bs.includes("if (blk.classList.contains('ns-fold-hide')) {"), '退格须先查"光标所在块已隐藏"');
  assert.ok(bs.indexOf("ns-fold-hide')") < bs.indexOf('ns-fold-body') , '隐藏块分支必须排在"组内行交回原生"之前，否则hide态正文行照样让回 Blink');
  assert.ok(/while \(frag\.lastChild && frag\.lastChild\.nodeType === 1 && frag\.lastChild\.tagName === 'BR'\)/.test(bs), '整行搬走前须剥掉块尾那枚撑行高的 <br>（否则展开态组末凭空多一条空行、收起态标题变两行）');
  assert.ok(bs.indexOf("tagName === 'BR'") < bs.indexOf('hasTailEndMark(host)'), '剥 br 要在插入目标行之前完成');
  // 桌面感应区：透明 absolute 补件 + 定位基准 + 窄屏撤销（只准扩落点，一像素都不许多画）
  assert.ok(/#editor \.ns-fold-mark\{[^}]*position:relative[^}]*\}/.test(SRC), 'mark 须为感应区补件提供定位基准');
  const after = (SRC.match(/#editor \.ns-fold-mark::after\{([^}]*)\}/) || [])[1] || '';
  assert.ok(after.includes("content:''") && after.includes('position:absolute'), '缺的这枚感应区必须是 absolute 出流（不占行盒、不改缩进）：' + after);
  assert.ok(!/background|border|box-shadow/.test(after), '感应区补件绝不许画任何像素（E1/E4 两态墨迹等大用例是它的对照锚）：' + after);
  assert.ok(/@media \(max-width:560px\)\{[\s\S]*?#editor \.ns-fold-mark::after\{content:none\}/.test(SRC), '窄屏已有 44×44 感应区，须撤掉桌面补件，免得它在 inline-flex 里多占一个子盒把居中挤偏');
});

test('V1004-B4 源码锚：不用 :scope、frag 在 catch 可见、抛错回塞', () => {
  assert.ok(SRC.includes('function hasTailEndMark(block)'), '锚探测走直属子遍历（项目铁律：护栏不得用 :scope，老内核抛错会静默失效）');
  assert.ok(!/querySelector\(':scope > span\.ns-fold-endmark'\)/.test(SRC), '本版新增代码里不得出现 :scope');
  const seg = SRC.slice(SRC.indexOf('function foldGroupOfPrev'), SRC.indexOf("// 护栏：光标落在 [折叠] 标记内"));
  assert.ok(seg.includes('let frag = null;') && seg.includes('frag = cut.extractContents();'), 'frag 声明在 try 外，catch 才拿得到');
  assert.ok(/catch \(err\) \{[\s\S]{0,220}blk\.insertBefore\(frag, blk\.firstChild\)/.test(seg), '抛错路径把摘出的整行塞回原位（字符守恒优先）');
  assert.ok(seg.includes('if (e.defaultPrevented) return;'), '两条退格监听互斥：已被前一条处理过就不再处理一遍（闸 R2-P2）');
  assert.ok(seg.includes('placeCaretAfterMerge(host);'), '合并后必须显式落光标到可见拼接点，不能指望 ensureCaret 兜住隐形块（闸 R2-P0）');
  assert.ok(seg.includes('if (!g) return;') && !seg.includes('g.anchored'), '不再要求"已落锚"——无锚组同样接管（闸 R1-P0a）');
  assert.ok(seg.includes("cl.contains('ns-fold-endline')"), '独立行锚也识别为组尾行并接管，落点取标题/正文而非那条 0 高隐形行（闸 R1-P0b/R2-P1/R3-①）');
  assert.ok(!/:scope/.test(seg), '本段不得出现 :scope（老内核抛错=护栏静默失效）');
});

/* ── 三审补：光标停在"刚被收起的隐藏正文"里必须弹回可见处 ──
   行为侧由 tests/e2e/v1004.test.js E6 在真 Chromium 验（jsdom 的选区模型会把光标从 display:none
   块里自行挪走，撑不住这个场景，硬写 jsdom 断言只会得到"永远 true/永远 false"的假信号）。 */
test('V1004-B9 源码锚：归一化含"光标落在隐藏正文块 → 弹回该组把手可见文字末尾"这条护栏', () => {
  const fn = SRC.slice(SRC.indexOf('function foldCaretNormalize'), SRC.indexOf('// 块内可见内容的末尾落位'));
  assert.ok(fn.length > 200, '取到 foldCaretNormalize 函数体');
  assert.ok(fn.includes("eb2.classList.contains('ns-fold-hide')"), '须判定"光标所在块已随收起变隐藏"');
  assert.ok(/while \(n\) \{ if \(n\.classList && n\.classList\.contains\('ns-fold'\)\) break;/.test(fn), '须向上找该组把手');
  assert.ok(fn.includes('placeCaretAfterMerge(n)') && fn.indexOf('placeCaretAfterMerge(n)') < fn.indexOf('foldLeftmostPos(mk2)'),
    '落位首选把手可见文字末尾（闸 R2 复审二轮：自动摆到行最左位＝给下一记退格递刀，一记键整删 [折叠]+连带隐形的 [/折叠] 共 9 字、拆掉整组结构还自动上云）；最左位只作兜底');
  assert.ok(fn.includes('foldLeftmostPos(mk2)') && fn.includes('setCaret(pos2.node, pos2.off)'), '兜底路径仍走 setCaret（红线3：不 removeAllRanges 打编辑器）');
  assert.ok(fn.includes('foldJumpToPrevLineEnd(eb2)'), '找不到把手时兜底跳上一可见行尾，绝不让光标停在看不见的地方');
  assert.ok(fn.indexOf("eb2.classList.contains('ns-fold-hide')") > fn.indexOf('caretAtFoldEndMark(r)'), '分支顺序：隐形锚护栏在前');
  assert.ok(fn.indexOf("eb2.classList.contains('ns-fold-hide')") < fn.indexOf('caretInsideFoldMark(r)'), '隐藏块护栏须在 [折叠] 标记判定之前生效');
});

/* ── 三 bump + 双壳 ── */
test('V1004-C1 三 bump 10.0.4 + 双壳逐字节', () => {
  assert.ok(SRC.includes("const APP_VERSION = '10.1.3';"), 'APP_VERSION 应 10.0.4');
  assert.ok(GRADLE.includes('versionCode 1013') && GRADLE.includes('versionName "10.1.3"'), 'gradle 应 1004/10.0.4');
  assert.ok(MCP.includes("version: '10.1.3'"), 'MCP serverInfo 应 10.0.4');
  const a = fs.readFileSync(path.join(ROOT, 'www/index.html'));
  const b = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'));
  const c = fs.readFileSync(path.join(ROOT, 'index.html'));
  assert.ok(a.equals(c) && b.equals(c), '双壳必须与根 index.html 逐字节一致');
});
