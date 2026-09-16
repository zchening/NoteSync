// NoteSync v9.2.0 单元测试：图片查看器与保存阶梯 / 刷新开奖卡 / 折叠光标透明 /
// 画布色板根因 / 夜间三令牌 / 首页彩蛋入口 / 正文门牌触发 / 桌宠档案滚动 / 游戏文字。
// 守护纪律（本仓铁律）：①源码字面量钉必须锚到补丁行，裸匹配会命中同形代码成恒真；
// ②行为优先于文本；③每条新功能都配「退回旧形态必红」的反证钉。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');
const KT = path.resolve(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'img', 'ImgSavePlugin.kt');
const MAIN = fs.readFileSync(KT, 'utf8');
const GATE = ['mirror', 'snake', 'dragon', 'brick', 'satoshi', 'bitcoin', 'tank', 'spacex', 'tesla', 'pet'];
const ENUM = '(mirror|snake|dragon|brick|satoshi|bitcoin|tank|spacex|tesla|pet)';

// 从 :root / body.dark 两个块里取某个自定义属性的值（用于「日间逐字节同值」这种硬约束）
function tokVar(block, name) {
  const m = new RegExp('\\' + name + '\\s*:\\s*([^;]+);').exec(block);
  return m ? m[1].trim() : null;
}
function cssBlock(startMark, endStr) {
  const i = SRC.indexOf(startMark);
  assert.ok(i > 0, '找不到 CSS 锚 ' + startMark);
  const j = SRC.indexOf(endStr, i);
  return SRC.slice(i, j);
}

