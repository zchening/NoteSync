// v8.0.7 两处用户拍板改动守护——① 二级页返回钮左起笔（收藏+历史）与列表图标列同竖线；
// ② 手动刷新（v8.0.8 终态，用户拍板「不要等同，要一模一样」）：刷新钮 = 字面
//    location.reload()，与 F5 同一实现路径——按钮自演状态机（转圈/✓/800ms 保底/
//    2.5s 封顶/连点令牌/页脚强写）全退役，加载反馈归浏览器标签页，页脚由 boot→poll 原生落位；
//    仅保留未解锁与保存中两个前置守卫（reload 会掐断在途 PUT）。
// H1 对齐覆盖规则与主菜单居中并存（禁外溢）；H2 reload 本体与守卫锚定补丁行；
// H3 自演状态机全令牌禁现；H4 前置轻提示（红线15 守卫）保留。行为层由 v781 Z2-Z4 与 sync T3 覆盖。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { INDEX_PATH } = require('../helpers');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

test('H1 二级页视图级 flex-start 覆盖在位（含新增历史钮），主菜单居中基规则并存', () => {
  assert.ok(SRC.includes('#menuFavView .menu-item,#menuHistView .menu-item{justify-content:flex-start}'), '收藏+历史二级页内全部行左起笔（视图级=闸R1-P1：禁枚 id 漏 #menuHistSave）');
  assert.ok(SRC.includes('id="menuHistSave" class="menu-item"'), '新增历史版本钮须在 #menuHistView 内且挂 menu-item 类（视图级覆盖的命中前提）');
  assert.ok(SRC.includes('.menu-item{display:flex;align-items:center;justify-content:center;gap:12px;'), '主菜单九行整组居中基规则不动（v801 pin 同锚——覆盖只走视图级选择器，禁改基规则）');
  const ov = SRC.indexOf('#menuFavView .menu-item,#menuHistView .menu-item{justify-content:flex-start}');
  const base = SRC.indexOf('.menu-item{display:flex;align-items:center;justify-content:center');
  assert.ok(ov > base, '覆盖规则须与基规则同层级相邻落位（读序在基规则之后）');
});

test('H2 刷新：按下同帧 location.reload()，守卫先行（锚定 v8.0.8 补丁行）', () => {
  assert.ok(SRC.includes("refreshBtnEl.addEventListener('click', () => {"), '点击处理器为同步函数——不再有 poll 竞速/计时器编排');
  assert.ok(/location\.reload\(\);[\s\S]{0,8}?\}\);/.test(SRC), 'reload 是守卫通过后的唯一动作（紧随其后即 handler 收尾，锚定补丁行防恒真）');
  assert.ok(!SRC.includes("setStatus(false, '同步中…')"), 'v8.0.8：按钮绝不强写页脚——状态由 boot→poll 原生落位（推翻 v8.0.7 两段式）');
  assert.ok(!SRC.includes('}, 2500);'), '2.5s 封顶随状态机退役（断网反馈归 boot/poll 原生路径）');
  assert.ok(!SRC.includes('poll().then('), '按钮不再手动拉 poll——重载即整页重建');
});

test('H3 自演状态机全令牌禁现（转圈/✓/保底/封顶/令牌/toast 一揽子）', () => {
  for (const dead of ['rfbToastTimer', 'rfbState', 'rfbStepTimer', 'rfbDoneTimer', 'rfbCapTimer', 'rfbRun', 'rfbSettle', 'rfbFinish', 'spinning', 'ico-check', '@keyframes spin']) {
    assert.ok(!SRC.includes(dead), '退役串禁现：' + dead);
  }
  assert.ok(!SRC.includes("'已是最新'"), '「已是最新」胶囊短句退役');
  assert.ok(!SRC.includes("'已同步更新'"), '「已同步更新」胶囊短句退役');
});

test('H4 前置轻提示保留：未解锁/保存中仍是 toast（非刷新结果，页脚另有其文案）', () => {
  assert.ok(SRC.includes("showUploadStatus('请先解锁'); setTimeout(() => { if (uploadStatus.textContent === '请先解锁') hideUploadStatus(); }, 2000); return;"), '未解锁轻提示带红线15守卫');
  assert.ok(SRC.includes("showUploadStatus('正在保存中，稍候自动同步');"), '忙窗口轻提示保留');
});
