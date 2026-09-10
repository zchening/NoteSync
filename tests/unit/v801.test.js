// v8.0.1 菜单列表左列对齐守护（用户报「点左下角菜单出来的列表乱」）
// 根因=历史 text-align:center 血统的 justify-content:center 让「图标+文字」整组居中，
// 九行字数长短不一 → 图标列左右锯齿。v8.0.1 flex-start 修齐但贴左失衡，v8.0.2 终形=定宽标签列+整组居中（对齐与均衡兼得）。真几何守门在 e2e menu_align。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { INDEX_PATH } = require('../helpers');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

test('A1 菜单行=定宽标签列+整组居中（v8.0.2 终形）', () => {
  assert.ok(SRC.includes('.menu-item{display:flex;align-items:center;justify-content:center;gap:12px;'), '.menu-item 整组居中终形在位');
  assert.ok(SRC.includes('.menu-item .mi-l,#menuThemeLabel{width:112px;text-align:left}'), '.mi-l 定宽标签列（与 theme 标签单一真源）=图标列仍严格对齐的根基');
  assert.ok(/\.menu-item\{[^}]*min-height:42px/.test(SRC), '42px 行高不变（v7.0.1 纪律仍守）');
});
test('A2 居中必须配定宽标签列（无列居中=回潮到锯齿）', () => {
  assert.strictEqual((SRC.match(/class="mi-l"/g) || []).length, 11, '11 行静态标签必须全包 mi-l（theme 行走 #menuThemeLabel）');
  assert.ok(SRC.includes('#menuThemeIcon{display:flex;align-items:center}'), 'theme 行图标 span flex 化防基线缝');
});
