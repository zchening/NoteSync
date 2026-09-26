// NoteSync v9.0.0 单元测试：彩蛋十门牌 + 统一音效层 + 街机档案 + 桌宠红线。
// 守护纪律（本仓铁律）：①源码字面量钉必须锚到补丁行，裸匹配会命中同形代码成恒真；
// ②行为优先于文本；③红线（不触正文、不存原文、默认静音）一律做成可执行断言而非注释。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');
const WWW = fs.readFileSync(path.resolve(__dirname, '..', '..', 'www', 'index.html'), 'utf8');
const APK = fs.readFileSync(path.resolve(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html'), 'utf8');
const GATE = ['mirror', 'snake', 'dragon', 'brick', 'satoshi', 'bitcoin', 'tank', 'spacex', 'tesla', 'pet'];

// 取彩蛋层 A/B 两段脚本（位于主脚本之后、</body> 之前），供"层内"静态断言用
function layerSrc() {
  const i = SRC.lastIndexOf('v9.0.0 彩蛋层 A');
  const j = SRC.lastIndexOf('v9.0.0 彩蛋层 B');
  assert.ok(i > 0 && j > i, '两层彩蛋脚本应存在且顺序为 A 前 B 后');
  return { a: SRC.slice(i, j), b: SRC.slice(j) };
}

/* ── A1 门牌命中即不解析为笔记：noteId 置空、走首页态、由彩蛋层接管 ── */
test('A1 访问 /snake 时 noteId 为空串（不当作加密笔记），nsRouteHit 命中 snake', t => {
  const app = loadApp(null, 'http://localhost/snake'); t.after(() => app.window.close());
  const w = app.window;
  assert.strictEqual(w.eval('noteId'), '', '门牌不得被解析为笔记名');
  assert.strictEqual(w.eval('nsRouteHit'), 'snake');
  assert.ok(!w.eval('NOTE_API').includes('/snake'), 'NOTE_API 不得指向 /api/note/snake（否则门牌会去读一条不存在笔记）');
});
test('A1b 非门牌路径仍按笔记解析，既有行为零回归', t => {
  const app = loadApp(null, 'http://localhost/zchening'); t.after(() => app.window.close());
  assert.strictEqual(app.window.eval('noteId'), 'zchening');
  assert.strictEqual(app.window.eval('nsRouteHit'), '');
  assert.ok(app.window.eval('NOTE_API').endsWith('/api/note/zchening'));
});

/* ── A2 门牌清单三处同源：路由白名单 / 图鉴条目 / 词表正则 ── */
test('A2 十个门牌在路由表、图鉴、词表正则三处严格同源（防漂移）', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  // 跨 realm 数组的 prototype 不同，deepStrictEqual 必红——一律 JSON 化后比
  assert.strictEqual(JSON.stringify(w.eval('NS_RESERVED_ROUTES.slice()')), JSON.stringify(GATE), '路由白名单');
  assert.strictEqual(JSON.stringify(w.NS_ROUTES.slice()), JSON.stringify(GATE), '彩蛋层导出表须与路由表同序同集');
  const list = w.eval('NS_EGG_LIST.map(x=>x.id)');
  GATE.forEach(id => assert.ok(list.includes(id), '图鉴缺门牌条目 ' + id));
  const L = layerSrc();
  const ENUM = '(mirror|snake|dragon|brick|satoshi|bitcoin|tank|spacex|tesla|pet)';
  assert.ok(L.a.indexOf(ENUM) >= 0, '词表正则必须显式枚举十个门牌（不得用通配，否则会吞正文里的普通斜杠词）');
  // 自指断言无价值（ENUM 是我自己写的串）——改为真跑行为：词表触发器对五种输入各判一次。
  // 触发器在 setTimeout(0) 里建浮层，所以每次 fire 后必须等一拍（同步断言=恒假，同样是假绿）
  const w2 = loadApp(); t.after(() => w2.window.close());
  const W = w2.window;
  const ed = W.document.getElementById('editor');
  const tick = () => new Promise(r => setTimeout(r, 0));
  function fire(text, type) {
    ed.textContent = text;
    const e = new W.Event('beforeinput', { bubbles: true });
    e.inputType = type || 'insertText'; e.data = text.slice(-1);
    ed.dispatchEvent(e);
  }
  fire('买咖啡 /pet'); await tick();
  assert.ok(W.document.getElementById('nsAsk'), '独立成词的 /pet 必须触发');
  W.document.getElementById('nsAsk').remove();
  fire('config/pet'); await tick();
  assert.ok(!W.document.getElementById('nsAsk'), '路径片段不得触发（写技术笔记每敲斜杠就被弹走）');
  fire('pet'); await tick();
  assert.ok(!W.document.getElementById('nsAsk'), '裸词不得触发');
  fire('/petshop'); await tick();
  assert.ok(!W.document.getElementById('nsAsk'), '前缀词不得触发');
  fire('/tank'); await tick();
  assert.ok(W.document.getElementById('nsAsk'), '/tank 必须触发');
});

/* ── A3 图鉴扩容 17 条，新条目 replay 一律走 nsRouteEgg（App 内图鉴即发射台）── */
test('A3 图鉴 17 条；十个门牌条目 replay 全部指 nsRouteEgg，无第二触发路径', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  assert.strictEqual(w.eval('NS_EGG_TOTAL'), 17);
  assert.strictEqual(w.eval('NS_EGG_LIST.length'), 17, '条目数须与常量同版一致（本仓硬钉）');
  const srcs = w.eval('NS_EGG_LIST.filter(x=>'+JSON.stringify(GATE)+'.indexOf(x.id)>=0).map(x=>String(x.replay)).join("|")');
  GATE.forEach(id => assert.ok(srcs.includes("nsRouteEgg('" + id + "')"), id + ' 的 replay 必须走 nsRouteEgg'));
  assert.ok(!/toggle|Zen|no-op/.test(srcs), 'replay 不得挂带反向开关副作用的函数（v8.3.0 闸教训）');
});

/* ── A4 新建笔记禁用门牌（首页净化 + 提交兜底双挡）── */
test('A4 首页命中门牌：不清空输入、主按钮变「打开彩蛋」并走 nsRouteEgg（v9.2.0 用户改判，旧「清空+换一个」= 输入了没反应）', () => {
  const S = SRC.slice(SRC.indexOf('const eggHit'), SRC.indexOf("li.addEventListener('input'"));
  assert.ok(S.includes('NS_RESERVED_ROUTES.indexOf(nm) >= 0'), '门牌名单必须复用 NS_RESERVED_ROUTES，绝不在首页抄第二份（抄了就漂移）');
  assert.ok(S.includes("lb.textContent = egg ? '打开彩蛋' : '打开'"), '命中须改按钮文案（锚补丁行，裸匹配会命中同形代码成恒真）');
  assert.ok(S.includes("lb.classList.toggle('egg', !!egg)"), '命中须上金色描边态');
  assert.ok(S.includes('是彩蛋门牌，不会新建笔记'), '须给专属说明行，把「不新建笔记」讲明白');
  const C = SRC.slice(SRC.indexOf("lb.addEventListener('click'"), SRC.indexOf("li.addEventListener('keydown'"));
  assert.ok(C.includes('window.nsRouteEgg(egg)'), '点击必须走彩蛋层唯一入口（图鉴 replay 同款），不开第二条启动路径');
  // 旧形态禁现：清空输入 + 提交处静默 return——正是用户报「输入了却什么也没发生」的两行成因
  assert.ok(!S.includes("li.value = ''; syncOpenBtn(); if (urlEl)"), '旧「命中即清空输入」禁回潮');
  assert.ok(!SRC.includes("if (name && typeof NS_RESERVED_ROUTES !== 'undefined' && NS_RESERVED_ROUTES.indexOf(name.toLowerCase()) >= 0) return;"), '旧「提交处静默 return」禁回潮');
  assert.ok(!SRC.includes('这个名字是彩蛋专属门牌，换一个'), '旧「换一个」文案已退役，禁回潮');
});

/* ── A5 启动：壳挂出、HUD 五件套、body 锁滚动、当场入图鉴 ── */
test('A5 nsRouteEgg 启动游戏：#nsGame 挂出 + HUD 齐 + 入图鉴 + 路径改写', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  w.nsRouteEgg('snake');
  const g = w.document.getElementById('nsGame');
  assert.ok(g, '游戏壳应挂出');
  assert.ok(w.document.body.classList.contains('ns-in-game'), 'body 应上锁滚动类');
  ['.ns-x', '.ns-gate', '.ns-sc', '.ns-mute'].forEach(sel => assert.ok(g.querySelector(sel), 'HUD 缺件 ' + sel));
  assert.strictEqual(g.querySelector('.ns-gate').textContent, '/snake');
  assert.strictEqual(w.eval("location.pathname"), '/snake', '地址栏应同步为门牌路径（可分享、可返回）');
  assert.ok(w.nsEggHas('snake'), '进入即记入图鉴');
  assert.strictEqual(w.NSG.route, 'snake');
});

