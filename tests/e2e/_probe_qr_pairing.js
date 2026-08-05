// _probe_qr_pairing.js — v5.20 二维码配对（快速档）端到端验证
//   P1 发送端解锁并写入内容
//   P2 弹层按需显示：打开只见"显示配对二维码"按钮，画布未出现
//   P3 点显示后：画布出现且已绘制；qrUrl = origin/noteId#k=<URL-safe密钥>，与本机存储密钥一致
//   P4 关闭弹层后复位（qrMask 隐藏、画布移除）
//   P5 接收端（全新上下文、无本地密钥）打开配对链接 → 免口令自动解锁，内容与发送端一致
//   P6 接收端解锁后地址栏 hash 被剥离、密钥已写入其 localStorage
//   P7 接收端输入能反向同步回发送端（证明密钥双向可用，而非只读展示）
//   P8 接收端刷新后（无 hash）仍可凭已存密钥自动解锁
//   P9 篡改密钥 / 错误密钥 → 回退口令界面并提示"配对链接无效或已失效"，hash 同样被剥离
// 环境：spawn 真实 server.js（localhost 安全上下文），双浏览器上下文走真实 PBKDF2/AES 全链路。
// 用法: node tests/e2e/_probe_qr_pairing.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const PORT = '8151';
const BASE = 'http://localhost:' + PORT;
const NOTE = 'probeQrPair';
const PASS = 'probe-qr-pass';

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}
const strip = s => (s || '').replace(/\u200B/g, '');

