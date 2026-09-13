// NoteSync v8.3.0 彩蛋二单元测试：彩蛋图鉴 ?eggs / notesync 烟花 / 打字机音。
// 约定：纯函数（nsFwHit）钉语义；DOM 行为（图鉴渲染/烟花自清）走真 jsdom；
// 打字机音用假 AudioContext 计数（只统计 bandpass 与 oscillator，避开解锁静音 buffer 噪声）。
// v8.3.1：禅模式按用户令整体退役（B7/B8 改挂打字机音输入层驱动守护）；发声判据自 keydown
// 迁至 beforeinput 输入层（软键盘敲字符不发 keydown、桌面 IME 组字期字母被静默→旧通道只剩回车有声）。
// 铁律回归：color 只吃变量、浮层 pointer-events:none、绝不改正文 DOM。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
function fresh(pageUrl) {
  const dom = loadApp(null, pageUrl);
  return { dom, window: dom.window };
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function makeFakeAC() {
  const stat = { filters: 0, oscs: 0 };
  function AC() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  AC.prototype.createBuffer = function (ch, len) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; };
  AC.prototype.createBufferSource = function () { return { buffer: null, connect() {}, start() {}, stop() {} }; };
  AC.prototype.createGain = function () { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; };
  AC.prototype.createBiquadFilter = function () { stat.filters++; return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; };
  AC.prototype.createOscillator = function () { stat.oscs++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; };
  AC.prototype.resume = function () { return Promise.resolve(); };
  return { AC, stat };
}

// ── B1 图鉴：未发现=??? + locked；解锁后显名显提示 + 计数 ──
test('B1 图鉴渲染：未发现锁态显示 ???，解锁后显名与触发提示，计数同步', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.nsEggOpen();
  const rows = w.document.querySelectorAll('#eggList .egg-row');
  assert.strictEqual(rows.length, 7, '图鉴应有 7 个条目（v8.3.1 禅模式退役 8→7）');
  assert.ok([...rows].every(r => r.classList.contains('locked')), '全新用户全部为未发现锁态');
  assert.strictEqual([...rows][0].querySelector('.egg-name').textContent, '???', '未发现不得泄露彩蛋名');
  assert.strictEqual(w.document.getElementById('eggCount').textContent, '0 / 7 FOUND');
  w.nsEggUnlock('skin');
  w.nsEggUnlock('fw');
  w.nsEggRender();
  const again = [...w.document.querySelectorAll('#eggList .egg-row')];
  const skin = again.find(r => r.getAttribute('data-egg') === 'skin');
  assert.ok(!skin.classList.contains('locked'));
  assert.strictEqual(skin.querySelector('.egg-name').textContent, '复古皮肤');
  assert.strictEqual(skin.querySelector('.egg-hint').textContent, '连点左上角 logo 七次');
  assert.strictEqual(w.document.getElementById('eggCount').textContent, '2 / 7 FOUND');
  assert.ok(!w.document.getElementById('eggMask').classList.contains('hidden'), 'nsEggOpen 应打开面板');
});

// ── B2 图鉴：?eggs 直开；关闭三路径（X/按钮/点遮罩空白）──
test('B2 ?eggs 自动打开；X、关闭按钮、点遮罩空白三条路径都能收起', t => {
  const app = fresh('http://localhost/?eggs'); t.after(() => app.dom.window.close());
  const w = app.window;
  const m = w.document.getElementById('eggMask');
  assert.ok(!m.classList.contains('hidden'), '?eggs 应直开图鉴');
  w.document.getElementById('eggX').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(m.classList.contains('hidden'), 'X 应关闭');
  w.nsEggOpen();
  w.document.getElementById('eggClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(m.classList.contains('hidden'), '关闭按钮应生效');
  w.nsEggOpen();
  m.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.ok(m.classList.contains('hidden'), '点遮罩空白应关闭');
});

// ── B3 解锁进度持久化：只写 notesync_eggs 位图，不落任何笔记内容 ──
test('B3 解锁只写 localStorage notesync_eggs 位图；幂等；键名不含笔记/正文', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.nsEggUnlock('rain'); w.nsEggUnlock('rain'); w.nsEggUnlock('type');
  const raw = w.localStorage.getItem('notesync_eggs');
  assert.ok(raw, '应写入进度');
  const o = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(o).sort(), ['rain', 'type']);
  assert.ok(w.nsEggHas('rain') && !w.nsEggHas('skin'));
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = String(w.localStorage.key(i));
    assert.ok(!/ct|iv|html|body|content/i.test(k), '图鉴进度不得出现正文相关键：' + k);
  }
});