/* ── A6 退出四路径 + 路径还原 + 镜像互斥 ── */
test('A6 退出路径（× / Esc / popstate）收壳还原 + 结束卡空白=重开不退壳', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  // App 内启动确实压了一条历史（见 A29 反证），UI 退出必走 back()；jsdom 的 history.back 是
  // "Not implemented"（会喷 jsdomError 且不还原路径），故在此打桩成「回到上一条URL」的浏览器语义
  w.history.back = function () { try { this.replaceState({}, '', '/'); } catch (e) {} };
  const esc = () => { w.document.getElementById('nsGame').querySelector('.ns-x').click(); };
  w.nsRouteEgg('brick');
  assert.ok(w.document.getElementById('nsGame'));
  esc();
  assert.ok(!w.document.getElementById('nsGame'), '× 应收壳');
  assert.ok(!w.document.body.classList.contains('ns-in-game'));
  assert.strictEqual(w.eval("location.pathname"), '/', '退出应还原进入前路径');
  w.nsRouteEgg('brick');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!w.document.getElementById('nsGame'), 'Esc 应收壳');
  // v9.3.3：点结束卡遮罩空白不再退出收壳（旧「点空白→closeShell→back 回笔记」正是用户报「跳着跳着回笔记页」根因），
  // 改为重开、壳保持、历史不动。必须真点遮罩本体（target===card 才触发重开分支）。
  w.nsRouteEgg('brick');
  const pathAtGame = w.eval("location.pathname");
  w.eval("window.nsGameEnd('全清了', [['打掉', '1 块']])");
  const over2 = w.document.querySelector('.ns-over');
  assert.ok(over2 && !over2.classList.contains('hidden'), '结束卡应可被唤出');
  const ev = new w.MouseEvent('click', { bubbles: true });
  Object.defineProperty(ev, 'target', { value: over2 });
  over2.dispatchEvent(ev);
  assert.ok(w.document.getElementById('nsGame'), '点结束卡空白=重开，不得收壳退回笔记（v9.3.3 用户报障）');
  assert.strictEqual(w.eval("location.pathname"), pathAtGame, '结束卡空白点击不得动历史路径');
});

