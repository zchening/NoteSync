// v6.2 验收测试（2026-09-07）：口令弹窗 X 融入标题行（36px 热区）/ 菜单主视图滚动 /
// menuClose 退役 / 菜单盒瘦身 / .box button 排除关闭钮（优先级根因修复）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const readSrc = () => require('fs').readFileSync(INDEX_PATH, 'utf8');
const readRel = rel => require('fs').readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// ── 1. 口令弹窗 X 融入标题行（方案 A + 用户拍板 36 热区）──
test('V62-1 modal-head 结构：maskClose 在弹窗头部、标题前置于 X', () => {
  const src = readSrc();
  assert.ok(src.includes('<div class="modal-head">'), '应有 .modal-head 头部');
  assert.ok(/id="mask"[\s\S]{0,300}modal-head[\s\S]{0,200}id="maskClose"/.test(src), 'maskClose 应在 mask 内的 modal-head 中');
  assert.ok(/modal-head[\s\S]{0,120}<h1>输入口令<\/h1>[\s\S]{0,200}id="maskClose"/.test(src), '标题应在 X 之前（标题左、X 右）');
  assert.ok(!src.includes('style="position:relative"'), '口令弹窗 .box 不再需要 relative（无绝对定位子元素）');
});

test('V62-2 X 样式：36px 流内按钮 + 20px 图标 + 绝对定位退役', () => {
  const src = readSrc();
  assert.ok(src.includes('.box-x{width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:none;border:none;color:var(--muted);cursor:pointer;border-radius:10px;padding:0;flex:none;'), 'X 应为 36px 流内按钮');
  assert.ok(src.includes('.box-x svg{width:20px;height:20px}'), 'X 图标应 20px');
  assert.ok(!src.includes('.box-x{position:absolute'), '绝对定位悬浮式应退役');
  assert.ok(src.includes('.box-x:hover{color:var(--fg);background:var(--hover)}'), 'hover 反馈应保留');
});

// ── 3. 优先级根因修复（X 曾被 .box button 渲染成通栏实底条）──
test('V62-3 .box button 与两处主题注入均排除 .box-x', () => {
  const src = readSrc();
  assert.ok(src.includes('.box button:not(.box-x){width:100%;height:46px'), '通栏按钮规则应排除 .box-x');
  assert.ok(src.includes('.box button:not(:disabled):not(.box-x){background:${p.fg}!important'), '主题注入 builder 应排除 .box-x');
  assert.ok((src.match(/\.box button:not\(:disabled\):not\(\.box-x\)\{background:#E3E3E5/g) || []).length === 1, '夜间硬编码注入应排除 .box-x（恰一处）');
});

// ── 4. menuClose 退役 ──
test('V62-4 menuClose 退役：按钮/wiring 全移除，遮罩点击关闭保留', () => {
  const src = readSrc();
  assert.ok(!src.includes('id="menuClose"'), 'menuClose 按钮应移除');
  assert.ok(!src.includes("$('#menuClose')"), 'menuClose wiring 应移除');
  assert.ok(src.includes("menuMask.addEventListener('click', e => { if (e.target === menuMask) menuMask.classList.add('hidden'); });"), '遮罩点击关闭应保留');
});

// ── 5. 菜单主视图滚动 + 收纳盒瘦身（v7.0.1：flex+42px+26px 图标+72vh，用户反馈一屏放下）──
test('V62-5 菜单滚动与瘦身：主视图 72vh 内滚、盒 300px、条目 42px/15px、图标 26px', () => {
  const src = readSrc();
  assert.ok(src.includes('#menuMainView{max-height:min(72vh,560px);overflow-y:auto;-webkit-overflow-scrolling:touch}'), '主视图应限高内滚');
  assert.ok(src.includes('#menuBox{width:min(86vw,300px);text-align:left;padding:14px 16px}'), 'menuBox 应 300px/14px 16px');
  assert.ok(/\.menu-item\{[^}]*min-height:42px/.test(src) && /\.menu-item\{[^}]*font-size:15px/.test(src), '条目 42px/15px');
  assert.ok(/\.menu-item\{[^}]*margin-bottom:5px/.test(src), '条目间距 margin-bottom:5px');
  assert.ok(src.includes('.menu-item svg{width:26px;height:26px;flex:none}'), '图标 26px（flex 布局）');
  assert.ok(src.includes('#menuHistList,#menuFavList{max-height:min(50vh,400px);overflow-y:auto;-webkit-overflow-scrolling:touch}'), '历史/收藏 50vh');
});

// ── 6. 版本升格 ──
test('V62-6 版本升格 6.2/62 + README 条目 ≤40 汉字（v7.0 起断言跟随最新版）', () => {
  const src = readSrc();
  assert.ok(src.includes("const APP_VERSION = '7.3.1';"), 'APP_VERSION 应 7.3.1');
  const gradle = readRel('android/app/build.gradle');
  assert.ok(gradle.includes('versionCode 731') && gradle.includes('versionName "7.3.1"'), 'gradle 应 731/7.3.1');
  const readme = readRel('README.md');
  const row = (readme.match(/^\| v7\.0\.0 \|[^|]+\|([^|]+)\|/m) || [])[1] || '';
  const hz = (row.match(/[一-龥]/g) || []).length;
  assert.ok(hz > 0 && hz <= 40, 'README v6.3 摘要应为 1-40 汉字（实测 ' + hz + '）');
  assert.ok(readme.includes('| v6.3 | 2026-09-07 |'), 'README 应有 v6.3 条目');
});
