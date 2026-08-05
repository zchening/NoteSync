// _probe_v520_blind.js — v5.20 二维码配对「独立盲测」对抗探针（与主代理 _probe_qr_pairing.js 完全独立设计）
// 覆盖方向：
//   A 发送端时序/泄漏：未显示时 DOM 不得含密钥；60s 自动隐藏定时器真实存在且语义正确；关闭即复位
//   B URL-safe base64 无损性：构造 base64 含 + 与 / 且带 = 填充的真实 AES 密钥，端到端配对
//   C fragment 垃圾注入：#k=<真密钥>&foo=1、#k=<真密钥>#yyy 必须被拒绝
//   D 配对到不存在的笔记（全新 noteId）行为
//   E 非法密钥长度（16/31/64/1 字节）优雅回退、hash 剥离、密钥不落地
//   F hash 剥离彻底性：location.hash / href / performance 导航条目均无密钥残留
//   G 429 锁定下打开配对链接：不得绕过锁定；有/无本地密钥两种设备
//   H 已有本地密钥的设备遇到错误配对密钥：回退且已存密钥不得被破坏
//   I 二维码内容真实可解码：自研 QR 解码器（格式信息 BCH/掩码/之字形/块解交织，独立于页面库）
//     从画布像素还原模块矩阵并解出载荷，必须 === 配对链接；另做模块矩阵与库输出比对+结构校验
//   J 边界：KEY_STORE 缺失时「显示配对二维码」的行为（审查发现的疑似哑按钮）
// 环境：spawn 真实 server.js（localhost 安全上下文）；不修改任何业务代码。
// 用法: cd tests && node e2e/_probe_v520_blind.js
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '..', '..');
const PORT = '8161';
const BASE = 'http://localhost:' + PORT;
const NOTE = 'v520blind';
const PASS = 'blind-pass-520';