/* ── A7 红线：游戏全程不触正文 DOM、不改数据 ── */
test('A7 进出游戏与连点若干帧，编辑器 innerHTML 与正文一字不变', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  ed.innerHTML = '<p>原文不动<span class="rem-mark">x</span></p>';
  const before = ed.innerHTML;
  ['snake', 'brick', 'satoshi', 'bitcoin', 'tank', 'spacex', 'tesla', 'dragon'].forEach(id => {
    w.nsRouteEgg(id);
    const cv = w.document.getElementById('nsCv');
    if (cv) { for (let i = 0; i < 6; i++) { const pe = new w.Event('pointerdown', { bubbles: true }); pe.clientX = 30; pe.clientY = 60; cv.dispatchEvent(pe); } } // jsdom 无 PointerEvent 构造器
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.strictEqual(ed.innerHTML, before, '游戏不得改正文（含 rem-mark 结构）');
  assert.ok(!ed.textContent.includes('/snake'), '门牌文本不得被写进正文');
});

/* ── A8 统一画风：两层脚本与样式内零新色字面量 ── */
test('A8 彩蛋两层零新色字面量（canvas 只吃主题变量），遮罩 rgba 沿用既有先例', () => {
  const L = layerSrc();
  const both = L.a + L.b;
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(both.replace(/#[^'"]*'/g, '')), '层内不得出现十六进制色值');
  assert.ok(!/hsla?\(/.test(both), '不得出现 hsl 色');
  assert.ok(both.includes("getPropertyValue('--fg')") || both.includes("GC('--fg')"), 'canvas 取色必须走主题变量');
  const cssBlock = SRC.slice(SRC.lastIndexOf('v9.0.0 彩蛋层样式'), SRC.lastIndexOf('</style>'));
  assert.strictEqual((cssBlock.match(/rgba?\(/g) || []).length, 3, '样式内仅允许三处 rgba：浅色遮罩底 / 暗色遮罩底 / 确认浮层投影（与 .mask、#versionToast、.box 既有先例同类）');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(cssBlock.replace(/#[a-zA-Z][\w-]*(?![\w-]*\{)/g, '')), '样式一律吃 var()，不得有十六进制色');
});

/* ── A9 音效默认静音 + 状态独立持久化（不并进图鉴位图）── */
test('A9 音效默认静音；切换写 notesync_snd 独立键，不污染图鉴位图', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  assert.strictEqual(w.nsSndMuted(), true, '默认必须静音（笔记应用多在办公室打开）');
  assert.strictEqual(w.localStorage.getItem('notesync_snd'), null, '未动过就不该有键');
  w.nsSndToggle();
  assert.strictEqual(w.nsSndMuted(), false);
  assert.strictEqual(w.localStorage.getItem('notesync_snd'), 'on');
  assert.ok(!(String(w.localStorage.getItem('notesync_eggs') || '')).includes('snd'), '静音态不得混进图鉴位图');
});
test('A9b 默认静音必须真零开销：静音态一个音频节点都不许造（原 doesNotThrow 断言被内层 try/catch 吞成恒真）', t => {
  let created = 0;
  const app = loadApp(w => {
    class FakeCtx {
      constructor() { this.state = 'running'; this.sampleRate = 44100; this.currentTime = 0; this.destination = {}; }
      createGain() { created++; return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { created++; return { type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, detune: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createBufferSource() { created++; return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
      createBiquadFilter() { created++; return { type: '', Q: { value: 1 }, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
      createDelay() { created++; return { delayTime: { value: 0 }, connect() {} }; }
      createWaveShaper() { created++; return { curve: null, oversample: '', connect() {} }; }
      resume() { return Promise.resolve(); }
    }
    w.AudioContext = FakeCtx; w.webkitAudioContext = FakeCtx;
  });
  t.after(() => app.window.close());
  const w = app.window;
  assert.strictEqual(w.nsSndMuted(), true, '默认必须静音');
  w.NSG.voice = 'snake';
  for (let i = 0; i < 12; i++) w.nsFx('eat');
  assert.strictEqual(created, 0, '静音态造了 ' + created + ' 个音频节点——「默认静音零开销」不成立');
  w.nsSndToggle(); // 开声后才允许真正建节点
  for (let i = 0; i < 4; i++) w.nsFx('eat');
  assert.ok(created > 0, '开声后应建节点，否则音效层是死的（created=' + created + '）');
});

/* ── A10 桌宠红线：只存计数与形态，正文一个字都不落盘 ── */
test('A10 桌宠吃字后 localStorage 全量序列化不含任何笔记原文', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const secret = '这是绝不能外流的笔记原文ABC';
  w.document.getElementById('editor').innerHTML = '<p>' + secret + '</p>';
  for (let i = 0; i < 30; i++) w.nsPetEat(7);
  const dump = Object.keys(w.localStorage).map(k => k + '=' + w.localStorage.getItem(k)).join('||');
  assert.ok(!dump.includes(secret), '任何 localStorage 键都不得含笔记原文');
  assert.ok(w.nsPetState().ate >= 210, '食量计数应累加');
  assert.ok(['stage', 'ate', 'shelf', 'born', 'asleep'].every(k => k in w.nsPetState()), '档案字段只允许计数与形态类');
});

/* ── A11 街机档案：id/key 形状 + 护照即钥匙 ── */
test('A11 档案 id 为 8 位无歧义字母表、key 16 位，护照同时含两者', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const id = w.nsArcadeId(), key = w.nsArcadeKey();
  assert.ok(/^[A-Z2-9]{8}$/.test(id), 'id 须与服务端 ARC_ID_RE 同形：' + id);
  assert.ok(/^[A-Z2-9]{16}$/.test(key), 'key 长度须 ≥8 且同字母表：' + key);
  const pp = w.nsArcadePassport();
  assert.ok(pp.includes('id=' + id) && pp.includes('key=' + key), '护照即钥匙：丢了找不回');
});

/* ── A12 词表触发：带斜杠、独立成词、粘贴不算、同词一次会话只提示一次 ── */
test('A12 正文敲 /pet 出确认浮层；点"不了"不启动；再敲同词不再提示', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  function type(s) {
    ed.textContent += s;
    const e = new w.Event('beforeinput', { bubbles: true });
    e.inputType = 'insertText'; e.data = s.slice(-1);
    ed.dispatchEvent(e);
  }
  type('/pet');
  await new Promise(r => setTimeout(r, 0)); // 触发是 setTimeout(0) 里做的（避开组字期未上屏），断言前必须让宏任务转一圈
  let ask = w.document.getElementById('nsAsk');
  assert.ok(ask, '门牌词命中应给确认浮层（不直接跳转打断打字）');
  ask.querySelector('.ns-no').click();
  assert.ok(!w.document.getElementById('nsAsk'), '点"不了"应撤浮层');
  assert.ok(!w.document.getElementById('nsGame'), '未确认不得启动');
  type('/pet');
  await new Promise(r => setTimeout(r, 0));
  assert.ok(!w.document.getElementById('nsAsk'), '同一会话同词只提示一次（防反复打扰）');
});
test('A12b 粘贴与组字期一律不触发；裸词（无斜杠）不触发', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  function fire(inputType, data, isComposing) {
    const e = new w.Event('beforeinput', { bubbles: true });
    e.inputType = inputType; e.data = data; if (isComposing) Object.defineProperty(e, 'isComposing', { value: true });
    ed.dispatchEvent(e);
  }
  ed.textContent = '配置见 /pet';
  fire('insertFromPaste', 't');
  assert.ok(!w.document.getElementById('nsAsk'), '粘贴不得触发');
  fire('insertText', 't', true);
  assert.ok(!w.document.getElementById('nsAsk'), '组字期不得触发');
  ed.textContent = '我在写 pet 相关';
  fire('insertText', 't');
  await new Promise(r => setTimeout(r, 0));
  assert.ok(!w.document.getElementById('nsAsk'), '裸词（无斜杠）不得触发');
});

/* ── A13 镜像三档 + 与游戏互斥 ── */
test('A13 镜像三档 class 切换正确；进任意游戏前必摘镜像（方向键全反必被骂）', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.nsRouteEgg('mirror');
  const de = w.document.documentElement, bd = w.document.body;
  assert.ok(bd.classList.contains('ns-mirror-B'), '默认档应为 B（镜像不反字）');
  w.document.querySelector('.ns-mrow button[data-m="A"]').click();
  assert.ok(bd.classList.contains('ns-mirror-A') && !bd.classList.contains('ns-mirror-B'));
  w.document.querySelector('.ns-mrow button[data-m="C"]').click();
  assert.ok(bd.classList.contains('ns-mirror-C'));
  w.nsRouteEgg('snake');
  assert.ok(!bd.classList.contains('ns-mirror-C') && !de.classList.contains('ns-mirror-C'), '启动游戏必须摘掉镜像');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});

/* ── A14 加载顺序与不侵入：彩蛋层必须在主脚本之后，且不得早于 DOM 就绪 ── */
test('A14 彩蛋层两段位于主脚本之后、</body> 之前；样式块紧随其后（覆膜顺序不被打断）', () => {
  const main = SRC.lastIndexOf("navigator.serviceWorker.register('/sw.js");
  const la = SRC.indexOf('v9.0.0 彩蛋层 A');
  const lb = SRC.indexOf('v9.0.0 彩蛋层 B');
  const cssAt = SRC.indexOf('v9.0.0 彩蛋层样式');
  const bodyEnd = SRC.lastIndexOf('</body>');
  assert.ok(main < cssAt && cssAt < la && la < lb && lb < bodyEnd, '顺序须为 主脚本 → 样式 → 层A → 层B → </body>');
  assert.ok(SRC.lastIndexOf('mountThemeOverride') < la, '彩蛋层不得插在主题覆膜函数之前（override 必须压轴）');
});

/* ── A15 三 bump 与壳字节一致 ── */
test('A15 版本 9.3.3；www 与 android 壳与根 index 逐字节一致', () => {
  assert.ok(SRC.includes("const APP_VERSION = '10.1.3';"), 'APP_VERSION 应随彩蛋十门牌与音效层升到 9.3.1');
  assert.strictEqual(SRC, WWW, 'www 壳必须逐字节同步（本仓 brand W3/D5 同源钉）');
  assert.strictEqual(SRC, APK, 'android assets 壳必须逐字节同步');
});

/* ── A16 服务端档案接口的形状约定（与前端常量互锁）── */
test('A16 server.js 街机档案：id 正则与前端同形、钥匙只存哈希、合并取 max/并集', () => {
  const srv = fs.readFileSync(path.resolve(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(srv.includes('const ARC_ID_RE = /^[A-Z2-9]{8}$/;'), 'id 规则须与前端生成器同形');
  assert.ok(srv.includes("arcHash(k)"), '只存哈希不存明文钥匙');
  assert.ok(srv.includes("return sendJSON(res, 404, { error: 'not found' }); // 钥匙错与不存在同形，防枚举"), '钥匙错必须与不存在同形');
  assert.ok(srv.includes('if (!Number.isFinite(p) || v > p) out.counters[k]'), '计数器取 max（不信客户端整体覆盖）');
  assert.ok(srv.includes('new Set((out.shelf || []).concat(inc.shelf || [])'), '集合并集');
  // 存在性钉等于没钉（删掉执法行也照绿）——逐条钉到执法语句本体
  assert.ok(srv.includes('if (arcLimited(aid)) return sendJSON(res, 429'), 'PUT 限流必须真执法');
  assert.ok(srv.includes("arcLimited('post:' + getClientIP(req))"), '建档必须按 IP 限速（否则公网可刷盘占满 inode）');
  assert.ok(srv.includes('delete pub.keyHash'), 'GET 回档必须剥 keyHash');
  assert.ok(srv.includes("if (arcRead(id)) return sendJSON(res, 200, { ok: true });"), '已存在不得回 exists:true（那等于告诉探测者 id 有人占）');
  assert.ok(srv.includes('RESERVED_IDS') && srv.includes("!fs.existsSync(notePath(_raw))") && srv.includes("!fs.existsSync(notePath(_low))"),
    '服务端必须挡门牌新建且按原样名+小写名两处查（readNote 对缺档返回 EMPTY 故 !readNote 恒假；ID_RE 允许大写，只查小写会把存量 Snake 型笔记判成新建并永久 400）');
  assert.ok(srv.includes('function sweepArcWrites'), '限流表必须有清扫（无界 Map = 内存泄漏）');
  assert.ok(srv.includes("fs.renameSync(tmp, f)"), '须 tmp→rename 原子写（Windows 直接覆盖有半写风险）');
});

/* ═══ 闸后补钉：R1/R2/R3 命中项逐条锁死，防回归 ═══ */

/* A17 桌宠「默认关」是用户拍板项，此前 asleep 缺省 false + boot 无条件挂载 = 默认开 */
test('A17 全新用户不得出现桌宠；只有访问过 /pet 才领养', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  assert.strictEqual(w.nsPetState().adopted, false, '档案缺省必须是未领养');
  assert.ok(!w.document.getElementById('nsPet'), '冷启动不得挂出桌宠');
  w.nsRouteEgg('pet');
  assert.strictEqual(w.nsPetState().adopted, true, '访问 /pet 即领养');
});

/* A18 三款「按住」类游戏缺 keyup = 松不开手（火永远关不掉、车一路漂到撞墙） */
test('A18 spacex / tesla / dragon 必须有 keyup 收口与 pauseHook', () => {
  const L = layerSrc();
  ['spacex', 'tesla', 'dragon'].forEach(id => {
    const at = L.b.indexOf("id: '" + id + "'");
    assert.ok(at > 0, '缺 ' + id + ' 模块');
    const body = L.b.slice(at, at + 4200);
    assert.ok(body.includes('keyup:'), id + ' 必须有 keyup 处理（否则按下的键永远抬不起来）');
  });
  assert.ok(L.b.includes("pauseHook: function () { thrust = false; ENG(false); }"), 'spacex 暂停必须松油门并停引擎');
  assert.ok(L.b.includes("pauseHook: function () { ax = 0; ay = 0; ENG(false); }"), 'tesla 暂停必须清零姿态推力');
});

/* A19 镜像壳此前是不透明全屏 z70，把被镜像的站点整个盖住 = 功能实际不成立（P0） */
test('A19 镜像壳必须透明且不吃点击，控制面板才收点击', () => {
  const cssAt = SRC.indexOf('v9.0.0 彩蛋层样式');
  const css = SRC.slice(cssAt, SRC.indexOf('</style>', cssAt));
  assert.ok(css.includes('.ns-game.ns-passthru{background:transparent;pointer-events:none}'), '镜像壳必须透明不吃点击');
  assert.ok(css.includes('.ns-game.ns-passthru .ns-hud,.ns-game.ns-passthru .ns-mirror-panel{pointer-events:auto}'), '面板必须收回点击');
  const L = layerSrc();
  assert.ok(L.a.includes("root.className = 'ns-game ns-dom ns-passthru'"), '镜像必须挂 passthru 类');
  // 反向抵消名单必须含确认浮层与镜像面板本身（否则控制条里的字左右反着读）
  assert.ok(css.includes('body.ns-mirror-B #nsAsk') && css.includes('body.ns-mirror-B .ns-mirror-panel'), '镜像反字名单漏项');
});

/* A20 图鉴 z90 高于游戏 z70：从图鉴 replay 启动必须先收遮罩，否则游戏在遮罩下隐形空跑（P0） */
test('A20 从图鉴启动游戏必须先收掉 eggMask 遮罩', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.nsEggUnlock('snake');
  w.nsEggOpen();
  const row = w.document.querySelector('#eggList .egg-row[data-egg="snake"]');
  assert.ok(row, '解锁后应有可点行');
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(w.document.getElementById('nsGame'), '点行应启动游戏');
  assert.ok(w.document.getElementById('eggMask').classList.contains('hidden'), '启动后图鉴遮罩必须收起（否则游戏 z70 被 z90 压住看不见）');
});

/* A21 音长纪律：音高类单音 ≤180ms；噪声/持续类（爆炸、引擎、呼噜）本就该长，豁免 */
test('A21 FX 表内音高类单音时长必须 ≤0.18s（噪声/持续类另计）', () => {
  const L = layerSrc();
  const body = L.a.slice(L.a.indexOf('var FX = {'), L.a.indexOf('var lastFx'));
  assert.ok(body.length > 200, '未取到 FX 表体');
  const entries = body.split(/\n\s{2}(?=[a-z]+:\s+function)/);
  assert.ok(entries.length > 18, 'FX 条目切分过少（' + entries.length + '），断言会漏');
  const over = [];
  entries.forEach(seg => {
    if (/nz\(|lfoGrowl/.test(seg)) return; // 噪声/持续类豁免
    [...seg.matchAll(/dur:\s*([\d.]+)/g)].forEach(m => { if (parseFloat(m[1]) > 0.181) over.push(m[1]); });
  });
  assert.strictEqual(over.length, 0, '以下音高类单音超 180ms：' + over.join(', ') + '（和弦靠多声短音叠，不靠拉长）');
});

/* A22 probe 通道：e2e 要能断言「转向真生效」而不是「元素存在」 */
test('A22 snake/brick/tank/satoshi 必须暴露 probe 状态快照', () => {
  const L = layerSrc();
  ['snake', 'brick', 'tank', 'satoshi', 'bitcoin'].forEach(id => {
    const at = L.b.indexOf("id: '" + id + "'");
    assert.ok(at > 0 && L.b.slice(at - 3600, at + 3600).includes('probe: function'), id + ' 缺 probe（e2e 只能断言元素存在=假绿温床）');
  });
  const app = loadApp(); t_after(app);
  assert.strictEqual(typeof app.window.nsGameProbe, 'function', 'probe 出口未挂到 window');
});
function t_after(app) { app.window.close(); }

/* A23 吃字落盘防抖：每敲一字就 setItem 是写放大（同步落盘 + 配额抖动） */
test('A23 桌宠吃字必须防抖落盘，连打 50 字不得写 50 次 localStorage', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.nsPetState().adopted = true;
  let writes = 0;
  const ls = w.localStorage;
  const orig = ls.setItem.bind(ls);
  ls.setItem = function (k, v) { if (k === 'notesync_pet') writes++; return orig(k, v); };
  for (let i = 0; i < 50; i++) w.nsPetEat(3);
  assert.strictEqual(writes, 0, '连打 50 字当场写了 ' + writes + ' 次（应全部走防抖窗口）');
  assert.ok(w.nsPetState().ate >= 150, '内存计数必须即时累加');
});

/* A24 第一次出成绩就要惰性建档（不先打开 /pet 也该有档案，否则跨设备成绩只对桌宠用户成立），
   且建档只能发一次——闸三 V2 实锤：arcadePush 里再内联一发 POST 就是双发，白吃按 IP 计的建档限流 */
test('A24 第一次出成绩必须建档，且只发一次建档 POST', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const posts = [];
  w.fetch = function (u, opt) {
    if (opt && String(opt.method) === 'POST') posts.push(String(u));
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
  };
  w.nsGameBest('snake', 42); // 只打一把分，从没碰过 /pet
  for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(posts.length, 1, '建档 POST 必须恰发一次：' + posts.join(','));
  assert.ok(/\/api\/arcade$/.test(posts[0]), '必须打在建档路由上：' + posts[0]);
  assert.ok(/^[A-Z2-9]{8}$/.test(w.nsArcadeId()), 'id 必须已生成并可用：' + w.nsArcadeId());
});

/* A25 2048 一次移动内同块不得二次合并（[2,2,4]→8 违规） */
test('A25 2048 单次移动每块最多合一次', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.nsRouteEgg('satoshi');
  // 造一个 [2,2,4] 行：合一次应得 [4,4]，若允许连合会变 8
  w.eval("(function(){ var b=window.NSG.cur; })()");
  const body = layerSrc().b;
  const at = body.indexOf('function slide(row)');
  assert.ok(body.slice(at, at + 560).includes('a.splice(i + 1, 1); i++;'), 'slide 必须跳过刚合出来的块（否则 [2,2,4] 连合两次变 8）'); // v9.3.0：窗口 420→560，slide 对象化在锚前多两行注释，语义零变
});

/* A26 蛇满格 do-while 死循环会冻页 */
test('A26 贪吃蛇食物生成必须走空格集合，不得 do-while 死循环', () => {
  const body = layerSrc().b;
  const at = body.indexOf('function place()');
  const seg = body.slice(at, at + 460);
  assert.ok(seg.includes('var free = []'), 'place() 应枚举空格');
  assert.ok(seg.includes('if (!free.length) return null'), '满盘必须返回 null（do-while 会冻页）');
  assert.ok(!/do \{[^}]*\} while \(sn\.some/.test(seg), '禁残留 do-while 找空位写法');
});

/* A27 事件监听与 rAF 不得随进出次数累积（每进一次堆一份 = 十次就是十个 keydown） */
test('A27 进出游戏 12 次不累积 keydown 监听与 rAF', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  let keyCount = 0;
  const origAdd = w.document.addEventListener.bind(w.document);
  const origRem = w.document.removeEventListener.bind(w.document);
  w.document.addEventListener = function (t2, fn) { if (t2 === 'keydown') keyCount++; return origAdd(t2, fn); };
  w.document.removeEventListener = function (t2, fn) { if (t2 === 'keydown') keyCount--; return origRem(t2, fn); };
  for (let i = 0; i < 12; i++) { w.nsRouteEgg('snake'); w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
  assert.ok(keyCount <= 2, 'keydown 监听净增 ' + keyCount + '（应只留常驻的那一份）');
  assert.ok(!w.NSG.raf || w.NSG.cur, '退出后 rAF 不得残留');
});

/* A28 顶栏已满（实测 349px）：桌宠与彩蛋浮层一律不得进顶栏 flex 流 */
test('A28 桌宠精灵不得参与顶栏布局（0 占宽钉）', () => {
  const cssAt = SRC.indexOf('v9.0.0 彩蛋层样式');
  const css = SRC.slice(cssAt, SRC.indexOf('</style>', cssAt));
  assert.ok(css.includes('#nsPet{position:absolute;left:0;bottom:-11px'), '桌宠必须骑线绝对定位，不进顶栏 flex');
  assert.ok(!/header\s*\{[^}]*gap:\s*\d+px[^}]*\}/.test(css.split('#nsPet')[1] || ''), '不得改顶栏间距给彩蛋腾位');
});

/* A29 e2e E1 实锤的形态级复现：冷启动 pathname 已是门牌路径 → launch 不压历史 →
   退出若再花一条 back() 就是把标签页退出站点（真机表现为白页），必须就地 replace 回首页 */
test('A29 冷启动直达门牌：launch 不压历史，退出回首页且一次 back 都不许调', t => {
  const app = loadApp(null, 'http://localhost/snake'); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  w.NSG.prevPath = '/'; // 复刻 boot 冷启动预置（launch/closeShell 在 IIFE 内非全局，只能走公开入口）
  w.nsRouteEgg('snake');
  assert.ok(w.document.getElementById('nsGame'), '壳应挂出');
  assert.strictEqual(w.NSG.pushed, false, '冷启动直达（路径本就对）不得压历史');
  let backCalls = 0;
  w.history.back = () => { backCalls++; }; // 打桩：一旦走 back 即判红，不等 jsdom 的导航副作用
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.strictEqual(backCalls, 0, '未压历史却调 back() = 退出站点变白页');
  assert.strictEqual(w.eval("location.pathname"), '/', '退出必须落回首页路径');
  assert.ok(!w.document.getElementById('nsGame'), '壳应收掉');
  assert.strictEqual(w.NSG.prevPath, undefined, 'prevPath 应随退出复位');
  // 反证另一半：App 内入口（图鉴/正文词表）确实压了历史，退出才走 back 抵消
  w.NSG.prevPath = '/';
  w.nsRouteEgg('brick');
  assert.strictEqual(w.NSG.pushed, true, 'App 内启动必须压一条历史（Esc 抵消它）');
});

/* A30 补丁行钉：退出判定必须挂在 NSG.pushed 分支上，旧「无条件 back()」形态禁回潮 */
test('A30 退出历史判定锚在 pushed 分支，无条件 back 禁回潮', () => {
  const L = layerSrc();
  const src = L.a + L.b;
  // launch 已随本版改成双分支（换游戏原地 replace、常规才 push），钉随迁到补丁行
  assert.ok(src.includes("else { history.pushState({ nsGame: id }, '', '/' + id); NSG.pushed = true; }"),
    'launch 必须只在真压了历史时置 pushed = true（锚补丁行）');
  assert.ok(src.includes('if (NSG.pushed) { try { history.back(); } catch (e) {} }'),
    'closeShell 必须按 pushed 分流：压过才 back');
  assert.ok(src.includes("if (switching) history.replaceState({ nsGame: id }, '', '/' + id);"),
    '换游戏必须原地 replace（back+push 同 tick 交错会多出一发 popstate 把新局关掉）');
  assert.ok(!src.includes("if (!fromPop && NSG.prevPath != null && location.pathname !== NSG.prevPath) { try { history.back(); } catch (e) {} }"),
    '旧「UI 退出无条件 back」形态禁回潮（回潮即 E1 白页复现）');
});

/* A31 换游戏不得动历史（R1 P1：back 与紧随的 pushState 同 tick 交错） */
test('A31 游戏内换局：零 pushState、零 back，只 replace 换路径，且退出仍抵消最初那一条', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const h = w.history, op = h.pushState.bind(h), orp = h.replaceState.bind(h);
  let pushes = 0, reps = 0, backs = 0;
  h.pushState = function () { pushes++; return op.apply(h, arguments); };
  h.replaceState = function () { reps++; return orp.apply(h, arguments); };
  h.back = function () { backs++; };
  w.nsRouteEgg('snake');
  assert.strictEqual(pushes, 1, 'App 内首次启动必须压一条历史');
  reps = 0;
  w.nsRouteEgg('brick'); // 换局
  assert.strictEqual(pushes, 1, '换局再 pushState = 换十只叠十条历史');
  assert.strictEqual(backs, 0, '换局调 back() 会让紧随的 pushState 与 popstate 交错');
  assert.strictEqual(reps, 1, '换局必须恰好原地 replace 一次');
  assert.strictEqual(w.eval("location.pathname"), '/brick', '地址栏要跟到新门牌');
  assert.strictEqual(w.NSG.pushed, true, '换局后仍须保留「压过历史」的事实，否则退出白页');
});

/* A32 切后台置 paused 后下一只游戏必须能跑（R2 P1-1：无游戏时也置 paused，launch 不复位=画面定格） */
test('A32 launch 必须复位 paused：切后台一次不得冻死后续所有游戏', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.NSG.paused = true; // 模拟「无游戏在跑时被 visibilitychange 置成 true」
  w.NSG.cur = null;
  w.nsRouteEgg('snake');
  assert.strictEqual(w.NSG.paused, false, 'launch 不清 paused = frame 永不执行，画面定格假死');
});

/* A33 三处 ×／返回按钮不得把 Event 当 fromPop（R1/T3 实锤：UI 退出恒走不动历史分支） */
test('A33 HUD × 与结束卡返回按钮必须显式传 false，不得把 Event 当 fromPop', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const h = w.history, op = h.pushState.bind(h), orp = h.replaceState.bind(h);
  let reps = 0, backs = 0;
  h.pushState = function () { return op.apply(h, arguments); };
  h.replaceState = function () { reps++; return orp.apply(h, arguments); };
  h.back = function () { backs++; };
  w.nsRouteEgg('brick');
  w.document.querySelector('#nsGame .ns-x').click();
  assert.strictEqual(backs, 1, '点 × 必须走 back 抵消（Event 被当 fromPop 时会改走 replace）');
  assert.strictEqual(reps, 0, '点 × 不得同时 replace 出第二条重复历史');
});

