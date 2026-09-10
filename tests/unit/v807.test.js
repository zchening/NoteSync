// v8.0.7 两处用户拍板改动守护——① 二级页返回钮左起笔（收藏+历史）与列表图标列同竖线；
// ② 手动刷新=浏览器刷新体感：页脚=唯一结果反馈通道（按下即「同步中…」，结果由 poll 原生落位），
//    结果 toast 与「晚到翻牌」状态机退役，2.5s 封顶仅在页脚仍无人落位时代报「刷新失败」。
// H1 对齐覆盖规则与主菜单居中并存（禁外溢）；H2 刷新页角落位/代报/✓ 判据锚定补丁行；
// H3 旧结果 toast/翻牌状态机禁现；H4 前置轻提示（红线15 守卫）保留。行为层由 v781 Y3/Y4 与 menu_align M5 覆盖。
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

test('H2 刷新：按下页脚「同步中…」，✓ 仅成功，封顶代报有前提守卫', () => {
  assert.ok(SRC.includes("setStatus(false, '同步中…'); // v8.0.7 主修"), '按下即页脚「同步中…」（不再谎报绿点已同步）');
  assert.ok(SRC.includes("if (statusText.textContent === '已同步') { // ✓ 只给成功"), '✓ 仅页脚「已同步」才亮——冲突/失败/被锁回灰');
  assert.ok(SRC.includes("if (forcedFail && statusText.textContent === '同步中…') setStatus(false, '刷新失败');"), '封顶代报只时代报——poll 已落位（成功/失败/锁定）绝不抢写');
  assert.ok(/rfbCapTimer = setTimeout\([\s\S]*?\}, 2500\);/.test(SRC), '2.5s 封顶保留：断网 fetchRetry 退避期不死转圈');
  assert.ok(SRC.includes('clearTimeout(rfbCapTimer); if (rfbCapTimer !== null)'), '收尾后封顶一次性作废：不得二次代报/二次补 ✓');
});

test('H3 结果 toast 与晚到翻牌状态机全退役（与页脚重复=用户报障点）', () => {
  assert.ok(!SRC.includes('rfbToastTimer'), '刷新结果 toast 计时器退役');
  assert.ok(!SRC.includes('rfbState'), 'pending→settled→timeout→late 翻牌状态机退役（2s 常驻轮询接管晚到纠正）');
  assert.ok(!SRC.includes("'已是最新'"), '「已是最新」胶囊短句退役');
  assert.ok(!SRC.includes("'已同步更新'"), '「已同步更新」胶囊短句退役');
  assert.ok(!SRC.includes("rfbFinish('刷新失败')"), '旧强制失败翻牌入口退役（代报判定已收进 rfbSettle）');
});

test('H4 前置轻提示保留：未解锁/保存中仍是 toast（非刷新结果，页脚另有其文案）', () => {
  assert.ok(SRC.includes("showUploadStatus('请先解锁'); setTimeout(() => { if (uploadStatus.textContent === '请先解锁') hideUploadStatus(); }, 2000); return;"), '未解锁轻提示带红线15守卫');
  assert.ok(SRC.includes("showUploadStatus('正在保存中，稍候自动同步');"), '忙窗口轻提示保留');
});