/* ══ V1 画布色板根因：css() 必须读 body，不是 documentElement ══════════ */
test('V1 画布取色函数读 body（夜间色板声明在 body.dark 上，自定义属性不上浮）', () => {
  const i = SRC.indexOf('function css(name)');
  assert.ok(i > 0, 'css() 必须存在');
  const fn = SRC.slice(i, SRC.indexOf('\n}', i) + 2);
  assert.ok(fn.includes('document.body || document.documentElement'), '必须优先从 body 取样式（锚补丁行）');
  assert.ok(!/getComputedStyle\(document\.documentElement\)/.test(fn), '旧形态「只读 documentElement」禁回潮——那正是夜间色板从来没生效的根因');
  assert.ok(fn.includes('getComputedStyle'), '仍须走 getComputedStyle 取计算值');
});
test('V1b 三个画布令牌：日间与基础令牌逐字节同值，夜间才抬档', () => {
  const day = cssBlock(':root{', '  }\n  body.dark{');
  const night = cssBlock('body.dark{', '  }\n  *{box-sizing:border-box}');
  assert.strictEqual(tokVar(day, '--g-line'), tokVar(day, '--line'), '日间 --g-line 必须等于 --line（白天画面零变化）');
  assert.strictEqual(tokVar(day, '--g-fill'), tokVar(day, '--box-bg'), '日间 --g-fill 必须等于 --box-bg');
  assert.strictEqual(tokVar(day, '--g-mute'), tokVar(day, '--muted'), '日间 --g-mute 必须等于 --muted');
  ['--g-line', '--g-fill', '--g-mute'].forEach(n => {
    const d = tokVar(day, n), k = tokVar(night, n);
    assert.ok(d && k, n + ' 两板都必须声明');
    assert.notStrictEqual(d, k, n + ' 夜间必须与日间不同，否则抬档是空的');
  });
});
test('V1c pal() 三条弱档通道走 g 令牌并回落基础令牌，绝不写死兜底色', () => {
  const i = SRC.indexOf('function pal()');
  const fn = SRC.slice(i, SRC.indexOf('\n  return PAL;', i));
  assert.ok(fn.includes("GC('--g-line') || GC('--line')"), '边界细线必须走 --g-line 回落 --line');
  assert.ok(fn.includes("GC('--g-fill') || GC('--box-bg')"), '面板实底必须走 --g-fill 回落 --box-bg');
  assert.ok(fn.includes("GC('--g-mute') || GC('--muted')"), '标签文字必须走 --g-mute 回落 --muted');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(fn), 'pal() 内不得有十六进制兜底色（A8 同族纪律：canvas 只吃主题变量）');
  assert.ok(fn.includes("contains('dark')"), 'PAL 必须带 dark 标志供夜间 alpha 下限用');
});
test('V1d 夜间装饰 alpha 下限护栏存在，且三处双层压暗点已接入', () => {
  assert.ok(/function gA\(a\)/.test(SRC), 'gA() 下限护栏必须存在');
  const n = (SRC.match(/c\.globalAlpha = gA\(/g) || []).length;
  assert.ok(n >= 3, '至少三处装饰 alpha 走 gA()（tank 网格、草丛、tesla 星点），实得 ' + n);
  assert.ok(SRC.includes("c.globalAlpha = gA(.5);"), 'tank 网格线 .5 必须已接入（锚补丁行）');
  assert.ok(SRC.includes("c.globalAlpha = gA(.55);"), 'tank 草丛 .55 必须已接入');
});

/* ══ V2 关于页「N / M FOUND」不换行 ══════════════════════════════════ */
test('V2 彩蛋行解掉 about-v 的 110px 定宽与 break-all，计数串钉死不换行', () => {
  assert.ok(SRC.includes('.ns-egg-entry .about-v{display:flex;align-items:baseline;gap:5px;position:relative;width:auto;word-break:normal;white-space:nowrap;flex:none}'),
    '彩蛋行必须自己解掉定宽与断字（.about-v 基础板不动，防版本号行回归）');
  assert.ok(SRC.includes(".ns-egg-entry .ns-num{font:400 12px/1.5 var(--mono);letter-spacing:.1em;color:var(--fg);font-weight:600;white-space:nowrap}"),
    '计数串必须 white-space:nowrap');
  assert.ok(SRC.includes('.about-v{width:110px;') === false || SRC.includes('.about-v{width:110px;text-align:left;'),
    '.about-v 基础板保持原样（版本号行不受影响）');
});

/* ══ V3 桌宠档案页：方案B 可滚 + 操作区常驻 ══════════════════════════ */
test('V3 桌宠面板拆成可滚内容区 + 常驻底栏，镜像面板不受牵连', () => {
  assert.ok(!SRC.includes('.ns-dom .ns-mirror-panel,.ns-dom .ns-pet-panel{margin:auto'),
    '旧「镜像与桌宠共用 margin:auto + 父级 overflow:hidden」禁回潮——面板比视口高时上下两端一起被裁');
  assert.ok(SRC.includes('.ns-dom .ns-mirror-panel{margin:auto;max-width:420px;padding:22px 20px 30px}'),
    '镜像面板必须原样保留（它本来就短，不该被牵连）');
  assert.ok(/\.ns-pet-scroll\{[^}]*overflow-y:auto/.test(SRC), '内容区必须可滚');
  assert.ok(/\.ns-pet-dock\{[^}]*flex:none/.test(SRC), '操作区必须常驻不滚走');
  assert.ok(SRC.includes('calc(14px + env(safe-area-inset-bottom))'), '底栏必须带安全区留白，否则 iPhone 横条压住按钮');
  assert.ok(SRC.includes('.ns-dom .ns-pet-panel{margin:0 auto;max-width:420px;padding:0;width:100%;flex:1;min-height:0;display:flex;flex-direction:column}'),
    '面板必须撑满、允许子区收缩（缺 min-height:0 则 overflow 不生效）且宽屏居中（margin:0 auto）');
});
test('V3b 档案 DOM 两段齐备，说明文字在可滚区内、三颗按钮在底栏内', () => {
  const i = SRC.indexOf("'<div class=\"ns-pet-panel\">'");
  assert.ok(i > 0, '桌宠面板模板必须在');
  const block = SRC.slice(i, SRC.indexOf("document.body.appendChild(root);", i));
  assert.ok(block.includes('ns-pet-scroll') && block.includes('ns-pet-dock'), '两段容器都要有');
  const scroll = block.slice(block.indexOf('ns-pet-scroll'), block.indexOf('ns-pet-dock'));
  assert.ok(scroll.includes('ns-pnote') && scroll.includes('ns-pass'), '护照与说明文字必须在可滚区（旧形态它们被裁在视口外）');
  const dock = block.slice(block.indexOf('ns-pet-dock'));
  assert.ok(dock.includes('ns-pet-sleep'), '「让它去睡」必须在常驻底栏');
});

/* ══ V4 正文 /门牌 触发：光标锚定 + 组字通道 ═════════════════════════ */
test('V4 触发判据改为光标锚定，且补了中文输入法上屏通道', () => {
  assert.ok(SRC.includes('function nsWordTriggerAtCaret()'), '新判据函数必须在');
  assert.ok(SRC.includes("editor.addEventListener('compositionend'"), '必须补 compositionend 通道（Chromium 拼音 commit 不派 insertText）');
  assert.ok(!SRC.includes('function nsWordTrigger(text)'), '旧「扫 textContent 尾部」函数禁回潮');
  assert.ok(!SRC.includes("(?=$|[\\s，。、！？.;:!?])"), '旧「词后必须有分隔符」的预查禁回潮——打完 /mirror 就停手恰恰没有分隔符');
  assert.ok(SRC.includes(ENUM), '门牌枚举必须仍显式列出十个（防通配吞正文斜杠词）');
});
test('V4b 行为：中文后紧跟斜杠必须触发（旧正则在此必红）', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const W = app.window, ed = W.document.getElementById('editor');
  const old = W.document.getElementById('nsAsk'); if (old) old.remove();
  ed.textContent = '看/dragon';
  const e = new W.Event('beforeinput', { bubbles: true });
  e.inputType = 'insertText'; e.data = 'n';
  ed.dispatchEvent(e);
  await new Promise(r => setTimeout(r, 0));
  const ask = W.document.getElementById('nsAsk');
  assert.ok(ask, '「看/dragon」必须弹确认层（旧 (^|\\s) 判据把中文当非边界，永不触发）');
  assert.ok(/dragon/.test(ask.textContent), '弹的必须是 dragon');
  ask.remove();
});
test('V4c 行为：路径片段与更长的词仍不得触发（放宽不等于放水）', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const W = app.window, ed = W.document.getElementById('editor');
  async function fire(text) {
    const old = W.document.getElementById('nsAsk'); if (old) old.remove();
    ed.textContent = text;
    const e = new W.Event('beforeinput', { bubbles: true });
    e.inputType = 'insertText'; e.data = text.slice(-1);
    ed.dispatchEvent(e);
    await new Promise(r => setTimeout(r, 0));
    return !!W.document.getElementById('nsAsk');
  }
  assert.strictEqual(await fire('config/pet'), false, '路径片段不得触发');
  assert.strictEqual(await fire('pet'), false, '裸词不得触发');
  assert.strictEqual(await fire('打开/mirrorx'), false, '更长的词不得触发');
});