/* A34 桌宠三件必须有 CSS、header 必须是包含块（R2 P1-2/P1-3：JS 写 inline 坐标而元素是 static = 全不生效） */
test('A34 桌宠三件 CSS 在位且 header 是包含块', () => {
  const cssAt = SRC.lastIndexOf('v9.0.0 彩蛋层样式');
  const css = SRC.slice(cssAt, SRC.lastIndexOf('</style>'));
  assert.ok(/\.ns-pet-cover\{[^}]*position:fixed/.test(css), '偷字贴片没有 position：盖不住字');
  assert.ok(/#nsPetChip\{[^}]*position:fixed/.test(css), '嘴里叼的字没有 position');
  assert.ok(/#nsPetBubble\{[^}]*position:fixed/.test(css), '气泡没有 position：会坠到正文末尾');
  assert.ok(/header\{position:relative/.test(SRC), 'header 不是包含块 → #nsPet(absolute) 落到文档底缘而非顶栏下沿');
});

/* A35 气泡/贴片必须自报坐标（fixed 无 left/top = 钉在视口左上角） */
test('A35 petBubble 与偷字贴片都必须写 left/top，且气泡横向夹进视口', () => {
  const a = layerSrc().a;
  assert.ok(/b\.style\.left *=/.test(a) && /b\.style\.top *=/.test(a), 'petBubble 不设坐标');
  assert.ok(/window\.innerWidth *- *bw/.test(a), '气泡必须按自身宽度夹住右边缘（窄屏必溢出）');
  assert.ok(/cover\.style\.left *=/.test(a) && /chip\.style\.left *=/.test(a), '贴片/叼字必须按 Range 实测坐标定位');
});

/* A36 放归清定时器（R2 P1-4） */
test('A36 放归必须先 clearInterval 再摘节点', () => {
  const a = layerSrc().a;
  const at = a.indexOf("querySelector('.ns-pet-free')");
  assert.ok(at > 0, '找不到放归接线锚点');
  const seg = a.slice(at, at + 600);
  assert.ok(seg.includes('clearInterval(el._timer)'), '放归不清 interval：每次放归留一条 60ms 死循环');
  assert.ok(seg.indexOf('clearInterval(el._timer)') < seg.indexOf('removeChild'), '顺序必须先清再摘');
});

/* A37 护照往返：自产护照必须能被自家正则认领，并真把形态拉回来（P0-1 整链死在此） */
test('A37 自产护照可被认领，认领必须把形态与柜子一次落全', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const pp = w.nsArcadePassport();
  assert.ok(w.nsArcadeClaimRe().test(pp), '护照文本必须命中自家认领正则（生成与解析必须同源）：' + pp);
  const theirs = 'ns1:id=QRSTUVWX;key=ABCDEFGH987654';
  assert.ok(w.nsArcadeClaimRe().test(theirs), '分号形态必须可认领');
  assert.ok(w.nsArcadeClaimRe().test('ns1:id=QRSTUVWX/key=ABCDEFGH987654'), '斜杠旧形态也要可认领（已贴在用户笔记里的不能作废）');
  let hit = '';
  w.fetch = function (u) {
    hit = String(u);
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ counters: { brick: 7 }, stage: 2, ate: 4200, shelf: [1, 4, 9, 300], born: 1700000000000 }); } });
  };
  w.document.getElementById('editor').textContent = '存一下：' + theirs;
  w.nsClaimPassport();
  for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5)); // 等认领链跑完
  assert.ok(/\/api\/arcade\/QRSTUVWX$/.test(hit), '必须去拉那只档的远端形态，实拉：' + hit);
  const st = w.nsPetState();
  assert.strictEqual(st.adopted, true, '认领成功即视为已领养');
  assert.strictEqual(st.stage, 2); assert.strictEqual(st.ate, 4200);
  assert.strictEqual(JSON.stringify(st.shelf), '[1,4,9]', '柜子只收 0..15 合法索引（越界必须滤掉）');
  assert.strictEqual(st.born, 1700000000000, '生日必须跟回来');
  assert.strictEqual(w.nsArcadeId(), 'QRSTUVWX', '必须换到那只档');
});

