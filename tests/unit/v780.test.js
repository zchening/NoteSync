// v7.8.0 时间悬浮卡改版（用户拍板方案 C：单行胶囊 → 三行小卡）
//
// 症状：移动端输入「2026-09-15 18:00 明天体检，明早早点送橙子上学+空腹」后把光标落到时间上，
// 浮卡是 white-space:nowrap + max-width:92vw 的单行胶囊，超长文本把尾随的「添加提醒」整颗
// 裁出屏幕——用户看不见入口（功能本身没坏：整卡仍可点）。
// 修法：卡片宽度 min(86vw,340px)、三行结构（时间＋相对日 / 事项 / 主按钮），
// 省略号截断只落在事项行，「添加提醒」恒完整可见；按钮用面板「知道了」同款 fg 底/bg 字反相语言。
//
// X1 静态形态：胶囊排版退役 + 三行/实底按钮/入场动画到位
// X2 chipDayLabel 标签口径（同日留空、明天/后天/周X/N天后）
// X3 DOM 行为：无事项不渲染事项行、同日不挂相对日、长事项仍由 itemAfterMatch 截到 20 字
// X4 状态切换：CTA 卡必须显式摘掉 feedback（从展示卡直切未添加时间不经过 hideTimeChip）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function freshApp() {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  });
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor') };
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
function mockCapture(window, note, putV) {
  window.fetch = (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (m === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: putV }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(note) });
  };
}
// 把光标放到正文里那段时间串上（第 3 个字符），等 selectionchange 250ms 防抖跑完
async function showChipFor(app, html, S) {
  const { window, document, editor } = app;
  editor.innerHTML = html;
  const tn = editor.querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf(S);
  assert.ok(idx !== -1, '前置：正文里必须有那段时间串');
  const range = document.createRange();
  range.setStart(tn, idx + 2); range.setEnd(tn, idx + 2);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  await sleep(400);
  return document.getElementById('timeChip');
}
async function unlockedApp() {
  const app = freshApp();
  const key = await makeKey();
  const noteCt = await app.window.encryptText('x', key);
  mockCapture(app.window, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' }, 5);
  await app.window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  return app;
}

// ── X1：静态形态 ───────────────────────────────────────────
test('X1 v7.8.0 chip 由单行胶囊改三行小卡，截断代价归事项行、按钮恒可见', () => {
  const base = SRC.match(/#timeChip\{[^}]*\}/);
  assert.ok(base, '必须有 #timeChip 主规则');
  assert.ok(!/white-space:nowrap/.test(base[0]), '主规则不得再 nowrap（正是它把 CTA 挤出屏幕）');
  assert.ok(/max-width:92vw/.test(base[0]), '必须留 max-width:92vw 兜底——老内核丢掉 width:min() 时卡片仍受屏宽约束，不至于再次撑破（截断代价归事项行）');
  assert.ok(/width:min\(86vw,340px\)/.test(base[0]), '卡片必须定宽 min(86vw,340px)（桌面手机同一套，不分叉）');
  assert.ok(/display:flex;flex-direction:column/.test(base[0]), '三行结构走纵向 flex');
  assert.ok(/animation:chipRise/.test(base[0]), '入场用 chip 专用动画（不能用通用 rise：to 帧 transform:none 会丢居中）');
  assert.ok(/@keyframes chipRise\{from\{[^}]*translateX\(-50%\)[^}]*\}to\{[^}]*translateX\(-50%\)[^}]*\}\}/.test(SRC), 'chipRise 两帧都必须保住 translateX(-50%)');

  const what = SRC.match(/#timeChip \.chip-what\{[^}]*\}/);
  assert.ok(what && /white-space:nowrap/.test(what[0]) && /text-overflow:ellipsis/.test(what[0]), '省略号只能落在事项行');
  const cta = SRC.match(/#timeChip \.chip-cta\{[^}]*\}/);
  assert.ok(cta && /min-height:42px/.test(cta[0]), '主按钮触控高度 ≥42px（与对话框按钮同规，适老）');
  assert.ok(cta && /background:var\(--fg\)/.test(cta[0]) && /color:var\(--bg\)/.test(cta[0]), '主按钮必须是 fg 底/bg 字实底反相');
  assert.ok(/#timeChip \.chip-sep\{[^}]*background:var\(--line\)/.test(SRC), '分隔线用描边色（三板都要有对应锁色）');
  assert.ok(/#timeChip \.chip-del\{[^}]*border:1px solid var\(--line\)/.test(SRC), '删除伪按钮描边锁色不得丢（v5.47 断言沿用）');
});

// ── X2：相对日标签口径 ─────────────────────────────────────
test('X2 chipDayLabel 同日留空、明天/后天/周内周X、更远 N天后', t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const f = app.window.chipDayLabel;
  const now = new Date();
  const dayAt = (offset, h) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, 0, 0, 0);
    return d.getTime();
  };
  assert.strictEqual(f(dayAt(0, 23)), '', '同日返回空——fmtRemTime 已带「今天」，挂标签是重复');
  assert.strictEqual(f(dayAt(1, 8)), '明天');
  assert.strictEqual(f(dayAt(2, 8)), '后天');
  for (const off of [3, 4, 5, 6]) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, 8, 0, 0, 0);
    assert.strictEqual(f(d.getTime()), '周' + '日一二三四五六'.charAt(d.getDay()), off + ' 天后必须显周X');
  }
  assert.strictEqual(f(dayAt(7, 8)), '7天后');
  assert.strictEqual(f(dayAt(40, 8)), '40天后');
});

