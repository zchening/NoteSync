// NoteSync v10.1.4 E2E：扫码换机改「备份笔记本体」路线 —— 机器替人扫。
// 背景（用户实锤）：旧路线把「收藏+全部密钥」整包塞进一张二维码，每篇固定约 80 字节（32 字节 AES 钥的
// base64 不可压缩），而备份弹窗把显示宽锁在 260px —— 收藏 6 篇时每格已掉到 0.48mm，手机屏对手机屏
// 物理上解不出（「微信能扫、NoteSync 扫半天没反应」）。新路线出一张恒定密度的配对链，清单写进专用备份笔记。
// 本文件要证的三件事：
//  ① 密度与篇数解耦：1 篇与 100 篇出的码格子数一样，且画布像素喂 jsQR 真能反解出来（不靠源码锚，
//     也不靠"看起来变大了"——红线：几何/视觉守护必须量真实可见状态）；
//  ② 换机全链路：新 context 用解出的那条链接进去 → 自动解锁 → 只读恢复卡 → 恢复 → 目标笔记可解密打开；
//  ③ 甲案三闸：清单绝不进 contenteditable、编辑器只读、saveLocal 对备份笔记硬拒写（服务器版本不推进）。
// 真起 server.js（NOTESYNC_DATA_DIR 指独立临时目录，绝不碰仓库 data/notes）+ 真 Chromium。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server.js');
const JSQR = path.join(ROOT, 'jsQR.js');
const PASS = 'bak-pass-1014';
const SRC = 'src1014';               // 发起换机的那台设备上正在用的笔记
const TRAVEL = 'travel1014';         // 只存在于本机密钥库、未收藏的笔记：验证「未收藏也带走」
let server, browser, baseURL, dataDir, proc;
let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }
process.on('unhandledRejection', (r) => {
  const m = String((r && r.message) || r);
  if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(m)) return;
  console.error('Unhandled:', m); process.exitCode = 1;
});

function freePort() { return new Promise(res => { const s = require('net').createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); }); }

before(async () => {
  dataDir = path.join(os.tmpdir(), 'ns-v1014-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(path.join(dataDir, 'notes'), { recursive: true });
  const port = await freePort();
  proc = spawn(process.execPath, [SERVER], { env: Object.assign({}, process.env, { PORT: String(port), NOTESYNC_DATA_DIR: dataDir }), stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/healthz'); if (r.ok) break; } catch (e) {}
    if (Date.now() - t0 > 10000) throw new Error('server 未起来');
    await new Promise(r => setTimeout(r, 120));
  }
  baseURL = 'http://127.0.0.1:' + port + '/';
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  try { if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 6000))]); } catch (e) {}
  try { if (proc) proc.kill(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures > 0 ? 1 : 0);
});

