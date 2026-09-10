// v7.8.1 右下角刷新按钮反馈改版（方案 A：金色反馈版）→ v8.0.7 再改（用户拍板「等同于刷浏览器」）
//
// v7.8.1 症状：点刷新只 .spinning 转一下，快网时不足 1 秒看不清 → 加了结果胶囊。
// v8.0.7 症状（用户报）：点刷新转圈期间页脚仍谎报绿点「已同步」，完成后 toast「已是最新」
// 又与页脚「已同步」重复。修法：页脚=唯一结果反馈通道——点击即灰点「同步中…」、结果由
// poll 原生落位（已同步/待处理/同步中断），结果 toast 退役；按钮仍 金转圈→成功✓一闪→回灰。
// 2.5s 封顶仅在页脚仍是「同步中…」时代报「刷新失败」，晚到结果由 2 秒常驻轮询自然纠正。
//
// Y1 静态形态：金色工作态/✓ 完成态 CSS，只用 --accent，不引新颜色（v7.8.1 遗产不动）
// Y2 按钮标记：双 svg（ico-refresh + ico-check）同族 1.7px
// Y3 行为-成功：按下页脚即「同步中…」→ poll 翻绿 → 保底转满 → ✓ 一闪回灰，全程无 toast
// Y4 行为-失败：同样转满/封顶停转，页脚代报「刷新失败」，不亮 ✓，无 toast
// Y5 静态锚定：页角落位与封顶代报判定锚定补丁行；旧「结果 toast/晚到翻牌状态机」全退役
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

// ── Y3：行为-成功 ──────────────────────────────────────────
test('Y3 成功：按下页脚即「同步中…」→poll 翻绿→保底 800ms→✓ 一闪，全程无 toast', async t => {
  const app = await unlockedApp({ v: 5, text: 'unchanged body' });
  t.after(() => app.dom.window.close());
  const btn = app.document.getElementById('refreshBtn');
  const foot = app.document.getElementById('statustext');
  const pill = app.document.getElementById('uploadStatus');
  const t0 = Date.now();
  btn.click();
  assert.ok(btn.classList.contains('spinning') && btn.classList.contains('working'), '按下立即 spinning+working（金色）');
  assert.strictEqual(foot.textContent, '同步中…', 'v8.0.7 主修：按下瞬间页脚必须落「同步中…」（灰点），不再谎报「已同步」');
  assert.ok(!app.document.getElementById('status').classList.contains('on'), '同步中期间点必须是灰点（dot.on 缺席）');
  await sleep(150); // poll 早已返回，仍在补足窗口内
  assert.ok(btn.classList.contains('spinning'), 'poll 秒回也必须还在转（保底 800ms 生效，快网才有感知）');
  assert.strictEqual(foot.textContent, '已同步', 'poll 成功自行翻绿——页脚由 poll 落位，刷新处理器绝不另写成功文案');
  assert.ok(await waitFor(() => !btn.classList.contains('spinning')), '转圈终会停');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 780, '从按下到停转 ≥800ms（含 20ms 计时粒度余量），实测 ' + elapsed + 'ms');
  assert.ok(btn.classList.contains('done'), '成功结果必须亮 ✓');
  assert.ok(!pill.classList.contains('show'), 'v8.0.7：成功不弹 toast（结果 toast 已退役，页脚是唯一反馈通道）');
  await waitFor(() => !btn.classList.contains('done'), 1500);
  assert.ok(!btn.classList.contains('done'), '✓ 短暂展示后回灰');
  assert.ok(!pill.classList.contains('show'), '收尾后仍无 toast');
});