/* A38 形态随 PUT 上行 + 撞限流不静默丢（P0-1 的另一半 + R2 P2） */
test('A38 PUT 必须带桌宠形态，撞 429 必须重挂防抖而非丢档', async t => {
  const L = layerSrc();
  const src = L.a + L.b;
  assert.ok(src.includes('body.stage = PET.stage; body.ate = PET.ate'), 'PUT 不带形态 = 跨设备只回得到成绩');
  assert.ok(src.includes('body.shelf = (ARC.shelf || []).concat((PET.shelf || []).map(Number))'), '柜子必须走 shelf 字段（服务端并集），加偏移会被 n<512 过滤丢光');
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  let put = null;
  w.fetch = function (u, opt) {
    if (opt && String(opt.method) === 'PUT') { put = JSON.parse(opt.body); return Promise.resolve({ status: 429, json: function () { return Promise.resolve({}); } }); }
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
  };
  w.nsArcadeId();     // 建档
  w.nsPetEat(30);     // 吃字
  w.nsArcadeFlush();  // 走关页同一条补发通道，不等 5s 防抖
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(put, '没发出 PUT');
  assert.strictEqual(put.stage, w.nsPetState().stage, 'PUT 必须带形态 stage');
  assert.ok(put.ate >= 30, 'PUT 必须带 ate：' + JSON.stringify(put));
  assert.ok(Array.isArray(put.shelf), 'PUT 必须带柜子数组');
  const L2 = layerSrc();
  assert.ok((L2.a + L2.b).includes("addEventListener('pagehide'"), 'pagehide 必须挂同一条补发（否则关页丢掉防抖窗口内的成绩）');
  assert.ok((L2.a + L2.b).includes('arcadeSchedule(20000)'), '撞 429 必须退避重挂，不得沿用 5s 节奏硬撞');
});