// 手机档视口：DPR=1 令 CSS px == 设备 px，「每格几像素」这个物理量才能直接断言（屏对屏可扫下限经验值 4px）
async function newPage(mobile) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } : {});
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e))); // 吞错＝把真回归静默成绿（闸 R2-P2 点名）
  return { ctx, page, errs };
}
async function unlockNote(page, name) {
  await page.goto(baseURL + name);
  await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 20000 });
  await page.evaluate(p => window.unlock(String(p)), PASS);
  await page.waitForFunction(() => {
    const ed = document.getElementById('editor'), m = document.getElementById('mask');
    return ed && ed.getAttribute('contentEditable') === 'true' && m && m.classList.contains('hidden');
  }, { timeout: 20000 });
}
// 画布喂 jsQR：这是「机器替人扫」——不看源码字符串，只看真正画出来的那些像素能不能被解回原文。
// 注意：注入必须在最后一次导航之后（addScriptTag 不随跳转重放，早注的会被 goto 抹掉）。
async function injectJsqr(page) { await page.addScriptTag({ path: JSQR }); }
async function scanCanvas(page, sel) {
  return page.evaluate(async (s) => {
    if (typeof window.jsQR !== 'function') throw new Error('jsQR 未注入');
    const cv = document.querySelector(s);
    if (!cv) throw new Error('找不到二维码画布 ' + s);
    const r = cv.getBoundingClientRect();
    const ctx = cv.getContext('2d');
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const hit = window.jsQR(new Uint8ClampedArray(img.data), cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
    const q = window.qrcode(0, 'M'); q.addData(hit && hit.data ? hit.data : '', 'Byte');
    let n = 0; try { q.make(); n = q.getModuleCount(); } catch (e) {}
    return { data: (hit && hit.data) || '', rectW: Math.round(r.width * 100) / 100, modules: n, bitmap: cv.width };
  }, sel);
}

test('① 出码密度与篇数解耦：1 篇与 100 篇同为一张配对链，画布像素可被 jsQR 反解', guard(async () => {
  const { ctx, page, errs } = await newPage(true);
  try {
    await unlockNote(page, SRC);
    await injectJsqr(page); // 导航之后再注，否则被 goto 抹掉
    // 造 100 篇「本机有密钥」的笔记，但收藏夹只放 2 篇：默认必须只备份这 2 篇，
    // 勾上「带上其他笔记」才变 102 篇（v10.1.5 用户口径：备份=收藏夹，扩范围要显式同意）
    await page.evaluate(() => {
      const std = () => { const a = crypto.getRandomValues(new Uint8Array(32)); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
      for (let i = 0; i < 100; i++) localStorage.setItem('notesync_key_' + ('ns' + String(i).padStart(3, '0')), std());
      localStorage.setItem('notesync_key_travel1014', std());
      localStorage.setItem('notesync_favs', JSON.stringify(['ns001', 'travel1014']));
    });
    await page.click('#menuBtn');
    await page.waitForFunction(() => !document.getElementById('menuMask').classList.contains('hidden'), { timeout: 5000 });
    await page.click('#menuBackup');
    await page.waitForFunction(() => !document.getElementById('bakMask').classList.contains('hidden'), { timeout: 5000 });
    // 勾选框必须出现（本机有 100 篇未收藏的密钥）、默认不勾、且文案里报出篇数
    await page.waitForFunction(() => !document.getElementById('bakWideRow').classList.contains('hidden'), { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => document.getElementById('bakWide').checked), false, '默认必须不勾（不替用户悄悄扩范围）');
    assert.ok(/100 篇/.test(await page.evaluate(() => document.getElementById('bakWideTxt').textContent)), '勾选框要报出「其他笔记」的真实篇数');
    await page.fill('#bakPass', PASS);
    await page.click('#bakGo');
    await page.waitForFunction(() => !document.getElementById('bakStage2').classList.contains('hidden'), { timeout: 25000 });
    const err = await page.evaluate(() => document.getElementById('bakErr').textContent);
    assert.strictEqual(err, '', '出码阶段不应有报错：' + err);
    assert.ok(/恢复 2 篇/.test(await page.evaluate(() => document.getElementById('bakTip').textContent)), '不勾时提示的篇数必须等于收藏数');
    let shot = await scanCanvas(page, '#bakQrHolder canvas');
    assert.ok(/^https?:\/\/127\.0\.0\.1:\d+\/nsbak-[a-z0-9]{6}#k=[A-Za-z0-9_-]+$/.test(shot.data), '扫出来的必须是一条备份笔记配对链（随机档名 + #k= 密钥）：' + shot.data);
    const n2 = shot.modules;
    // 关掉重开、勾上再出一张：格子数必须一模一样（与篇数解耦），而服务器上的密文必须真的装下 102 篇
    await page.click('#bakClose2');
    await page.click('#menuBtn');
    await page.click('#menuBackup');
    await page.waitForFunction(() => !document.getElementById('bakMask').classList.contains('hidden'), { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => document.getElementById('bakWide').checked), false, '重开出码框必须回到未勾（不记忆上次的扩大选择）');
    await page.click('#bakWide');
    await page.fill('#bakPass', PASS);
    await page.click('#bakGo');
    await page.waitForFunction(() => !document.getElementById('bakStage2').classList.contains('hidden'), { timeout: 25000 });
    // 102 篇候选超上限：必须裁到 BAK_MAX=100 并如实报「未含 2 篇」（透明化，不静默丢）
    const tip2 = await page.evaluate(() => document.getElementById('bakTip').textContent);
    assert.ok(/恢复 100 篇/.test(tip2) && /未含 2 篇/.test(tip2), '勾上后应带上其他笔记、裁到 100 篇上限并如实报未含数：' + tip2);
    shot = await scanCanvas(page, '#bakQrHolder canvas');
    assert.strictEqual(shot.modules, n2, '2 篇与 102 篇出的码格子数必须完全相同（这就是本次重立的目标）');
    assert.ok(shot.modules > 0 && shot.modules <= 45, '格子数必须 ≤45（实测 ' + shot.modules + '）');
    const pitch = shot.rectW / (shot.modules + 8);
    assert.ok(pitch >= 4, '手机上每格必须 ≥4 CSS px 才谈得上屏对屏扫，实测 ' + pitch.toFixed(2) + '（宽 ' + shot.rectW + 'px / ' + shot.modules + ' 格）');
    // 备份笔记必须真的落在服务器上、且服务器只见密文（零知识不破）
    const bakId = shot.data.match(/\/(nsbak-[a-z0-9]{6})#k=/)[1];
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'notes', bakId + '.json'), 'utf8'));
    assert.ok(typeof raw.ct === 'string' && raw.ct.length > 4000, '102 篇清单应真写进服务器（密文长度 ' + raw.ct.length + '）');
    assert.ok(!JSON.stringify(raw).includes('ns001'), '服务器上绝不该看得见笔记名明文（零知识）');
    assert.ok(raw.salt && raw.wkHash, '备份笔记应已落盐并完成凭据认领');
    assert.ok(raw.v >= 3, '同一篇备份笔记被更新过（不勾→勾两次写入），版本应递增，实得 v=' + raw.v);
    assert.deepStrictEqual(errs, [], '全程不应有页面 JS 错误：' + JSON.stringify(errs));
  } finally { try { await ctx.close(); } catch (e) {} }
}));

test('② 换机全链路：新设备用扫到的链接进去 → 自动解锁 → 只读恢复卡 → 恢复 → 目标笔记可解密打开', guard(async () => {
  // 第一台设备：两篇真笔记（同口令、各自不同的盐 → 各自不同的密钥，换机要搬走的正是这批密钥）
  const a = await newPage(true);
  let pairUrl = '';
  const BODY = '换机内容-Ω 3.14';
  try {
    await unlockNote(a.page, SRC);
    await a.page.click('#editor');
    await a.page.keyboard.type(BODY);
    await a.page.waitForFunction(() => document.getElementById('statustext').textContent === '已同步', { timeout: 20000 });
    await unlockNote(a.page, TRAVEL);            // 第二篇：同口令、不同盐 → 不同密钥（正是换机要搬走的东西）
    await a.page.click('#editor');
    await a.page.keyboard.type(BODY + '-travel');
    await a.page.waitForFunction(() => document.getElementById('statustext').textContent === '已同步', { timeout: 20000 });
    await a.page.evaluate(() => localStorage.setItem('notesync_favs', JSON.stringify(['travel1014', 'src1014'])));
    await injectJsqr(a.page); // 导航之后再注
    await a.page.click('#menuBtn');
    await a.page.click('#menuBackup');
    await a.page.fill('#bakPass', PASS);
    await a.page.click('#bakGo');
    await a.page.waitForFunction(() => !document.getElementById('bakStage2').classList.contains('hidden'), { timeout: 25000 });
    const err = await a.page.evaluate(() => document.getElementById('bakErr').textContent);
    assert.strictEqual(err, '', '出码阶段不应有报错：' + err);
    pairUrl = (await scanCanvas(a.page, '#bakQrHolder canvas')).data;
    assert.ok(pairUrl.indexOf('nsbak-') > 0, '应拿到备份笔记配对链');
    await a.ctx.close();
  } catch (e) { try { await a.ctx.close(); } catch (_) {} throw e; }

  // 第二台设备：全新 context（空 localStorage），只做「扫码 → 跟随链接」这一件事
  const b = await newPage(true);
  try {
    await b.page.goto(pairUrl);
    await b.page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 20000 });
    await b.page.reload(); // 配对接收端本就靠整页重载收口（tryPairingUnlock 落地 KEY_STORE 后 replace）
    await b.page.waitForFunction(() => !document.getElementById('bakRestMask').classList.contains('hidden'), { timeout: 25000 });
    const gate = await b.page.evaluate(() => {
      const ed = document.getElementById('editor');
      return { editable: ed.getAttribute('contentEditable'), html: ed.innerHTML, sum: document.getElementById('bakRestSummary').textContent, list: document.getElementById('bakRestList').textContent, btn: document.getElementById('bakRestGo').textContent };
    });
    assert.strictEqual(gate.editable, 'false', '闸1：备份笔记的编辑器必须只读');
    assert.strictEqual(gate.html, '', '闸1：清单绝不进 contenteditable（编辑器必须是空的）');
    assert.ok(/含 \d+ 篇/.test(gate.sum), '恢复卡要说清含几篇：' + gate.sum);
    assert.ok(gate.list.split('\n').indexOf('travel1014') >= 0, '清单要能看见都带走了哪些笔记：' + gate.list);
    // 闸3：先证明「就算被叫起来也写不进服务器」——版本必须纹丝不动（恢复卡开着照测，两件事互不依赖）
    const bakId = pairUrl.match(/\/(nsbak-[a-z0-9]{6})#k=/)[1];
    const vBefore = JSON.parse(fs.readFileSync(path.join(dataDir, 'notes', bakId + '.json'), 'utf8')).v;
    await b.page.evaluate(async () => { try { await window.saveLocal(true); } catch (e) {} });
    // 等「页脚真的报出被闸门拒写」这一真条件，而不是定值 sleep 后读盘（闸 R2-P2：定值 1200ms 在并发
    // 饿死下可能连那次调用都还没跑到闸门，读到的 v 当然没变——那是假绿。红线：等异步一律等真实条件）
    await b.page.waitForFunction(() => document.getElementById('statustext').textContent.indexOf('换机备份只能在') >= 0, { timeout: 15000 });
    const vAfter = JSON.parse(fs.readFileSync(path.join(dataDir, 'notes', bakId + '.json'), 'utf8')).v;
    assert.strictEqual(vAfter, vBefore, '闸2：对备份笔记强制 saveLocal(true) 也不得推进服务器版本（' + vBefore + '→' + vAfter + '）');
    // 真恢复：点〔恢复这 N 篇〕→ 应写回密钥 + 合并收藏 + 跳进第一篇
    await b.page.click('#bakRestGo');
    await b.page.waitForFunction(() => location.pathname.indexOf('travel1014') >= 0 || location.pathname === '/' + SRC, { timeout: 25000 });
    const restored = await b.page.evaluate(() => ({
      travel: localStorage.getItem('notesync_key_travel1014'),
      favs: localStorage.getItem('notesync_favs'),
      slot: localStorage.getItem('notesync_bak_slot'),
      tip: (document.getElementById('uploadStatus') || {}).textContent || '',
    }));
    assert.ok(restored.travel && restored.travel.length >= 43, '恢复后本机应有 travel1014 的密钥');
    assert.ok(JSON.parse(restored.favs).indexOf('travel1014') >= 0, '恢复后收藏夹应含 travel1014');
    assert.ok(restored.slot && /nsbak-[a-z0-9]{6}/.test(restored.slot), '恢复后应记下备份槽，供这台设备以后继续更新同一份');
    assert.ok(/已从备份码恢复 \d+ 篇收藏/.test(restored.tip), '恢复成功必须用 toast 说一遍（e2e 实锤：只写页脚会被首 poll 刷成「已同步」＝用户以为没成功）：' + restored.tip);
    // 落地检验：这篇笔记真能解密打开，且正文与旧设备上打进去的一字不差
    await b.page.waitForFunction(() => {
      const ed = document.getElementById('editor'), m = document.getElementById('mask');
      return ed && ed.getAttribute('contentEditable') === 'true' && m && m.classList.contains('hidden');
    }, { timeout: 25000 });
    const body = await b.page.evaluate(() => document.getElementById('editor').innerText);
    assert.ok(body.indexOf('换机内容-Ω 3.14-travel') >= 0, '新机打开 travel1014 应看到旧机写入的正文，实得：' + JSON.stringify(body.slice(0, 80)));
    assert.deepStrictEqual(a.errs.concat(b.errs), [], '两台设备全程不应有页面 JS 错误：' + JSON.stringify(a.errs.concat(b.errs)));
    assert.ok((await b.page.evaluate(() => document.getElementById('bakRestMask').classList.contains('hidden'))), '跳走后不应再有恢复卡拦在目标笔记上');
  } finally { try { await b.ctx.close(); } catch (e) {} }
}));