// ── B4 烟花纯函数：尾匹配 + 大小写不敏感 + 未成词静默 ──
test('B4 nsFwHit：notesync 尾命中（大小写不敏感），未成词/超尾静默', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  assert.ok(w.nsFwHit('notesync'));
  assert.ok(w.nsFwHit('试试 NOTESYNC'), '大写同样命中（手机上常开首字母大写）');
  assert.ok(w.nsFwHit('写点啥notesync'), '中文前缀后成词也命中');
  assert.ok(!w.nsFwHit('notesyn'), '少一个字母不命中');
  assert.ok(!w.nsFwHit('notesyncc'), '尾 8 位已不是 notesync');
  assert.ok(!w.nsFwHit('今天记一笔'), '普通文本静默');
  assert.ok(!w.nsFwHit(''));
});

// ── B5 烟花 DOM：20 金粒 + 按时自清 + 不改正文 ──
test('B5 nsFirework 放 20 粒并按期自清，正文一字不动', async t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  ed.textContent = '原文保持不动';
  const before = ed.textContent;
  w.nsFirework(120, 240);
  const fws = w.document.querySelectorAll('.ns-fw');
  assert.strictEqual(fws.length, 1);
  assert.strictEqual(fws[0].querySelectorAll('i').length, 20, '一束 20 粒');
  assert.strictEqual(ed.textContent, before, '烟花绝不得改动正文');
  assert.ok(w.nsEggHas('fw'), '放过烟花即记入图鉴');
  const t0 = Date.now();
  while (w.document.querySelectorAll('.ns-fw').length > 0) {
    if (Date.now() - t0 > 4000) assert.fail('烟花未在 1.5s+ 余量内自清');
    await wait(50);
  }
});

// ── B6 烟花 armed：敲出 notesync 只放一次，脱离词形再敲才二次（同数字梗跳变机）──
test('B6 输入触发：成词爆一次，持续成词连击不再爆，脱离后重入再爆', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  const fire = () => ed.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  const fws = () => w.document.querySelectorAll('.ns-fw').length;
  ed.textContent = 'notesync'; fire();
  assert.strictEqual(fws(), 1, '首次成词应放烟花');
  ed.textContent = 'notesync'; fire();
  assert.strictEqual(fws(), 1, '同一词形连击不得连放');
  ed.textContent = 'notesync啊'; fire();
  ed.textContent = 'notesync啊notesync'; fire();
  assert.strictEqual(fws(), 2, '脱离后重新成词应再放一次');
});

// ── B7 v8.3.1 输入层驱动：可见字符上屏必发声；删除/粘贴/替换/补全与编辑器外不响 ──
test('B7 打字机音改 beforeinput 驱动：insertText 发声；deleteBackward/粘贴/replace/补全零响；口令框零响', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  const bi = (type, target) => (target || ed).dispatchEvent(new w.InputEvent('beforeinput', { inputType: type, data: 'x', bubbles: true, cancelable: true }));
  w.nsSetSkin(2);
  bi('insertText');
  assert.strictEqual(fake.stat.filters, 1, '实体键/软键盘/IME 整词上屏共用 insertText 通道，必须发声（修复前软键盘敲字符只剩回声响）');
  bi('deleteBackward'); bi('deleteContentBackward');
  assert.strictEqual(fake.stat.filters, 1, '删除类不响——只响「打字」');
  bi('insertFromPaste'); bi('insertReplacementText'); bi('insertCompositionText'); bi('insertFromHistory');
  assert.strictEqual(fake.stat.filters, 1, '粘贴/系统替换/组字过程/历史补全不得误发');
  bi('insertText', w.document.getElementById('pw'));
  assert.strictEqual(fake.stat.filters, 1, '口令框打字零发声（与 keydown 通道同一编辑器判据）');
});

