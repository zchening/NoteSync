// _probe_save_reliability.js — v5.19 I4 保存可靠性验证
//   S1 busy 期间的输入不再丢失：本轮保存完成后 pendingResave 触发补存
//   S2 保存失败自动退避重试：首次 PUT 拒绝后 ~3s 重试成功
//   S3 flushDirtySave：未保存内容可立即兜底写出（不等 800ms 防抖）
//   S4 输入记入撤销栈（Ctrl+Z 可还原）
// 环境：spawn 真实 server.js（localhost 安全上下文，crypto.subtle 可用，unlock 走真实派生），
// 仅 apiPut/encryptText 替换为可控 stub（注入延迟/失败、捕获明文）；apiGet 走真实服务端。
// 判定只依赖 apiPut 调用次数与 encryptText 捕获的内容，不受 poll 状态文案干扰。
// 用法: node tests/e2e/_probe_save_reliability.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const PORT = '8141';
const BASE = 'http://localhost:' + PORT;
const NOTE = 'probeSaveReliability';

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
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
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.goto(BASE + '/' + NOTE);
    await page.waitForSelector('#pw', { timeout: 10000 });

    // unlock 前替换 apiPut 为可控 stub；encryptText stub 捕获明文（真实加密对断言无意义）
    await page.evaluate(() => {
      window.__attempts = 0;       // apiPut 被调用次数（含失败）
      window.__puts = 0;           // apiPut 成功次数
      window.__saved = [];         // encryptText 捕获到的待存 html
      window.__putDelay = 0;
      window.__failNext = 0;
      window.apiPut = async () => {
        window.__attempts++;
        if (window.__putDelay) await new Promise(r => setTimeout(r, window.__putDelay));
        if (window.__failNext > 0) { window.__failNext--; throw new Error('simulated network failure'); }
        window.__puts++;
        return { v: window.__puts };
      };
      window.encryptText = async (text) => { window.__saved.push(text); return { ct: 'ct', iv: 'iv' }; };
    });
    await page.fill('#pw', 'probe-pass');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
      && document.getElementById('mask').classList.contains('hidden'), { timeout: 15000 });

    const type = (html) => page.evaluate(v => {
      const e = document.getElementById('editor');
      e.innerHTML = v;
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }, html);
    const snap = () => page.evaluate(() => ({
      attempts: window.__attempts, puts: window.__puts,
      saved: window.__saved.map(s => s.replace(/\u200B/g, '')),
    }));
    // waitForFunction 不能闭包 Node 侧变量，阈值必须作为参数传入页面
    const waitCounts = (minAttempts, minPuts, timeout) =>
      page.waitForFunction(([a, p]) => window.__attempts >= a && window.__puts >= p,
        [minAttempts, minPuts], { timeout, polling: 200 }).catch(() => {});

    // unlock 会经 stub 存一次 salt（attempt#1），等它落定再开始
    await waitCounts(1, 1, 5000);
    const base = await snap();

    // ===================== S1 busy 期间的输入补存 =====================
    console.log('\n===== S1: busy（保存中）期间的输入不丢失 =====');
    await page.evaluate(() => { window.__putDelay = 1200; });
    await type('<div>v1</div>');                    // 800ms 防抖后开始第一次保存（占用 1200ms）
    await page.waitForTimeout(800 + 400);          // 第一次 PUT 进行中（busy=true）
    await type('<div>v1</div><div>v2busy</div>');  // busy 期间输入 → pendingResave
    await waitCounts(base.attempts + 2, base.puts + 2, 8000);
    await page.evaluate(() => { window.__putDelay = 0; });
    let st = await snap();
    console.log('  attempts=' + st.attempts + ' puts=' + st.puts + ' saved=' + JSON.stringify(st.saved.slice(base.saved.length)));
    check('S1: busy 期间的输入触发了补存（新增 ≥2 次保存尝试）', st.attempts - base.attempts >= 2, 'attempts ' + base.attempts + '->' + st.attempts);
    check('S1: 补存内容为最新版（含 v2busy）', st.saved.some(s => strip(s).includes('v2busy')), JSON.stringify(st.saved.slice(base.saved.length)));

    // ===================== S2 保存失败自动重试 =====================
    console.log('\n===== S2: 保存失败后 ~3s 自动重试成功 =====');
    const preS2 = await snap();
    await page.evaluate(() => { window.__failNext = 1; });
    await type('<div>v3retry</div>');
    await waitCounts(preS2.attempts + 1, 0, 3000);
    st = await snap();
    check('S2: 失败的保存已发生（attempt+1 且内容已捕获）', st.attempts === preS2.attempts + 1 && st.saved.some(s => strip(s).includes('v3retry')), 'attempts=' + st.attempts);
    await waitCounts(preS2.attempts + 2, preS2.puts + 1, 8000);
    st = await snap();
    console.log('  attempts=' + st.attempts + ' puts=' + st.puts);
    check('S2: 重试后出现一次成功 PUT', st.puts === preS2.puts + 1, 'puts ' + preS2.puts + '->' + st.puts);
    check('S2: 重试共发起 2 次尝试（首次失败+重试）', st.attempts === preS2.attempts + 2, 'attempts ' + preS2.attempts + '->' + st.attempts);

    // ===================== S3 flushDirtySave 兜底 =====================
    console.log('\n===== S3: flushDirtySave 立即写出未保存内容 =====');
    const preS3 = await snap();
    await type('<div>v4flush</div>');
    await page.evaluate(() => window.flushDirtySave());   // 不等 800ms 防抖，立即触发
    await waitCounts(preS3.attempts + 1, 0, 3000);
    st = await snap();
    check('S3: flushDirtySave 立即保存了脏内容（attempt+1）', st.attempts === preS3.attempts + 1, 'attempts ' + preS3.attempts + '->' + st.attempts);
    check('S3: 保存内容为 v4flush', st.saved.some(s => strip(s).includes('v4flush')), JSON.stringify(st.saved.slice(preS3.saved.length)));

    // ===================== S4 输入记入撤销栈 =====================
    console.log('\n===== S4: 输入后 Ctrl+Z 能还原 =====');
    await waitCounts(preS3.attempts + 1, preS3.puts + 1, 5000);
    await type('<div>v5undo</div>');
    await page.waitForTimeout(200);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyZ');
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const afterUndo = strip(await page.evaluate(() => document.getElementById('editor').innerHTML));
    check('S4: Ctrl+Z 撤销掉最近一笔输入', !afterUndo.includes('v5undo'), afterUndo);
  } finally {
    if (browser) await browser.close();
    child.kill('SIGKILL');
  }

  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
