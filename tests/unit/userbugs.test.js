// NoteSync 单元测试（jsdom 加载真实 index.html）
// 覆盖 5 个用户报告缺陷(Bug 1~5) 的修复验证。
// 仅创建本文件并运行，不修改任何应用代码或其它测试文件。
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../helpers');

const dom = loadApp();
const { window } = dom;
const document = window.document;

// 测试结束后关闭 jsdom window，避免遗留定时器导致进程退出码非 0
after(() => { try { window.close(); } catch (e) {} });

function dispatchInput(el) {
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

// ── Bug 1：落地页笔记名输入框应接受中文，不被清空/拦截 ───────────────
test('Bug1 落地页输入框保留中英文（中文不被清空）', () => {
  const li = document.getElementById('landingInput');
  assert.ok(li, 'landingInput 应存在');
  li.value = '我的笔记';
  dispatchInput(li);
  assert.strictEqual(li.value, '我的笔记', '中文应被保留');

  li.value = 'MyNote';
  dispatchInput(li);
  assert.strictEqual(li.value, 'MyNote', '英文应被保留');
});

// ── Bug 2：笔记名为空时「打开」按钮应禁用 ───────────────────────────
test('Bug2 落地页「打开」按钮按名称是否为空禁用', () => {
  const li = document.getElementById('landingInput');
  const lb = document.getElementById('landingBtn');
  assert.ok(lb, 'landingBtn 应存在');

  // 各断言自洽：先显式置空并派发 input，建立“空名称”基线（等价于初始 landing 状态）
  li.value = '';
  dispatchInput(li);
  assert.strictEqual(lb.disabled, true, '初始空名称应禁用');

  li.value = 'abc';
  dispatchInput(li);
  assert.strictEqual(lb.disabled, false, '非空名称应启用');

  li.value = '   ';          // 仅空格（trim 守卫）
  dispatchInput(li);
  assert.strictEqual(lb.disabled, true, '纯空格应禁用(trim 守卫)');
});

// ── Bug 3：口令为空时「解 锁」按钮禁用，且禁用样式有意呈现 ──────────
test('Bug3 「解 锁」按钮按口令是否为空禁用', () => {
  const pw = document.getElementById('pw');
  const ok = document.getElementById('ok');
  assert.ok(ok, 'ok 应存在');

  // 初始（空）应禁用（HTML 的 disabled 属性）
  assert.strictEqual(ok.disabled, true, '初始空口令应禁用');

  pw.value = 'x';
  dispatchInput(pw);
  assert.strictEqual(ok.disabled, false, '非空口令应启用');

  pw.value = '';
  dispatchInput(pw);
  assert.strictEqual(ok.disabled, true, '清空口令应重新禁用');
});

test('Bug3 禁用按钮存在有意样式规则（button:disabled）', () => {
  // jsdom 对 CSS 变量/计算样式的支持弱，故只扫描 styleSheets 中是否存在
  // 选择器含 button:disabled 且声明含 background:var(--line) / cursor:not-allowed /
  // box-shadow:none 的规则。（真实计算样式由 E2E 在 Chromium 中验证）
  let found = null;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (const r of rules) {
      const sel = r.selectorText || '';
      // jsdom 会规范化 cssText（冒号/分号后补空格），先去掉空白再匹配
      const css = (r.cssText || '').toLowerCase().replace(/\s+/g, '');
      if (sel.includes('button:disabled') &&
          css.includes('background:var(--line)') &&
          css.includes('cursor:not-allowed') &&
          css.includes('box-shadow:none')) {
        found = r;
        break;
      }
    }
    if (found) break;
  }
  assert.ok(found, '应存在针对 button:disabled 的有意禁用样式规则');
});

// ── Bug 4：PWA maskable 图标 + favicon 使用奶油色背景（非黑）─────────
test('Bug4 manifest 含 maskable 目的图标（奶油色背景）', () => {
  const manifestPath = path.resolve(__dirname, '..', '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const icons = manifest.icons || [];
  const maskable = icons.filter((i) => (i.purpose || '').split(/\s+/).includes('maskable'));
  assert.ok(maskable.length >= 1, 'manifest 应至少含一个 purpose=maskable 图标');
  assert.ok(
    maskable.some((i) => (i.src || '').includes('icon-maskable-512.png')),
    '应存在 icon-maskable-512.png 的 maskable 条目'
  );
});

test('Bug4 favicon.svg 使用奶油色背景（非黑）', () => {
  const svgPath = path.resolve(__dirname, '..', '..', 'favicon.svg');
  const svg = fs.readFileSync(svgPath, 'utf8');
  assert.ok(svg.includes('fill="#FBFBF8"'), 'favicon.svg 应含奶油色背景 #FBFBF8');
});

// ── Bug 5：移动端指纹解锁（WebAuthn PRF）在 jsdom 中的可测部分 ──────
// 注意：jsdom 未实现 crypto.subtle / PublicKeyCredential，故加密往返无法在此运行。
test('Bug5 supportsWebAuthnPRF 在 jsdom 中解析为 false', async () => {
  const supported = await window.supportsWebAuthnPRF();
  assert.strictEqual(supported, false, 'jsdom 无 PublicKeyCredential，应为 false');
});

test('Bug5 updateBioUI 在 PRF 不支持时隐藏 bioBtn', async () => {
  const bioBtn = document.getElementById('bioBtn');
  assert.ok(bioBtn, 'bioBtn 应存在');
  await window.updateBioUI();
  assert.strictEqual(bioBtn.style.display, 'none', 'PRF 不支持时 bioBtn 应隐藏');
});

test('Bug5 enrollBiometric 无密钥时不抛错并设置状态文案', async () => {
  // 全新 jsdom localStorage 中无 KEY_STORE → 命中 !masterRawB64 守卫
  let threw = false;
  try {
    await window.enrollBiometric();
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'enrollBiometric 应不抛异常');
  const status = document.getElementById('uploadStatus');
  assert.ok(status, 'uploadStatus 应存在');
  assert.ok((status.textContent || '').length > 0, '应设置一段状态文案');
});

test('Bug5 unlockWithBiometric 无 BIO_STORE 时不抛错并设置错误文案', async () => {
  const errEl = document.getElementById('err');
  assert.ok(errEl, 'err 应存在');
  let threw = false;
  try {
    await window.unlockWithBiometric();
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'unlockWithBiometric 应不抛异常');
  assert.ok((errEl.textContent || '').length > 0, '应设置一段错误文案');
});