// ── Y4：行为-失败 ──────────────────────────────────────────
test('Y4 失败：保底照转、封顶停转，页脚代报「刷新失败」，不亮 ✓，无 toast', async t => {
  const app = await unlockedApp({ v: 5, text: 'local only' });
  t.after(() => app.dom.window.close());
  const foot = app.document.getElementById('statustext');
  // 先等 applyUnlocked 尾部的成功 poll 落定（页脚变「已同步」），再换 reject fetch——
  // 否则那次在途成功会把「同步中…」翻回「已同步」，打断封顶代报的前提判据（工装竞态，非真机行为）。
  // 闸R2-P2-1：前提落不成要大声红指向环境，不得静默走到后面冒充产品红（红线18 前提自诊断精神）。
  assert.ok(await waitFor(() => foot.textContent === '已同步', 3000), '前提自诊断：applyUnlocked 后页脚应落定「已同步」，未落定=工装/环境异常');
  app.window.fetch = () => Promise.reject(new Error('net down'));
  const btn = app.document.getElementById('refreshBtn');
  const pill = app.document.getElementById('uploadStatus');
  btn.click();
  assert.ok(btn.classList.contains('working'), '失败路径照先转金');
  assert.strictEqual(foot.textContent, '同步中…', '按下即「同步中…」——失败路径同样先诚实挂起');
  await sleep(150); // poll 的 fetchRetry 还要退避数秒，此刻必须仍在转（保底窗口内）
  assert.ok(btn.classList.contains('spinning'), '秒断也不得闪停——失败路径同样先转满保底');
  assert.ok(await waitFor(() => !btn.classList.contains('spinning'), 4500), '转圈终会停（封顶 2.5s，套件并行下留计时余量）');
  assert.ok(foot.textContent === '刷新失败' || foot.textContent === '同步中断', '页脚代报「刷新失败」（晚到 poll catch 改写「同步中断」亦真实）');
  assert.ok(!btn.classList.contains('done'), '失败绝不亮 ✓（不装完成）');
  assert.ok(!pill.classList.contains('show'), 'v8.0.7：失败也不弹 toast——页脚承载');
  await sleep(120);
  assert.ok(!btn.classList.contains('done'), '✓ 事后也不会偷亮（900ms 窗口内同样不装完成）');
});

// ── Y5：静态锚定 ───────────────────────────────────────────
test('Y5 页角落位/封顶代报/去抖锚定补丁行，旧 toast 与翻牌状态机全退役', () => {
  assert.ok(SRC.includes("setStatus(false, '同步中…'); // v8.0.7 主修：刷新期间页脚不再谎报绿点「已同步」"), '按下即「同步中…」锚定补丁行');
  assert.ok(SRC.includes("if (forcedFail && statusText.textContent === '同步中…') setStatus(false, '刷新失败');"), '封顶只在页脚仍无人落位时代报失败——晚到结果由常驻轮询自然纠正');
  assert.ok(SRC.includes("if (statusText.textContent === '已同步') { // ✓ 只给成功"), '✓ 仅页脚「已同步」才亮：冲突/失败/中途被锁一律回灰');
  assert.ok(/clearTimeout\(rfbStepTimer\); clearTimeout\(rfbDoneTimer\); clearTimeout\(rfbCapTimer\);/.test(SRC), '连点先去抖：上一轮补足/封顶/收尾计时全部作废');
  assert.ok(/const run = \+\+rfbRun;[\s\S]*?if \(run !== rfbRun\) return;/.test(SRC), '运行令牌：晚到的上一轮结果不得给新一轮串台');
  assert.ok(/rfbCapTimer = setTimeout\([\s\S]*?\}, 2500\);/.test(SRC), 'UI 层 2.5s 封顶：断网退避期间不死等转圈');
  assert.ok(!SRC.includes('rfbState'), 'v7.8.1「晚到翻牌」状态机退役（常驻轮询接管纠正）');
  assert.ok(!SRC.includes('rfbToastTimer'), '刷新结果 toast 计时退役');
  assert.ok(!SRC.includes("'已是最新'") && !SRC.includes("msg = '已同步更新'"), '结果胶囊短句全退役（与页脚重复=用户报障点）');
});

// ── Y6：三板锁色（R2-P1 实锤教训：金色态只落静态板=国产强制深色夜间吃字）──
test('Y6 刷新按钮金色态三板锁色齐：静态 var(--accent) + 动态板 ${accent} + SHELL #708ED9', () => {
  assert.ok(/#refreshBtn\.working,#refreshBtn\.done\{color:var\(--accent\)\}/.test(SRC), '静态板：working/done 走 --accent 令牌');
  assert.ok(SRC.includes('#refreshBtn{color:${p.muted}!important}'), '动态板：基色锁 muted（footer 同族）');
  assert.ok(SRC.includes('#refreshBtn.working,#refreshBtn.done{color:${accent}!important}'), '动态板：金色态锁 ${accent}');
  assert.ok(SRC.includes("'#refreshBtn{color:#676A75!important}'"), 'SHELL 板：基色预反色锁');
  assert.ok(SRC.includes("'#refreshBtn.working,#refreshBtn.done{color:#708ED9!important}'"), 'SHELL 板：金色态壳蓝（brand svg 同款）');
});
