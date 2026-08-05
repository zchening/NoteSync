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

// ── Bug 1：落地页笔记名输入框禁止中文/符号，仅保留英文与数字 ──────────
test('Bug1 落地页输入框过滤中文与符号，仅保留英文数字', () => {
  const li = document.getElementById('landingInput');
  assert.ok(li, 'landingInput 应存在');

  // 纯中文应被完全剔除
  li.value = '我的笔记';
  dispatchInput(li);
  assert.strictEqual(li.value, '', '中文输入应被清空');

  // 中英文混合：仅保留英文部分
  li.value = '我的Note123';
  dispatchInput(li);
  assert.strictEqual(li.value, 'Note123', '中文应被剔除，仅留英文数字');

  // 英文数字保留
  li.value = 'MyNote123';
  dispatchInput(li);
  assert.strictEqual(li.value, 'MyNote123', '英文数字应被保留');

  // 符号与空格被剔除；v5.19 起 _ 与 - 恢复为合法字符（与后端 ID_RE 一致）
  li.value = 'a-b@c d!';
  dispatchInput(li);
  assert.strictEqual(li.value, 'a-bcd', '符号与空格应被剔除，短横线保留');

  li.value = 'my_note-1';
  dispatchInput(li);
  assert.strictEqual(li.value, 'my_note-1', '下划线与短横线应被保留');
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

// ── Bug 4：PWA 图标恢复为备案前透明金 logo（v5.16 修正 v5.15 误改黑底）──
test('Bug4 manifest 仅引用透明 favicon.svg（purpose 含 maskable，无 maskable PNG）', () => {
  const manifestPath = path.resolve(__dirname, '..', '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const icons = manifest.icons || [];
  // 应存在 favicon.svg 的 maskable 条目（备案前即如此）
  const faviconMaskable = icons.find(
    (i) => (i.src || '').includes('favicon.svg') && (i.purpose || '').split(/\s+/).includes('maskable')
  );
  assert.ok(faviconMaskable, 'manifest 应含 favicon.svg 的 purpose=maskable 条目');
  // 不应再有任何 icon-maskable-*.png 条目（v5.14 加、v5.16 移除）
  const png = icons.find((i) => (i.src || '').includes('icon-maskable'));
  assert.ok(!png, 'manifest 不应再含 icon-maskable-*.png 条目；icons=' + JSON.stringify(icons));
});

test('Bug4 favicon.svg 为透明金 logo（无黑色背景填充）', () => {
  const svgPath = path.resolve(__dirname, '..', '..', 'favicon.svg');
  const svg = fs.readFileSync(svgPath, 'utf8');
  assert.ok(!svg.includes('fill="#0F0F11"'), 'favicon.svg 不应含黑色背景 #0F0F11（备案前为透明）');
  assert.ok(svg.includes('stroke="#8F7126"'), 'favicon.svg 应保留金色描边 #8F7126');
});

// ── Bug 5：指纹解锁功能已按用户决定彻底移除（v5.15）─────────────────
// 此前基于 WebAuthn PRF 的指纹解锁在浏览器内只能走"通行密钥"流程，
// 且国内 Android 设备普遍不可用，故 v5.15 起完全移除相关代码与 UI。
// 本条仅断言：指纹相关全局函数与元素已不复存在。
test('Bug5 指纹解锁相关代码已彻底移除', () => {
  assert.strictEqual(typeof window.supportsWebAuthnPRF, 'undefined', 'supportsWebAuthnPRF 应已删除');
  assert.strictEqual(typeof window.enrollBiometric, 'undefined', 'enrollBiometric 应已删除');
  assert.strictEqual(typeof window.unlockWithBiometric, 'undefined', 'unlockWithBiometric 应已删除');
  assert.strictEqual(typeof window.updateBioUI, 'undefined', 'updateBioUI 应已删除');
  assert.strictEqual(document.getElementById('bioBtn'), null, 'bioBtn 元素应已删除');
  assert.strictEqual(document.getElementById('bioBanner'), null, 'bioBanner 元素应已删除');
});