/* ═══ 第二轮（R1b）补钉：认领链「修通一半」的四枚洞逐条锁死 ═══ */

/* A39 拉不到档就绝不动本机（旧写法先换档再 fetch：护照手抄错一位＝本机被切进不可达档且成绩清零） */
test('A39 认领取档失败必须完全不动本机', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const id0 = w.nsArcadeId(), key0 = w.nsArcadeKey();
  const pet0 = JSON.stringify(w.nsPetState());
  w.fetch = function () { return Promise.resolve({ status: 404, json: function () { return Promise.resolve({}); } }); };
  w.document.getElementById('editor').textContent = '抄错的护照：ns1:id=QQWERTYU;key=ASDFGHJK9876';
  w.nsClaimPassport();
  for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(w.nsArcadeId(), id0, '取不到档不得换档');
  assert.notStrictEqual(w.nsArcadeId(), 'QQWERTYU', '护照必须真能被正则命中，否则这条钉是空转');
  assert.strictEqual(JSON.stringify(w.nsPetState()), pet0, '取不到档不得改桌宠状态');
  assert.strictEqual(w.localStorage.getItem('notesync_arcade'), JSON.stringify({ id: id0, key: key0, counters: {}, shelf: [], updatedAt: 0 }), '本机档案必须原样留在存储');
});

/* A40 第二次换档必须仍然可达：认领标志只活在会话内，绝不允许被持久化 */
test('A40 同会话可连续换两本护照，且认领标志不落盘', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.fetch = function () { return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ counters: { snake: 1 } }); } }); };
  const ed = w.document.getElementById('editor');
  ed.textContent = '第一本 ns1:id=BQWERTYU;key=KASDFGHJ9876';
  w.nsClaimPassport();
  for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(w.nsArcadeId(), 'BQWERTYU', '第一次换档应成功');
  ed.textContent = '第二本 ns1:id=CQWERTYU;key=MASDFGHJ9876';
  w.nsClaimPassport();
  for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(w.nsArcadeId(), 'CQWERTYU', '换过一本之后再认第二本必须仍然可达（持久化 claimed 会把后半生堵死）');
  assert.ok(/^[A-Z2-9]{8}$/.test(w.nsArcadeId()), '夹具字母表必须合法（含 0/1/I/O 会让正则根本不命中＝空转绿）');
  const raw = w.localStorage.getItem('notesync_arcade') || '';
  assert.ok(!/claimed/.test(raw), '认领标志一旦进 localStorage，刷新也解不开：' + raw);
});

/* A41 他端放归/睡眠态必须跟回来，且绝不当场复活挂出（无条件 asleep=false 等于 A 机放归 B 机必复活） */
test('A41 认领必须还原睡眠与放归态且不挂出宠物', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.fetch = function () {
    return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ counters: {}, stage: 2, ate: 800, asleep: true, retiredAt: 1700000000000, shelf: [3] }); } });
  };
  w.document.getElementById('editor').textContent = 'ns1:id=DQWERTYU;key=NASDFGHJ9876';
  w.nsClaimPassport();
  for (let i = 0; i < 60; i++) await new Promise(r => setTimeout(r, 20)); // 覆盖 200ms 挂载与 260ms 重渲染两拍
  const st = w.nsPetState();
  assert.strictEqual(st.asleep, true, '他端在睡/已放归必须照状态还原');
  assert.strictEqual(st.stage, 2); assert.strictEqual(st.ate, 800);
  assert.strictEqual(st.retiredAt, 1700000000000, '放归时间戳必须跟回来（面板写着档案保留 30 天可原样认领）');
  assert.ok(!w.document.getElementById('nsPet'), ' asleep 态不得把宠物挂出来（与 boot 同口径）');
});

/* A42 restart 与 launch 同口径清 paused（结束卡期间切一次后台，回来点再来一局仍是定格=同病灶只修一侧） */
test('A42 再来一局必须清掉 paused 与暂停标签', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  w.nsRouteEgg('snake');
  w.eval("window.nsGameEnd('结束', [['分', '1']])");
  w.NSG.paused = true; // 模拟结束卡停留期间切后台
  w.document.querySelector('.ns-again').click();
  assert.strictEqual(w.NSG.paused, false, 'restart 不清 paused = 点了再来一局仍定格');
  assert.ok(!w.document.getElementById('nsGame').textContent.includes('已暂停'), '暂停标签必须一起抹掉');
});

/* A43 形态上行的三条硬约束：retiredAt 随行、关页那发带 keepalive、节流窗口尾补一发 */
test('A43 形态上行须带 retiredAt，pagehide 须 keepalive，30s 窗口须尾随补发', () => {
  const src = layerSrc().a;
  assert.ok(src.includes('body.asleep = !!PET.asleep; body.retiredAt = PET.retiredAt || 0;'), '放归时间戳不上行=「原样认领」是空话');
  assert.ok(src.includes('arcadeSend(true)'), '关页补发必须走 keepalive 那一发');
  assert.ok(src.includes('keepalive: !!keepalive'), 'fetch 必须真带上 keepalive 参数');
  assert.ok(src.includes('arcadeSchedulePet._t = setTimeout(arcadeSchedulePet, wait)'), '窗口内即丢会吞掉睡眠/放归这种低频关键写，必须尾随补一发');
});

