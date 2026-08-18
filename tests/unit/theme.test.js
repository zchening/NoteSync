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

test('applyTheme(false) 将 <html> color-scheme 设为 light', () => {
  window.applyTheme(false);
  assert.strictEqual(schemeOf(), 'light', '日间模式应声明 color-scheme:light');
  assert.strictEqual(document.body.classList.contains('dark'), false, 'body 不应有 dark 类');
});

test('初始按时间自动设置：当前为夜间时段则 color-scheme=dark', () => {
  // 重新触发一次页面同款初始化逻辑，验证日间/夜间默认声明与 shouldBeDark 一致
  const dark = window.shouldBeDark();
  window.applyTheme(dark);
  assert.strictEqual(schemeOf(), dark ? 'dark' : 'light', '初始 color-scheme 应与 shouldBeDark 一致');
});
