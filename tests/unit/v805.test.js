// v8.0.5 历史版本二级页重设计守护（v8.0.4 挂账兑现：裸文本/hairline→同族胶囊）
// G1 胶囊行与三段结构；G2 展开/失效/预览形态；G3 眉标与空态；G4 旧形态+v6.1 语义双禁现。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { INDEX_PATH } = require('../helpers');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

test('G1 历史行=同族胶囊+时钟列+mono 时间', () => {
  assert.ok(SRC.includes('.hist-item{display:flex;flex-wrap:wrap;align-items:center;gap:10px;box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px;min-height:42px'), '.hist-item 胶囊化终形');
  assert.ok(SRC.includes('.hist-item .hist-line{flex:1;min-width:0}'), 'line 子规则（v61 主 pin 原样保留）');
  assert.ok(SRC.includes("row.innerHTML = HIST_CLOCK_SVG;"), '时钟列注入（动态重写携同构结构——红线17）');
  assert.ok(SRC.includes('.hist-clock{width:16px;height:16px;flex:none}'), '时钟尺寸档钉');
  assert.ok(SRC.includes('.hist-meta{flex:1;min-width:0;font:400 12.5px/1.5 ui-monospace'), 'mono 时间列');
});
test('G2 展开金框/失效虚线胶囊/预览左金线', () => {
  assert.ok(SRC.includes(".hist-item.hist-open{border-color:color-mix(in srgb, var(--accent) 45%, var(--line))}") && SRC.includes("row.classList.add('hist-open')") && SRC.includes("row.classList.remove('hist-open')"), '行级展开态闭环');
  assert.ok(SRC.includes('.hist-item.hist-bad{opacity:.5;border-style:dashed'), '失效态虚线胶囊');
  assert.ok(SRC.includes('.hist-preview{width:100%;margin-top:2px') && SRC.includes('border-left:2px solid color-mix(in srgb, var(--accent) 55%, transparent)'), '预览内联换行构图');
});
test('G3 眉标「版本 · N 个」与空态时钟构图', () => {
  assert.ok(SRC.includes("kick.textContent = '版本 · ' + list.length + ' 个'"), '历史眉标复用 .list-kicker');
  assert.ok(SRC.includes('#menuHistEmpty{display:flex;flex-direction:column') && SRC.includes('#menuHistEmpty svg{width:22px;height:22px;opacity:.55}'), '空态与收藏同构图');
});
test('G4 旧裸文本形态禁现（v6.1 拍板语义由 v61 原 pin 继续守护）', () => {
  assert.ok(!SRC.includes('.hist-item{padding:8px 4px;border-bottom'), '旧 hairline 裸文本行退役');
  assert.ok(!SRC.includes('.hist-item.hist-bad{opacity:.45}'), '旧压暗式失效态退役');
});