(async () => {
  // ---- 起真实 server.js ----
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let started = false;
    child.stdout.on('data', d => {
      if (!started && d.toString().includes('listening on :' + PORT)) { started = true; resolve(); }
    });
    child.stderr.on('data', d => process.stderr.write('[server] ' + d));
    child.on('exit', code => { if (!started) reject(new Error('server exited early, code=' + code)); });
    setTimeout(() => { if (!started) reject(new Error('server did not start within 10s')); }, 10000);
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

    // ============ 发送端 ============
    const senderCtx = await browser.newContext();
    const sender = await senderCtx.newPage();
    await sender.goto(BASE + '/' + NOTE);
    await sender.waitForSelector('#pw', { timeout: 10000 });
    await sender.fill('#pw', PASS);
    await sender.click('#ok');
    await sender.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
      && document.getElementById('mask').classList.contains('hidden'), { timeout: 20000 });
    await sender.evaluate(() => {
      const e = document.getElementById('editor');
      e.innerHTML = '<div>QRPAIR-SEED-CONTENT</div>';
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await sender.waitForTimeout(1200); // 等 800ms 防抖保存落地
    // localVer 是页面顶层 let 不挂 window，改从服务器侧确认版本已落地
    const savedNote = await (await fetch(BASE + '/api/note/' + NOTE)).json();
    check('P1: 发送端解锁并保存种子内容', (savedNote.v || 0) > 0 && !!savedNote.ct, JSON.stringify({ v: savedNote.v, ctLen: (savedNote.ct || '').length }));

    // ---- P2 弹层按需显示 ----
    await sender.click('#qrBtn');
    const maskShown = await sender.evaluate(() => !document.getElementById('qrMask').classList.contains('hidden'));
    const hasRevealBtn = await sender.evaluate(() => !!document.getElementById('qrReveal'));
    const canvasBefore = await sender.evaluate(() => !!document.getElementById('qrCanvas'));
    check('P2a: 打开弹层可见', maskShown);
    check('P2b: 初始只显示"显示配对二维码"按钮', hasRevealBtn);
    check('P2c: 密钥二维码默认不渲染', !canvasBefore);

    // ---- P3 显示二维码与配对链接 ----
    await sender.click('#qrReveal');
    await sender.waitForSelector('#qrCanvas', { timeout: 5000 });
    const qrInfo = await sender.evaluate(() => {
      const cv = document.getElementById('qrCanvas');
      let dark = 0, total = 0;
      try {
        const ctx = cv.getContext('2d');
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 0; i < d.length; i += 4) { total++; if (d[i] < 128) dark++; }
      } catch (e) {}
      return {
        w: cv.width, h: cv.height, dark, total,
        url: document.getElementById('qrUrl').textContent,
        urlVisible: !document.getElementById('qrUrl').classList.contains('hidden'),
        stored: localStorage.getItem('notesync_key_' + 'probeQrPair'),
      };
    });
    check('P3a: 画布已绘制且为方形', qrInfo.w > 100 && qrInfo.w === qrInfo.h, JSON.stringify({ w: qrInfo.w, h: qrInfo.h }));
    check('P3b: 画布含明暗模块（真实二维码而非空白）', qrInfo.dark > 50 && qrInfo.dark < qrInfo.total * 0.8, 'dark=' + qrInfo.dark + '/' + qrInfo.total);
    check('P3c: 配对链接同时展示', qrInfo.urlVisible && qrInfo.url.length > 0);
    const expectedUrl = BASE + '/' + NOTE;
    const m = qrInfo.url.match(/^(http:\/\/localhost:8151\/probeQrPair)#k=([A-Za-z0-9_-]+)$/);
    check('P3d: 配对链接形如 origin/noteId#k=<URL-safe密钥>', !!m && m[1] === expectedUrl, qrInfo.url);
    if (m && qrInfo.stored) {
      const safe = qrInfo.stored.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      check('P3e: #k= 与本机存储密钥一致（URL-safe 化后）', m[2] === safe);
    } else {
      check('P3e: #k= 与本机存储密钥一致（URL-safe 化后）', false, 'stored=' + !!qrInfo.stored);
    }
    const pairingUrl = qrInfo.url;

    // ---- P4 关闭弹层复位 ----
    await sender.click('#qrClose');
    const closedState = await sender.evaluate(() => ({
      hidden: document.getElementById('qrMask').classList.contains('hidden'),
      canvas: !!document.getElementById('qrCanvas'),
    }));
    check('P4: 关闭后弹层隐藏且画布移除', closedState.hidden && !closedState.canvas, JSON.stringify(closedState));

    // ============ 接收端（全新上下文，无任何本地密钥） ============
    const recvCtx = await browser.newContext();
    const recvNeg = await recvCtx.newPage();

    // ---- P9 先行：错误密钥回退（在干净上下文先测负例，避免串扰）----
    const wrongKey = Buffer.alloc(32, 0).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await recvNeg.goto(BASE + '/' + NOTE + '#k=' + wrongKey);
    await recvNeg.waitForSelector('#mask:not(.hidden)', { timeout: 20000 });
    const negState = await recvNeg.evaluate(() => ({
      err: document.getElementById('err').textContent,
      hash: location.hash,
      stored: localStorage.getItem('notesync_key_' + 'probeQrPair'),
    }));
    check('P9a: 错误密钥回退到口令界面', negState.err.includes('配对链接无效或已失效'), JSON.stringify(negState.err));
    check('P9b: 失败后 hash 已剥离', negState.hash === '', negState.hash);
    check('P9c: 失败不落地错误密钥', !negState.stored);

    // ---- P5 正确配对链接免口令解锁（第二个全新上下文，模拟另一台设备扫码）----
    // 注意不能在 recv 上继续：同 URL 仅 hash 变化属同文档导航，不会重跑 init()
    await recvCtx.close();
    const recvCtx2 = await browser.newContext();
    const recv = await recvCtx2.newPage();
    await recv.goto(pairingUrl);
    // 配对成功 → location.replace 整页重载到干净 URL（非原地解锁）；等重载落定再等编辑器就绪
    await recv.waitForURL(u => !String(u).includes('#k='), { timeout: 25000 });
    await recv.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
      && document.getElementById('mask').classList.contains('hidden'), { timeout: 25000 });
    const recvState = await recv.evaluate(() => ({
      html: document.getElementById('editor').innerHTML,
      foot: document.getElementById('foot').textContent,
      pwVisible: !document.getElementById('mask').classList.contains('hidden'),
    }));
    check('P5a: 接收端免口令自动解锁', !recvState.pwVisible);
    check('P5b: 解密出的内容与发送端一致', strip(recvState.html).includes('QRPAIR-SEED-CONTENT'), strip(recvState.html));
    check('P5c: 状态栏显示已解锁', recvState.foot.includes('已解锁'), recvState.foot);

    // ---- P6 hash 剥离 + 密钥落地接收端 ----
    const postState = await recv.evaluate(() => ({
      hash: location.hash,
      href: location.href,
      stored: localStorage.getItem('notesync_key_' + 'probeQrPair'),
      senderStored: null,
    }));
    check('P6a: 解锁后地址栏 hash 已剥离', postState.hash === '' && !postState.href.includes('#k='), postState.href);
    check('P6b: 密钥已写入接收端 localStorage', !!postState.stored);
    const senderStored = await sender.evaluate(() => localStorage.getItem('notesync_key_' + 'probeQrPair'));
    check('P6c: 接收端密钥与发送端一致', postState.stored === senderStored);

    // ---- P7 接收端输入反向同步（密钥双向可用）----
    await recv.evaluate(() => {
      const e = document.getElementById('editor');
      e.innerHTML = '<div>QRPAIR-SEED-CONTENT</div><div>RECV-REPLY-7788</div>';
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    try {
      await sender.waitForFunction(() => {
        const t = (document.getElementById('editor').textContent || '').replace(/\u200B/g, '');
        return t.includes('RECV-REPLY-7788');
      }, { timeout: 15000 });
      check('P7: 接收端输入同步回发送端', true);
    } catch (e) {
      const got = await sender.evaluate(() => strip(document.getElementById('editor').textContent));
      check('P7: 接收端输入同步回发送端', false, got);
    }

    // ---- P8 接收端刷新后凭已存密钥自动解锁 ----
    await recv.reload();
    await recv.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
      && document.getElementById('mask').classList.contains('hidden'), { timeout: 20000 });
    const reHtml = strip(await recv.evaluate(() => document.getElementById('editor').innerHTML));
    check('P8: 刷新后凭已存密钥自动解锁且内容仍在', reHtml.includes('RECV-REPLY-7788'), reHtml);

    await senderCtx.close();
    await recvCtx2.close();
  } finally {
    if (browser) await browser.close();
    child.kill('SIGKILL');
  }

  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
