// NoteSync E2E（Playwright + 真实 Chromium）—— 验证用户上报的 5 个 bug 是否已修复。
// 结构复用 flow.test.js：setup/teardown + guard + failures + process.exit + unhandledRejection 守卫。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./harness');

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
  const badResponses = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });
  page.__errors = errors;
  page.__bad = badResponses;
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput', { timeout: 15000 });
});

after(async () => {
  await teardown(browser, server);
  process.exit(failures > 0 ? 1 : 0);
});

// ── Bug 1：落地页笔记名框禁止中文/符号，仅英文数字可输入并导航 ──────────
test('Bug1 笔记名框过滤中文（仅英文数字可输入并导航解锁）', guard(async () => {
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput');

  // 1) 中文 / 符号输入应通过 input 事件被过滤（直接验证应用逻辑，不依赖输入法）
  const afterCn = await page.evaluate(() => {
    const li = document.getElementById('landingInput');
    li.value = '我的笔记';
    li.dispatchEvent(new Event('input', { bubbles: true }));
    return li.value;
  });
  assert.strictEqual(afterCn, '', '中文输入应被清空: ' + afterCn);
  // 过滤清空后空名 -> 打开按钮应禁用
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('landingBtn').disabled),
    true,
    '过滤清空后“打开”按钮应禁用'
  );

  const afterMix = await page.evaluate(() => {
    const li = document.getElementById('landingInput');
    li.value = '我的MyNote123';
    li.dispatchEvent(new Event('input', { bubbles: true }));
    return li.value;
  });
  assert.strictEqual(afterMix, 'MyNote123', '中文应被剔除，仅留英文数字: ' + afterMix);
  // 过滤后保留英文数字（非空）-> 按钮应启用
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('landingBtn').disabled),
    false,
    '过滤后保留英文数字，“打开”按钮应启用'
  );

  // 2) 英文数字笔记名正常导航 + 解锁
  const name = 'MyNote';
  await page.fill('#landingInput', name);
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('landingBtn').disabled),
    false,
    '有输入时“打开”按钮应可用'
  );
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(name), { timeout: 10000 });
  const url = page.url();
  assert.ok(url.endsWith(encodeURIComponent(name)), 'URL 应指向笔记路径: ' + url);

  assert.strictEqual(page.__bad.length, 0, '导航不应产生 4xx 响应: ' + page.__bad.join(' | '));

  await page.waitForSelector('#editor');
  const maskVisible = await page.evaluate(() => !document.getElementById('mask').classList.contains('hidden'));
  assert.strictEqual(maskVisible, true, '导航后应使用密码遮罩（init 已解码 noteId）');

  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('editor').contentEditable === 'true'),
    true,
    '解锁后编辑器应可编辑（stub API 正常）'
  );
  assert.strictEqual(page.__errors.length, 0, '导航/解锁过程不应有页面错误: ' + page.__errors.join(' | '));
}));

// ── Bug 2：笔记名为空时“打开”按钮禁用 ───────────────────────────────────
test('Bug2 笔记名为空时“打开”按钮禁用，输入后启用', guard(async () => {
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput');
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('landingBtn').disabled),
    true,
    '空笔记名时“打开”按钮应禁用'
  );
  await page.fill('#landingInput', 'x');
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('landingBtn').disabled),
    false,
    '有输入时“打开”按钮应启用'
  );
  await page.fill('#landingInput', '');
  assert.strictEqual(
    await page.evaluate(() => document.getElementById('landingBtn').disabled),
    true,
    '清空后“打开”按钮应恢复禁用'
  );
}));

// ── Bug 2b：解锁后退出锁定，解锁按钮必须回到禁用态 ─────────────────────
// 修复点：lock 处理程序清空 pw.value 不会触发 input 事件，故需显式设置 #ok.disabled=true
test('Bug2b 解锁后退出锁定，解锁按钮回到禁用态', guard(async () => {
  const name = 'QuitTest';
  await page.goto(baseURL);
  await page.waitForSelector('#landingInput');
  await page.fill('#landingInput', name);
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(name), { timeout: 10000 });
  await page.waitForSelector('#editor');
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });

  // 解锁后填入口令 -> 解锁按钮应启用
  await page.fill('#pw', 'x');
  assert.strictEqual(await page.evaluate(() => document.getElementById('ok').disabled), false, '解锁且有口令时按钮应启用');

  // 点退出锁定
  await page.click('#lock');
  await page.waitForSelector('#pw');
  assert.strictEqual(await page.evaluate(() => document.getElementById('pw').value), '', '退出后口令框应清空');
  assert.strictEqual(await page.evaluate(() => document.getElementById('ok').disabled), true, '退出后解锁按钮必须回到禁用态');
}));

