// v8.0.1 菜单列表左列对齐守护（用户报「点左下角菜单出来的列表乱」）
// 根因=历史 text-align:center 血统的 justify-content:center 让「图标+文字」整组居中，
// 九行字数长短不一 → 图标列左右锯齿。修法=flex-start + gap12 起线齐。A1 钉新形制，A2 防 center 回潮。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { INDEX_PATH } = require('../helpers');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

test('A1 菜单行=图标列左对齐：justify-content:flex-start + gap 12', () => {
  assert.ok(SRC.includes('.menu-item{display:flex;align-items:center;justify-content:flex-start;gap:12px;'), '.menu-item 起线齐新形制在位');
  assert.ok(/\.menu-item\{[^}]*min-height:42px/.test(SRC), '42px 行高不变（v7.0.1 纪律仍守）');
});
test('A2 center 整组居中永久退役（防回潮）', () => {
  const m = SRC.match(/\.menu-item\{[^}]*\}/);
  assert.ok(m && !/justify-content:center/.test(m[0]), 'menu-item 不得再出现 justify-content:center');
});
