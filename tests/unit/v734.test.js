// v7.3.4 单元测试——块级三方合并（"几乎从不冲突"正解）：
//   409/poll级2 真冲突（本机脏 + 远端真变）自动块级三方合并，两端改不同块并集重发零冲突条；
//   只有同一块两端都改且结果不同（真同行冲突）才回落弹条。
//   三个纯函数：blockize / lcsPairs / threeWayMergeBlocks（经 window.__threeWayMerge 探针测行为）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

function freshApp() {
  const dom = loadApp();
  const w = dom.window;
  const merge = (anc, mine, theirs) => w.__threeWayMerge(anc, mine, theirs);
  return { dom, w, merge };
}

test('V734-S1：两端改不同块 → 自动并集合并，零冲突', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>line1</div><div>line2</div><div>line3</div>';
    const mine = '<div>line1</div><div>line2+MY</div><div>line3</div>';
    const theirs = '<div>line1</div><div>line2</div><div>line3+TH</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0, '不同块的编辑不得判为同行冲突');
    const joined = r.blocks.join('');
    assert.ok(joined.includes('line2+MY'), '应保留本机对 line2 的编辑');
    assert.ok(joined.includes('line3+TH'), '应采纳远端对 line3 的编辑');
    assert.ok(joined.includes('<div>line1</div>'), '未动块应原样保留');
  } finally { dom.window.close(); }
});

test('V734-S2：同一块两端改得不一样 → 判接通行冲突（回调弹条）', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>line1</div><div>line2</div><div>line3</div>';
    const mine = '<div>line1</div><div>line2+MY</div><div>line3</div>';
    const theirs = '<div>line1</div><div>line2+TH</div><div>line3</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.ok(r.conflicts.length === 1, '同块两端都改且不同必须报 1 个冲突');
  } finally { dom.window.close(); }
});

test('V734-S3：仅本机插入新块（他端未动）→ 保留本机插入', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div>';
    const mine = '<div>a</div><div>NEW</div><div>b</div>';
    const theirs = '<div>a</div><div>b</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0);
    assert.ok(r.blocks.join('').includes('<div>NEW</div>'), '插入块应保留');
  } finally { dom.window.close(); }
});

test('V734-S4：两端把同一块改成一样 → 无害采纳不报冲突', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div>';
    const mine = '<div>a</div><div>SAME</div>';
    const theirs = '<div>a</div><div>SAME</div>';
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0, '改成一样不得误报冲突');
    assert.ok(r.blocks.join('').includes('<div>SAME</div>'));
  } finally { dom.window.close(); }
});

test('V734-S5：本机删除某块 + 他端改其余块 → 并集保留删除且采纳他端', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>x</div><div>y</div><div>z</div>';
    const mine = '<div>x</div><div>z</div>';                       // 本机删 y
    const theirs = '<div>x</div><div>y</div><div>z+EDITED</div>';  // 他端改 z
    const r = merge(anc, mine, theirs);
    assert.equal(r.ok, true);
    assert.equal(r.conflicts.length, 0);
    const joined = r.blocks.join('');
    assert.ok(!joined.includes('<div>y</div>') || !joined.match(/<div>y<\/div>/), '本机删除不应复活');
    assert.ok(joined.includes('z+EDITED'), '他端对 z 的编辑应采纳');
  } finally { dom.window.close(); }
});

test('V734-S6：完全无公共锚点（整篇两端都大改）→ ok=false 回落弹条', () => {
  const { dom, merge } = freshApp();
  try {
    const anc = '<div>a</div><div>b</div>';
    const mine = '<div>AA</div><div>BB</div>';
    const theirs = '<div>OO</div><div>PP</div>';
    const r = merge(anc, mine, theirs);
    // 无任何两端都原样保留的块 = 覆盖性大改 → 绝不自动合并
    assert.equal(r.ok, false);
  } finally { dom.window.close(); }
});

test('V734-B1：handleWriteConflict 真冲突分支先尝试 autoMergeSave', () => {
  assert.ok(/if \(await autoMergeSave\(note, remoteHtml\)\)/.test(SRC), 'handleWriteConflict 真冲突应尝试三方合并');
  assert.ok(/window\.__wconAutoMerge/.test(SRC), 'handleWriteConflict 合并成功应有诊断探针');
});

test('V734-B2：poll 级2 脏路径先尝试 autoMergeSave（打字活跃期内静默推迟）', () => {
  const idx = SRC.indexOf('const unsaved = !isDecorativelyEqual(editor.innerHTML, lastHtml);');
  assert.ok(idx > -1, '应存在 poll 级2 脏路径');
  const seg = SRC.slice(idx, idx + 700);
  assert.ok(/if \(await autoMergeSave\(note, html\)\)/.test(seg), 'poll 脏路径应尝试三方合并');
  assert.ok(/window\.__pollLevel2Merge/.test(seg), 'poll 合并成功应有诊断探针');
  assert.ok(/document\.activeElement === editor && Date\.now\(\) - lastTypeAt < 1500/.test(seg), '打字活跃期应静默推迟');
});

test('V734-B3：autoMergeSave 落库路径齐全（force baseV=note.v / 草稿 / 缓存 / 失败即退）', () => {
  const idx = SRC.indexOf('async function autoMergeSave');
  assert.ok(idx > -1, '应存在 autoMergeSave');
  const seg = SRC.slice(idx, idx + 1300);
  assert.ok(/baseV: note\.v \|\| localVer/.test(seg), 'autoMergeBase 应以远端权威 v 为 baseV 重发');
  assert.ok(/writeDraft\(enc\.ct, enc\.iv\)/.test(seg), '合并结果应先落草稿');
  assert.ok(/if \(!mergedHtml \|\| !mergedHtml\.trim\(\)\) return false/.test(seg), '合并结果空一律不落地（防误清空）');
  assert.ok(/if \(isComposing\) return false/.test(seg), '组字中严禁自动合并');
  assert.ok(/lastRestoreAt <= RESTORE_GUARD_MS/.test(seg), '恢复保护窗内严禁自动合并');
});