// ── X3：DOM 行为（无事项 / 同日 / 超长事项）─────────────────
test('X3 无事项不渲染事项行、同日不挂相对日、超长事项仍截到 20 字', async t => {
  const app = await unlockedApp();
  t.after(() => app.dom.window.close());

  // ① 只有时间，没有事项
  const d1 = new Date(); d1.setDate(d1.getDate() + 1); d1.setHours(7, 5, 0, 0);
  const S1 = fmtDate(d1);
  let chip = await showChipFor(app, '<div>' + S1 + '</div>', S1);
  assert.ok(!chip.classList.contains('hidden'), '前置：纯时间也必须弹卡');
  assert.ok(!chip.querySelector('.chip-what'), '无事项时不得渲染空的事项行');
  assert.ok(chip.querySelector('.chip-sep'), '分隔线恒在');
  assert.strictEqual(chip.lastElementChild.className, 'chip-cta', '按钮必须是卡片最后一个节点（时间在前、CTA 在后，v5.45 顺序不变）');
  assert.strictEqual(chip.querySelector('.chip-day').textContent, '明天', '明天的时间挂「明天」');

  // ② 同日：今天 23:59（跑在临午夜一分钟内时该项自动跳过，避免造出过去时间）
  const d2 = new Date(); d2.setHours(23, 59, 0, 0);
  if (d2.getTime() > Date.now() + 60000) {
    const S2 = fmtDate(d2);
    chip = await showChipFor(app, '<div>' + S2 + ' 交材料</div>', S2);
    assert.ok(chip.textContent.includes('今天'), '同日时间首行必须是「今天 HH:MM」');
    assert.ok(!chip.querySelector('.chip-day'), '同日不得再挂相对日标签（与「今天」重复）');
    assert.strictEqual(chip.querySelector('.chip-what').textContent, '交材料', '事项独立成行');
  }

  // ③ 超长事项：itemAfterMatch 20 字截断口径不变（布局层再兜一次省略号）
  const d3 = new Date(); d3.setDate(d3.getDate() + 2); d3.setHours(18, 0, 0, 0);
  const S3 = fmtDate(d3);
  const longItem = '明天体检，明早早点送橙子上学空腹记得带医保卡和身份证原件';
  chip = await showChipFor(app, '<div>' + S3 + ' ' + longItem + '</div>', S3);
  const what = chip.querySelector('.chip-what');
  assert.ok(what, '超长事项必须独占事项行');
  assert.strictEqual(what.textContent, longItem.slice(0, 20) + '…', '事项仍按 v5.39 规则截到 20 字加省略号');
  assert.strictEqual(chip.querySelector('.chip-day').textContent, '后天', '两天后必须挂「后天」');
  assert.ok(chip.querySelector('.chip-cta'), '超长事项下 CTA 依然完整渲染（这就是本版要修的 bug）');
});