// ── B8 v8.3.1 回车双通道防重：物理回车 keydown 响铃后 insertParagraph 300ms 内吞击；软键盘 Enter（无 keydown）兜底出声 ──
test('B8 回车防重与兜底：keydown Enter+换行二击=一声一铃；纯 insertParagraph 走兜底通道', async t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  const key = (k) => ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const bi = (type) => ed.dispatchEvent(new w.InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true }));
  w.nsSetSkin(2);
  key('Enter');
  assert.strictEqual(fake.stat.filters, 1, '物理回车 keydown 出声');
  assert.strictEqual(fake.stat.oscs, 1, '物理回车带一声回车铃');
  bi('insertParagraph'); // 紧随其后的换行二击（jsdom 不自动派发，模拟 300ms 内到得最快的兜底通道）
  assert.strictEqual(fake.stat.filters, 1, '防重护栏：keydown 刚响过，insertParagraph 不得二击');
  assert.strictEqual(fake.stat.oscs, 1, '防重护栏：铃也不得双响');
  await wait(320); // 越过 300ms 防重窗
  bi('insertLineBreak'); // 软键盘 Shift+Enter 等不发 keydown Enter 的换行：兜底通道按回车（带回铃）
  assert.strictEqual(fake.stat.filters, 2, '无 keydown 前导时换行类兜底出声');
  assert.strictEqual(fake.stat.oscs, 2, '兜底换行=回车形态，带回铃');
});

// ── B9 v8.3.2 逐字母发声（冻时钟，人速 30ms/键）：keydown 字母出声、其 insertText 被 10ms 双通道去重、229 静默、回车带铃、静音归零 ──
test('B9 打字机音：默认皮肤零发声；逐字母 keydown 出声+insertText 同 tick 吞击；回车带铃；静音归零', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const realNow = w.Date.now;
  let vt = realNow.call(w.Date);
  w.Date.now = () => vt;
  const advance = (ms) => { vt += ms; };
  const ed = w.document.getElementById('editor');
  const key = (k, keyCode) => ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, keyCode: keyCode === undefined ? k.charCodeAt(0) : keyCode, bubbles: true }));
  const bi = (data) => ed.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'insertText', data: data, bubbles: true, cancelable: true }));
  w.nsSetSkin(0);
  key('a'); key('Enter'); bi('a');
  assert.strictEqual(fake.stat.filters, 0, '默认皮肤必须彻底静默（用户没主动进复古模式）');
  w.nsSetSkin(1);
  key('a');
  assert.strictEqual(fake.stat.filters, 1, 'v8.3.2：物理键/拼音组字期字母逐 keydown 出声（用户挑定逐字母节奏）');
  bi('a');
  assert.strictEqual(fake.stat.filters, 1, '双通道去重：紧随同字符 insertText（同 tick）吞击不两响');
  advance(30); key('p');
  assert.strictEqual(fake.stat.filters, 2, '下一字母（30ms 后人速节奏）再响一声');
  bi('p');
  assert.strictEqual(fake.stat.filters, 2, '其 insertText 被 10ms 双通道去重——拼音 pa 两键两声不多不少');
  advance(30); key('n', 229);
  assert.strictEqual(fake.stat.filters, 2, 'iOS 软键盘组字期 keyCode=229 静默（其声由 compositionend/insertText 通道承担）');
  advance(30); bi('b');
  assert.strictEqual(fake.stat.filters, 3, '软键盘/异字符 insertText 独立通道仍出声（30ms>24ms 节流）');
  advance(30); key('Enter');
  assert.strictEqual(fake.stat.filters, 4, '回车也应发声');
  assert.strictEqual(fake.stat.oscs, 1, '回车额外带一声回车铃（打字机灵魂）');
  assert.ok(w.nsEggHas('type'), '发过声即记入图鉴');
  w.nsTyMuteSet(true);
  const f = fake.stat.filters;
  advance(30); key('c'); advance(30); key('Enter'); advance(30); bi('c');
  assert.strictEqual(fake.stat.filters, f, '静音后不得再发声');
  assert.strictEqual(w.localStorage.getItem('notesync_tymute'), '1', '静音开关持久化');
  w.nsTyToggle();
  assert.strictEqual(w.localStorage.getItem('notesync_tymute'), '0', '再切回开声');
  w.Date.now = realNow;
});

// ── B10 打字机音：节流（24ms 内连击只出一声）+ 非编辑器输入不响 ──
test('B10 节流与输入源过滤：极速连击只响一次；口令框打字零发声', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  const bi = (target) => (target || ed).dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }));
  w.nsSetSkin(2);
  for (let i = 0; i < 6; i++) bi();
  assert.strictEqual(fake.stat.filters, 1, '24ms 节流窗内连击只出一声（不糊成一片）');
  const f = fake.stat.filters;
  bi(w.document.getElementById('pw'));
  assert.strictEqual(fake.stat.filters, f, '非编辑器输入不得发声');
});

// ── B11 埋点：皮肤/雨/粒子/徽章各自触发即记入图鉴 ──
test('B11 四个旧彩蛋埋点：换肤、起雨、数字粒子、徽章挂出各记一次', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.nsSetSkin(1);
  assert.ok(w.nsEggHas('skin'));
  w.nsSetSkin(0);
  assert.ok(w.nsEggHas('skin'), '回默认不撤销已发现');
  w.nsRainStart('cj', 200);
  assert.ok(w.nsEggHas('rain'));
  w.nsBurst(10, 10, '🔥');
  assert.ok(w.nsEggHas('num'));
  w.eval('window.__origBadgeAt = nsBadgeAt; nsBadgeAt = function(){ return NS_FEST_META.night; };');
  try {
    w.eval("document.getElementById('nsBadge').setAttribute('data-ns','');");
    w.updateNsBadge();
    assert.ok(w.nsEggHas('badge'), '徽章真的挂出来才算发现');
  } finally { w.eval('nsBadgeAt = window.__origBadgeAt;'); }
  w.nsRainStart('night', 200); // 深夜无雨：不算发现雨（此时 rain 早已解锁，只验不抛错）
});

// ── B12 图鉴 replay：已发现行可点，且各自只做自己的事 ──
test('B12 图鉴 replay：点「Notesync 烟花」行放烟花；锁态行无点击能力', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.nsEggUnlock('fw');
  w.nsEggRender();
  const row = [...w.document.querySelectorAll('#eggList .egg-row')].find(r => r.getAttribute('data-egg') === 'fw');
  assert.strictEqual(row.getAttribute('role'), 'button', '已发现且可再玩的行应为可点按钮');
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(w.document.querySelectorAll('.ns-fw').length, 1, '点行应放一束烟花');
  const locked = [...w.document.querySelectorAll('#eggList .egg-row')].find(r => r.getAttribute('data-egg') === 'diag');
  assert.strictEqual(locked.getAttribute('role'), null, '未发现行不得暴露为可点');
  assert.strictEqual(locked.querySelector('.egg-go'), null, '未发现行不得有再玩标记');
});

