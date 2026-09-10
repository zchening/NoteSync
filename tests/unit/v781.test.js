// v7.8.1「金色转圈+✓」方案与 v8.0.7「页脚两段式+自演转圈」方案均已被 v8.0.8 推翻——
// 用户拍板「不要等同，要一模一样」：刷新钮 = 字面 location.reload()，与 F5 同一实现路径。
// 按钮不再自演加载：类名状态机/✓ 图标/keyframes/800ms 保底/2.5s 封顶/连点令牌/页脚强写
// 全部退役，整页重建的加载反馈由浏览器标签页承担，页脚状态由 boot→poll 原生落位。
//
// Z1 静态形态：v6.0 基调（--muted 灰、贴右下）不动；自演态金色规则与 ✓ 图标禁现
// Z2 行为：解锁后按下 → 同帧 location.reload()，按钮/页脚/胶囊全零改动、零 fetch 代跑
// Z3 守卫-未解锁：轻提示保留（红线15 守卫句式），绝不 reload
// Z4 守卫-保存中/在途写入：轻提示保留，绝不 reload（reload 会掐断在途 PUT）
// Z5 退役令牌全文件禁现：rfb*/spinning/ico-check/同步中… 等旧状态机串一处不许留
// Z6 三板锁色收缩：working/done 金色态已从三块板全拆，基色 muted 三板仍在
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) { // 红线：等真实条件，不定值 sleep
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(30); }
  return false;
}
// jsdom 的 location.reload 是非配置/非写自有属性（无法打桩），但它真实触发时会经
// VirtualConsole 抛「Not implemented: navigation」——据此计数即可硬证明「按下确实调用 reload」。
function freshApp() {
  let reloadHits = 0;
  let html = fs.readFileSync(INDEX_PATH, 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr[^"]*"><\/script>/, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (/navigation/i.test(e.message)) reloadHits++; });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      w.EventSource = class { close() {} };
      try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
      catch (e) { w.crypto = webcrypto; }
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
      if (!w.Range.prototype.getClientRects) {
        w.Range.prototype.getClientRects = function () { return []; };
        w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
      }
    },
  });
  const window = dom.window;
  return { dom, window, document: window.document, editor: window.document.getElementById('editor'), reloadCount: () => reloadHits };
}
async function unlockedApp(note) {
  const app = freshApp();
  const key = await makeKey();
  const ct = await app.window.encryptText(note.text, key);
  const wire = { v: note.v, ct: ct.ct, iv: ct.iv, salt: 'x' };
  app.window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(wire) });
  await app.window.applyUnlocked(key, wire);
  return app;
}
async function makeKey() { return webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

// ── Z1：静态形态 ───────────────────────────────────────────
test('Z1 按钮基调不动（--muted 灰），自演态 CSS 与 ico-check 标记全禁现', () => {
  const base = SRC.match(/#refreshBtn\{[^}]*\}/)[0];
  assert.ok(/color:var\(--muted\)/.test(base), '常态仍是 --muted 灰（v6.0 基调不动）');
  assert.ok(!/#refreshBtn\.(spinning|working|done)\b/.test(SRC), '自演态类选择器（转圈/金态/done 切图）全禁现——合法保留的仅 #refreshBtn{}、:active、svg 尺寸三条');
  assert.ok(!SRC.includes('ico-check'), '✓ 图标类名全文件禁现（按钮 HTML 与 CSS 双双清除）');
  const btn = SRC.match(/<button type="button" id="refreshBtn"[\s\S]*?<\/button>/);
  assert.ok(btn, 'refreshBtn 标记必须在');
  assert.ok(/class="ico-refresh"/.test(btn[0]), '单图标 ico-refresh 保留（44px 触控、1.7px 细线基调由 v60 T3 守）');
  assert.strictEqual((btn[0].match(/<svg/g) || []).length, 1, '按钮内只剩一枚 SVG');
});

// ── Z2：行为-按下即 reload ─────────────────────────────────
test('Z2 解锁后按下：同帧 location.reload()，按钮/页脚/胶囊零自演、零 fetch 代跑', async t => {
  const app = await unlockedApp({ v: 5, text: 'unchanged body' });
  t.after(() => app.dom.window.close());
  const foot = app.document.getElementById('statustext');
  const before = foot.textContent; // 可能是「连接中…」或后台 poll 已落的「已同步」——本用例不依赖其值
  let fetchCalls = 0;
  app.window.fetch = () => { fetchCalls++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 5 }) }); };
  const btn = app.document.getElementById('refreshBtn');
  const pill = app.document.getElementById('uploadStatus');
  const b2 = fetchCalls;
  const baseRC = app.reloadCount();
  btn.click();
  assert.strictEqual(fetchCalls - b2, 0, '点击处理器绝不代跑 poll/fetch（网络动作属于重载后的 boot，不属于按钮）');
  assert.strictEqual(foot.textContent, before, 'v8.0.8：页脚绝不被按钮改写——状态由重载后 boot→poll 原生落位');
  assert.notStrictEqual(foot.textContent, '同步中…', '按钮不再假挂起「同步中…」（v8.0.7 两段式已推翻）');
  assert.ok(!pill.classList.contains('show'), '正常刷新不弹任何胶囊');
  assert.ok(await waitFor(() => app.reloadCount() > baseRC, 1000), '按下必须触发真实 location.reload()（jsdom 导航错误计数自增）');
  assert.strictEqual(app.reloadCount() - baseRC, 1, 'reload 恰好一次：无定时器补刀、无收尾状态机');
  await sleep(150); // 让任何被引向异步的遗漏浮出来
  assert.strictEqual(btn.className, '', '按钮不留任何自演类名（spinning/working/done 族全灭）');
});

