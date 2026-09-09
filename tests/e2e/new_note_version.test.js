// NoteSync E2E 回归：「空笔记名从零建笔记」首存版本对齐
// 背景 bug（v7.5.1 定案根修）：全新笔记解锁时，落盐 PUT 把服务器顶到 v1 并设 localVer=1，
// 但紧随的 applyUnlocked 用落盐前的旧快照 note.v=0 又把 localVer 覆盖回 0 →
// 首端此后每次正文保存 baseV=0 撞服务器 v1 → 永久 409、正文永不落库；次端只读到空 v1（“已同步但空、刷新无效”）。
// seedNote 预建笔记会跳过“!note.salt 落盐”分支 → 旧套件从来看不到此路径，本用例专门堵这个盲区。
// 真起 server.js（含 baseV/409 + SSE）+ 真 Chromium 双 context。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server.js');
const DATA_NOTES = path.join(ROOT, 'data', 'notes');
const PBKDF2_ITER = 200000;
const NODE = process.execPath;

process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket|context|disposed/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg); process.exitCode = 1;
});

function b64ToBuf(s) { return Uint8Array.from(Buffer.from(s, 'base64')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
function startServer() {
  return new Promise(async (resolve) => {
    const port = await freePort();
    const child = spawn(NODE, [SERVER], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (d) => (stderr += d));
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
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function deriveKey(pass, saltBuf) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBuf, iterations: PBKDF2_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function decryptText(ct, iv, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, key, b64ToBuf(ct));
  return new TextDecoder().decode(pt);
}

test('空笔记名从零建笔记：首存不 409、版本对齐、次端能 poll 到内容', async () => {
  const id = 'REGNEWNOTE1';
  const PASS = 'regpw123';
  const server = await startServer();
  const baseURL = `http://localhost:${server.port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const putStatuses = [];
  try {
    // —— 首端：口令解锁一条“服务器尚不存在”的全新笔记 ——
    const A = await browser.newContext();
    const a = await A.newPage();
    a.on('response', (res) => { if (/\/api\/note\//.test(res.url()) && !/\/stream$/.test(res.url()) && res.request().method() === 'PUT') putStatuses.push(res.status()); });
    await a.goto(baseURL + encodeURIComponent(id));
    await a.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
    await a.evaluate((p) => window.unlock(String(p)), PASS);
    await a.waitForFunction(() => { const ed = document.getElementById('editor'); const m = document.getElementById('mask'); return ed && ed.getAttribute('contentEditable') === 'true' && m && m.classList.contains('hidden'); }, { timeout: 15000 });

    // 关键不变量（回归点）：落盐写完服务器到 v1 后，applyUnlocked 不得把 localVer 覆盖回 0。
    const nAfterUnlock = await apiGet(server.port, id);
    const verAfterUnlock = await a.evaluate(() => localVer);
    assert.strictEqual(nAfterUnlock.v, 1, '新笔记解锁后服务器应已落盐到 v=1');
    assert.strictEqual(verAfterUnlock, nAfterUnlock.v, `解锁后 localVer 必须等于服务器版本（got ${verAfterUnlock} vs ${nAfterUnlock.v}）——旧快照覆盖 bug 的判据`);

    // —— 首端输入正文并保存：绝不能再出现 409，且必须真正落库 ——
    await a.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); ed.innerHTML = '<div>HELLO-X</div>'; ed.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'HELLO-X', bubbles: true })); });
    await a.evaluate(() => saveLocal());
    await sleep(1200);
    assert.ok(!putStatuses.includes(409), '首端正文保存不得出现 409（版本被覆盖回 0 会导致永久 409）：' + JSON.stringify(putStatuses));
    const nAfterSave = await apiGet(server.port, id);
    const kA = await deriveKey(PASS, b64ToBuf(nAfterSave.salt));
    const bodyAfterSave = await decryptText(nAfterSave.ct, nAfterSave.iv, kA);
    assert.ok(bodyAfterSave.includes('HELLO-X'), '服务器正文必须含首端输入的 HELLO-X（实际=' + JSON.stringify(bodyAfterSave) + '）');

    // —— 次端（干净、口令解锁）：靠 poll 自动拉到 HELLO-X ——
    const B = await browser.newContext();
    const b = await B.newPage();
    await b.goto(baseURL + encodeURIComponent(id));
    await b.waitForFunction(() => typeof window.unlock === 'function', { timeout: 15000 });
    await b.evaluate((p) => window.unlock(String(p)), PASS);
    await b.waitForFunction(() => document.getElementById('editor').textContent.includes('HELLO-X'), undefined, { timeout: 8000 });
    const verB = await b.evaluate(() => localVer);
    assert.strictEqual(verB, nAfterSave.v, '次端 poll 采纳后 localVer 应等于服务器版本');

    await A.close(); await B.close();
  } finally {
    try { fs.unlinkSync(path.join(DATA_NOTES, id + '.json')); } catch (e) {}
    try { fs.unlinkSync(path.join(DATA_NOTES, id + '.hist.json')); } catch (e) {}
    try { server.child.kill(); } catch (e) {}
    if (browser) { await Promise.race([browser.close().then(() => true).catch(() => true), new Promise((r) => setTimeout(() => r(true), 6000))]).catch(() => {}); }
  }
});