// ── B13 静态钉：配色只吃变量、浮层不抢焦点、版本号同步、图鉴条目数与常量一致 ──
test('B13 源码钉：新彩蛋零新色字面量 / 浮层 pointer-events:none / 版本 8.3.2 / 条目数一致', t => {
  assert.ok(SRC.includes("const APP_VERSION = '8.3.2';"), '版本号应随逐字母发声升到 8.3.2');
  assert.ok(SRC.includes("const NS_EGG_TOTAL = 7;"), '图鉴总数应随禅模式退役为 7');
  assert.ok(!SRC.includes('nsZen') && !SRC.includes('zenTip') && !SRC.includes("id: 'zen'"), '禅模式禁回潮：函数/DOM/图鉴条目三处字面量一律不得残留');
  assert.ok(SRC.includes("else if (e.key && e.key.length === 1) { tyKdAt = Date.now(); tyKdData = e.key; nsTypeSound('key'); }"), 'v8.3.2 用户挑定逐字母节奏：字符击键必须挂 keydown 发声且记占供双通道去重（撤销 v8.3.1 禁挂钉）');
  assert.ok(SRC.includes('location.search.indexOf(\'eggs\')'), '?eggs 通道在位');
  assert.ok(SRC.includes('.ns-fw{position:fixed;z-index:58;pointer-events:none}'), '烟花层不得抢焦点');
  assert.ok(SRC.includes('background:var(--accent)'), '烟花粒子吃 --accent，不引新色');
  const app = fresh(); t.after(() => app.dom.window.close());
  // 顶层 const 不挂 window（本项目已知铁律），取值一律走 eval
  assert.strictEqual(app.window.eval('NS_EGG_LIST.length'), app.window.eval('NS_EGG_TOTAL'), '图鉴条目数须与 NS_EGG_TOTAL 一致');
  assert.strictEqual(app.window.eval('NS_EGG_LIST.length'), 7);
});

