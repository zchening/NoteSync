// NoteSync v7.3.4「跨设备自动合并」(automerge) 全链路验证探针
// 真实：spawn 真实 server.js（乐观并发 409 + SSE 广播）+ 真实 Chromium（Playwright）双 context。
// 加解密走真实 AES-256-GCM + PBKDF2(200000) —— 基线笔记通过真实加密 PUT 预置到服务端（与客户端同算法），
// 两端解锁、编辑、保存全部走真实客户端代码路径。
// 逐场景最终行为 PASS/FAIL + 冲突条 DOM 证据 + 服务端最终正文（用一台独立 verifier 页解密读取）。
// 覆盖：S1 分离段自动合并 / S2 同段真冲突仍弹条 / S3 同段同改采纳 / S4 等待同步 / S5 无脏端自动采纳。
// 运行：node tests/e2e/_probe_v734_full.js   （退出码 0=5 场景全过；1=有失败）
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server.js');
const DATA_NOTES = path.join(ROOT, 'data', 'notes');

const PASS = 'probe-pass';
const PBKDF2_ITER = 200000;
const BODY = '<div>First</div><div>Second</div><div>Third</div>';

const NODE = process.execPath; // 运行本探针的 node 即指定二进制

// ---------------- 工具 ----------------
function b64(buf) { return Buffer.from(buf).toString('base64'); }
function b64ToBuf(s) { return Uint8Array.from(Buffer.from(s, 'base64')); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(fn, timeout = 6000, step = 100) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() - t0 > timeout) throw new Error('timeout after ' + timeout + 'ms (last=' + (last && last.message ? last.message : JSON.stringify(last)) + ')');
    await sleep(step);
  }
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function startServer() {
  return new Promise(async (resolve) => {
    const port = await freePort();
    const child = spawn(NODE, [SERVER], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const t0 = Date.now();
    const check = () => {
      const r = http.get(`http://localhost:${port}/healthz`, (res) => { res.resume(); res.on('end', () => resolve({ child, port })); });
      r.on('error', () => { if (Date.now() - t0 > 8000) { child.kill(); throw new Error('server boot fail: ' + stderr); } setTimeout(check, 120); });
    };
    check();
  });
}
function apiGet(port, id) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/api/note/${encodeURIComponent(id)}`, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('get ' + res.statusCode + ': ' + b));
        resolve(JSON.parse(b));
      });
    }).on('error', reject);
  });
}
function apiPut(port, id, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: 'localhost', port, path: `/api/note/${encodeURIComponent(id)}`, method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: (() => { try { return JSON.parse(b); } catch { return b; } })() }));
    });
    r.on('error', reject); r.end(data);
  });
}
async function deriveKey(pass, saltBuf) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBuf, iterations: PBKDF2_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encryptText(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { ct: b64(ct), iv: b64(iv) };
}
// 预置基线笔记：真实加密后 PUT 到服务端（同客户端算法）。返回 salt b64。
async function seedNote(port, id, html) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(PASS, salt);
  const enc = await encryptText(html, key);
  const r = await apiPut(port, id, { ct: enc.ct, iv: enc.iv, salt: b64(salt) });
  if (r.status !== 200) throw new Error('seed put ' + r.status + ' ' + JSON.stringify(r.body));
  return { salt: b64(salt) };
}

// ---------------- 浏览器 ----------------
async function launch() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  return browser;
}
// 打开笔记并真实解锁（窗口疏散除非口头）。返回 {ctx,page,errs}
async function openDevice(browser, baseURL, noteId, waitText) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto(baseURL + encodeURIComponent(noteId));
  await page.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
  await page.evaluate((p) => window.unlock(String(p)), PASS);
  await page.waitForFunction(() => {
    const ed = document.getElementById('editor');
    const mask = document.getElementById('mask');
    return ed && ed.getAttribute('contenteditable') === 'true' && mask && mask.classList.contains('hidden');
  }, { timeout: 15000 });
  if (waitText) await page.waitForFunction((t) => document.getElementById('editor').textContent.includes(t), waitText, { timeout: 10000 });
  return { ctx, page, errs };
}
// 向第 idx 个根级块末尾追加 suffix，并派发真实 InputEvent（激活保存/脏判定链路）。
async function appendToPara(page, idx, suffix) {
  await page.evaluate(({ idx, suffix }) => {
    const ed = document.getElementById('editor');
    const blocks = Array.from(ed.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && String(n.nodeValue || '').trim() !== ''));
    const target = blocks[idx];
    if (!target) throw new Error('no block idx=' + idx + ' total=' + blocks.length);
    target.appendChild(document.createTextNode(suffix));
    ed.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: suffix, bubbles: true }));
  }, { idx, suffix });
}
async function snap(page) {
  return await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const rb = document.getElementById('remoteBar');
    return {
      text: ed.textContent,
      html: ed.innerHTML,
      remoteBarVisible: !!(rb && !rb.classList.contains('hidden')),
      pendingRemote: (typeof pendingRemoteNote !== 'undefined' && pendingRemoteNote) ? 1 : 0,
      localVer: (typeof localVer !== 'undefined' ? localVer : null),
      wconMerge: (window.__wconAutoMerge || 0),
      pollMerge: (window.__pollLevel2Merge || 0),
      pollSkip: (window.__pollSkipCount || 0),
    };
  });
}

function cleanup(dataFiles) {
  for (const id of dataFiles) {
    try { fs.unlinkSync(path.join(DATA_NOTES, id + '.json')); } catch (e) {}
    try { fs.unlinkSync(path.join(DATA_NOTES, id + '.hist.json')); } catch (e) {}
  }
}

// Windows/Playwright 拆解阶段偶发未处理 rejection（context/browser 竞态关闭）——
// 吞掉拆解噪声，不让它污染场景结果与退出码（对齐现有 e2e 的 --test-force-exit 纪律）。
process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/context|browser|protocol|closed|target|connection|transport|websocket|disposed/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

// ---------------- 结果收集 ----------------
const results = [];
function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + evidence);
}

let browser, server;
const notefiles = [];

async function main() {
  try {
    browser = await launch();
    server = await startServer();
    const baseURL = `http://localhost:${server.port}/`;

    // 真冲突/真合并场景统一编排：B 先改（在基线 v=1 上变脏），随后 A 改+保存（服务端 v=2），
    // 再让 B 保存（baseV=1 → 409 → handleWriteConflict → autoMerge）。
    // 关键：B 必须先在自己脏的状态下留在 v=1 基线，否则 B 干净时 poll 会先把 A 的更新采纳给 B，
    // 那就不再是「同基线并发」而是「顺序编辑」，测不到 409/合并路径。
    async function runConflictScenario(id, aIdx, aSuffix, bIdx, bSuffix) {
      await seedNote(server.port, id, BODY); // server v=1
      const A = await openDevice(browser, baseURL, id, 'First');
      const B = await openDevice(browser, baseURL, id, 'First');
      await appendToPara(B.page, bIdx, bSuffix); // B 先改（同基线 v=1 脏）
      await appendToPara(A.page, aIdx, aSuffix); // A 改
      await A.page.evaluate(() => saveLocal()); // A 保存成功 → server v=2
      await waitFor(async () => (await apiGet(server.port, id)).v === 2, 4000);
      await B.page.evaluate(() => saveLocal()); // baseV=1 → 409 → handleWriteConflict → autoMerge/等价
      await sleep(500);
      const b = await snap(B.page);
      const n = await apiGet(server.port, id);
      return { A, B, b, n };
    }

    // ============ S1 + S4 分离段自动合并 ============
    {
      const id = 'V734S1';
      notefiles.push(id);
      // B 改第2段(Second→SecondBBB)、A 改第1段(First→FirstAAA)，两端改不同块
      const { A, B, b, n } = await runConflictScenario(id, 0, 'AAA', 1, 'BBB');
      const bar = b.remoteBarVisible;
      const both = b.text.includes('FirstAAA') && b.text.includes('SecondBBB');
      const mergeRan = (b.wconMerge + b.pollMerge) >= 1;
      const ok = !bar && both && n.v >= 3 && mergeRan;
      record('S1 分离段自动合并（不弹条）', ok,
          'B editor=' + JSON.stringify(b.text) + ' | FirstAAA=' + b.text.includes('FirstAAA') + ' SecondBBB=' + b.text.includes('SecondBBB') +
          ' | remoteBar=' + bar + ' | pendingRemote=' + b.pendingRemote + ' | server.v=' + n.v +
          ' | pollMerge=' + b.pollMerge + ' | wconMerge=' + b.wconMerge + ' | autoMergeRan=' + mergeRan);

      // S4 等待同步：等 2s 后 B 端仍看到合并后的完整内容 + 独立 verifier 页解密服务端正文作最终证据
      await sleep(2000);
      const bAfter = await snap(B.page);
      const verifier = await openDevice(browser, baseURL, id, 'First');
      const vText = (await snap(verifier.page)).text;
      verifier.ctx.close();
      const s4ok = bAfter.text.includes('FirstAAA') && bAfter.text.includes('SecondBBB') &&
        vText.includes('FirstAAA') && vText.includes('SecondBBB');
      record('S4 等待同步后两端/服务端均见合并结果', s4ok,
          'B=' + JSON.stringify(bAfter.text) + ' | serverBody(verifier)=' + JSON.stringify(vText));
      A.ctx.close(); B.ctx.close();
    }

    // ============ S2 同段真冲突仍弹条 ============
    {
      const id = 'V734S2';
      notefiles.push(id);
      // 双方同段(第1段 First)改成不同内容（A→FirstAAA，B→FirstBBB）
      const { A, B, b, n } = await runConflictScenario(id, 0, 'AAA', 0, 'BBB');
      const bar = b.remoteBarVisible;
      // 服务端不能被 B 静默覆盖（仍应是 A 的 FirstAAA；B 的 FirstBBB 挂起待拍板）
      const verifier = await openDevice(browser, baseURL, id, 'First');
      const vText = (await snap(verifier.page)).text;
      verifier.ctx.close();
      const ok = bar && b.pendingRemote === 1 && !vText.includes('FirstBBB') && vText.includes('FirstAAA');
      record('S2 同段真冲突仍弹条（不静默吞任意一端）', ok,
          'remoteBar=' + bar + ' | pendingRemote=' + b.pendingRemote + ' | B editor=' + JSON.stringify(b.text) +
          ' | serverBody(verifier)=' + JSON.stringify(vText) + ' | server.v=' + n.v);
      A.ctx.close(); B.ctx.close();
    }

    // ============ S3 同段同改（内容恰好一致）采纳不弹条 ============
    {
      const id = 'V734S3';
      notefiles.push(id);
      // 双方同段(第1段 First)都改成 FirstAAA（内容一致）
      const { A, B, b, n } = await runConflictScenario(id, 0, 'AAA', 0, 'AAA');
      const verifier = await openDevice(browser, baseURL, id, 'First');
      const vText = (await snap(verifier.page)).text;
      verifier.ctx.close();
      const ok = !b.remoteBarVisible && vText.includes('FirstAAA') && vText.includes('Second') && !vText.includes('FirstAAABBB');
      record('S3 同段同改采纳一次不弹条', ok,
          'remoteBar=' + b.remoteBarVisible + ' | B editor=' + JSON.stringify(b.text) + ' | serverBody(verifier)=' + JSON.stringify(vText) + ' | server.v=' + n.v);
      A.ctx.close(); B.ctx.close();
    }

    // ============ S5 无脏端自动采纳（不回归） ============
    {
      const id = 'V734S5';
      notefiles.push(id);
      await seedNote(server.port, id, BODY);
      const A = await openDevice(browser, baseURL, id, 'First');
      const C = await openDevice(browser, baseURL, id, 'First'); // C 只打开不编辑，干净
      await appendToPara(A.page, 0, 'AAA');
      await A.page.evaluate(() => saveLocal());
      // C 靠 2s 轮询/SSE 自动采纳，不弹条
      await C.page.waitForFunction(() => document.getElementById('editor').textContent.includes('FirstAAA'), undefined, { timeout: 8000 });
      const c = await snap(C.page);
      const n = await apiGet(server.port, id);
      const ok = !c.remoteBarVisible && c.text.includes('FirstAAA') && c.pendingRemote === 0;
      record('S5 无脏端 poll 自动采纳（不弹条，不回归）', ok,
          'C editor=' + JSON.stringify(c.text) + ' | FirstAAA=' + c.text.includes('FirstAAA') + ' | remoteBar=' + c.remoteBarVisible + ' | pendingRemote=' + c.pendingRemote + ' | server.v=' + n.v);
      A.ctx.close(); C.ctx.close();
    }

  } catch (e) {
    console.error('探针异常（主流程）: ', e && e.stack || e);
    results.push({ name: 'MAIN', pass: false, evidence: String(e && e.message || e) });
  } finally {
    cleanup(notefiles);
    try { if (server && server.child) server.child.kill(); } catch (e) {}
    if (browser) {
      await Promise.race([
        browser.close().then(() => true).catch(() => true),
        new Promise((r) => setTimeout(() => r(true), 6000)),
      ]).catch(() => {});
    }
  }
}

main().then(() => {
  const failed = results.filter((r) => !r.pass);
  console.log('\n==== v7.3.4 automerge 全链路探针结果 ====');
  for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + ' | ' + r.name);
  if (results.length === 0) { console.log('没有任何场景被评估（主流程未跑完）'); process.exit(1); }
  console.log('失败数: ' + failed.length + ' / ' + results.length);
  process.exit(failed.length > 0 ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });