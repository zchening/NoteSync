// v7.3.4 块级三方合并 · 独立定向探针（测试者依据契约手工推演期望值，再断言）。
// 三个纯函数 blockize / lcsPairs / threeWayMergeBlocks 经 window.__threeWayMerge 探针测试。
// 铁律验收：任一用例若"吞掉本机输入 / 吞掉远端内容 / 错位 / 该弹条却静默合并"一律判败并报告；
// 绝不为了通过而放宽语义。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

function freshApp() {
  const dom = loadApp();
  const w = dom.window;
  if (typeof w.__threeWayMerge !== 'function') {
    throw new Error('window.__threeWayMerge 未定义 → index.html 未真正加载到 jsdom，先排查加载而非放水');
  }
  const merge = (anc, mine, theirs) => w.__threeWayMerge(anc, mine, theirs);
  return { dom, w, merge };
}

test('V734-M-SMOKE：加载成功且 __threeWayMerge 可触发', () => {
  const { dom, merge } = freshApp();
  try {
    const r = merge('<div>a</div><div>b</div>', '<div>a</div><div>b</div>', '<div>a</div><div>b</div>');
    assert.equal(typeof r, 'object');
    assert.ok('ok' in r, '应返回 { ok, ... }');
  } finally { dom.window.close(); }
});

// ── a. 两端改不同中间块（改动散布、彼此隔离的单块 run）→ 自动并集，零冲突 ──
test('V734-M-a：两端改不同中间块（散布单块run）→ 自动并集、零冲突、不错位', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div><div>c</div><div>d</div><div>e</div>';
    const mine = '<div>a</div><div>b+MY</div><div>c</div><div>d+MY</div><div>e</div>';   // mine 改 b、d（隔离）
    const theirs = '<div>a</div><div>b</div><div>c+TH</div><div>d</div><div>e+TH</div>'; // theirs 改 c、e（隔离）
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true, '两端各改不同且隔离的块应自动合并');
    assert.equal(r.conflicts.length, 0, '不同块不得误判冲突');
    const joined = r.blocks.join('');
    assert.ok(joined.includes('b+MY'), '本机对 b 的编辑应保留');
    assert.ok(joined.includes('d+MY'), '本机对 d 的编辑应保留');
    assert.ok(joined.includes('c+TH'), '远端对 c 的编辑应采纳');
    assert.ok(joined.includes('e+TH'), '远端对 e 的编辑应采纳');
    assert.ok(joined.includes('<div>a</div>'), '锚点 a 保留');
    // 顺序校验：各块不错位（a, b+MY, c+TH, d+MY, e+TH）
    const idx = (s) => joined.indexOf(s);
    const order = ['<div>a</div>', '<div>b+MY</div>', '<div>c+TH</div>', '<div>d+MY</div>', '<div>e+TH</div>'];
    for (let k = 1; k < order.length; k++) {
      assert.ok(idx(order[k - 1]) < idx(order[k]), '块应保持 ancestor 相对顺序，不得错位');
      assert.ok(idx(order[k]) > -1, '块存在于结果中');
    }
  } finally { dom.window.close(); }
});

// ── b. 文首改：mine 改第一块、theirs 改第二块 ──
test('V734-M-b：文首改（mine改第1块、theirs改第2块）→ 边界正确定位', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>l1</div><div>l2</div><div>l3</div>';
    const mine = '<div>l1+MY</div><div>l2</div><div>l3</div>';
    const theirs = '<div>l1</div><div>l2+TH</div><div>l3</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0);
    const joined = r.blocks.join('');
    assert.ok(joined.startsWith('<div>l1+MY</div>'), '本机对文首块的修改应位于开头');
    assert.ok(joined.includes('<div>l2+TH</div>'), '远端的文首第二块修改应采纳，且不被顶掉');
    assert.ok(joined.endsWith('<div>l3</div>'), '文尾未动块应原样收尾');
  } finally { dom.window.close(); }
});

// ── c. 文末改：mine 改最后一块、theirs 改倒数第二块 → 边界归位 ──
test('V734-M-c：文末改（mine改最后、theirs改倒数第二）→ 边界正确归位不吞', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>l1</div><div>l2</div><div>l3</div>';
    const mine = '<div>l1</div><div>l2</div><div>l3+MY</div>';
    const theirs = '<div>l1</div><div>l2+TH</div><div>l3</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0);
    const joined = r.blocks.join('');
    assert.ok(joined.endsWith('<div>l3+MY</div>'), '本机对最后一块的修改应落位到文末，不吞');
    assert.ok(joined.includes('<div>l2+TH</div>'), '远端对倒数第二块的修改应采纳');
    assert.equal(joined, '<div>l1</div><div>l2+TH</div><div>l3+MY</div>', '整串应精确等于既不改序也不漏块的结果');
  } finally { dom.window.close(); }
});

// ── d. 本机删除中段一块 + 远端删另一块 → 两个删除都保留，块数收敛 ──
test('V734-M-d：本机删b + 远端删c → 并集=两者都删，[a,d]，零冲突', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div><div>c</div><div>d</div>';
    const mine = '<div>a</div><div>c</div><div>d</div>';        // 本机删 b
    const theirs = '<div>a</div><div>b</div><div>d</div>';      // 远端删 c
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0, '删除不同块不构成冲突');
    const joined = r.blocks.join('');
    assert.equal(joined, '<div>a</div><div>d</div>', '本机删除 b 与远端删除 c 应同时成立，内容不复活');
  } finally { dom.window.close(); }
});

// ── e. 本机插入一块 + 远端改一块（同一 base gap 内插入与修改共存）──
// 契约：任一步"无法逐位归位"必须回落 ok:false（弹条），绝不静默丢本机插入。
// 若实现返回 ok:true 却丢掉本机插入块 NEW → 吞掉本机输入，判败。
test('V734-M-e：同gap 本机插入NEW + 远端改b → 不得吞掉本机插入（应回落ok:false）', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div>';
    const mine = '<div>a</div><div>NEW</div><div>b</div>';   // 本机在 a 与 b 之间插入 NEW
    const theirs = '<div>a</div><div>b+TH</div>';           // 远端改 b → b+TH
    const r = merge(anc, mine, theirs);
    const joined = r.blocks.length ? r.blocks.join('') : '';
    // 安全底线：绝不能静默吞掉本机插入。要么回落冲突(ok:false)，要么产物同时含 NEW 与 b+TH 且都不丢。
    const safe = r.ok === false || (joined.includes('<div>NEW</div>') && joined.includes('<div>b+TH</div>'));
    assert.ok(safe,
      '契约红线：同 gap 插入与编辑共存时不得静默丢本机输入。实际 {ok:' + r.ok + ', conflicts:' +
      JSON.stringify(r.conflicts) + ', joined:' + joined + '}');
    assert.ok(!(r.ok === true && r.conflicts.length === 0 && !joined.includes('<div>NEW</div>')),
      '缺陷确认：实现了 ok:true 却悄悄丢弃本机插入 NEW（吞掉本机输入）——本用例应判失败');
  } finally { dom.window.close(); }
});

// ── f. 两端在同一块末尾追加不同文本 → 真同行冲突，必须 ok:false 回落 (弹条) ──
test('V734-M-f：同一块两端追尾不同文本 → 必须回落 ok:false，绝不全自动静默合并', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>line</div>';
    const mine = '<div>line+MY</div>';
    const theirs = '<div>line+TH</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, false, '同一块两端改得不同=真同行冲突，应回落弹条(ok:false)');
  } finally { dom.window.close(); }
});

// ── g. 两端把同一块改成完全一样 → 无冲突、采纳其一 ──
test('V734-M-g：两端把同一块改成一样 → 无冲突，采纳一次', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div>';
    const mine = '<div>a</div><div>SAME</div>';
    const theirs = '<div>a</div><div>SAME</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0);
    const joined = r.blocks.join('');
    assert.ok(joined.includes('<div>SAME</div>'));
    assert.equal((joined.match(/<div>SAME<\/div>/g) || []).length, 1, '一致块应只出现一次，不重复');
  } finally { dom.window.close(); }
});

// ── h. 装饰等价块（a[data-url]>、u.rem-mark、无样式 span）应视为等价，不误判冲突 ──
test('V734-M-h：装饰等价（a[data-url]>、u.rem-mark、裸span）不误判成冲突', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div><span>s</span></div><div>done<u class="rem-mark">R</u></div><div>link <a data-url="1" href="U1">T</a></div>';
    // mine 把裸 span 去掉、把自动链接 href 改掉（字节不同但装饰等价）
    const mine = '<div>s</div><div>done<u class="rem-mark">R</u></div><div>link <a data-url="1" href="U2">T</a></div>';
    const theirs = '<div><span>s</span></div><div>done<u class="rem-mark">R</u></div><div>link <a data-url="1" href="U1">T</a></div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true, '装饰差异不应导致回落');
    assert.equal(r.conflicts.length, 0, '装饰等价块不得误判成同行冲突');
    const joined = r.blocks.join('');
    assert.ok(joined.includes('s') && joined.includes('done') && joined.includes('T'), '三个块语义内容完整保留');
  } finally { dom.window.close(); }
});

// ── i. 嵌套块（外层 div 套 div）作为单一顶层块处理，不做错位拆分 ──
test('V734-M-i：嵌套块视为单一顶层块，离散块级并集不错位', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div><div>outer</div><div>inner</div></div><div>line2</div>';
    const mine = '<div><div>outer</div><div>inner</div></div><div>line2+MY</div>';
    const theirs = '<div><div>outerUPD</div><div>inner</div></div><div>line2</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0, '嵌套块与另一个普通块属不同顶层块，改不同块应并集');
    const joined = r.blocks.join('');
    assert.ok(joined.includes('outerUPD'), '远端对嵌套块内层的修改应整体采纳（整块原子化）');
    assert.ok(joined.includes('line2+MY'), '本机对另一块(顶层)的修改应保留');
    assert.equal(joined.indexOf('<div><div>'), 0, '嵌套块应作为单一顶层块整体置于结果开头，不错位拆分');
  } finally { dom.window.close(); }
});

// ── j. 空内容 / 只有一段单块改动 ──
test('V734-M-j1：全空三方基线 → 空ok:true，无内容', () => {
  const { dom, merge } = freshApp();
  try {
    const r = merge('', '', '');
    assert.equal(r.ok, true);
    assert.equal(r.blocks.length, 0);
  } finally { dom.window.close(); }
});

test('V734-M-j2：单块文档，仅本机改该块（远端==ancestor）→ 应自动采纳本机', () => {
  // 契约："本机单块改、远端未动 → 自动合并"。单块文档里 mine 改唯一块、theirs 与 ancestor 完全一致，
  // 该合并应是无歧义采纳 mine。实际实现因 sideRepFor 的"整文档无保留→null"守卫(prevB===-1&&nextB===aLen)
  // 而 bail 成 ok:false → 对单块便签的任何本机编辑都回落弹条（"几乎从不冲突"在单块文档失效）。此处为缺陷复现。
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>only</div>';
    const mine = '<div>only+MY</div>';
    const theirs = '<div>only</div>';
    const r = merge(anc, mine, theirs);
    // 正确语义应自动合并；实际 ok:false（保守回落）——这是"可安全合并却强制弹条"的假回落缺陷。
    assert.equal(r.ok, true, '单块文档 m 改唯一块、t 未动，应自动采纳 mine，而非回落弹条(ok:true)');
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.blocks.join(''), '<div>only+MY</div>', '单块本机改应整块采纳');
  } finally { dom.window.close(); }
});

// ── k. 一侧多块连续改动、另一侧也动 → 无法逐位归位 → 必须回落（弹条），绝不静默错位合并 ──
test('V734-M-k：远端正片多块run + 本机同区另一块改动 → 回落(conflicts非空或!ok)，绝不零冲突静默合并', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div><div>c</div><div>d</div><div>e</div>';
    const mine = '<div>a</div><div>b+MY</div><div>c</div><div>d</div><div>e</div>';   // 本机改 b
    const theirs = '<div>a</div><div>bB</div><div>cB</div><div>dB</div><div>e</div>'; // 远端连改 b,c,d（重叠b）
    const r = merge(anc, mine, theirs);
    // 安全契约：不得零冲突自动合并（真同行冲突在 b 上）。
    assert.notEqual(r.ok === true && r.conflicts.length === 0, true,
      '整 run 多块且与另一端重叠属冲突，必须回落(conflicts非空/!ok)大弹条，绝不静默错位合并');
    const mustFallback = r.ok === false || (r.conflicts && r.conflicts.length > 0);
    assert.equal(mustFallback, true, '该场景必须表态"回落弹条"(!ok 或 conflicts非空)');
    // 附带发现（契约不一致，但当前调用方 autoMergeSave 会因 conflicts 非空而正确回落）：
    // 实际返回 ok:true + conflicts:[{anc:[b],mine:null,theirs:null}] 且 blocks 被截断成 [a,e]（丢 b/c/d）。
  } finally { dom.window.close(); }
});

// ── l. 每个结果块要么完整元素、要么被 reblock 包成 <div>（根下全为块级，无裸文本挂根） ──
test('V734-M-l：产出块根下全为块级（裸文本必被<div>包裹，不出现在根上）', () => {
  const { dom, merge } = freshApp();
  try {
    // ancestor 含一个裸文本顶层节点
    const anc = '<div>A</div>raw text<div>C</div>';
    const mine = '<div>A</div><div>NEW</div>raw text<div>C</div>'; // 本机插入一块 + 保留裸文本
    const theirs = '<div>A</div>raw text<div>C</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0);
    assert.ok(r.blocks.length > 0);
    for (const b of r.blocks) {
      assert.equal(typeof b, 'string');
      assert.ok(b.trim().startsWith('<'), '每个产出块都必须是完整元素或被 reblock 包裹，不能裸文本挂根，实际:"' + b + '"');
    }
    const joined = r.blocks.join('');
    assert.ok(joined.includes('<div>NEW</div>'), '本机插入的NEW应保留');
    assert.ok(joined.includes('<div>raw text</div>'), '裸文本应被 <div> 包裹后放在根节点下');
  } finally { dom.window.close(); }
});

// ── 额外：本机编辑一块，远端删除同一块 → 真同行冲突（编辑 vs 删除重叠）→ 回落弹条 ──
test('V734-M-n：本机编辑b + 远端删除同一块b → 重叠冲突 → 回落(=!ok 或 conflicts非空)，绝不静默吞本机编辑', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div><div>c</div>';
    const mine = '<div>a</div><div>bMY</div><div>c</div>';   // 本机把 b 改成 bMY
    const theirs = '<div>a</div><div>c</div>';              // 远端把 b 删了
    const r = merge(anc, mine, theirs);
    const mustFallback = r.ok === false || (r.conflicts && r.conflicts.length > 0);
    assert.equal(mustFallback, true,
      '编辑与删除落在同一块属真冲突，必须回落弹条，绝不零冲突静默吞本机编辑或复活远端删除');
    assert.notEqual(r.ok === true && r.conflicts.length === 0, true, '不得零冲突自动合并');
  } finally { dom.window.close(); }
});

// ── 探针存在性：顶层函数声明与探针导出在源码中存在 ──
test('V734-M-B1：源码含 blockize/lcsPairs/threeWayMergeBlocks/__threeWayMerge 探针', () => {
  assert.ok(/^function blockize/m.test(SRC), 'blockize 应为顶层 function 声明');
  assert.ok(/^function lcsPairs/m.test(SRC), 'lcsPairs 应为顶层 function 声明');
  assert.ok(/^function threeWayMergeBlocks/m.test(SRC), 'threeWayMergeBlocks 应为顶层 function');
  assert.ok(/window\.__threeWayMerge/.test(SRC), '应有 __threeWayMerge 探针导出');
});