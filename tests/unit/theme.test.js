// NoteSync 单元测试：夜间模式 color-scheme 声明（浏览器兼容性修复专项）
// 验证：applyTheme 切换时同步设置 <html> 的 color-scheme，
// 对抗小米/QQ浏览器（遵守标准的夜间模式）对页面强制反色。
// 仅创建本文件并运行，不修改任何应用代码或其它测试文件。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

const dom = loadApp();
const { window } = dom;
const document = window.document;

after(() => { try { window.close(); } catch (e) {} });

// 读取 <html> 上声明的 color-scheme（兼容 jsdom 不同读取方式）
function schemeOf() {
  const el = document.documentElement;
  if (el.style.colorScheme) return el.style.colorScheme;
  const m = /color-scheme\s*:\s*([^;]+)/.exec(el.getAttribute('style') || '');
  return m ? m[1].trim() : '';
}

test('applyTheme(true) 将 <html> color-scheme 设为 dark', () => {
  window.applyTheme(true);
  assert.strictEqual(schemeOf(), 'dark', '夜间模式应声明 color-scheme:dark');
  assert.strictEqual(document.body.classList.contains('dark'), true, 'body 应有 dark 类');
});

test('applyTheme(false) 将 <html> color-scheme 设为 only light（Auto-Dark 豁免标记）', () => {
  window.applyTheme(false);
  assert.strictEqual(schemeOf(), 'only light', '日间模式应声明 color-scheme:only light（Chrome Auto-Dark 豁免）');
  assert.strictEqual(document.body.classList.contains('dark'), false, 'body 不应有 dark 类');
});

test('applyTheme 同步 <meta name="color-scheme"> 的 content', () => {
  window.applyTheme(false);
  let meta = document.querySelector('meta[name="color-scheme"]');
  assert.ok(meta, 'meta[name=color-scheme] 应存在（静态或动态创建）');
  assert.strictEqual(meta.getAttribute('content'), 'only light', '日间 meta content 应为 only light');
  window.applyTheme(true);
  meta = document.querySelector('meta[name="color-scheme"]');
  assert.strictEqual(meta.getAttribute('content'), 'dark', '夜间 meta content 应为 dark');
});

test('初始按时间自动设置：color-scheme 与 shouldBeDark 一致', () => {
  // 重新触发一次页面同款初始化逻辑，验证日间/夜间默认声明与 shouldBeDark 一致
  const dark = window.shouldBeDark();
  window.applyTheme(dark);
  assert.strictEqual(schemeOf(), dark ? 'dark' : 'only light', '初始 color-scheme 应与 shouldBeDark 一致');
});