// ── Z3/Z4：前置守卫 ────────────────────────────────────────
test('Z3 未解锁：轻提示「请先解锁」+ 绝不 reload（重载只会回锁屏页，属自伤）', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const btn = app.document.getElementById('refreshBtn');
  const pill = app.document.getElementById('uploadStatus');
  const baseRC = app.reloadCount();
  btn.click();
  assert.strictEqual(pill.textContent, '请先解锁', '轻提示保留（v7.5.1 语义不动）');
  assert.ok(pill.classList.contains('show'), '提示可见');
  await sleep(120);
  assert.strictEqual(app.reloadCount() - baseRC, 0, '未解锁绝不 reload');
});

test('Z4 保存中/在途写入：轻提示 + 绝不 reload（reload 会掐断在途 PUT）', async t => {
  const app = await unlockedApp({ v: 5, text: 'before edit' });
  t.after(() => app.dom.window.close());
  app.window.fetch = () => new Promise(() => {}); // 永不返回 → busy 恒真
  app.editor.innerHTML = '<div>typing…</div>';
  app.window.saveLocal(); // busy = true 在首个 await 前同步置位
  await sleep(50); // 给微任务排空，确认 busy 稳持
  const btn = app.document.getElementById('refreshBtn');
  const pill = app.document.getElementById('uploadStatus');
  const baseRC = app.reloadCount();
  btn.click();
  assert.ok(pill.textContent.indexOf('正在保存中') === 0, '忙窗口轻提示保留，实际: ' + pill.textContent);
  await sleep(120);
  assert.strictEqual(app.reloadCount() - baseRC, 0, 'busy 窗口绝不 reload');
});

// ── Z5：退役令牌全文件禁现 ────────────────────────────────
test('Z5 v7.8.1/v8.0.7 自演状态机令牌全文件零残留', () => {
  for (const dead of ['rfbStepTimer', 'rfbDoneTimer', 'rfbCapTimer', 'rfbRun', 'rfbSettle', 'rfbFinish', 'rfbState', 'rfbToastTimer', 'spinning', '@keyframes spin', "'同步中…'"]) {
    assert.ok(!SRC.includes(dead), '退役串禁现：' + dead);
  }
  assert.ok(!SRC.includes("setStatus(false, '刷新失败')"), '封顶代报「刷新失败」随状态机退役（断网反馈归 poll/boot 原生路径）');
});

// ── Z6：三板锁色收缩 ──────────────────────────────────────
test('Z6 三板只留基色：working/done 金色规则已从三块板全拆', () => {
  assert.ok(SRC.includes('#refreshBtn{color:${p.muted}!important}'), '动态板基色锁 muted 仍在');
  assert.ok(SRC.includes("'#refreshBtn{color:#676A75!important}'"), 'SHELL 板基色预反色仍在');
  assert.ok(!SRC.includes('.working') && !SRC.includes('.done{'), '三块板中 working/done 派生规则零残留');
});
