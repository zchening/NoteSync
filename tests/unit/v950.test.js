// v9.5.0 守护：① /tank 等 canvas 蛋移动端点屏开火整屏「闪蓝」根修（.ns-game 挂 tap-highlight transparent）；
// ② 导出图 A3 极简书纸卡——页头金题线+单行日期+noteId 无框刻印、页脚真品牌标克隆+「来自 NoteSync」+tagline，
//    桌面出图宽封顶 640，零新色字面量，正文存档零写入。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');
function ed(w) { return w.document.getElementById('editor'); }

/* ── ① 闪蓝根修（静态锚定补丁行） ── */
test('v9.5.0 闪蓝根修：.ns-game 一条 tap-highlight transparent 盖全屏游戏层', () => {
  assert.ok(SRC.includes('.ns-game{-webkit-tap-highlight-color:transparent}'),
    '.ns-game 必须挂 -webkit-tap-highlight-color:transparent（可继承，覆盖 canvas/HUD/提示条）');
});

/* ── ② 导出图 A3 静态锚 ── */
test('v9.5.0 导出图：640 封顶 + 页头/页脚件在位，旧裸渲染禁回潮', () => {
  assert.ok(SRC.includes("Math.min(editor.clientWidth, 640)"), '桌面出图宽度封顶 640');
  assert.ok(SRC.includes("matchMedia('(pointer:coarse)')"), '封顶仅桌面——触屏（横屏手机/平板）照旧跟编辑器宽（闸 R3-3g）');
  assert.ok(SRC.includes("document.querySelector('header .brand svg')"), '页脚品牌标＝克隆顶栏真 SVG（同源禁重画）');
  assert.ok(SRC.includes("setProperty('filter', 'none', 'important')"), '借壳态卡内 img/canvas 钉回 filter:none 防多翻一次色（闸 R2-P1）');
  assert.ok(SRC.includes('width: wrap.offsetWidth'), '出图尺寸含边框，右/下 2px 不裁（闸 R2-P2）');
  assert.ok(SRC.includes('max-width:45%;overflow:hidden;text-overflow:ellipsis'), '长 noteId 刻印截断不撑爆页头（闸 R2-P2）');
  assert.ok(SRC.includes("createTextNode('来自 ')"), '水印字标「来自 」+b NoteSync');
  assert.ok(SRC.includes("'记录，自有回响'"), '右下角 tagline 在位');
  assert.ok(SRC.includes("· 星期"), '日期含星期且单行（nowrap 见 white-space:nowrap 组合）');
  assert.ok(!SRC.includes("width:' + editor.clientWidth + 'px;padding:' + cs.padding"), '旧「裸正文铺编辑器宽」渲染禁回潮');
});

test('v9.5.0 导出图：renderNotePng 函数体零色值字面量（只吃 var() 令牌）', () => {
  const i = SRC.indexOf('async function renderNotePng');
  assert.ok(i > 0, 'renderNotePng 在位');
  const body = SRC.slice(i, SRC.indexOf('if (window.PointerEvent)', i));
  const hex = body.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepStrictEqual(hex, [], '导出排版禁新色字面量：' + hex.join(','));
  assert.ok(!/rgba?\(/.test(body), '同样禁裸 rgb()/rgba()，颜色只走 var(--…)');
});

/* ── ③ 行为：真调 renderNotePng（stub html2canvas 捕获渲染树） ── */
function stubCapture(w, bag) {
  w.html2canvas = (node, opts) => {
    bag.node = node; bag.opts = opts;
    return Promise.resolve({ toBlob: cb => cb(new w.Blob(['fake'], { type: 'image/png' })) });
  };
}
const settle = w => new Promise(r => w.setTimeout(r, 120));

test('v9.5.0 导出图行为：结构齐、链接转纯文本、渲染后离屏卡自拆、正文零写入', async t => {
  const bag = {};
  const dom = loadApp(w => stubCapture(w, bag));
  t.after(() => dom.window.close());
  const w = dom.window;
  ed(w).innerHTML = '<div>看图 https://example.com/verylongpath/page?x=1&amp;y=2 结束</div><div><img src="/a.png"></div>';
  const before = ed(w).innerHTML;
  const blob = await w.renderNotePng();
  assert.ok(blob, '返回 Blob');
  assert.strictEqual(bag.opts.scale, 2, 'scale 2 高清随旧链路');
  assert.strictEqual(bag.opts.backgroundColor, null, '圆角外透明，衬卡自带底色');
  const txt = bag.node.textContent;
  assert.ok(txt.includes('看图'), '正文进图');
  assert.ok(txt.includes('example') && txt.includes('verylongpath'), '长 URL 进图（防溢出预处理会在 :/.?=& 后补空格断行，不能整串比对）');
  assert.ok(!bag.node.querySelector('a'), '链接转纯文本（旧预处理保留）');
  assert.ok(bag.node.querySelector('img').style.maxWidth === '100%', '图片限宽防溢出');
  assert.ok(txt.includes('来自 NoteSync') || (txt.includes('来自') && txt.includes('NoteSync')), '底部水印在图内');
  assert.ok(txt.includes('记录，自有回响'), 'tagline 在图内');
  assert.ok(/星期[日一二三四五六]/.test(txt), '日期星期在页头');
  assert.ok(!w.document.body.contains(bag.node), '渲染完离屏卡自拆，不留残骸');
  assert.strictEqual(ed(w).innerHTML, before, '正文存档零写入');
  await settle(w);
});

test('v9.5.0 导出图行为：landing（noteId 空）不挂刻印；笔记路由刻印＝真 noteId', async t => {
  const bag = {};
  const dom = loadApp(w => stubCapture(w, bag));
  t.after(() => dom.window.close());
  await dom.window.renderNotePng();
  assert.ok(!/zchening/.test(bag.node.textContent), 'landing 无刻印残留');

  const bag2 = {};
  const dom2 = loadApp(w => stubCapture(w, bag2), 'http://localhost/zchening');
  t.after(() => dom2.window.close());
  await dom2.window.renderNotePng();
  assert.ok(bag2.node.textContent.includes('zchening'), '页头右角刻印＝当前笔记真 noteId');
});