// ── X4：状态切换残留 ───────────────────────────────────────
test('X4 CTA 卡渲染前必须摘掉 feedback（展示卡直切未添加时间不经过 hideTimeChip）', async t => {
  assert.ok(/timeChip\.classList\.remove\('feedback'\); \/\/ v7\.8\.0：从「已添加」展示卡直接切到未添加时间时不经过 hideTimeChip/.test(SRC), '必须有显式摘类（锚定补丁行——hideTimeChip 里也有一句 remove，裸匹配会恒真伪绿）');
  const app = await unlockedApp();
  t.after(() => app.dom.window.close());
  const dA = new Date(); dA.setDate(dA.getDate() + 1); dA.setHours(7, 5, 0, 0);
  const dB = new Date(); dB.setDate(dB.getDate() + 2); dB.setHours(9, 0, 0, 0);
  const SA = fmtDate(dA), SB = fmtDate(dB);
  await app.window.addReminder(dA.getTime(), '开会');
  await sleep(560); // 等 400ms linkify 重建，避免 selection 设到死节点（v6.0 竞态教训）
  let chip = await showChipFor(app, '<div>会议 ' + SA + ' 开会 ' + SB + ' 体检</div>', SA);
  assert.ok(chip.classList.contains('feedback'), '已添加的时间弹两行展示卡');
  chip = await showChipFor(app, '<div>会议 ' + SA + ' 开会 ' + SB + ' 体检</div>', SB);
  assert.ok(!chip.classList.contains('feedback'), '同一次防抖周期内直切未添加时间，CTA 卡不得残留 feedback');
  assert.ok(chip.querySelector('.chip-cta'), '切过来必须重新渲染出「添加提醒」按钮');
});

// ── X5：与草稿/冲突条同位让位（对抗审 P1：卡片长高后盖住「保留本机/使用云端」并吃掉点击）──
test('X5 草稿/冲突条在位时浮卡让位：两路守卫同步 + 条弹出即收卡', async t => {
  const guardRe = /!isDraftBarHidden\(\)\) \{ (?:hideTimeChip\(\); return;|if \(chipFromHover\) hideTimeChip\(\); return;) \}/g;
  const hits = SRC.match(guardRe) || [];
  assert.ok(hits.length >= 2, 'caret 路 + hover 路必须都挂草稿条守卫（红线13：多处消费点必须同步，漏一处=互斥回归），实挂 ' + hits.length + ' 处');
  assert.ok(/function showDraftBar\(\) \{ draftBar\.classList\.remove\('hidden'\); hideTimeChip\(\); \}/.test(SRC), '条弹出时必须立刻收浮卡（不等下一次 selectionchange）');

  const app = await unlockedApp();
  t.after(() => app.dom.window.close());
  const d1 = new Date(); d1.setDate(d1.getDate() + 1); d1.setHours(7, 5, 0, 0);
  const S = fmtDate(d1);
  const chip = await showChipFor(app, '<div>会议 ' + S + ' 开会</div>', S);
  assert.ok(!chip.classList.contains('hidden'), '前置：无冲突时卡片正常浮出');
  app.window.showDraftBar();
  app.document.dispatchEvent(new app.window.Event('selectionchange'));
  await sleep(400);
  assert.ok(chip.classList.contains('hidden'), '草稿/冲突条弹出后浮卡必须立即让位');
});
