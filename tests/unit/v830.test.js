// NoteSync v8.3.0 彩蛋二单元测试：彩蛋图鉴 ?eggs / notesync 烟花 / 禅模式 / 打字机音。
// 约定：纯函数（nsFwHit）钉语义；DOM 行为（图鉴渲染/烟花自清/禅进出）走真 jsdom；
// 打字机音用假 AudioContext 计数（只统计 bandpass 与 oscillator，避开解锁静音 buffer 噪声）。
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
  assert.strictEqual(rows.length, 8, '图鉴应有 8 个条目');
  assert.ok([...rows].every(r => r.classList.contains('locked')), '全新用户全部为未发现锁态');
  assert.strictEqual([...rows][0].querySelector('.egg-name').textContent, '???', '未发现不得泄露彩蛋名');
  assert.strictEqual(w.document.getElementById('eggCount').textContent, '0 / 8 FOUND');
  w.nsEggUnlock('skin');
  w.nsEggUnlock('fw');
  w.nsEggRender();
  const again = [...w.document.querySelectorAll('#eggList .egg-row')];
  const skin = again.find(r => r.getAttribute('data-egg') === 'skin');
  assert.ok(!skin.classList.contains('locked'));
  assert.strictEqual(skin.querySelector('.egg-name').textContent, '复古皮肤');
  assert.strictEqual(skin.querySelector('.egg-hint').textContent, '连点左上角 logo 七次');
  assert.strictEqual(w.document.getElementById('eggCount').textContent, '2 / 8 FOUND');
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
  w.nsEggUnlock('zen'); w.nsEggUnlock('zen'); w.nsEggUnlock('type');
  const raw = w.localStorage.getItem('notesync_eggs');
  assert.ok(raw, '应写入进度');
  const o = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(o).sort(), ['type', 'zen']);
  assert.ok(w.nsEggHas('zen') && !w.nsEggHas('skin'));
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

// ── B7 禅模式：解锁+空白 30s 窗进入；任意输入即退；有字不进 ──
test('B7 禅模式进出：空白笔记到点进禅、输入即退、有内容永不进', async t => {
  const app = fresh();
  t.after(() => { try { app.window.eval('clearTimeout(zenTimer)'); } catch (e) {} });
  t.after(() => app.dom.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  w.eval('cryptoKey = {};'); // 模拟已解锁（顶层 let 走间接 eval 赋值，与既有测试同手法）
  ed.textContent = '';
  w.nsZenArm(50);
  const t0 = Date.now();
  while (!w.document.body.classList.contains('zen')) {
    if (Date.now() - t0 > 3000) assert.fail('禅模式未在窗后进入');
    await wait(30);
  }
  assert.ok(w.nsEggHas('zen'), '进禅即记入图鉴');
  ed.textContent = '开始写';
  ed.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  assert.ok(!w.document.body.classList.contains('zen'), '任意输入必须立刻退出禅模式');
  // 有内容的笔记：到点也不得进禅（禅只属于空白页）
  w.nsZenArm(50);
  await wait(200);
  assert.ok(!w.document.body.classList.contains('zen'), '非空笔记不得进禅');
});

// ── B8 禅模式：未解锁（无密钥）不上膛——落地页/口令框打字不该被算发呆 ──
test('B8 未解锁不计时：cryptoKey 为空时 nsZenArm 直接早退', async t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.eval('cryptoKey = null;');
  w.nsZenArm(30);
  await wait(150);
  assert.ok(!w.document.body.classList.contains('zen'), '未解锁不得进禅');
});

// ── B9 打字机音：皮肤外静默、环内发声、静音开关生效并持久化 ──
test('B9 打字机音三态：默认皮肤零发声；复古皮肤发声（回车带铃）；静音后归零', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  const key = (k) => ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  w.nsSetSkin(0);
  key('a'); key('Enter');
  assert.strictEqual(fake.stat.filters, 0, '默认皮肤必须彻底静默（用户没主动进复古模式）');
  w.nsSetSkin(1);
  key('a');
  assert.strictEqual(fake.stat.filters, 1, '复古皮肤内击键应发声');
  key('Enter');
  assert.strictEqual(fake.stat.filters, 2, '回车也应发声');
  assert.strictEqual(fake.stat.oscs, 1, '回车额外带一声回车铃（打字机灵魂）');
  assert.ok(w.nsEggHas('type'), '发过声即记入图鉴');
  w.nsTyMuteSet(true);
  const f = fake.stat.filters;
  key('b'); key('c');
  assert.strictEqual(fake.stat.filters, f, '静音后不得再发声');
  assert.strictEqual(w.localStorage.getItem('notesync_tymute'), '1', '静音开关持久化');
  w.nsTyToggle();
  assert.strictEqual(w.localStorage.getItem('notesync_tymute'), '0', '再切回开声');
});

// ── B10 打字机音：节流（24ms 内连击只出一声）+ 非编辑器击键不响 ──
test('B10 节流与输入源过滤：极速连击只响一次；口令框打字零发声', t => {
  const fake = makeFakeAC();
  const dom = loadApp(w => { w.AudioContext = fake.AC; });
  t.after(() => dom.window.close());
  const w = dom.window;
  const ed = w.document.getElementById('editor');
  w.nsSetSkin(2);
  for (let i = 0; i < 6; i++) ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  assert.strictEqual(fake.stat.filters, 1, '24ms 节流窗内连击只出一声（不糊成一片）');
  const f = fake.stat.filters;
  const pw = w.document.getElementById('pw');
  pw.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  assert.strictEqual(fake.stat.filters, f, '非编辑器击键不得发声');
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
test('B13 源码钉：新彩蛋零新色字面量 / 浮层 pointer-events:none / 版本 8.3.0 / 条目数一致', t => {
  assert.ok(SRC.includes("const APP_VERSION = '8.3.0';"), '版本号应随本次功能升到 8.3.0');
  assert.ok(SRC.includes('location.search.indexOf(\'eggs\')'), '?eggs 通道在位');
  assert.ok(SRC.includes('.ns-fw{position:fixed;z-index:58;pointer-events:none}'), '烟花层不得抢焦点');
  assert.ok(SRC.includes('background:var(--accent)'), '烟花粒子吃 --accent，不引新色');
  assert.ok(SRC.includes('#zenTip'), '禅模式提示层在位');
  assert.ok(SRC.includes('body.zen header,body.zen footer{opacity:.2}'), '禅模式=顶栏页脚淡出（不动排版）');
  const app = fresh(); t.after(() => app.dom.window.close());
  // 顶层 const 不挂 window（本项目已知铁律），取值一律走 eval
  assert.strictEqual(app.window.eval('NS_EGG_LIST.length'), app.window.eval('NS_EGG_TOTAL'), '图鉴条目数须与 NS_EGG_TOTAL 一致');
  assert.strictEqual(app.window.eval('NS_EGG_LIST.length'), 8);
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
