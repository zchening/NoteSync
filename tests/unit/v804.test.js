// v8.0.4 收藏夹二级页重设计守护（用户报「裸文本左对齐列表感觉 low」=与主菜单胶囊行族脱节）
// F1 行族与结构；F2 金点三板联动；F3 旧裸文本形态禁现；F4 删除入口拍板不回潮（v5.55）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { INDEX_PATH } = require('../helpers');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

test('F1 收藏行=主菜单同族胶囊+金星列+mono名+右箭头+眉标', () => {
  assert.ok(SRC.includes('.fav-row{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px;min-height:42px'), '.fav-row 胶囊化终形在位');
  assert.ok(SRC.includes("const FAV_STAR_SVG") && SRC.includes("const FAV_CHEV_SVG"), '金星/箭头常量在位');
  assert.ok(SRC.includes("row.innerHTML = FAV_STAR_SVG;") && SRC.includes("label.className = 'fav-name'") && SRC.includes("insertAdjacentHTML('beforeend', FAV_CHEV_SVG)"), '注入行三段结构（动态重写携带被守护结构——红线17 v8.0.3 教训不回潮）');
  assert.ok(SRC.includes(".fav-name{flex:1;min-width:0;font:400 13.5px/1.5 ui-monospace"), 'mono 笔记名列');
  assert.ok(SRC.includes('.fav-star{width:18px;height:18px;flex:none}') && SRC.includes('.fav-go{width:14px;height:14px;flex:none;color:var(--muted)}'), '金星星列/右箭头尺寸档钉（删行=回潮 300x150 裸形，堵守护盲区）');
  assert.ok(SRC.includes(".list-kicker{") && SRC.includes("kick.textContent = '收藏 · ' + favs.length + ' 篇'"), '眉标行');
});
test('F2 眉标金点三板锁色联动（基础 var/夜板 ${accent}/壳板蓝补偿）', () => {
  assert.ok(SRC.includes(".list-kicker::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--accent)"), '基础板');
  assert.ok(SRC.includes('.list-kicker::before{background:${accent}!important}'), '夜间覆盖板');
  assert.ok(SRC.includes("'.list-kicker::before{background:#708ED9!important}'"), '国产壳板蓝补偿');
});
test('F3 旧裸文本形态禁现 + F4 删除入口拍板不回潮', () => {
  assert.ok(!SRC.includes('.fav-row{display:flex;justify-content:space-between'), '旧 hairline 裸文本行退役');
  assert.ok(!SRC.includes('fav-del') && !SRC.includes('menuFavHead'), '✕ 删除按钮与旧标题不回潮（v5.55 拍板：唯一删除入口=笔记内取消收藏）');
  assert.ok(SRC.includes('#menuFavEmpty svg{width:22px;height:22px;opacity:.55}') && SRC.includes('<span>暂无收藏</span>'), '空态星形构图在位');
});
