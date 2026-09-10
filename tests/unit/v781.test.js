// v7.8.1 右下角刷新按钮反馈改版（用户拍板方案 A：金色反馈版）
//
// 症状：点刷新只 .spinning 转一下，快网时不足 1 秒看不清；转完页脚还是那句「已同步」，
// 与没点之前一模一样——用户完全感知不到「刷新发生了、结果是什么」。
// 修法：保底转满 800ms 且期间图标变 --accent 金 → 结束切同族 1.7px 细线 ✓（失败不装完成）
// → 结果胶囊走既有 upload-status（「已是最新 / 已同步更新 / 刷新失败」，短句无标点、带自动隐藏守卫）。
// 冲突挂起态（远端有更新待处理）胶囊让位，不叠条（沿用 v7.8.0 浮卡与草稿条同位让位精神）。
//
// Y1 静态形态：金色工作态/✓ 完成态 CSS，只用 --accent，不引新颜色
// Y2 按钮标记：双 svg（ico-refresh + ico-check）同族 1.7px
// Y3 行为-无新内容：spinning+working 起 → 保底转满 → done+「已是最新」胶囊，2s 内自动收
// Y4 行为-请求失败：同样转满 800ms，但「刷新失败」胶囊且不亮 ✓（不装完成）
// Y5 静态锚定：结果三态判定挂 poll 之后 step 内；连点去抖清上一轮计时
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) { // 红线：等真实条件，不定值 sleep
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(30); }
  return false;
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