// ── B14 闸 R1 P1①回归：深夜时刻开机，徽章挂出必须当场记入图鉴（TDZ 吞错钉）+ 声明顺序静态钉 ──
test('B14 冻时 23 点开机：徽章埋点不再踩 TDZ，当次会话即入图鉴；NS_EGG_KEY 声明先于顶层 updateNsBadge()', t => {
  const dom = loadApp(w => {
    class FakeDate extends Date {
      constructor(...a) { if (a.length === 0) { super(2026, 0, 1, 23, 0, 0); } else { super(...a); } }
    }
    w.Date = FakeDate;
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  assert.strictEqual(w.eval("document.getElementById('nsBadge').getAttribute('data-ns')"), w.eval('NS_FEST_META.night.em + NS_FEST_META.night.tx'), '23 点开机徽章应挂出深夜态');
  assert.ok(w.nsEggHas('badge'), '开机即挂出的徽章必须记入图鉴（修复前：nsEggUnlock 早于 const NS_EGG_KEY，TDZ 抛错被 try/catch 吞）');
  assert.ok(SRC.indexOf('const NS_EGG_KEY') < SRC.indexOf('updateNsBadge();'), '声明顺序钉：图鉴键必须在首个顶层 updateNsBadge() 调用之前');
});

// ── B15 闸修字面量钉：五处补丁行各锚一条（改被守护行必同版改此钉——本仓红线）──
test('B15 闸修源码钉：关图鉴归还焦点 / eggMask z90 / 滤 e.repeat / tyNoise 绑 ctx / type replay 点播', () => {
  assert.ok(SRC.includes("function nsEggClose() { try { document.getElementById('eggMask').classList.add('hidden'); } catch (e) {} if (CHIP_HOVER_OK) { try { editor.focus(); ensureCaret(); } catch (e) {} } }"), '红线10：关图鉴四路径必须归还编辑器焦点');
  assert.ok(SRC.includes('#eggMask{z-index:90}'), 'eggMask 必须与 menuMask 同层压过 landing(z30)，否则 ?eggs 直开被锁屏页盖住');
  assert.ok(SRC.includes('if (e.repeat) return;'), '长按自动重复必须滤掉（否则 24ms 顶格连响）');
  assert.ok(SRC.includes('if (tyNoise && tyNoiseCtx === ctx) return tyNoise;'), '白噪声缓存必须绑定 ctx（跨 ctx buffer 抛错会被 catch 吞成永久消音）');
  assert.ok(SRC.includes("replay: () => nsTypeSound('enter', true)"), '打字机音「再玩一次」=点播示例音');
  assert.ok(!SRC.includes('replay: () => nsTyToggle()'), '禁回潮：replay 挂 toggle 会一点就静音，语义反向');
  assert.ok(SRC.includes('if (d && d === tyKdData && now - tyKdAt < 10) return;'), 'v8.3.2 补丁行钉：keydown↔beforeinput 双通道 10ms 去重在位（改被守护行必同版改此钉）');
  assert.ok(SRC.includes('if (e.keyCode === 229) return;'), 'v8.3.2 钉：iOS 软键盘组字期精准静默（keyCode 229），非一刀切挡 Blink 逐字母');
  assert.ok(!SRC.includes('if (e.isComposing) return;'), 'v8.3.2 评审 P1 禁现钉：beforeinput 不得再挂 e.isComposing 早退（安卓/国产内核 commit 的 insertText 全带该标记，挡=移动上屏声全哑；桌面双响另有 10ms 去重）');
  assert.ok(SRC.includes('tyEnterAt = now; // 闸 R2 P1②：兜底响过即占住防重窗，软键盘连打两次回车不叠双铃'), 'v8.3.1 闸R2 P1② 钉：换行兜底出声必回写防重窗');
  assert.ok(SRC.includes('if (now - tyCompAt < 60) return;'), 'v8.3.1 闸R2 P1① 钉：compositionend 兜底后 insertText 双通道去重窗在位（闸二 R2 P2 收窄 120→60ms）');
  assert.ok(SRC.includes('if (d && d === tyLastData && now - tyLastDataAt < 50) { tyLastDataAt = now; return; }'), 'v8.3.1 闸二R2 P1 钉：beforeinput 长按同字符 auto-repeat 抑制在位且抑制时链式占窗（e.repeat 只守 keydown 通道，字符通道须自防）');
});

// ── B16 图鉴点播行为：皮肤外与静音下 force 仍响一声，且不篡改静音持久态 ──
test('B16 nsTypeSound force：图鉴点播绕皮肤/静音门各响一声，tymute 存储零污染', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.nsSetSkin(0);
  w.nsTypeSound('enter', true);
  assert.strictEqual(fake.stat.filters, 1, '默认皮肤外点播必须响（用户从图鉴点「再玩一次」就是要听）');
  assert.strictEqual(fake.stat.oscs, 1, '点播走 enter=带回车铃');
  w.nsTyMuteSet(true);
  const f = fake.stat.filters;
  w.nsTypeSound('enter', true);
  assert.strictEqual(fake.stat.filters, f + 1, '静音态下点播仍响');
  assert.strictEqual(w.localStorage.getItem('notesync_tymute'), '1', '点播不得顺手解除静音持久态');
  w.nsTyMuteSet(false);
  const f2 = fake.stat.filters;
  w.nsTypeSound('key');
  assert.strictEqual(fake.stat.filters, f2, '非点播（正常击键）早退门原样保留');
});

// ── B17 v8.3.1 闸R2 P1①回归：IME 整词上屏兜底通道——compositionend 出声；随后 insertText 60ms 窗去重；窗过恢复；组字期 insertText 双保险不响 ──
test('B17 IME 上屏兜底：compositionend 响一声；60ms 内 insertText 吞击；commit 形态 isComposing=true 的 insertText 出声（评审 P1 反转）', async t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  const bi = (opt) => ed.dispatchEvent(new w.InputEvent('beforeinput', Object.assign({ inputType: 'insertText', data: '词', bubbles: true, cancelable: true }, opt)));
  w.nsSetSkin(2);
  ed.dispatchEvent(new w.Event('compositionend', { bubbles: true })); // jsdom 无 CompositionEvent 构造器挂 isComposing，按既有铁律手派 Event；真机 Chromium 系该属性=undefined 通过防御门（闸二 R1/R3 CDP 探针实锤）
  assert.strictEqual(fake.stat.filters, 1, 'commit 不派 insertText 的内核：compositionend 兜底必须出声（修前中文打字整段哑火）');
  bi();
  assert.strictEqual(fake.stat.filters, 1, 'compositionend 刚兜过底：60ms 窗内 insertText 吞击不双响');
  ed.dispatchEvent(new w.Event('compositionend', { bubbles: true }));
  bi(); // 同词窗内再来一组兜底+上屏：仍一声（60ms 去重 + 24ms 节流 + 同字符 50ms 三窗内）
  assert.strictEqual(fake.stat.filters, 1, '去重窗与节流窗内连击总声不涨（词级节奏，不糊成一片）');
  await wait(200); // 同时越过 60ms 去重窗、50ms 连发窗与 24ms 节流窗（余量防并发饿红，TC13 教训）
  ed.dispatchEvent(new w.Event('compositionend', { bubbles: true }));
  assert.strictEqual(fake.stat.filters, 2, '窗过后下一词上屏再响一声');
  bi();
  assert.strictEqual(fake.stat.filters, 2, '该词双通道二击仍被吞（60ms 窗+同字符连发护栏双挡）');
  await wait(200);
  bi({ data: 'k' }); // 异字符：不踩同字符连发护栏，验纯窗过恢复
  assert.strictEqual(fake.stat.filters, 3, '窗过后英文直打 insertText 恢复发声');
  await wait(30); // 越过 24ms 节流（紧随 bi('k') 同 tick 出声会被节流吞，属预期）
  ed.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'insertText', data: 'q', bubbles: true, cancelable: true, isComposing: true }));
  assert.strictEqual(fake.stat.filters, 4, 'v8.3.2 评审 P1：commit 形态 insertText 带 isComposing=true 不得再被挡（安卓/国产内核上屏声的独苗），本条由吞声变出声');
});