// ── Bug 3：空口令时“解锁”按钮禁用 + 禁用样式为有意设计（非破损/不可见）──
test('Bug3 空口令时解锁按钮禁用且禁用样式为有意弱化', guard(async () => {
  await page.goto(baseURL);
  // 不触发真实解锁，仅显示密码框
  await page.evaluate(() => {
    document.getElementById('landing')?.classList.add('hidden');
    document.getElementById('mask')?.classList.remove('hidden');
  });
  await page.waitForSelector('#ok');

  assert.strictEqual(await page.evaluate(() => document.getElementById('ok').disabled), true, '空口令时“解锁”按钮应禁用');
  await page.fill('#pw', 'x');
  assert.strictEqual(await page.evaluate(() => document.getElementById('ok').disabled), false, '有口令时“解锁”按钮应启用');

  // 计算样式：先取“启用态”基线（此时 #pw 有值），再清空取“禁用态”
  const enStyles = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('ok'));
    return { bg: s.backgroundColor, color: s.color };
  });
  await page.fill('#pw', '');
  assert.strictEqual(await page.evaluate(() => document.getElementById('ok').disabled), true, '清空后“解锁”按钮应恢复禁用');

  const styles = await page.evaluate(() => {
    const dis = getComputedStyle(document.querySelector('#ok:disabled'));
    const root = getComputedStyle(document.documentElement);
    const tmp = document.createElement('span');
    tmp.style.display = 'none';
    document.body.appendChild(tmp);
    tmp.style.color = 'var(--line)'; const lineRgb = getComputedStyle(tmp).color;
    tmp.style.color = 'var(--muted)'; const mutedRgb = getComputedStyle(tmp).color;
    tmp.remove();
    return {
      disCursor: dis.cursor,
      disShadow: dis.boxShadow,
      disBg: dis.backgroundColor,
      disColor: dis.color,
      resolvedLine: lineRgb,
      resolvedMuted: mutedRgb,
      lineRaw: root.getPropertyValue('--line').trim(),
      mutedRaw: root.getPropertyValue('--muted').trim(),
    };
  });

  assert.strictEqual(styles.disCursor, 'not-allowed', '禁用态光标应为 not-allowed');
  assert.strictEqual(styles.disShadow, 'none', '禁用态应去除阴影');
  assert.strictEqual(styles.disBg, styles.resolvedLine, '禁用态背景应等于解析后的 --line (' + styles.lineRaw + ')');
  assert.strictEqual(styles.disColor, styles.resolvedMuted, '禁用态文字应等于解析后的 --muted (' + styles.mutedRaw + ')');
  assert.notStrictEqual(styles.disBg, enStyles.bg, '禁用态背景应区别于启用态（金色渐变）');
}));

// ── Bug 4：PWA 图标恢复为备案前透明金 logo（v5.16 修正 v5.15 误改黑底）────
test('Bug4 manifest 仅含 favicon.svg maskable + favicon 透明金 logo 由服务器正确返回', guard(async () => {
  await page.goto(baseURL);

  const manifestOk = await page.evaluate(async () => {
    const r = await fetch('/manifest.json');
    const j = await r.json();
    const icons = Array.isArray(j.icons) ? j.icons : [];
    const faviconMaskable = icons.some(
      (i) => (i.purpose || '').includes('maskable') && (i.src || '').includes('favicon.svg')
    );
    const hasPng = icons.some((i) => (i.src || '').includes('icon-maskable'));
    return { faviconMaskable, hasPng };
  });
  assert.strictEqual(manifestOk.faviconMaskable, true, 'manifest 应包含 favicon.svg 的 maskable 条目');
  assert.strictEqual(manifestOk.hasPng, false, 'manifest 不应再含 icon-maskable-*.png');

  const svg = await page.evaluate(async () => {
    const r = await fetch('/favicon.svg');
    const t = await r.text();
    return { hasGold: t.includes('stroke="#8F7126"'), hasBlack: t.includes('fill="#0F0F11"') };
  });
  assert.strictEqual(svg.hasGold, true, 'favicon.svg 应保留金色描边 #8F7126');
  assert.strictEqual(svg.hasBlack, false, 'favicon.svg 不应含黑色填充 #0F0F11（备案前透明）');
}));

// ── Bug 5：指纹解锁功能已彻底移除（v5.15）────────────────────────────
// 浏览器内指纹只能走 WebAuthn/通行密钥，且国内 Android 普遍不可用，故彻底移除。
// E2E 层断言：指纹相关全局函数与 DOM 元素已不复存在。
test('Bug5 指纹解锁相关代码已彻底移除', guard(async () => {
  await page.goto(baseURL);
  await page.waitForSelector('#editor');
  const gone = await page.evaluate(() => ({
    fn: typeof window.enrollBiometric === 'undefined' &&
        typeof window.unlockWithBiometric === 'undefined' &&
        typeof window.updateBioUI === 'undefined' &&
        typeof window.supportsWebAuthnPRF === 'undefined',
    bioBtn: document.getElementById('bioBtn') === null,
    bioBanner: document.getElementById('bioBanner') === null,
  }));
  assert.strictEqual(gone.fn, true, '指纹相关全局函数应已删除');
  assert.strictEqual(gone.bioBtn, true, 'bioBtn 元素应已删除');
  assert.strictEqual(gone.bioBanner, true, 'bioBanner 元素应已删除');
}));