test('③ 旧 v7.7.0 整包码文本仍可恢复（读侧兼容，禁"新手机不认旧码"）', guard(async () => {
  const { ctx, page } = await newPage(false);
  try {
    await page.goto(baseURL + SRC);
    await page.waitForFunction(() => typeof window.applyBackupBundle === 'function', { timeout: 20000 });
    const r = await page.evaluate(async () => {
      const k = (() => { const x = crypto.getRandomValues(new Uint8Array(32)); let s = ''; for (const c of x) s += String.fromCharCode(c); return btoa(s); })();
      const raw = 'notesync-backup:v1:' + btoa(JSON.stringify({ v: 1, f: [['legacy1014', k]] }));
      await window.applyBackupBundle(raw);
      return { got: localStorage.getItem('notesync_key_legacy1014'), want: k, favs: localStorage.getItem('notesync_favs') };
    });
    assert.strictEqual(r.got, r.want, '旧格式载荷的密钥应照旧写回');
    assert.ok(JSON.parse(r.favs).indexOf('legacy1014') >= 0, '旧格式也应合并进收藏夹');
  } finally { try { await ctx.close(); } catch (e) {} }
}));

test('④ 粘贴恢复兜底：不依赖摄像头，粘文本→真点〔恢复〕→密钥与收藏落地', guard(async () => {
  const { ctx, page, errs } = await newPage(false);
  try {
    await page.goto(baseURL + SRC);
    await page.waitForFunction(() => typeof window.pasteBackupTextUI === 'function', { timeout: 20000 });
    // 打开这层浮窗的正规入口是取景框里的「粘贴备份文本恢复」，而取景框要真摄像头（headless 无设备）；
    // 故只直调 UI 构造函数，后续输入与点击全部走真交互（红线：落点/选区/焦点断言不许用 element.click 假绿）
    await page.evaluate(() => window.pasteBackupTextUI());
    await page.waitForSelector('#bakPasteMask input', { timeout: 5000 });
    const k = stdKeyLocal();
    const text = await page.evaluate((kk) => 'notesync-bak:1:' + btoa(JSON.stringify({ v: 1, ts: Date.now(), f: [['paste1014', kk]] })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), k);
    // 先喂一段非法文本，验「报错不写库」这条守卫真的在门口拦
    await page.fill('#bakPasteMask input', 'notesync-bak:1:@@不合法@@');
    await page.click('#bakPasteGo');
    await page.waitForFunction(() => document.querySelector('#bakPasteMask .err').textContent !== '', { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('notesync_key_paste1014')), null, '非法文本必须先被挡在门口，绝不写库');
    await page.fill('#bakPasteMask input', text);
    await page.click('#bakPasteGo');
    await page.waitForFunction(() => !document.getElementById('bakPasteMask'), { timeout: 10000 });
    const got = await page.evaluate(() => ({ k: localStorage.getItem('notesync_key_paste1014'), favs: localStorage.getItem('notesync_favs') }));
    assert.strictEqual(got.k, k, '粘贴恢复应把密钥逐字写回');
    assert.ok(JSON.parse(got.favs).indexOf('paste1014') >= 0, '粘贴恢复应合并收藏夹');
    assert.deepStrictEqual(errs, [], '全程不应有页面 JS 错误：' + JSON.stringify(errs));
  } finally { try { await ctx.close(); } catch (e) {} }
}));