// ── B18 v8.3.1 闸R2 P1②回归：软键盘连打回车（无 keydown）两声两铃封顶，300ms 内二击被兜底占窗吞掉 ──
test('B18 软键盘连打回车不叠双铃：首击兜底出声出铃，紧随二次 300ms 窗内吞击', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  const bi = (type) => ed.dispatchEvent(new w.InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true }));
  w.nsSetSkin(2);
  bi('insertLineBreak');
  assert.strictEqual(fake.stat.filters, 1, '软键盘回车兜底出声');
  assert.strictEqual(fake.stat.oscs, 1, '兜底回车带铃');
  bi('insertParagraph'); // 模拟软键盘连快按两次回车（无 keydown 前导）
  assert.strictEqual(fake.stat.filters, 1, '闸R2 P1②：兜底响过即占防重窗，二次不得叠声');
  assert.strictEqual(fake.stat.oscs, 1, '闸R2 P1②：铃也不得叠响');
});

// ── B19 v8.3.1 闸二R2 P1：长按 auto-repeat 逐重复仍派 insertText（e.repeat 只守 keydown），字符通道须自防同字符连发。
// 冻时钟（B14 先例）：虚拟 33ms=真机 auto-repeat 节奏，既 >24ms 节流（分辨护栏本体）又 <50ms 连发窗，且免疫 OS 定时器粒度漂移。──
test('B19 长按连发抑制：同字符 50ms 内一声封顶；窗过重复放行；异字符不受误伤', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const realNow = w.Date.now;
  let vt = realNow.call(w.Date);
  w.Date.now = () => vt;
  const advance = (ms) => { vt += ms; };
  const ed = w.document.getElementById('editor');
  const bi = (data) => ed.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'insertText', data: data, bubbles: true, cancelable: true }));
  w.nsSetSkin(2);
  bi('z');
  for (let i = 0; i < 5; i++) { advance(33); bi('z'); } // auto-repeat 均匀节奏：每事件重置 50ms 窗全程压制
  assert.strictEqual(fake.stat.filters, 1, '长按同字符连发：一声封顶（33ms>24ms 节流已越过，挡下的是连发护栏本体=分辨断言）');
  advance(90); // 松键后隔 90ms（>50ms 护栏窗）再同键=人手连打
  bi('z');
  assert.strictEqual(fake.stat.filters, 2, '窗过后同字符再敲（人手连打节奏）正常出声，不误伤');
  advance(90);
  bi('y');
  assert.strictEqual(fake.stat.filters, 3, '换键打字：异字符不受连发护栏影响');
  w.Date.now = realNow;
});