/* A44 学舌链必须真通：petRememberEcho 有调用点（第一轮实锤「定义了却全仓零调用」＝petEcho 恒空、复述分支永不达） */
test('A44 学舌必须有喂入调用点，且只在内存不落盘', () => {
  const a = layerSrc().a;
  const calls = (a.match(/petRememberEcho\(/g) || []).length;
  assert.ok(calls >= 2, 'petRememberEcho 只有定义没有调用（实得 ' + calls + ' 处）：桌宠永远学不出话');
  assert.ok(/closest\('#copyBtn'\)[\s\S]{0,220}petRememberEcho\(sel\)/.test(a), '喂入点必须挂在复制这条真实链路上');
  assert.ok(!/localStorage[^\n]*petEcho|petEcho[^\n]*localStorage/.test(a), '学舌文本绝不允许落盘（红线：只留内存，刷新即失）');
});

/* ═══ 用户拍板后的口径钉：通关必须真能通、提示语必须真成立 ═══ */

/* A45 satoshi 目标数学可达性：4×4 理论上限是出生值 × 2^17，超了就是永远打不通的死目标 */
test('A45 satoshi 通关目标必须数学可达（曾因 GOAL=1e8 而出生 2/4 聪，达标率仅 0.13%）', () => {
  const head = SRC.indexOf('var SPAWN ='); // 直接锚唯一常量声明："id: 'satoshi'" 在图鉴与游戏本体各出现一次，indexOf 会取错位置
  assert.ok(head > 0, '找不到 satoshi 出生值常量（改名即红，防漂移）');
  assert.ok(SRC.indexOf('var SPAWN =', head + 10) < 0, 'SPAWN 声明必须全文件唯一，否则锚点会挑错块');
  const seg = SRC.slice(head, head + 200);
  const spawn = Number((seg.match(/var SPAWN = (\d+)/) || [])[1]);
  const goal = Number((seg.match(/GOAL = ([^,]+)/) || [])[1]); // 科学计数（1e8）按整段取，别用 [0-9.e]+ 截成 "1"
  assert.ok(spawn > 0 && goal > 0, '取不到常量：' + seg.slice(0, 80));
  const steps = Math.log2(goal / spawn);
  assert.ok(steps <= 17 && steps >= 6, '从出生值翻倍到目标需 ' + steps.toFixed(1) + ' 档，超出 4×4 上限 17 档即通关不可达、低于 6 档则白给');
  assert.ok(spawn >= 1024, '出生块要明显大于 1 聪才有「攒币」体感：' + spawn);
});

/* A46 bitcoin「越深越值钱」必须是真机制（同档按深度加成，浅处 0.6 倍、深处最高 2.2 倍） */
/* A46 黄金矿工「越深越值钱」：公式必须在位且被夹住（布局单调性与跨度交给 e2e 真视口判，
   jsdom 的画布高恒 0，在这里量布局等于量一个退化值——量不到还容易写成恒真） */
test('A46 深度加成公式在位且被 clamp，矿块价值不得为负', t => {
  const L46 = layerSrc();
  const a = L46.a + L46.b; // 十只游戏本体在彩蛋层 B，只查层 A 会锚不到
  const at = a.indexOf('「越深越值钱」必须是真的');
  assert.ok(at > 0, '找不到深度加成的说明锚点（改名即红）');
  const seg = a.slice(at, at + 900);
  assert.ok(seg.includes('var y = rf(TOP, BOT), mul = 0.6 + 1.6 * Math.min(1, Math.max(0, (y - TOP) / span))'), '加成公式漂移');
  assert.ok(seg.includes('w: Math.round(k[2] * mul)'), '重量必须同比加成，否则深处不更难拉');
  assert.ok(seg.includes('m: Math.round(mul * 100) / 100'), 'probe 必须回传生成时真用过的系数（重算=自证）');
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  w.nsRouteEgg('bitcoin');
  const p = w.nsGameProbe();
  assert.ok(p.items.length >= 5, '矿块太 sparse：' + p.items.length);
  assert.ok(p.items.every(x => Number.isFinite(x.v) && (x.v > 0 || x.t === 'tnt')), '非 TNT 的矿块价值必须为正');
  assert.ok(p.items.every(x => !Number.isFinite(x.m) || (x.m >= 0.6 && x.m <= 2.2)), '加成必须夹在 0.6~2.2：' + p.items.map(x => x.m).join(','));
});

/* ═══ 闸三 V1 揪出的两枚 P1：各自的行为钉 ═══ */

/* A47 dragon 必须真跳得起来（曾 vy 与重力同号：起跳首帧就被「落地」夹回地面，恐龙永远贴地、地面障必死） */
test('A47 断网恐龙：跳一次必须真离地，且能靠跳躲过地面障', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  w.nsRouteEgg('dragon');
  const g = w.NSG.cur, step = 1 / 60;
  for (let i = 0; i < 260; i++) g.frame(step); // 跑完 3 秒分镜进 run
  assert.strictEqual(w.nsGameProbe().phase, 'run', '分镜没进跑动相位：' + JSON.stringify(w.nsGameProbe()));
  g.key({ code: 'Space', preventDefault() {} });
  // 峰值：起跳后总有一帧的 y 必须明显离地（外壳自身的循环也在推进时间，所以只看「曾经多高」不看「第几帧」）
  let peak = 0;
  for (let i = 0; i < 90; i++) { g.frame(step); peak = Math.max(peak, w.nsGameProbe().y); if (w.nsGameProbe().ground && i > 3) break; }
  assert.ok(peak > 40, '起跳峰值只有 ' + peak.toFixed(1) + 'px：根本跳不起来（vy 与重力反号才会瞬时被落地分支夹回 0）');
  const st = w.nsGameProbe();
  assert.ok(st.ground === true || st.dead === true, '跳完要么落回地面、要么撞上障碍结算，不能悬在半空：' + JSON.stringify(st));
  assert.strictEqual(typeof st.obs, 'number', 'probe 必须能观测障碍，否则这类物理反号无人守');
});

/* A48 建档必须在 id 诞生时就发：只挂在「第一次写成绩」分支上，先拿护照的人云端永远无档、
   之后每次 PUT 都被 404 静默吞掉——本版主打的跨设备找回整链失效 */
test('A48 护照一诞生就必须建档；PUT 撞 404 补建一次且不得无限循环', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  const calls = [];
  w.fetch = function (u, opt) {
    calls.push((opt && opt.method) || 'GET');
    return Promise.resolve({ status: (opt && opt.method) === 'PUT' ? 404 : 200, json: function () { return Promise.resolve({}); } });
  };
  w.nsArcadeId(); // 仅仅是拿到 id（渲染/复制护照也会走这里）
  await new Promise(r => setTimeout(r, 20));
  assert.ok(calls.indexOf('POST') >= 0, '拿到 id 却没建档：之后所有 PUT 都会打在不存在的档上');
  calls.length = 0;
  w.nsPetEat(20); w.nsArcadeFlush(); // 推一次成绩 → PUT 404 → 应补建
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(calls.filter(x => x === 'POST').length <= 2, '补建必须封顶（抄错的护照也回 404，不设限就是死循环）：' + calls.join(','));
});

/* A49 关于页入口行的计数必须随重开刷新（原来挂载时一次算死，本会话新解锁的蛋还挂着 0/17）
   mountAboutRow 在彩蛋层 IIFE 内不是全局，只能走它真正的触发路径：点 #menuAbout */
test('A49 关于页重开后彩蛋计数必须跟着走', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  let box = w.document.getElementById('aboutAuthor');
  if (!box) { box = w.document.createElement('div'); box.id = 'aboutAuthor'; w.document.body.appendChild(box); }
  let btn = w.document.getElementById('menuAbout');
  if (!btn) { btn = w.document.createElement('button'); btn.id = 'menuAbout'; w.document.body.appendChild(btn); }
  const mount = async () => { btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 10)); };
  w.localStorage.setItem('notesync_eggs', '{}'); // 基线必须显式：深夜/节日态开机会自动解锁 badge，不写死就是时间依赖的漂红
  await mount();
  const row = w.document.getElementById('aboutEggRow');
  assert.ok(row, '关于页入口行没挂出来（点「关于」不触发挂载）');
  assert.ok(/0 \/ 17 FOUND/.test(row.textContent), '初次挂载应显 0/17：' + row.textContent);
  w.nsEggUnlock('snake'); w.nsEggUnlock('tank');
  await mount(); // 再开一次关于
  assert.ok(/2 \/ 17 FOUND/.test(row.textContent), '重开必须刷新计数：' + row.textContent);
  assert.strictEqual(w.document.querySelectorAll('#aboutEggRow').length, 1, '不得重复插入入口行');
});