test('⑤ 首页扫/粘旧整包码：恢复后必须整页跳进第一篇（闸 R3-K：只 setStatus 会被 landing 盖住＝「粘完没反应」）', guard(async () => {
  const { ctx, page, errs } = await newPage(false);
  try {
    await page.goto(baseURL); // 首页：noteId 为空、landing 覆盖层 z30 压住页脚状态区
    await page.waitForFunction(() => typeof window.applyBackupBundle === 'function', { timeout: 20000 });
    const k = stdKeyLocal();
    await page.evaluate((kk) => window.applyBackupBundle('notesync-backup:v1:' + btoa(JSON.stringify({ v: 1, f: [['home1014', kk]] }))), k);
    await page.waitForFunction(() => location.pathname === '/home1014', { timeout: 20000 });
    const st = await page.evaluate(() => ({
      path: location.pathname,
      key: localStorage.getItem('notesync_key_home1014'),
      favs: JSON.parse(localStorage.getItem('notesync_favs') || '[]'),
      pending: sessionStorage.getItem('ns_backup_import'),
    }));
    assert.ok(st.key && st.key.length >= 43, '首页恢复也应把密钥写回本机');
    assert.ok(st.favs.indexOf('home1014') >= 0, '首页恢复也应合并收藏夹');
    assert.ok(st.pending === null || /^\d+$/.test(String(st.pending)), '一次性提示经 sessionStorage 单程携带（读走即清）');
    assert.deepStrictEqual(errs, [], '全程不应有页面 JS 错误：' + JSON.stringify(errs));
  } finally { try { await ctx.close(); } catch (e) {} }
}));

function stdKeyLocal() {
  const b = crypto.randomBytes(32);
  return b.toString('base64');
}
