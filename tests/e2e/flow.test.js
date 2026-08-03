// NoteSync E2E（Playwright + 真实 Chromium）
// 覆盖真实浏览器路径：A7（选区 + 500ms linkify 防抖 + 光标保留）、B3（点导出不刷新页面）、B6（导出后 overflow 样式恢复）
// 直接驱动页面内的真实函数，绕过后端鉴权（隐藏 landing/mask 遮罩让按钮可点）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

const ZWSP = '\u200B';

// 仅吞掉 Playwright/浏览器拆解阶段偶发的未处理 rejection（Windows 环境），不掩盖真实业务错误。
process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

// 失败计数：teardown 后据此决定最终退出码，避免 Windows 拆解 hang 污染结果。
let failures = 0;
function guard(fn) {
  return async (t) => {
    try {
      await fn(t);
    } catch (e) {
      failures++;
      throw e;
    }
  };
}

let server, browser, page, baseURL;

before(async () => {
  ({ server, baseURL, browser } = await setup());
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 15000 });
  // 隐藏 landing/mask 遮罩，使 header 按钮可点击
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.add('hidden');
  });
  page.__errors = errors;
});

after(async () => {
  await teardown(browser, server);
  process.exit(failures > 0 ? 1 : 0);
});

// ── A7：删除线后 linkify 的 500ms 防抖重排不应破坏选区 ─────────────────
test('A7 删除线后 linkify 防抖不破坏选区', guard(async () => {
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = 'AB15.34CD';
    // 触发 input 事件，调度 500ms 后的 linkify（A7 的回归点在于 linkify 重排 DOM）
    ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  // 在 linkify 触发前选中整段文字
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const t = ed.firstChild;
    const r = document.createRange();
    r.selectNodeContents(t);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.click('#strikeBtn');
  // 等待 linkify 防抖（500ms）+ 余量，确保重排后选区仍被正确恢复
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const sel = window.getSelection();
    const s = document.querySelector('#editor s');
    return {
      text: (sel.toString() || '').replace(/\u200B/g, ''),
      hasS: !!s,
      sText: s ? s.textContent.replace(/\u200B/g, '') : '',
      rangeCount: sel.rangeCount,
      type: sel.type,
    };
  });

  assert.strictEqual(info.hasS, true, '应已加删除线');
  assert.ok(info.rangeCount > 0, '选区不应塌缩（rangeCount>0）');
  assert.strictEqual(info.text, 'AB15.34CD', '选区应精确覆盖原文字、不因 \u200B 插入丢尾字');
}));

// ── B3：点击导出按钮页面不刷新 ───────────────────────────────────────
test('B3 点导出按钮页面不刷新', guard(async () => {
  await page.evaluate(() => {
    window.__reloadMarker = 'keep';
    document.getElementById('editor').innerHTML = '导出测试内容';
  });
  await page.click('#exportImgBtn');
  await page.waitForTimeout(600);
  const kept = await page.evaluate(() => window.__reloadMarker === 'keep');
  assert.strictEqual(kept, true, '点击导出后页面不应刷新（reload marker 应保留）');
}));

// ── B6：导出后 editor 的 overflow 样式必须恢复 ────────────────────────
test('B6 导出后 editor overflow 样式恢复', guard(async () => {
  await page.evaluate(() => {
    document.getElementById('editor').innerHTML = 'overflow 恢复测试';
  });
  await page.evaluate(() => window.exportImage());
  // exportImage 异步执行；等待 overflow 被 finally 恢复为空
  await page
    .waitForFunction(() => document.getElementById('editor').style.overflow === '', { timeout: 10000 })
    .catch(() => {});
  const overflow = await page.evaluate(() => document.getElementById('editor').style.overflow);
  assert.strictEqual(overflow, '', '导出后 editor.overflow 应恢复为空，不被 hidden 残留');
}));