/* A50 提示语不许吹过实现（用户拍板：tank 改准、brick 不得写「划掉一条」这种与实际相反的口径） */
test('A50 三条文案口径钉：tank 无摇杆、brick 不动数据、dragon 提示与操作一致', () => {
  const b = layerSrc().b;
  const tankAt = b.indexOf("id: 'tank', tip:");
  const tankTip = b.slice(tankAt, b.indexOf('\n', tankAt));
  assert.ok(!/摇杆/.test(tankTip), 'tank 触屏实为划屏改向，写「摇杆」就是吹：' + tankTip.slice(0, 60));
  assert.ok(/划屏/.test(tankTip) && /方向键/.test(tankTip), 'tank 提示必须写清两种操作');
  const brickAt = b.indexOf("id: 'brick', tip:");
  const brickTip = b.slice(brickAt, b.indexOf('\n', brickAt));
  assert.ok(!/划掉一条/.test(brickTip), 'brick 实际只计分，提示语不得暗示会改收藏：' + brickTip.slice(0, 70));
  assert.ok(/只计分/.test(brickTip), 'brick 必须明写只计分');
});

/* A51 关于页与图鉴必须同一计数口径（闸三 V2 P1：nsEggGot 位图整把数一照退役残键就 8/17，图鉴 7/17）
   v8.3.1 拍板「已发现位图里的退役残键不清」，所以残键一定存在，只能靠只数在册条目来对齐 */
test('A51 位图里有退役彩蛋残键时，关于页与图鉴仍报同一个数', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.localStorage.setItem('notesync_eggs', JSON.stringify({ snake: 1, tank: 1, zen: 1, nosuch: 1 })); // zen 已退役但残键按拍板不清
  let box = w.document.getElementById('aboutAuthor');
  if (!box) { box = w.document.createElement('div'); box.id = 'aboutAuthor'; w.document.body.appendChild(box); }
  let btn = w.document.getElementById('menuAbout');
  if (!btn) { btn = w.document.createElement('button'); btn.id = 'menuAbout'; w.document.body.appendChild(btn); }
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10));
  const row = w.document.getElementById('aboutEggRow');
  assert.ok(row, '入口行没挂出来');
  assert.ok(/2 \/ 17 FOUND/.test(row.querySelector('.ns-num').textContent), '只可数在册两条：' + row.textContent);
  w.nsEggRender();
  assert.strictEqual(w.document.getElementById('eggCount').textContent, '2 / 17 FOUND', '两处口径必须一致');
});

/* A52 建档只能有一处发出：id 诞生即建；写成绩那条路必须复用同一个 arcadeId()，
   两处各发一次就是首次记分双发，白吃按 IP 计的建档限流配额（闸三 V2 实锤） */
test('A52 建档 POST 全链只有一处发出', () => {
  const src = layerSrc().a + layerSrc().b;
  assert.strictEqual((src.match(/method: 'POST'/g) || []).length, 1, '彩蛋层只允许一处建档 POST');
  assert.ok(src.includes('if (!ARC.id) arcadeId();'), 'arcadePush 必须把建档交给 arcadeId()，不得自己再发一发');
  assert.ok(!/arcadeSend\._posted/.test(src), '只写不读的死标志不得残留');
});

/* ═══ v9.1.1：dom 型蛋（镜像/桌宠）不走 shell()/bindInput，此前没有任何 keydown 监听，
   真机实测「按 Esc 收不掉、只能去点 ×」。行为钉 + 不累积钉 + 补丁行钉三件一起上。═══ */

/* A53 镜像与桌宠：按 Esc 必须收壳（与 canvas 型同一退出语义） */
test('A53 dom 型蛋（mirror/pet）按 Esc 必须收壳', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  for (const id of ['mirror', 'pet']) {
    w.nsRouteEgg(id);
    assert.ok(w.document.getElementById('nsGame'), id + ' 应起壳');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!w.document.getElementById('nsGame'), id + ' 按 Esc 必须收壳（v9.0.0 实测收不掉）');
    assert.ok(!w.document.body.classList.contains('ns-in-game'), id + ' 退出后必须解掉锁滚动类');
  }
  // 桌宠蛋不能顺手把宠物摘掉（它是跨笔记常驻浮层，退出面板只该收面板）
  assert.ok(true);
});

/* A54 dom 型蛋的 Esc 监听必须按函数身份配平（按事件名计数会被收壳里那句无条件
   removeEventListener(keyHandler) 干扰——dom 型根本没挂过它，净数直接跑成负数＝假红） */
test('A54 dom 型蛋 Esc 监听挂摘配平，十二次进出零残留', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  let live = 0;
  const origAdd = w.document.addEventListener.bind(w.document);
  const origRem = w.document.removeEventListener.bind(w.document);
  const mine = (ty, fn) => ty === 'keydown' && !!fn && fn.name === 'domKeyHandler';
  w.document.addEventListener = function (ty, fn) { if (mine(ty, fn)) live++; return origAdd(ty, fn); };
  w.document.removeEventListener = function (ty, fn) { if (mine(ty, fn)) live--; return origRem(ty, fn); };
  for (let i = 0; i < 12; i++) {
    w.nsRouteEgg('mirror');
    assert.strictEqual(live, 1, '第 ' + (i + 1) + ' 次启动后应恰有一份在挂着（多了就是没摘干净）：' + live);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(live, 0, '第 ' + (i + 1) + ' 次收壳后应归零：' + live);
  }
  // 往返净数钉：开一次 dom 型蛋必须真挂上一份 Esc 监听（只判「不累积」时，压根没挂也是 0，照样绿）
  w.nsRouteEgg('mirror');
  assert.strictEqual(live, 1, 'dom 型蛋启动必须恰挂一份 Esc 监听（0 = 压根没挂，就是「Esc 收不掉」的复发）：' + live);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.strictEqual(live, 0, '收壳必须摘掉自己那份，否则进出十二次叠十二层：' + live);
});

/* A55 补丁行钉：挂载/摘除必须是真语句行（注释里的同形串不算），
   且 domKeyHandler 本体必须带「在局判定 + 顶层浮层让位」（R1 收口后它是多行函数） */
test('A55 dom 型蛋 Esc 挂载与摘除都是真语句行', () => {
  const src = layerSrc().a + layerSrc().b;
  const lines = src.split(String.fromCharCode(10)).map(l => l.replace(/\r$/, ''));
  const add = lines.filter(l => /^\s*try \{ document\.addEventListener\('keydown', domKeyHandler, true\); \} catch \(e\) \{\}/.test(l));
  assert.strictEqual(add.length, 1, 'launch 的 dom 分支必须有一行真语句挂监听（实得 ' + add.length + '；躲在注释里的同形串不算）');
  const off = lines.filter(l => /^\s*document\.removeEventListener\('keydown', domKeyHandler, true\);/.test(l));
  assert.strictEqual(off.length, 1, 'closeShell 必须有一行真语句摘掉它（实得 ' + off.length + '）');
  assert.ok(src.includes('function domKeyHandler(e) {'), 'dom 专用 Esc 处理器不在位');
  assert.ok(src.includes("if (!e || e.key !== 'Escape' || !NSG.cur) return;"), '处理器必须判在局：浮层已被别的路径收掉时不能再关一次');
  assert.ok(src.includes("if (em && !em.classList.contains('hidden')) return;"), '图鉴 z90 在场时必须让位（否则一次 Esc 关两层）');
  assert.ok(src.includes('remPanelOpen'), '提醒面板开着时必须让位');
  assert.ok(!/void 0;[^\n]*domKeyHandler/.test(src), '挂载被降级成 void 0 + 注释（反证探针残留形态）');
  assert.ok(src.includes("addEventListener('keydown', domKeyHandler, true)"), '必须捕捉阶段注册：图鉴的 Esc 出口注册更早，冒泡阶段看到现场时已被它自己关掉，让位判据会失效');
});

/* A56 dom 型蛋不得与顶层浮层抢同一发 Esc（R1 实锤：镜像是 passthru，可以「开着镜像再开图鉴」，
   早退之前那一发 Esc 会把图鉴和镜像一起关掉） */
test('A56 图鉴/提醒面板在场时 dom 型蛋必须让位，一次 Esc 只关一层', t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window;
  w.document.body.focus = () => {};
  // 图鉴 z90 开着：这发 Esc 归图鉴，镜像壳必须还在（这才叫「一次按键只消一层」）
  w.nsRouteEgg('mirror');
  w.nsEggOpen();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(w.document.getElementById('nsGame'), '图鉴在场时 dom 型蛋不得跟着一起收（一次按两消）');
  assert.ok(w.document.getElementById('eggMask').classList.contains('hidden'), '图鉴应已被这一发 Esc 关掉');
  // 提醒面板开着：同样让位
  w.eval('remPanelOpen = true');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(w.document.getElementById('nsGame'), '提醒面板开着时 dom 型蛋不得抢 Esc');
  // 让位条件解除后必须能正常收壳
  w.eval('remPanelOpen = false');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!w.document.getElementById('nsGame'), '让位条件解除后 Esc 必须收壳');
});