let passed = 0, failed = 0;
const findings = [];
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}
function note(label, detail) { findings.push(label + ': ' + detail); console.log('  NOTE ' + label + ' -> ' + detail); }
const strip = s => (s || '').replace(/\u200B/g, '');
const b64ToUrlSafe = b64 => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ============ 自研 QR 解码器（Node 侧，独立于页面内 qrcode-generator）============
// ISO/IEC 18004：格式信息(15bit, ^0x5412, BCH(15,5) 生成多项式 0x537) → 掩码 →
// 功能图形保留区 → 反掩码 → 之字形位流 → 码字 → 按 RS 块解交织 → 字节模式载荷。
// 不做 RS 纠错（程序化绘制的画布无噪声，任何不一致都说明编码/绘制有 bug）。
const RS_M = { // version -> [[块数,每块总码字,每块数据码字],...]（M 级，v1~v10，ISO 表格）
  1: [[1, 26, 16]], 2: [[1, 44, 28]], 3: [[1, 70, 44]], 4: [[2, 50, 32]], 5: [[2, 67, 43]],
  6: [[4, 43, 27]], 7: [[4, 49, 31]], 8: [[2, 60, 38], [2, 61, 39]], 9: [[4, 69, 43]], 10: [[1, 80, 50], [4, 81, 51]],
};
const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r * c) % 3 + (r + c) % 2) % 2 === 0,
];
function deg(x) { return 31 - Math.clz32(x); }
function decodeQrMatrix(m) {
  const n = m.length;
  if (n < 21 || (n - 17) % 4 !== 0) throw new Error('非法模块数 ' + n);
  const ver = (n - 17) / 4;
  // --- 格式信息（左上副本；bit i 为 LSB 序）---
  let f = 0;
  for (let i = 0; i <= 5; i++) f |= (m[i][8] ? 1 : 0) << i;
  f |= (m[7][8] ? 1 : 0) << 6;
  f |= (m[8][8] ? 1 : 0) << 7;
  f |= (m[8][7] ? 1 : 0) << 8;
  for (let i = 9; i <= 14; i++) f |= (m[8][14 - i] ? 1 : 0) << i;
  const code = f ^ 0x5412;
  const data5 = code >> 10;
  let rem = data5 << 10;
  while (deg(rem) >= 10) rem ^= 0x537 << (deg(rem) - 10);
  if (((data5 << 10) | rem) !== code) throw new Error('格式信息 BCH 校验失败 raw=' + f.toString(2));
  const ecName = { 0: 'M', 1: 'L', 2: 'H', 3: 'Q' }[data5 >> 3];
  const mask = data5 & 7;
  if (ecName !== 'M') throw new Error('纠错级别应为 M，实际 ' + ecName);
  // --- 功能图形保留区 ---
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const setSq = (r0, c0, r1, c1) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) reserved[r][c] = true; };
  setSq(0, 0, 8, 8); setSq(0, n - 8, 8, n - 1); setSq(n - 8, 0, n - 1, 8);
  for (let i = 0; i < n; i++) { reserved[6][i] = true; reserved[i][6] = true; }
  const pos = ALIGN[ver] || [];
  for (const ar of pos) for (const ac of pos) {
    const first = pos[0], last = pos[pos.length - 1];
    if ((ar === first && ac === first) || (ar === first && ac === last) || (ar === last && ac === first)) continue;
    setSq(ar - 2, ac - 2, ar + 2, ac + 2);
  }
  if (ver >= 7) { setSq(0, n - 11, 5, n - 9); setSq(n - 11, 0, n - 9, 5); }
  // --- 结构自检：定位图形 / 定时图形 / 暗模块 ---
  const finderAt = (r0, c0) => {
    const pat = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++)
      if (!!m[r0 + r][c0 + c] !== (pat[r][c] === '1')) return false;
    return true;
  };
  if (!finderAt(0, 0) || !finderAt(0, n - 7) || !finderAt(n - 7, 0)) throw new Error('定位图形损坏');
  for (let i = 8; i < n - 8; i++) {
    if (!!m[6][i] !== (i % 2 === 0)) throw new Error('行定时图形损坏@' + i);
    if (!!m[i][6] !== (i % 2 === 0)) throw new Error('列定时图形损坏@' + i);
  }
  if (!m[n - 8][8]) throw new Error('暗模块缺失');
  // --- 反掩码 ---
  const mf = MASKS[mask];
  const u = m.map((row, r) => row.map((v, c) => (!reserved[r][c] && mf(r, c)) ? (v ? 0 : 1) : (v ? 1 : 0)));
  // --- 之字形读码字 ---
  const bytes = [];
  let bit = 0, cur = 0, up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[r][c]) continue;
        cur = (cur << 1) | (u[r][c] ? 1 : 0);
        if (++bit === 8) { bytes.push(cur); bit = 0; cur = 0; }
      }
    }
    up = !up;
  }
  // --- RS 块解交织（仅数据码字；无噪声故跳过纠错）---
  const spec = RS_M[ver];
  if (!spec) throw new Error('解码器不覆盖 version ' + ver);
  const blocks = [];
  for (const [cnt, total, data] of spec) for (let i = 0; i < cnt; i++) blocks.push({ total, data });
  const totalData = blocks.reduce((s, b) => s + b.data, 0);
  if (bytes.length < totalData) throw new Error('码字不足: ' + bytes.length + '<' + totalData);
  const bufs = blocks.map(() => []);
  let p = 0;
  const maxD = Math.max(...blocks.map(b => b.data));
  for (let i = 0; i < maxD; i++) for (let bi = 0; bi < blocks.length; bi++) if (i < blocks[bi].data) bufs[bi].push(bytes[p++]);
  const stream = [];
  for (const buf of bufs) for (const byte of buf) stream.push(byte);
  // --- 位流解析：字节模式 ---
  let bp = 0;
  const readBits = k => {
    let v = 0;
    for (let i = 0; i < k; i++) { v = (v << 1) | ((stream[Math.floor(bp / 8)] >> (7 - (bp % 8))) & 1); bp++; }
    return v;
  };
  const mode = readBits(4);
  if (mode !== 4) throw new Error('非字节模式 mode=' + mode);
  const len = readBits(ver <= 9 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(readBits(8));
  return { version: ver, mask, text: Buffer.from(out).toString('utf8') };
}

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

    // ============ A1 锁定状态下打开二维码弹层 ============
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(BASE + '/' + NOTE);
      await page.waitForSelector('#pw', { timeout: 10000 });
      await page.evaluate(() => document.getElementById('qrBtn').click());
      const s = await page.evaluate(() => ({
        maskShown: !document.getElementById('qrMask').classList.contains('hidden'),
        hint: (document.querySelector('.qr-lock-warn') || {}).textContent || '',
        reveal: !!document.getElementById('qrReveal'),
        canvas: !!document.getElementById('qrCanvas'),
      }));
      check('A1a: 未解锁时弹层显示"解锁后才可用"提示', s.maskShown && s.hint.includes('解锁后才可使用二维码配对'), JSON.stringify(s));
      check('A1b: 未解锁时无"显示配对二维码"按钮与画布', !s.reveal && !s.canvas);
      await ctx.close();
    }

    // ============ 发送端准备 ============
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
      e.innerHTML = '<div>BLIND-SEED-520</div>';
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await sender.waitForTimeout(1200);
    const savedNote = await (await fetch(BASE + '/api/note/' + NOTE)).json();
    check('A0: 发送端解锁并保存种子内容', (savedNote.v || 0) > 0 && !!savedNote.ct, JSON.stringify({ v: savedNote.v }));
    const senderKeyB64 = await sender.evaluate(id => localStorage.getItem('notesync_key_' + id), NOTE);
    const senderKeySafe = b64ToUrlSafe(senderKeyB64);

    // ============ A2 打开弹层：未显示二维码时 DOM 不得含密钥 ============
    // 注意：扫描只针对"渲染 DOM"——先剔除 <script> 块，因为应用源码本身含 '#k=' 字面量（非泄漏）。
    await sender.click('#qrBtn');
    const a2 = await sender.evaluate(({k, ks}) => {
      const html = document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
      return {
        maskShown: !document.getElementById('qrMask').classList.contains('hidden'),
        reveal: !!document.getElementById('qrReveal'),
        canvas: !!document.getElementById('qrCanvas'),
        leakStd: html.includes(k),
        leakSafe: html.includes(ks),
        leakMark: html.includes('#k='),
      };
    }, {k: senderKeyB64, ks: senderKeySafe});
    check('A2a: 弹层打开后只见"显示配对二维码"按钮', a2.maskShown && a2.reveal && !a2.canvas);
    check('A2b: 未显示时 DOM 无任何密钥字符串（标准/URL-safe/#k= 均无）', !a2.leakStd && !a2.leakSafe && !a2.leakMark, JSON.stringify(a2));

    // ============ A3+A4+A5 定时器埋点 → 显示二维码 ============
    await sender.evaluate(() => {
      window.__timers = [];
      const origSet = window.setTimeout, origClear = window.clearTimeout;
      window.setTimeout = function (fn, delay, ...args) {
        const id = origSet(fn, delay, ...args);
        window.__timers.push({ id, delay, fn, cleared: false });
        return id;
      };
      window.clearTimeout = function (id) {
        for (const t of window.__timers) if (t.id === id) t.cleared = true;
        return origClear(id);
      };
    });
    await sender.click('#qrReveal');
    await sender.waitForSelector('#qrCanvas', { timeout: 5000 });
    const a5 = await sender.evaluate(() => {
      const pend = window.__timers.filter(t => !t.cleared && t.delay === 60000);
      return { pending60s: pend.length, totalTimers: window.__timers.length };
    });
    check('A5a: 显示后注册了唯一的 60000ms 自动隐藏定时器', a5.pending60s === 1, JSON.stringify(a5));

    const a3 = await sender.evaluate(() => ({
      url: document.getElementById('qrUrl').textContent,
      urlVisible: !document.getElementById('qrUrl').classList.contains('hidden'),
    }));
    check('A3a: 配对链接可见且形如 origin/noteId#k=<URL-safe>', a3.urlVisible && a3.url === BASE + '/' + NOTE + '#k=' + senderKeySafe, a3.url);
    check('A3b: URL-safe 密钥字符集合法且无填充', /^[A-Za-z0-9_-]+$/.test(senderKeySafe) && !senderKeySafe.includes('='));

    // ---- A4 画布像素 → 模块矩阵；与库输出比对；自研解码器独立解码 ----
    const qr = await sender.evaluate((pairUrl) => {
      const cv = document.getElementById('qrCanvas');
      const q = window.qrcode(0, 'M');
      q.addData(pairUrl, 'Byte');
      q.make();
      const n = q.getModuleCount();
      const w = cv.width, h = cv.height;
      if (w !== h || w % (n + 8) !== 0) return { error: 'bad canvas size ' + w + 'x' + h + ' n=' + n };
      const s = w / (n + 8), quiet = 4 * s;
      const data = cv.getContext('2d').getImageData(0, 0, w, h).data;
      const px = (x, y) => data[(y * w + x) * 4] < 128;
      const matrix = [];
      let mismatches = 0;
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) {
          const dark = px(quiet + c * s + (s >> 1), quiet + r * s + (s >> 1)) ? 1 : 0;
          row.push(dark);
          if (!!dark !== q.isDark(r, c)) mismatches++;
        }
        matrix.push(row);
      }
      // 静区必须全白（取边带采样）
      let quietWhite = true;
      for (let x = 0; x < w && quietWhite; x += 2) {
        if (px(x, 1) || px(x, h - 2) || px(1, x) || px(w - 2, x)) quietWhite = false;
      }
      return { n, s, mismatches, quietWhite, matrix };
    }, a3.url);
    if (qr.error) {
      check('A4a: 画布尺寸与模块布局一致', false, qr.error);
    } else {
      check('A4a: 画布像素还原的模块矩阵与 qrcode 库输出 0 偏差', qr.mismatches === 0, 'mismatches=' + qr.mismatches + ' n=' + qr.n);
      check('A4b: 静区全白', qr.quietWhite);
      let decoded = null, derr = '';
      try { decoded = decodeQrMatrix(qr.matrix.map(r => r.map(Boolean))); }
      catch (e) { derr = e.message; }
      check('A4c: 自研独立解码器从画布还原出完整载荷', !!decoded && decoded.text === a3.url, derr || ('decoded=' + JSON.stringify(decoded && decoded.text)));
      if (decoded) console.log('       (version=' + decoded.version + ', mask=' + decoded.mask + ', EC=M)');
    }

    // ---- A5b 提前触发 60s 回调 → 应复位（等价于 60 秒后自动隐藏）----
    await sender.evaluate(() => {
      const t = window.__timers.find(t => !t.cleared && t.delay === 60000);
      window.clearTimeout(t.id);
      t.fn(); // 手动触发自动隐藏回调
    });
    const a5b = await sender.evaluate(({k, ks}) => {
      const html = document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
      return {
        canvas: !!document.getElementById('qrCanvas'),
        reveal: !!document.getElementById('qrReveal'),
        urlHidden: document.getElementById('qrUrl').classList.contains('hidden'),
        urlEmpty: document.getElementById('qrUrl').textContent === '',
        leakStd: html.includes(k), leakSafe: html.includes(ks),
      };
    }, {k: senderKeyB64, ks: senderKeySafe});
    check('A5b: 自动隐藏回调触发后复位：画布移除、回到"显示"按钮、链接清空', a5b.reveal && !a5b.canvas && a5b.urlHidden && a5b.urlEmpty, JSON.stringify(a5b));
    check('A5c: 复位后 DOM 无密钥残留', !a5b.leakStd && !a5b.leakSafe);

    // ============ A6 关闭弹层复位 + 重开状态正确 ============
    await sender.click('#qrReveal');
    await sender.waitForSelector('#qrCanvas', { timeout: 5000 });
    await sender.click('#qrClose');
    const a6 = await sender.evaluate(({k, ks}) => {
      const html = document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
      return { hidden: document.getElementById('qrMask').classList.contains('hidden'), canvas: !!document.getElementById('qrCanvas'), leak: html.includes(k) || html.includes(ks) };
    }, {k: senderKeyB64, ks: senderKeySafe});
    check('A6a: 关闭后弹层隐藏、画布移除、DOM 无密钥', a6.hidden && !a6.canvas && !a6.leak, JSON.stringify(a6));
    await sender.click('#qrBtn');
    const a6b = await sender.evaluate(() => ({ reveal: !!document.getElementById('qrReveal'), canvas: !!document.getElementById('qrCanvas'), pend60: window.__timers.filter(t => !t.cleared && t.delay === 60000).length }));
    check('A6b: 重新打开为按需初始态（显示按钮、无画布、无悬挂 60s 定时器）', a6b.reveal && !a6b.canvas && a6b.pend60 === 0, JSON.stringify(a6b));
    const pairingUrl = a3.url;

    // ============ F1 接收端正例 + hash 剥离彻底性（全新上下文） ============
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(pairingUrl);
      await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
        && document.getElementById('mask').classList.contains('hidden'), { timeout: 20000 });
      const f1 = await page.evaluate(() => {
        let perfName = '';
        try { perfName = performance.getEntriesByType('navigation')[0].name; } catch (e) {}
        return {
          hash: location.hash, href: location.href, url: document.URL,
          perfName,
          html: document.getElementById('editor').innerHTML,
          stored: localStorage.getItem('notesync_key_' + location.pathname.slice(1)),
        };
      });
      check('F1a: 免口令自动解锁且内容一致', strip(f1.html).includes('BLIND-SEED-520'), strip(f1.html));
      check('F1b: location.hash 已剥离', f1.hash === '');
      check('F1c: href/document.URL 无 #k=', !f1.href.includes('#k=') && !f1.url.includes('#k='), f1.href);
      check('F1d: performance 导航条目不含密钥', !f1.perfName.includes('#k=') && !f1.perfName.includes(senderKeySafe), f1.perfName);
      check('F1e: 接收端密钥与发送端一致（无损落地）', f1.stored === senderKeyB64);
      await ctx.close();
    }

    // ============ B1 构造 base64 含 + 和 / 且带 = 填充的密钥 → 全链路配对 ============
    let raw;
    do { raw = nodeCrypto.randomBytes(32); } while (!(/[+]/.test(raw.toString('base64')) && /[/]/.test(raw.toString('base64'))));
    const rawB64 = raw.toString('base64');
    console.log('  [info] 构造密钥 b64=' + rawB64 + '（含 + / 与 = 填充）');
    {
      const boot = await browser.newContext();
      const bp = await boot.newPage();
      await bp.goto(BASE + '/blindplus');
      await bp.waitForSelector('#pw', { timeout: 10000 });
      const putStatus = await bp.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('<div>PLUS-SLASH-KEY-OK</div>'));
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const b2b = b => btoa(String.fromCharCode(...new Uint8Array(b)));
        const r = await fetch('/api/note/blindplus', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ct: b2b(ct), iv: b2b(iv), salt: b2b(salt) }) });
        return r.status;
      }, rawB64);
      check('B1a: 引导端用含+/密钥加密并写入笔记', putStatus === 200, 'status=' + putStatus);
      await boot.close();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(BASE + '/blindplus#k=' + b64ToUrlSafe(rawB64));
      let unlocked = false;
      try {
        await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
          && document.getElementById('mask').classList.contains('hidden'), { timeout: 15000 });
        unlocked = true;
      } catch (e) {}
      const b1 = await page.evaluate(() => ({
        html: document.getElementById('editor').innerHTML,
        hash: location.hash,
        stored: localStorage.getItem('notesync_key_blindplus'),
        err: document.getElementById('err').textContent,
      }));
      check('B1b: 含 +/= 密钥的 URL-safe 往返无损：配对成功解锁', unlocked, b1.err);
      check('B1c: 解密内容正确', unlocked && strip(b1.html).includes('PLUS-SLASH-KEY-OK'), strip(b1.html));
      check('B1d: 落地密钥 === 标准 base64（含 = 填充原样还原）', b1.stored === rawB64, b1.stored);
      check('B1e: hash 已剥离', b1.hash === '');
      await ctx.close();
    }

    // ============ C1/C2 fragment 垃圾注入（真密钥 + 垃圾）必须拒绝 ============
    // 注：#editor 在 HTML 里默认 contenteditable="true"（遮罩层才是门禁，属既有设计），
    // 故判定"未解锁"以遮罩可见 + 未出现解密内容为准。
    for (const [label, suffix] of [['C1: #k=<真密钥>&foo=1 被拒绝', '&foo=1'], ['C2: #k=<真密钥>#yyy 被拒绝', '#yyy']]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(BASE + '/' + NOTE + '#k=' + senderKeySafe + suffix);
      await page.waitForSelector('#mask:not(.hidden)', { timeout: 15000 }).catch(() => {});
      const c = await page.evaluate(() => ({
        locked: !document.getElementById('mask').classList.contains('hidden'),
        contentLeak: (document.getElementById('editor').textContent || '').includes('BLIND-SEED-520'),
        stored: localStorage.getItem('notesync_key_' + location.pathname.slice(1)),
        hash: location.hash,
      }));
      check(label, c.locked && !c.contentLeak && !c.stored, JSON.stringify(c));
      if (c.hash.includes(senderKeySafe)) note(label.slice(0, 2), 'UX/安全(低): fragment 畸形时 parsePairingKey 直接返回 null，未剥离地址栏 hash——真密钥仍留在地址栏/历史里（未消费、仍有效）。');
      await ctx.close();
    }

    // ============ E1~E4 非法密钥长度优雅回退 ============
    const badKeys = [
      ['E1: 16 字节密钥（可导入 AES-128）回退', nodeCrypto.randomBytes(16)],
      ['E2: 31 字节密钥回退', nodeCrypto.randomBytes(31)],
      ['E3: 64 字节密钥（过长）回退', nodeCrypto.randomBytes(64)],
      ['E4: 1 字节密钥回退', nodeCrypto.randomBytes(1)],
    ];
    for (const [label, buf] of badKeys) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(BASE + '/' + NOTE + '#k=' + b64ToUrlSafe(buf.toString('base64')));
      await page.waitForSelector('#mask:not(.hidden)', { timeout: 15000 }).catch(() => {});
      const e = await page.evaluate(() => ({
        locked: !document.getElementById('mask').classList.contains('hidden'),
        err: document.getElementById('err').textContent,
        hash: location.hash,
        stored: localStorage.getItem('notesync_key_' + location.pathname.slice(1)),
      }));
      check(label, e.locked && e.err.includes('配对链接无效或已失效') && e.hash === '' && !e.stored, JSON.stringify(e));
      await ctx.close();
    }

    // ============ H1 已有正确密钥的设备遇到错误配对密钥：拒绝错误密钥且不破坏已存密钥 ============
    // 既有设备场景：错误配对密钥被拒后，init 继续走 loadStoredKey → 凭已存密钥自动解锁是合理行为；
    // 核心断言是 (a) 错误密钥被明确拒绝（出现提示）(b) 已存密钥未被篡改 (c) 最终用的是旧密钥（内容可解密）。
    {
      const ctx = await browser.newContext();
      const ok = await ctx.newPage();
      await ok.goto(pairingUrl);
      await ok.waitForFunction(() => document.getElementById('mask').classList.contains('hidden')
        && document.getElementById('editor').textContent.includes('BLIND-SEED-520'), { timeout: 20000 });
      const wrong = b64ToUrlSafe(nodeCrypto.randomBytes(32).toString('base64'));
      const bad = await ctx.newPage();
      await bad.goto(BASE + '/' + NOTE + '#k=' + wrong);
      await bad.waitForTimeout(2500); // 等待 pairing 失败 + loadStoredKey 自动解锁路径收敛
      const h1 = await bad.evaluate(() => ({
        maskHidden: document.getElementById('mask').classList.contains('hidden'),
        err: document.getElementById('err').textContent,
        stored: localStorage.getItem('notesync_key_' + location.pathname.slice(1)),
        content: (document.getElementById('editor').textContent || '').replace(/\u200B/g, ''),
        hash: location.hash,
      }));
      check('H1a: 错误配对密钥被明确拒绝（出现"配对链接无效或已失效"提示）', h1.err.includes('配对链接无效或已失效'), JSON.stringify({ maskHidden: h1.maskHidden, err: h1.err }));
      check('H1b: 已存正确密钥未被破坏/覆盖', h1.stored === senderKeyB64, String(h1.stored));
      check('H1c: 设备仍用旧密钥正常解密（错误密钥未生效）', h1.content.includes('BLIND-SEED-520'), h1.content.slice(0, 60));
      check('H1d: 错误密钥的 hash 已剥离', h1.hash === '', h1.hash);
      await ctx.close();
    }

    // ============ D1 配对到不存在的笔记（全新 noteId） ============
    {
      const ghostKey = b64ToUrlSafe(nodeCrypto.randomBytes(32).toString('base64'));
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(BASE + '/blindghost#k=' + ghostKey);
      let unlocked = false;
      try {
        await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
          && document.getElementById('mask').classList.contains('hidden'), { timeout: 12000 });
        unlocked = true;
      } catch (e) { /* 回退口令界面 */ }
      const d1 = await page.evaluate(() => ({
        hash: location.hash,
        stored: localStorage.getItem('notesync_key_blindghost'),
        err: document.getElementById('err').textContent,
        foot: document.getElementById('foot').textContent,
      }));
      const ghostServer = await (await fetch(BASE + '/api/note/blindghost')).json();
      if (unlocked) {
        note('D1', 'BUG(中): 配对到不存在的笔记时未做任何密钥校验即"成功"解锁（note.ct 为空跳过解密校验），'
          + '任意密钥被接受并落地 localStorage（stored=' + !!d1.stored + '），且向服务器 PUT salt 凭空创建了笔记'
          + '（server v=' + ghostServer.v + ', salt=' + !!ghostServer.salt + '）。接收端会误以为已与发送端配对。');
        check('D1: 不存在的笔记不应静默配对成功（任意密钥均通过=违反"错误密钥回退"规格）', false, 'unlocked=true, err="' + d1.err + '"');
      } else {
        check('D1: 不存在的笔记回退口令界面且不落地密钥', d1.hash === '' && !d1.stored, JSON.stringify(d1));
      }
      await ctx.close();
    }

    // ============ G1~G3 429 锁定下的配对行为 ============
    {
      const lockCtx = await browser.newContext();
      const owner = await lockCtx.newPage();
      await owner.goto(BASE + '/blindlock');
      await owner.waitForSelector('#pw', { timeout: 10000 });
      await owner.fill('#pw', 'lock-pass-1');
      await owner.click('#ok');
      await owner.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 20000 });
      await owner.evaluate(() => {
        const e = document.getElementById('editor');
        e.innerHTML = '<div>LOCKED-NOTE-CONTENT</div>';
        e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      });
      await owner.waitForTimeout(1200);
      const lockKeyB64 = await owner.evaluate(() => localStorage.getItem('notesync_key_blindlock'));
      const lastFail = await owner.evaluate(async () => {
        let last = null;
        for (let i = 0; i < 10; i++) {
          const r = await fetch('/api/fail/blindlock', { method: 'POST' });
          last = { status: r.status, body: await r.json() };
        }
        return last;
      });
      check('G0: 已把 blindlock 打入 429 锁定', lastFail.status === 429 || lastFail.body.locked, JSON.stringify(lastFail));

      // G1 有本地密钥的设备：配对不得绕过锁定
      const g1page = await lockCtx.newPage();
      await g1page.goto(BASE + '/blindlock#k=' + b64ToUrlSafe(lockKeyB64));
      await g1page.waitForSelector('#mask:not(.hidden)', { timeout: 15000 }).catch(() => {});
      const g1 = await g1page.evaluate(() => ({
        locked: !document.getElementById('mask').classList.contains('hidden'),
        contentLeak: (document.getElementById('editor').textContent || '').includes('LOCKED-NOTE-CONTENT'),
        hash: location.hash,
        err: document.getElementById('err').textContent,
      }));
      check('G1a: 429 锁定下即便密钥正确也不得解锁（遮罩可见、无解密内容）', g1.locked && !g1.contentLeak, JSON.stringify(g1));
      check('G1b: 锁定场景 hash 仍被剥离', g1.hash === '');
      check('G1c: 有本地密钥的设备显示锁定提示', g1.err.includes('尝试过多'), g1.err);

      // G2 全新设备（无本地密钥）：回退口令界面（记录提示文案）
      const freshCtx = await browser.newContext();
      const g2 = await freshCtx.newPage();
      await g2.goto(BASE + '/blindlock#k=' + b64ToUrlSafe(lockKeyB64));
      await g2.waitForSelector('#mask:not(.hidden)', { timeout: 15000 }).catch(() => {});
      const g2s = await g2.evaluate(() => ({
        locked: !document.getElementById('mask').classList.contains('hidden'),
        err: document.getElementById('err').textContent,
        stored: localStorage.getItem('notesync_key_blindlock'),
        hash: location.hash,
      }));
      check('G2a: 全新设备遇锁定回退口令界面且不落地密钥', g2s.locked && !g2s.stored && g2s.hash === '', JSON.stringify(g2s));
      if (!g2s.err.includes('尝试过多')) note('G2', 'UX(低): 全新设备（无本地密钥）在 429 锁定时初始口令界面未显示锁定提示（err="' + g2s.err + '"），需用户盲输一次口令后才提示。');

      // G3 锁定期间输口令 → 显示锁定提示（不消耗、不解锁）
      await g2.fill('#pw', 'whatever');
      await g2.click('#ok');
      await g2.waitForTimeout(800);
      const g3 = await g2.evaluate(() => ({ err: document.getElementById('err').textContent, locked: !document.getElementById('mask').classList.contains('hidden') }));
      check('G3: 锁定期间口令尝试显示"尝试过多"提示', g3.locked && g3.err.includes('尝试过多'), JSON.stringify(g3));
      await lockCtx.close();
      await freshCtx.close();
    }

    // ============ J1 边界：cryptoKey 存在但 KEY_STORE 被移除 → 显示按钮行为 ============
    {
      // 刷新后凭已存密钥自动解锁（无需再输口令）；随后运行时删除 KEY_STORE，
      // 模拟"内存有密钥、本地存储缺失"的边界（exportKey 失败 / 部分清理数据）。
      await sender.reload();
      await sender.waitForFunction(() => document.getElementById('mask').classList.contains('hidden')
        && document.getElementById('editor').contentEditable === 'true', { timeout: 20000 });
      await sender.evaluate(() => {
        localStorage.removeItem('notesync_key_' + location.pathname.slice(1));
        document.getElementById('qrBtn').click();
      });
      const j0 = await sender.evaluate(() => ({ reveal: !!document.getElementById('qrReveal') }));
      if (j0.reveal) {
        await sender.click('#qrReveal');
        await sender.waitForTimeout(500);
        const j1 = await sender.evaluate(() => ({
          canvas: !!document.getElementById('qrCanvas'),
          urlText: document.getElementById('qrUrl').textContent,
          maskShown: !document.getElementById('qrMask').classList.contains('hidden'),
        }));
        if (!j1.canvas && !j1.urlText) note('J1', 'UX(低): KEY_STORE 缺失（如 exportKey 失败/部分清数据）时，"显示配对二维码"点击后静默无反应（哑按钮），无画布无提示。');
        check('J1: KEY_STORE 缺失时 reveal 行为被记录', true);
      } else {
        check('J1: KEY_STORE 缺失时不出现误导性"显示"按钮', true);
      }
    }

    await senderCtx.close();
  } finally {
    if (browser) {
      await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 6000))]).catch(() => {});
    }
    child.kill('SIGKILL');
  }

  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  if (findings.length) { console.log('发现/备注:'); findings.forEach(f => console.log('  - ' + f)); }
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