// ── Y1：静态形态 ───────────────────────────────────────────
test('Y1 工作态/完成态用 --accent 金与 ✓ 图标切换，零新颜色', () => {
  assert.ok(/#refreshBtn svg\.ico-check\{display:none\}/.test(SRC), '✓ 默认隐藏（锚定 v7.8.1 补丁行，裸匹配会撞其它 display:none 规则）');
  assert.ok(/#refreshBtn\.working,#refreshBtn\.done\{color:var\(--accent\)\}/.test(SRC), '转圈期与完成态必须变品牌金（--accent，两主题自动适配，禁写死色值）');
  assert.ok(/#refreshBtn\.done svg\.ico-refresh\{display:none\}/.test(SRC) && /#refreshBtn\.done svg\.ico-check\{display:block\}/.test(SRC), 'done 态切图标：收起旋转圈、露出 ✓');
  assert.ok(/#refreshBtn\{[^}]*color:var\(--muted\)/.test(SRC.match(/#refreshBtn\{[^}]*\}/)[0]), '常态仍是 --muted 灰（v6.0 基调不动）');
});

// ── Y2：按钮标记 ───────────────────────────────────────────
test('Y2 刷新按钮含 ico-refresh + ico-check 双 SVG，描边 1.7px 同族', () => {
  const btn = SRC.match(/<button type="button" id="refreshBtn"[\s\S]*?<\/button>/);
  assert.ok(btn, 'refreshBtn 标记必须在');
  assert.ok(/class="ico-refresh"/.test(btn[0]) && /class="ico-check"/.test(btn[0]), '双图标类名齐备');
  const strokes = btn[0].match(/stroke-width="1\.7"/g) || [];
  assert.strictEqual(strokes.length, 2, '两个 SVG 都必须是顶栏同族 1.7px 细线');
  assert.ok(/stroke-linecap="round"/.test(btn[0]), '圆头描边与全页图标一致');
});

// ── Y3：行为-无新内容 ──────────────────────────────────────
test('Y3 无新内容：金色转圈→保底 800ms→✓+「已是最新」胶囊→自动收', async t => {
  const app = await unlockedApp({ v: 5, text: 'unchanged body' });
  t.after(() => app.dom.window.close());
  const btn = app.document.getElementById('refreshBtn');
  const pill = app.document.getElementById('uploadStatus');
  const t0 = Date.now();
  btn.click();
  assert.ok(btn.classList.contains('spinning') && btn.classList.contains('working'), '按下立即 spinning+working（金色）');
  await sleep(150); // poll 早已返回，仍在补足窗口内
  assert.ok(btn.classList.contains('spinning'), 'poll 秒回也必须还在转（保底 800ms 生效，快网才有感知）');
  assert.ok(await waitFor(() => !btn.classList.contains('spinning')), '转圈终会停');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 780, '从按下到停转 ≥800ms（含 20ms 计时粒度余量），实测 ' + elapsed + 'ms');
  assert.ok(btn.classList.contains('done'), '成功结果必须亮 ✓');
  assert.ok(pill.classList.contains('show') && pill.textContent === '已是最新', '胶囊文案对齐线上短句风格（无标点）');
  await waitFor(() => !btn.classList.contains('done'), 1500);
  assert.ok(!btn.classList.contains('done'), '✓ 短暂展示后回灰');
  assert.ok(await waitFor(() => !pill.classList.contains('show')), '胶囊 2s 自动隐藏（红线15）');
});

// ── Y4：行为-请求失败 ──────────────────────────────────────
test('Y4 请求失败：仍转满保底，但「刷新失败」胶囊且不亮 ✓（不装完成）', async t => {
  const app = freshApp();
  const key = await makeKey();
  const ct = await app.window.encryptText('local only', key);
  const wire = { v: 5, ct: ct.ct, iv: ct.iv, salt: 'x' };
  app.window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(wire) });
  await app.window.applyUnlocked(key, wire);
  t.after(() => app.dom.window.close());
  app.window.fetch = () => Promise.reject(new Error('net down'));
  const btn = app.document.getElementById('refreshBtn');
  const pill = app.document.getElementById('uploadStatus');
  const t0 = Date.now();
  btn.click();
  assert.ok(btn.classList.contains('working'), '失败路径照先转金');
  await sleep(150); // poll 的 fetchRetry 还要退避数秒，此刻必须仍在转（保底窗口内）
  assert.ok(btn.classList.contains('spinning'), '秒断也不得闪停——失败路径同样先转满保底');
  assert.ok(await waitFor(() => !btn.classList.contains('spinning'), 4500), '转圈终会停（封顶 2.5s，套件并行下留计时余量）');
  assert.ok(pill.classList.contains('show') && pill.textContent === '刷新失败', '失败给明确短句');
  assert.ok(!btn.classList.contains('done'), '失败绝不亮 ✓');
  await sleep(120);
  assert.ok(!btn.classList.contains('done'), '✓ 事后也不会偷亮（900ms 窗口内同样不装完成）');
});

// ── Y5：静态锚定 ───────────────────────────────────────────
test('Y5 结果三态判定与去抖锚定在 step 内，冲突挂起不叠胶囊', () => {
  assert.ok(SRC.includes("if (lastHtml !== prevHtml) msg = '已同步更新';"), '内容变化=已同步更新（lastHtml 前后比对，poll 零侵入）');
  assert.ok(SRC.includes("else if (st === '已同步') msg = '已是最新';"), '页脚已同步=已是最新');
  assert.ok(SRC.includes("else if (st === '远端有更新，待处理') msg = '';"), '冲突条已挂起：胶囊让位不叠加');
  assert.ok(/clearTimeout\(rfbStepTimer\); clearTimeout\(rfbDoneTimer\); clearTimeout\(rfbCapTimer\);/.test(SRC), '连点先去抖：上一轮补足/封顶/收尾计时全部作废');
  assert.ok(/const run = \+\+rfbRun;[\s\S]*?if \(run !== rfbRun\) return;/.test(SRC), '运行令牌：晚到的上一轮 poll 结果不得给新一轮串台');
  assert.ok(/setTimeout\(\(\) => \{ if \(uploadStatus\.textContent === msg\) hideUploadStatus\(\); \}, 2000\)/.test(SRC), 'toast 带「仍是它才清」守卫');
  assert.ok(/rfbCapTimer = setTimeout\([\s\S]*?\}, 2500\)/.test(SRC), 'UI 层 2.5s 封顶：断网退避期间不死等转圈');
  assert.ok(SRC.includes("rfbFinish('刷新失败'); // 封顶时"), '封顶时 poll 未返回必须强制失败——页脚旧「已同步」不得被误判为已是最新（晚到成功由翻牌纠正）');
});

// ── Y6：三板锁色（R2-P1 实锤教训：金色态只落静态板=国产强制深色夜间吃字）──
test('Y6 刷新按钮金色态三板锁色齐：静态 var(--accent) + 动态板 ${accent} + SHELL #708ED9', () => {
  assert.ok(/#refreshBtn\.working,#refreshBtn\.done\{color:var\(--accent\)\}/.test(SRC), '静态板：working/done 走 --accent 令牌');
  assert.ok(SRC.includes('#refreshBtn{color:${p.muted}!important}'), '动态板：基色锁 muted（footer 同族）');
  assert.ok(SRC.includes('#refreshBtn.working,#refreshBtn.done{color:${accent}!important}'), '动态板：金色态锁 ${accent}');
  assert.ok(SRC.includes("'#refreshBtn{color:#676A75!important}'"), 'SHELL 板：基色预反色锁');
  assert.ok(SRC.includes("'#refreshBtn.working,#refreshBtn.done{color:#708ED9!important}'"), 'SHELL 板：金色态壳蓝（brand svg 同款）');
});
