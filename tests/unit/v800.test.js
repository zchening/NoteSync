// v8.0.0 图标体系「描边 × 一点金」静态守护（规范页审批后落码的防回潮闸）
// D1 金件钩子与三板锁色；D2 退役旧形清零；D3 Unicode 字形收编；
// D4 品牌几何一字未动（形制保留硬约束）；D5 www 壳逐字节同步。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const FAV = fs.readFileSync(path.join(path.dirname(INDEX_PATH), 'favicon.svg'), 'utf8');

test('D1 一点金钩子齐备：基础板走变量，双对抗板同步锁色', () => {
  assert.ok(SRC.includes('svg .g{stroke:var(--accent)}'), '基础板 .g 金描边');
  assert.ok(SRC.includes('svg .gf{fill:var(--accent);stroke:none}'), '基础板 .gf 金填充');
  assert.ok(SRC.includes('#landing .trust svg{width:17px;height:17px;color:var(--muted);display:block}'), '信任结构降 muted，金件靠 .g/.gf');
  assert.ok(SRC.includes('svg .g,#landing .trust svg .g{stroke:${accent}!important}'), 'mountThemeOverride 板金件锁');
  assert.ok(SRC.includes('svg .gf,#landing .trust svg .gf{fill:${accent}!important'), 'mountThemeOverride .gf 锁');
  assert.ok(SRC.includes("'svg .g,#landing .trust svg .g{stroke:#708ED9!important}'"), '壳板 .g 蓝补偿（反色后恰落暖金）');
  assert.ok(SRC.includes("'svg .gf,#landing .trust svg .gf{fill:#708ED9!important"), '壳板 .gf 蓝补偿');
  assert.ok(!SRC.includes('d="m4.8 12.6 4.8 4.8 9.6-11"'), '刷新成功✓ path 金件随 v8.0.8 刷新钮改字面 reload 退役（禁回潮）');
  const gCount = (SRC.match(/class="g"/g) || []).length;
  const gfCount = (SRC.match(/class="gf"/g) || []).length;
  assert.ok(gCount >= 20 && gfCount >= 10, '金件覆盖面（实测 g=' + gCount + ' gf=' + gfCount + '）');
});

test('D2 退役旧形在 index 清零（禁止回潮）', () => {
  for (const dead of [
    '<path d="M4 8V4h4"/><path d="M16 4h4v4"/>',        // 旧扫一扫/换机码直角取景
    '<path d="M21 15v4a2 2 0 0 1-2 2H5',                // 旧上传/下载托盘
    '<path d="M16 4H9a3 3 0 0 0-2.83 4"/>',             // 旧删除线
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"/>',           // 旧刷新
    '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2"', // 旧太阳
    'M20.3 7.2A9.6',                                     // 旧无需账号套A
    'STAR_OUT_SVG.replace',                              // 旧点亮态（现为整面金）
  ]) assert.ok(!SRC.includes(dead), '旧形必须清零: ' + dead.slice(0, 24));
});

test('D3 Unicode 字形收编：☰ 与 × 改绘 SVG，尺寸挂点入 CSS', () => {
  assert.ok(!SRC.includes('title="菜单">☰<'), '页脚 ☰ 退役');
  assert.ok(SRC.includes('#menuBtn svg{width:19px;height:19px;display:block}'), 'menuBtn svg 档位');
  assert.ok(!SRC.includes('title="不再提示">×</button>'), '安装条 × 字形退役');
  assert.ok(SRC.includes('#installDismiss svg{width:13px;height:13px;display:block}'), 'installDismiss svg 档位');
});

test('D4 品牌环N几何一字未动（形制保留硬约束 + favicon 字节未改）', () => {
  const arcs = 'M40.5 14.5A19 19 0 0 1 14.5 40.5';
  const nPath = 'M18.72 16.96h2.2l6.16 11V16.96h2.2v14.08h-2.2l-6.16-11V31.04h-2.2Z';
  assert.strictEqual((SRC.split(arcs).length - 1), 2, 'hero+header 双弧两处原样');
  assert.ok(SRC.includes(nPath), '衬线N原路径');
  assert.ok(FAV.includes(arcs) && FAV.includes(nPath) && FAV.includes('stroke-width="4.6"'), 'favicon 定稿未动（?v 保留正当）');
});

test('D5 www 壳与根 index 逐字节一致（brand W3 同源）', () => {
  const www = fs.readFileSync(path.join(path.dirname(INDEX_PATH), 'www', 'index.html'), 'utf8');
  assert.strictEqual(www, SRC, 'www/index.html 必须逐字节同步');
});