/* ══ V5 首页彩蛋入口 ═══════════════════════════════════════════════ */
test('V5 首页命中门牌走「打开彩蛋」，旧「清空输入 + 换一个」禁回潮', () => {
  assert.ok(SRC.includes('<p id="landingEggTip" class="eggtip hidden"></p>'), '说明行 DOM 必须在');
  assert.ok(SRC.includes('#landing button.egg{'), '金色描边态样式必须在');
  assert.ok(SRC.includes("if (egg) { // 首页即发射台"), '点击分支必须显式分流（锚补丁行）');
  assert.ok(!SRC.includes('这个名字是彩蛋专属门牌，换一个'), '旧「换一个」文案已退役');
});
test('V5b 行为：首页输入 mirror 后按钮变「打开彩蛋」且解禁，输入普通名回原样', async t => {
  const app = loadApp(null, 'http://localhost/'); t.after(() => app.window.close());
  const W = app.window, d = W.document;
  const li = d.getElementById('landingInput'), lb = d.getElementById('landingBtn');
  assert.ok(li && lb, '首页输入框与按钮应在（根路径走 landing 分支）');
  li.value = 'mirror';
  li.dispatchEvent(new W.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(lb.textContent, '打开彩蛋', '命中门牌按钮必须改文案');
  assert.strictEqual(lb.disabled, false, '命中门牌按钮必须解禁（旧形态清空后反而更迷惑）');
  assert.ok(lb.classList.contains('egg'), '必须上描边态');
  const tip = d.getElementById('landingEggTip');
  assert.ok(tip && !tip.classList.contains('hidden'), '说明行必须出现');
  assert.ok(/\/mirror/.test(tip.textContent), '说明行必须带上命中的门牌名');
  li.value = 'worklog';
  li.dispatchEvent(new W.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(lb.textContent, '打开', '普通笔记名必须回到「打开」');
  assert.ok(!lb.classList.contains('egg'), '普通名不得留描边态');
  assert.ok(tip.classList.contains('hidden'), '普通名说明行必须收起');
});

/* ══ V6 游戏文字：测宽截断 + satoshi 分行 ══════════════════════════ */
test('V6 clipTo 按量出来的宽度截断，dragon 与 tesla 都已接入', () => {
  assert.ok(SRC.includes('function clipTo(c, txt, max)'), 'clipTo 必须在');
  assert.ok(SRC.includes('clipTo(c, o.label, o.w - 10)'), 'dragon 障碍必须按框宽截断');
  assert.ok(SRC.includes('clipTo(c, f.label, f.w - 12)'), 'tesla 碎片同款接入');
  const n = (SRC.match(/String\(o\.label\)\.slice\(0, ?6\)|String\(f\.label\)\.slice\(0, ?6\)/g) || []).length;
  assert.strictEqual(n, 0, '旧「数字数不量宽」的 slice(0,6) 禁回潮（6 个汉字 60px 压出 52px 的框）');
});
test('V6b satoshi：格内千分位改窄空格，数字与「聪」行距按格宽定死', () => {
  assert.ok(SRC.includes("fmt(v).replace(/,/g, '\\u2009')"), '格内数字必须去掉会下伸的逗号');
  assert.ok(SRC.includes('var lh = s * .30;'), '行距必须按格宽 s 定，不再随字号缩放');
  assert.ok(!SRC.includes('fs * .95'), '旧「聪 压在 fs*.95」的排版禁回潮（逗号下伸必重叠）');
  assert.ok(!SRC.includes('fs * .55'), '旧「数字基线下压 fs*.55」的排版禁回潮');
});

/* ══ V7 刷新开奖卡 ═════════════════════════════════════════════════ */
test('V7 开奖卡：四档权重合计 100、停留时长按档、UR 按拍板不自收', () => {
  assert.ok(SRC.includes("var NS_DRAW_W = [['r', 70], ['sr', 20], ['ssr', 8], ['ur', 2]];"), '权重必须钉死（改了要同步这条钉）');
  assert.ok(SRC.includes('var NS_DRAW_HOLD = { r: 2500, sr: 3200, ssr: 4500, ur: 0 };'), '停留时长必须分档，ur=0 即「不自动消失」');
  assert.ok(SRC.includes('if (hold > 0) setTimeout(close, hold);'), '必须按 hold 决定是否自收');
  assert.ok(SRC.includes("card.addEventListener('click', close)"), '不自收的档也要能点掉，不能挂着赶不走');
});
test('V7b 文案池 350 条、四档齐、无重复', () => {
  const i = SRC.indexOf('var NS_DRAW_POOL = {');
  assert.ok(i > 0, '池子必须在');
  const j = SRC.indexOf('\n};', i);
  const lit = SRC.slice(i + 'var NS_DRAW_POOL = '.length, j + 2);
  const pool = eval('(' + lit + ')');
  assert.deepStrictEqual(Object.keys(pool).sort(), ['r', 'sr', 'ssr', 'ur'], '四档都要有');
  assert.strictEqual(pool.r.length, 150);
  assert.strictEqual(pool.sr.length, 100);
  assert.strictEqual(pool.ssr.length, 70);
  assert.strictEqual(pool.ur.length, 30);
  const all = [].concat(pool.r, pool.sr, pool.ssr, pool.ur);
  assert.strictEqual(all.length, new Set(all).size, '全池不得有重复句');
  all.forEach(s => {
    const n = s.replace(/[，。、；：！？“”‘’「」『』（）《》·\s]/g, '').length;
    assert.ok(n >= 4 && n <= 15, '长度越界：' + s + ' (' + n + ')');
    assert.ok(!/[!！?？]/.test(s), '不许感叹号/问号：' + s);
  });
  // 用户已判「收藏册是负担」——全池不得出现任何收集/进度语义
  assert.ok(!SRC.includes('nsDrawBook') && !SRC.includes('draw_seen_book'), '不得有收藏册实现');
});
test('V7c 落库只有下标，绝不存文案原文；抽卡必须落在 reload 之前', () => {
  assert.ok(SRC.includes("sessionStorage.setItem(NS_DRAW_KEY, JSON.stringify({ t: t, i: i }))"), 'sessionStorage 只存档位+序号');
  assert.ok(!/sessionStorage\.setItem\(NS_DRAW_KEY[^;]*text/.test(SRC), '严禁把文案写进 sessionStorage');
  const roll = SRC.indexOf('try { nsDrawRoll(); } catch (e) {}');
  const reload = SRC.indexOf('    location.reload();', roll - 200);
  assert.ok(roll > 0 && reload > roll, 'nsDrawRoll() 必须在 location.reload() 之前——reload 之后就是死代码');
});
test('V7d 让位守卫：节日雨/问候/冲突条/局内 一律不弹（坏消息的时候不发奖）', () => {
  const i = SRC.indexOf('function nsDrawBusy()');
  const fn = SRC.slice(i, SRC.indexOf('\n}', i) + 2);
  ['nsGreet', 'nsRain', 'draftBar', 'remoteBar', 'ns-in-game'].forEach(k =>
    assert.ok(fn.includes(k), '让位判据缺 ' + k));
});

/* ══ V8 正文图片：放大 / 菜单 / 保存阶梯（v9.3.0 翻转）══════════════ */
test('V8 单击放大接管；v9.3.0 桌面右键交还系统菜单、自建只留触屏长按', () => {
  assert.ok(SRC.includes("editor.addEventListener('mousedown'"), '必须拦 mousedown 默认（否则点图会挪光标、清选区）');
  const ci = SRC.indexOf("editor.addEventListener('contextmenu'");
  assert.ok(ci > 0, 'contextmenu 监听必须在（触屏拦截走它）');
  const cbody = SRC.slice(ci, ci + 260);
  assert.ok(cbody.includes('if (nsHoverPointer()) return;'), 'v9.3.0：桌面必须提前 return 不拦不 preventDefault——交还系统原生菜单（防回潮钉）');
  assert.ok(SRC.includes("editor.addEventListener('click'"), '单击必须开放大层');
  assert.ok(SRC.includes("editor.addEventListener('touchstart'"), '移动长按必须有计时器');
  assert.ok(SRC.includes('}, 520);'), '长按阈值必须钉住（短于系统 callout、长于误触）');
});
test('V8b 查看器与菜单的 z 序都在图鉴 z90 之下', () => {
  const z = /#nsZoom\{[^}]*z-index:(\d+)/.exec(SRC);
  const m = /#nsImgMenu\{[^}]*z-index:(\d+)/.exec(SRC);
  assert.ok(z && m, '两层都必须有独立 z-index 声明');
  assert.ok(+z[1] < 90 && +m[1] < 90, '"图鉴最高"是钉住的口径，实得 zoom=' + z[1] + ' menu=' + m[1]);
  assert.ok(+m[1] > +z[1], '菜单必须浮在查看器之上（查看器里也要能弹菜单）');
});
test('V8c 保存阶梯 v9.3.0 重排：壳内直链原生主路径、share 退役、壳内绝不 window.open（红线15 数面齐）', () => {
  const i = SRC.indexOf('async function nsImgSave(img)');
  // 边界必须走正则：index.html 是 CRLF，裸 '\n}\n' 锚永不命中，indexOf 返回 -1 会让 slice 吞掉整段尾部变成假红
  const rel = /\r?\n\}\r?\n/.exec(SRC.slice(i));
  const fn = SRC.slice(i, i + rel.index + rel[0].length);
  assert.ok(fn.includes('typeof bridge.saveImageUrl'), '① 壳内 https 直链原生下载必须是最前主路径');
  assert.ok(fn.includes('Plugins.ImgSave'), '② 旧壳/data: 回退 base64 桥仍在');
  assert.ok(!fn.includes('navigator.share'), 'v9.3.0：系统分享面板一层退役');
  assert.ok(fn.includes("a.download = 'notesync-'"), '③ 浏览器 blob 下载');
  assert.ok(fn.includes("window.open(src, '_blank')"), '④ 浏览器兜底打开原图');
  const woIdx = fn.indexOf("window.open(src, '_blank')");
  const nativeGuard = fn.lastIndexOf('isNativeApp()', woIdx);
  assert.ok(woIdx > fn.indexOf('if (isNativeApp()) { done'), '壳内失败必须先于 window.open 明确报错——绝不允许拿打开链接冒充保存（用户实锤 bug 钉）');
  assert.ok(nativeGuard < woIdx, 'window.open 只能在 isNativeApp 判据之后的 catch 分支里');
  // 红线15 正向钉：每个 showUploadStatus 都要配「仍是它才清」的守卫式自收。
  assert.strictEqual((fn.match(/showUploadStatus\(/g) || []).length, 3, '调用点数面必须钉住（多了必漏配自收）');
  assert.strictEqual((fn.match(/uploadStatus\.textContent === /g) || []).length, 3, '每个调用点都必须配守卫式 setTimeout 自收');
  assert.ok(fn.includes('if (uploadStatus.textContent === msg) hideUploadStatus()'), 'done() 通道的守卫');
  assert.ok(fn.includes("if (uploadStatus.textContent === '图片地址取不到') hideUploadStatus()"), '早退通道的守卫');
});
test('V8d 删除图片入口整体退役（v9.3.0 用户令），不得回潮', () => {
  assert.ok(!SRC.includes('function nsImgDelete'), 'nsImgDelete 函数必须整体退役，不留僵尸入口');
  assert.ok(!SRC.includes("['删除图片'"), '菜单/底栏的删除项数组字面量不得回潮（正文图删除走退格，无需专门按钮）');
  assert.ok(!SRC.includes('nz-del'), '红色删除项样式随功能同退');
});
test('V8e Android 原生桥在位：零新权限、分区存储 + 预 Q 走扫描器', () => {
  assert.ok(MAIN.includes('@CapacitorPlugin(name = "ImgSave")'), '插件声明必须在');
  assert.ok(MAIN.includes('fun saveImage(call: PluginCall)'), 'saveImage 方法必须在');
  assert.ok(MAIN.includes('MediaStore.Images.Media.RELATIVE_PATH'), 'API29+ 走分区存储');
  assert.ok(MAIN.includes('MediaScannerConnection.scanFile'), '预 Q 走扫描器（避开 WRITE_EXTERNAL_STORAGE）');
  const mf = path.resolve(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.ok(!/WRITE_EXTERNAL_STORAGE/.test(fs.readFileSync(mf, 'utf8')), '不得新增写存储权限');
  const ma = fs.readFileSync(path.resolve(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'MainActivity.java'), 'utf8');
  assert.ok(ma.includes('registerPlugin(ImgSavePlugin.class)'), '必须在 MainActivity 显式注册');
});

/* ══ V9 折叠隐形标记对光标透明 ════════════════════════════════════ */
test('V9 光标透明四件套在位，且只用 setCaret 不碰原生撤销事务', () => {
  ['function foldMarkOfBlock', 'function foldLeftmostPos', 'function caretInsideFoldMark',
   'function caretAtFoldLeftmost', 'function foldCaretNormalize', 'function foldJumpToPrevLineEnd'].forEach(n =>
    assert.ok(SRC.includes(n), '缺函数 ' + n));
  const i = SRC.indexOf('function foldCaretNormalize()');
  const fn = SRC.slice(i, SRC.indexOf('\n}', i) + 2);
  assert.ok(fn.includes('setCaret('), '落位必须走 setCaret（红线3）');
  assert.ok(fn.includes('document.activeElement !== editor'),
    '必须带 activeElement 守卫：全局 selectionchange 在面板事项框/口令框聚焦时也会触发，' +
    '而 getSelection() 那时仍可能报编辑器旧选区，照旧归一就会把焦点从输入框抢回编辑器（V544-2/V71-3 实锤回归）');
  assert.ok(!/\.removeAllRanges\(|\.addRange\(/.test(fn), '禁真调用 removeAllRanges()/addRange()（会打断原生撤销事务分组）');
  assert.ok(fn.includes('isComposing'), '组字期必须不动选区（红线9）');
  assert.ok(SRC.includes("document.addEventListener('selectionchange'"), '归一化必须挂 selectionchange（覆盖 ←/→/Home/点选/拖拽全部入口）');
});
test('V9b 最左位再按← 才接管，扩选与组合键一律交回系统', () => {
  const i = SRC.indexOf("if (e.key !== 'ArrowLeft') return;");
  assert.ok(i > 0, '← 必须有专属分支');
  const around = SRC.slice(i - 400, i + 500);
  assert.ok(around.includes('e.shiftKey || e.ctrlKey || e.metaKey || e.altKey'), '组合键/扩选必须放行');
  assert.ok(around.includes('sel.isCollapsed'), '只处理坍缩光标');
  assert.ok(around.includes('foldJumpToPrevLineEnd'), '最左位← 必须跳上一行');
});
test('V9c 隐藏正文块必须跳过（原生← 也不进 display:none 的内容）', () => {
  const i = SRC.indexOf('function foldJumpToPrevLineEnd');
  const fn = SRC.slice(i, SRC.indexOf('\n}', SRC.indexOf('return false; // 上面没有可见行', i)) + 2);
  assert.ok(fn.includes('ns-fold-hide'), '必须跳过折叠隐藏块');
  assert.ok(fn.includes("display === 'none'"), '必须兜底判 computed display');
});
test('V9d 退格原子整删护栏一字未动（走与删互不干涉）', () => {
  assert.ok(SRC.includes('function foldMarkTouchedByCaret(range)'), '退格护栏必须在');
  assert.ok(SRC.includes("if (e.key !== 'Backspace') return;"), '退格分支未被←分支挤掉');
});

/* ══ V11 闸一轮回归钉（两路评审命中的 P0/P1，修完钉死防回潮） ═══════ */
test('V11 --mono 令牌必须定义（曾被 19 处 font 简写引用却从未声明，等宽小字全废成 16px 无衬线）', () => {
  const day = cssBlock(':root{', '  }\n  body.dark{');
  assert.ok(/--mono:/.test(day), ':root 必须声明 --mono');
  assert.ok(/ui-monospace/.test(tokVar(day, '--mono') || ''), '--mono 必须以 ui-monospace 起头');
  assert.ok((SRC.match(/var\(--mono\)/g) || []).length >= 18, '引用面仍应有 18+ 处（v9.3.0：放大查看器底栏按用户「看不清」改 15px sans，mono 引用 19→18）');
});
test('V11b 开奖卡入场必须自带居中帧，绝不复用通用 rise（to 帧 transform:none 会抹掉 translateX(-50%)）', () => {
  assert.ok(SRC.includes('@keyframes drawRise{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}'),
    '必须有保居中的专属入场');
  const base = /#nsDraw\{[^}]*\}/.exec(SRC)[0];
  assert.ok(base.includes('animation:drawRise'), '#nsDraw 必须用 drawRise');
  assert.ok(!/animation:rise[ ,}]/.test(base), '禁复用通用 rise（v5.44 remCard 同款事故）');
});
test('V11c 首页彩蛋态必须在两板广规则之后自带 !important，否则被实底碾平', () => {
  const dyn = SRC.indexOf('#landing button.egg:not(:disabled){background:${accentSoft}!important');
  const dynBroad = SRC.indexOf('#landing button:not(:disabled){background:${p.fg}!important');
  assert.ok(dyn > 0 && dynBroad > 0 && dyn > dynBroad, '动态板：彩蛋规则必须排在广规则之后');
  assert.ok(dyn !== -1 && dynBroad !== -1 && SRC.slice(dyn, dyn + 200).includes('border-color:${accent}!important'), '描边也必须锁');
  const shell = SRC.indexOf("'#landing button.egg:not(:disabled){background:#08090F!important");
  const shellBroad = SRC.indexOf("'#landing button:not(:disabled){background:#E3E3E5!important");
  assert.ok(shell > 0 && shellBroad > 0 && shell > shellBroad, '国产壳板：彩蛋规则必须排在广规则之后');
  assert.ok(shell === -1 || SRC.slice(shell, shell + 220).includes('#708ED9'), '壳板预反色必须是 255−#8F7126=#708ED9');
});
test('V11d 借壳模式不得吃夜间画布色板（壳会把页面翻成"看起来是白天"）', () => {
  const i = SRC.indexOf('function pal()');
  const fn = SRC.slice(i, SRC.indexOf('\n  return PAL;', i));
  assert.ok(fn.includes("darkShellActive()"), 'PAL.dark 必须把借壳摘出去');
  assert.ok(fn.includes("typeof darkShellActive === 'function'"), '必须 typeof 守卫（旧壳无此函数不得抛）');
});
test('V11e 图片查看器与菜单每条关闭路径都归还编辑器焦点（红线10）', () => {
  const i = SRC.indexOf('function nsImgCloseZoom()');
  const fn = SRC.slice(i, SRC.indexOf('\n}', i) + 2);
  assert.ok(fn.includes('nsImgGiveFocusBack()'), '关闭查看器必须归还焦点');
  assert.ok(fn.includes("document.removeEventListener('keydown', nsImgEsc, true)"), '关闭必须摘掉 Esc 监听，否则每开一次叠一份');
  const m = SRC.indexOf('function nsImgMenuClose()');
  assert.ok(SRC.slice(m, m + 220).includes('nsImgGiveFocusBack()'), '菜单关闭同样归还');
  // 回归钉：两个关闭函数都挂在 capture 的 scroll / 全局 mousedown 上，"没有浮层"时也会被调用；
  // 无条件归还焦点会在提醒面板打开时把焦点从事项输入框抢回编辑器（V544-2 / V71-3 实测回归）。
  const mc = SRC.slice(m, SRC.indexOf('\n', m));
  assert.ok(/if \(!m \|\| !m\.parentNode\) return;/.test(mc), '菜单关闭必须"真关掉了"才归还焦点');
  assert.ok(/if \(!z \|\| !z\.parentNode\) return;/.test(fn), '查看器关闭必须"真关掉了"才归还焦点');
  const g = SRC.indexOf('function nsImgGiveFocusBack()');
  const gf = SRC.slice(g, SRC.indexOf('\n}', g) + 2);
  assert.ok(gf.includes('editor.focus()') && gf.includes('ensureCaret()'), '归还必须是 focus + ensureCaret 两步');
});
test('V11f 桌宠面板宽屏必须居中（margin:0 会让 420px 面板左贴边）', () => {
  assert.ok(SRC.includes('.ns-dom .ns-pet-panel{margin:0 auto;'), '必须 margin:0 auto');
  assert.ok(!SRC.includes('.ns-dom .ns-pet-panel{margin:0;'), '禁回潮 margin:0');
});
test('V10 金属色与查看器色只声明在 :root / body.dark 两板，卡外无第二处硬编码', () => {
  const day = cssBlock(':root{', '  }\n  body.dark{');
  const night = cssBlock('body.dark{', '  }\n  *{box-sizing:border-box}');
  ['--foil-silver', '--foil-gold', '--foil-gold-hi', '--zoom-bg', '--zoom-ink'].forEach(n => {
    assert.ok(tokVar(day, n), n + ' 必须在 :root 声明');
  });
  ['--foil-silver', '--foil-gold', '--zoom-bg'].forEach(n => assert.ok(tokVar(night, n), n + ' 必须在 body.dark 声明'));
  const uses = (SRC.match(/var\(--foil-|var\(--zoom-/g) || []).length;
  assert.ok(uses >= 12, '卡面样式必须全部吃 var()，实得 ' + uses);
  const styleEnd = SRC.indexOf('</style>');
  const css = SRC.slice(0, styleEnd);
  // 只钉本次新增的四个金属色；8F7126 / D4B068 是既有 --accent 值，两板各一次本属正常
  ['A9ACB4', 'C9A24B', '8E9199', 'F0D89A'].forEach(h => {
    const c = (css.match(new RegExp('#' + h, 'g')) || []).length;
    assert.strictEqual(c, 1, '金属色 #' + h + ' 只允许在令牌声明里出现一次，实得 ' + c);
  });
});

/* ══ V12 闸二轮回归钉（三路评审各自命中，逐条钉死防回潮） ═════════ */
test('V12 Kotlin 不得引用 Capacitor 7 不存在的 @NonBlocking（写了 APK 直接 unresolved reference 炸构建）', () => {
  assert.ok(!/import\s+com\.getcapacitor\.annotation\.NonBlocking/.test(MAIN),
    '不得 import 该注解——本地 @capacitor/android 的 annotation 包只有 ActivityCallback/CapacitorPlugin/Permission/PermissionCallback');
  assert.ok(!/^\s*@NonBlocking\s*$/m.test(MAIN), '不得把该注解用在方法上');
  assert.ok(MAIN.includes('taskHandler') || MAIN.includes('后台线程'),
    '必须留注释说明为何不需要异步：Bridge 的 taskHandler 本就把插件方法派发在 handlerThread 上');
});
test('V12b 镜像补偿必须叠加而非替换基座 translateX(-50%)', () => {
  assert.ok(SRC.includes('transform:translateX(-50%) scaleX(-1)}'),
    '查看器提示条/按钮条基座带 translateX(-50%)，补偿必须是平移+翻转叠加');
  assert.ok(SRC.includes('body.ns-mirror-A #nsAsk,body.ns-mirror-B #nsAsk{transform:translateX(-50%) scaleX(-1)}'),
    '#nsAsk 同型存量缺陷也必须叠加（v9.1 起就脱中，闸 R1b 命中）');
  assert.ok(!/^body\.ns-mirror-A #nsAsk,body\.ns-mirror-B #nsAsk,body\.ns-mirror-A \.ns-mirror-panel/m.test(SRC),
    '#nsAsk 不得再与无平移基座的元素混在同一条纯 scaleX(-1) 规则里');
});
test('V12c 图片菜单入场只动 opacity（通用 rise 的 fill:both 会吞掉镜像 transform）', () => {
  const rule = /#nsImgMenu\{[^}]*\}/.exec(SRC)[0];
  assert.ok(rule.includes('animation:menuFade'), '菜单必须用只动透明度的专属入场');
  assert.ok(!/animation:rise/.test(rule), '禁复用 rise——它的 to 帧 transform:none 在 fill:both 下压掉镜像补偿');
  assert.ok(SRC.includes('@keyframes menuFade{from{opacity:0}to{opacity:1}}'), 'menuFade 必须真定义');
});
test('V12d 让位时绝不删袋：等泳道空出来再兑现，真兑现了才作废', () => {
  const i = SRC.indexOf('function nsDrawConsume()');
  const fn = SRC.slice(i, i + 2400);
  assert.ok(fn.includes('setTimeout(nsDrawConsume, 250)'), '忙时必须轮询等待，不能直接放弃这次开奖');
  assert.ok(fn.includes('NS_DRAW_WAIT++ >= 32'), '轮询必须有上限（约 8s），超时才作废，绝不无限等');
  // 顺序钉：兑现前那次 removeItem 必须排在 busy 判定之后——「先删袋再让位」＝当次开奖被静默吞掉
  // （越界作废分支先删袋是正确行为，所以只在 busyAt 之后找，不从函数头找）
  const busyAt = fn.indexOf('if (nsDrawBusy())');
  const rmAt = fn.indexOf('sessionStorage.removeItem(NS_DRAW_KEY);', busyAt);
  const showAt = fn.indexOf('nsDrawShow(d.t, pool[d.i])');
  assert.ok(busyAt > 0 && rmAt > busyAt && showAt > rmAt, '必须先判让位、真兑现时才删袋（闸 R3b 实测窄屏问候气泡下 3/3 白抽）');
  assert.ok(SRC.includes("var dc = document.getElementById('nsDraw');"), '确认浮层出现时必须收掉同泳道的开奖卡（反向互斥）');
});
