// v10.0.2 守护：导出图三件套 + 提速三层——
// A 随机句池：EXPORT_TAGLINES 17 槽位=16 句（品牌原句 ×2 权重），tail 从池随机；旧固定串赋值禁回潮。
// B tail C+D 合体：右对齐折两行（line-clamp:2）+ 两行仍放不下才 ellipsis；旧 nowrap 单行形态禁回潮。
// C 折叠恒定展开：导出副本挂 .ns-export + [data-ns-export] 属性门控作用域样式（head 挂载、用完即拆），
//   ▼ 12px + 7px 间隙（px——em 在 font-size:0 上归零）；编辑器 #editor 折叠 CSS 一字不动、导出零渗透。
// D 提速：①空闲预取同源组件 ②双 rAF 落定+图片 decode 预解码 ③SVG 快渲仅 Chromium 触屏、失败恒回退老链路。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const MCP = fs.readFileSync(path.join(ROOT, 'tools/notesync-mcp-server.js'), 'utf8');
function ed(w) { return w.document.getElementById('editor'); }

test('V1002-A 随机句池：16 句全留、原句 ×2、旧固定串赋值禁回潮', () => {
  const i = SRC.indexOf('const EXPORT_TAGLINES = [');
  assert.ok(i > 0, '句池常量在位');
  const seg = SRC.slice(i, SRC.indexOf('];', i) + 2);
  const pool = seg.match(/'[^']+'/g) || [];
  assert.strictEqual(pool.length, 17, '17 槽位 = 16 句 + 原句补一份（×2 权重）');
  assert.strictEqual(pool.filter(x => x === "'记录，自有回响'").length, 2, '品牌原句恰两份');
  assert.strictEqual(new Set(pool).size, 16, '去重后恰 16 句');
  for (const s of ['一字一句，皆有归处', '日常琐碎，亦是珍藏', '纸上烟火，人间自留', '微言可存，长夜不孤',
    '心事入册，岁月成篇', '写字的人，不慌张', '落笔，心就安了', '慢慢写，不着急', '落笔，自有归处',
    '写下，即成过往', '一言，可抵千日', '此刻，来日相见', '微末，亦是山河', '独语，自成天地', '凡记，皆不虚行']) {
    assert.ok(pool.includes("'" + s + "'"), '句缺失：' + s);
  }
  assert.ok(SRC.includes('tail.textContent = pickExportTagline();'), 'tail 从池随机取句');
  assert.ok(!SRC.includes("tail.textContent = '记录，自有回响';"), '禁回潮：旧固定串直赋');
});

test('V1002-B tail C+D 合体样式：折行右对齐+两行封顶 ellipsis，旧 nowrap 形态禁回潮', () => {
  assert.ok(SRC.includes('text-align:right;min-width:64px;max-height:3.4em;overflow:hidden;text-overflow:ellipsis'), 'C+D 合体承重件在位');
  assert.ok(SRC.includes('-webkit-line-clamp:2'), '两行封顶');
  assert.ok(SRC.includes('font:10.5px/1.7 var(--mono);color:var(--muted);opacity:.7;letter-spacing:.22em'), '大字距观感保住、行高 1.7 防两行贴线');
  assert.ok(!SRC.includes("letter-spacing:.22em;white-space:nowrap'"), '禁回潮：旧 nowrap 单行硬顶形态');
});

test('V1002-C 折叠恒定展开：作用域样式属性门控+7px 间隙，编辑器零渗透', () => {
  assert.ok(SRC.includes("wrap.classList.add('ns-export');"), '导出副本挂 ns-export');
  assert.ok(SRC.includes("mk.setAttribute('data-ns-export', '1')"), '副本内 fold-mark 打属性标');
  assert.ok(SRC.includes('[data-ns-export]{font-size:0;margin-right:7px;color:var(--muted)}'), '▼ 间隙必须 7px（em 在 font-size:0 上归零）且吃 --muted');
  assert.ok(!SRC.includes('[data-ns-export]{font-size:0;margin-right:.55em}'), '禁回潮：em 间隙写法（实算 0px）');
  assert.ok(SRC.includes('[data-ns-export]::before{content:"\\\\25BC"'), '恒定展开 ▼（用户拍板丙）');
  assert.ok(SRC.includes('.ns-export .ns-fold-hide{display:block}'), '收起态正文出图显形');
  assert.ok(SRC.includes('wrap.insertBefore(foldCss, wrap.firstChild)'), '样式常驻副本子树（SVG 快路随 clone 序列化进 foreignObject，两路同源）');
  assert.ok(SRC.includes('wrap.removeChild(foldCss)'), '用完即拆不堆积');
  // 编辑器本体折叠 CSS 与打印规则一字不动（v10.0.4 契约更新：三角改边框画，本测只验"导出侧改动没渗回编辑器"）
  assert.ok(SRC.includes("#editor .ns-fold-mark::before{content:'';display:inline-block;width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:8px solid currentColor;vertical-align:middle;position:relative;top:-6px}"), '#editor 三角规则在位（v10.1.1 几何画法：8px 长边等大同形盒）');
  assert.ok(SRC.includes("[data-ns-export]::before{content:\"\\\\25BC\";font-size:12px;line-height:1.9;vertical-align:baseline}"), '导出副本三角仍走 ▼ 字形（与编辑器规则两套独立，互不渗透）');
  assert.ok(SRC.includes('#editor .ns-fold-hide{display:none}'), '#editor 隐藏规则原样（F7 锚不翻）');
  assert.ok(!/^\s*\.ns-fold-hide\{/m.test(SRC), '仍无裸 .ns-fold-hide 全局规则（离屏默认全文语义保持）');
});

test('V1002-C2 行为：收起折叠导出后出图带▼样式、编辑器状态与存档零变化', async t => {
  const bag = {};
  const dom = loadApp(w => {
    w.html2canvas = (node, opts) => {
      bag.node = node; bag.opts = opts;
      return Promise.resolve({ toBlob: cb => cb(new w.Blob(['fake'], { type: 'image/png' })) });
    };
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  ed(w).innerHTML = '<div>[折叠]标题</div><div>正文1</div>';
  w.applyFolds();
  assert.ok(ed(w).querySelector('.ns-fold-collapsed'), '前置：编辑器收起态');
  const before = ed(w).innerHTML;
  await w.renderNotePng();
  assert.ok(bag.node.classList.contains('ns-export'), '导出副本挂 ns-export');
  assert.strictEqual(bag.node.querySelectorAll('[data-ns-export]').length, 1, '副本内 mark 被打属性标');
  assert.ok(!ed(w).querySelector('[data-ns-export]'), '编辑器 DOM 零渗透（无 data-ns-export）');
  assert.strictEqual(ed(w).innerHTML, before, '正文与折叠状态存档零写入');
  assert.strictEqual(bag.opts.scale, 2, 'jsdom 非触屏 Chromium → 恒走老链路 scale:2');
});

test('V1002-D 提速三层结构：预取/预解码/快渲门控+回退', () => {
  assert.ok(SRC.includes('function prefetchHtml2CanvasIdle()'), '①空闲预取在位');
  assert.ok(SRC.includes("requestIdleCallback(go, { timeout: 4000 })"), '①rIC 主路 + setTimeout 双保险');
  assert.ok(SRC.includes('im.decode ? im.decode().catch(() => {}) : Promise.resolve()'), '②图片预解码（失败忽略）');
  assert.ok(SRC.includes('requestAnimationFrame(() => requestAnimationFrame(fin));'), '②双 rAF 落定');
  const rnp = SRC.slice(SRC.indexOf('async function renderNotePng'), SRC.indexOf('async function renderNotePngSlow'));
  assert.ok(!rnp.includes('setTimeout(r, 50)'), '禁回潮：renderNotePng 内旧 50ms 定值等待');
  assert.ok(SRC.includes('async function renderNotePngSlow(wrap)'), '③老链路完整保留（回退通道）');
  assert.ok(SRC.includes('return chromium && coarse;'), '③快渲门控=Chromium 触屏（桌面/jsdom 恒老路）');
  const fast = SRC.slice(SRC.indexOf('async function renderNotePngFast'), SRC.indexOf('async function nsInlineFastImg'));
  assert.ok(fast.includes('if (!nsExportFastEligible()) return null;'), '③不合格直接 null 回退');
  assert.ok(fast.includes('if (!ink) return null;'), '③空白图防御回退');
  assert.ok(fast.includes('if (!w || !h || h > 8000) return null;'), '③超长护栏（R2-P1-2：20000→8000，×2 后 16000 设备 px 远离 GPU 极限）');
  assert.ok(fast.includes('canvas.height - 8'), '③底部带二次采样（R2-P1-2：单点左上拦不住半程残图）');
  assert.ok(SRC.includes('max-height overflow transform'), '①白名单含 overflow/transform（R2-P1-1：刻印与 tail 裁切盒两路同源）');
  assert.ok(SRC.includes("!/Edg\\/|EdgA\\/|OPR\\//.test(ua)"), '②Edge 排除正则修正（R2-P2：真 token 是 Edg/）');
  assert.ok(SRC.includes('[data-ns-export]{font-size:0;margin-right:7px;color:var(--muted)}'), '②▼ 吃 --muted 与编辑器同款（R2-P2）');
  assert.ok(SRC.includes('if (wrap.parentNode === document.body) document.body.removeChild(wrap);'), '③主 finally 拆 wrap+parentNode 守卫（快路泄漏根修，防双拆）');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(fast) && !/rgba?\(/.test(fast), '快渲实现零色值字面量（色全从 live computed 解析）');
});

test('V1002-E 三 bump 10.0.2 + 双壳逐字节', () => {
  assert.ok(SRC.includes("const APP_VERSION = '10.1.2';"), 'APP_VERSION 应 10.0.2');
  assert.ok(GRADLE.includes('versionCode 1012') && GRADLE.includes('versionName "10.1.2"'), 'gradle 应 1002/10.0.2');
  assert.ok(MCP.includes("version: '10.1.2'"), 'MCP serverInfo 应 10.0.2');
  const a = fs.readFileSync(path.join(ROOT, 'www/index.html'));
  const b = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'));
  const c = fs.readFileSync(path.join(ROOT, 'index.html'));
  assert.ok(a.equals(c) && b.equals(c), '双壳必须与根 index.html 逐字节一致');
});
