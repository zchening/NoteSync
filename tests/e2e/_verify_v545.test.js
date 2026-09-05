// NoteSync v5.45+v5.46+v5.47 独立回归验证（Playwright + 真实 Chromium）
//
// 逐字针对用户需求（v5.46/v5.47 调整处已标注）：
//   ① 面板添加提醒成功 → 正文光标处回写「时间　事项」（v5.47：分隔符=全角空格），可 Ctrl+Z 撤销
//   ② 已设提醒的时间串带下划线（u.rem-mark，linkify 管理）；未添加的日期无标记
//      （v5.46：下划线只包时间串，事项不带）
//   ③ 正文时间文本上的 chip 更明显（14px + 蓝色 CTA「添加提醒」）
//   ④ 已过期/已提醒过的时间回归普通正文（v5.46：无下划线不变灰，标记直接消失）；
//      删除提醒后标记消失
//   ⑤ 过期时间光标移上 → chip 完全不出现（零打扰）
//   ⑥ chip 点添加 → 两行确认卡（✅ 提醒已添加 / 时间　事项）+「删除」按钮（v5.47）
//   ⑦ 面板打开时分钟框默认聚焦且值全选（真选中「16」）
//   ⑧ 已添加的未来时间悬停 → 两行展示卡（移开即消失）（v5.46；v5.47 加删除按钮）
//   ⑨ 真实鼠标点击下划线时间 → 展示卡（v5.47：此前 e2e 只测过程序化选区）
//   ⑩ 临近触发 30 秒窗口内的已添加提醒仍弹展示卡（v5.47 窗口差修复）
//   ⑪ 面板列表升序（最近在最上）+ 左对齐（v5.47）
// 不修改任何业务代码。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server');

process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

let failures = 0;
function guard(fn) {
  return async (t) => {
    try { await fn(t); }
    catch (e) { failures++; throw e; }
  };
}

let server, browser, baseURL;

before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
});

after(async () => {
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 6000)),
    ]).catch(() => {});
  }
  try { if (server) server.close(); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

// 桌面环境：落地页 → 笔记名 → 口令解锁 → 编辑器就绪
async function openDesktopEditor(noteName) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', noteName || 'V545Verify');
  await page.click('#landingBtn');
  await page.waitForFunction((enc) => location.pathname.endsWith(enc), encodeURIComponent(noteName || 'V545Verify'), { timeout: 10000 });
  await page.waitForSelector('#editor', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  return { ctx, page };
}

// 面板添加一条提醒（v5.47 参数化：日期/时/分/事项）
async function addViaPanelAt(page, ymd, hh, mm, item) {
  await page.click('#remBtn');
  await page.waitForSelector('#remPanel', { timeout: 5000 });
  await page.fill('#remBoxForm input[type="date"]', ymd);
  await page.fill('#remBoxForm input.rem-hh', hh);
  await page.fill('#remBoxForm input.rem-mm', mm);
  await page.fill('#remBoxForm input.rem-item', item);
  await page.evaluate(() => {
    [...document.querySelectorAll('#remBoxForm button')].find(b => b.textContent === '添加提醒').click();
  });
  await page.waitForTimeout(900); // 500ms linkify 防抖 + 余量
}

// 面板添加一条「明天 09:30　买牛奶」
async function addViaPanel(page) {
  const tomorrow = new Date(Date.now() + 86400e3);
  const ymd = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
  await addViaPanelAt(page, ymd, '9', '30', '买牛奶');
  return { ymd };
}

// ── ①+② 面板添加 → 正文回写 + 下划线；Ctrl+Z 撤销整行 ──────────────────
test('V545-1 面板添加后正文回写「时间　买牛奶」（全角空格）并带 rem-mark 下划线，Ctrl+Z 可整行撤销', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545A');
  try {
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>今天要买</div>';
    });
    await page.click('#editor');
    await page.keyboard.press('Control+End'); // 光标放正文里
    const { ymd } = await addViaPanel(page);
    const expectLine = ymd.replace(/^(\d+)-(\d+)-(\d+)$/, (s, y, m, d) => (+y) + '-' + (+m) + '-' + (+d)) + ' 9:30　买牛奶';
    const st = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const u = ed.querySelector('u.rem-mark');
      return {
        text: ed.textContent,
        hasU: !!u,
        uText: u ? u.textContent : '',
        underline: u ? getComputedStyle(u).textDecorationLine : '',
      };
    });
    assert.ok(st.text.includes(expectLine), `正文必须回写「${expectLine}」（v5.47 分隔符=全角空格），实际: ${st.text}`);
    assert.ok(st.hasU, '正文必须出现 u.rem-mark 标记');
    assert.ok(st.uText.includes('9:30'), '下划线必须覆盖时间串: ' + st.uText);
    assert.ok(!st.uText.includes('买牛奶') && !st.uText.includes('·'), 'v5.46：下划线只包时间串，事项不带: ' + st.uText);
    assert.strictEqual(st.underline, 'underline', '必须是下划线样式');

    await page.click('#editor');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(() => document.getElementById('editor').textContent);
    assert.ok(!afterUndo.includes('买牛奶'), 'Ctrl+Z 必须整行撤销回写的时间行，实际: ' + afterUndo);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ③⑥ chip 明显化：蓝色 CTA「添加提醒」+ 两行确认卡 ────────────────────
test('V545-2 光标落时间上 chip 含蓝色「添加提醒」，点后变两行确认卡', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545B');
  try {
    const S = await page.evaluate(() => {
      const d = new Date(Date.now() + 86400e3);
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>开会 ' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' 9:15 记得带材料</div>';
      const tn = ed.querySelector('div').firstChild;
      const idx = tn.nodeValue.indexOf(d.getFullYear() + '-');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
      return true;
    });
    assert.ok(S, '前置就绪');
    await page.waitForTimeout(450);
    const chip = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      const cta = c.querySelector('.chip-cta');
      return {
        visible: !c.classList.contains('hidden'),
        text: c.textContent,
        ctaColor: cta ? getComputedStyle(cta).color : '',
      };
    });
    assert.ok(chip.visible, '未来时间 chip 必须浮出');
    assert.ok(chip.text.includes('添加提醒'), 'chip 必须含「添加提醒」CTA: ' + chip.text);
    assert.ok(!chip.text.includes('设提醒'), '旧文案「设提醒」不得出现');
    // CTA 双板锁色：浅 #2563EB / 深 #7EB1FF——主题按时间切换（07:00/19:00），晚间跑套件时页面为夜间，
    // 断言必须按 body.dark 取对应板色（2026-09-05 19:24 首次暴露：写死浅色板导致晚 7 点后必挂）
    const expectDark = await page.evaluate(() => document.body.classList.contains('dark'));
    assert.strictEqual(chip.ctaColor, expectDark ? 'rgb(126, 177, 255)' : 'rgb(37, 99, 235)', 'CTA 必须是当前主题对应板色（浅 #2563EB / 深 #7EB1FF）');

    await page.click('#timeChip');
    await page.waitForTimeout(200);
    const fb = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      const l1 = c.querySelector('.chip-ok1'), l2 = c.querySelector('.chip-ok2');
      return {
        feedback: c.classList.contains('feedback'),
        l1First: l1 && l1.firstChild ? l1.firstChild.nodeValue : '',
        hasDel: !!c.querySelector('.chip-del'),
        l2: l2 ? l2.textContent : '',
      };
    });
    assert.ok(fb.feedback, '点添加后必须变两行确认卡');
    assert.strictEqual(fb.l1First, '✅ 提醒已添加', '第一行必须是「✅ 提醒已添加」（v5.47：文本节点+删除按钮）');
    assert.ok(fb.hasDel, 'v5.47 确认卡必须带「删除」按钮');
    assert.ok(fb.l2.includes('9:15') && fb.l2.includes('记得带材料'), '第二行必须是「时间　事项」: ' + fb.l2);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ②④ 未添加的日期无标记；到点确认/删除提醒后标记消失回归普通正文（v5.46 去灰态）───
test('V545-3+V546 未添加日期无下划线；确认后标记消失（不变灰）；删除提醒后标记消失', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545C');
  try {
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>随便写的 2026-12-25 10:00 没设提醒</div>';
    });
    const plain = await page.evaluate(() => !!document.getElementById('editor').querySelector('u.rem-mark'));
    assert.ok(!plain, '未设提醒的日期绝不能有下划线标记');

    const { ymd } = await addViaPanel(page); // 添加「明天 9:30 · 买牛奶」
    const at = await page.evaluate(() => reminders[0] ? reminders[0].at : 0);
    assert.ok(at, '前置：提醒已入库');
    await page.waitForTimeout(700);
    const marked = await page.evaluate(() => {
      const u = document.getElementById('editor').querySelector('u.rem-mark');
      return { has: !!u, cls: u ? u.className : '' };
    });
    assert.ok(marked.has, '已设提醒的时间行必须带下划线');
    assert.strictEqual(marked.cls, 'rem-mark', '标记只挂 rem-mark（灰态 class 已退役）');

    await page.evaluate((at0) => { window.markRemDone(at0); }, at); // 到点确认（模拟）
    await page.waitForTimeout(700);
    const doneState = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      return { hasU: !!ed.querySelector('u.rem-mark'), text: ed.textContent };
    });
    assert.ok(!doneState.hasU, 'v5.46：到点确认后标记必须消失（回归普通正文，不变灰）');
    assert.ok(doneState.text.includes('买牛奶'), '正文文本必须原样保留');

    await page.evaluate((at0) => window.removeReminder(at0), at);
    await page.waitForTimeout(700);
    const gone = await page.evaluate(() => !!document.getElementById('editor').querySelector('u.rem-mark'));
    assert.ok(!gone, '删除提醒后下划线必须消失');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑤ 过期时间：chip 零打扰 ────────────────────────────────────────────
test('V545-4 光标落过期时间上 chip 完全不出现（零打扰）', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V545D');
  try {
    await page.evaluate(() => {
      const d = new Date(Date.now() - 86400e3);
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>昨天 ' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' 9:00 开过会</div>';
      const tn = ed.querySelector('div').firstChild;
      const idx = tn.nodeValue.indexOf(d.getFullYear() + '-');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    const st = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      return { hidden: c.classList.contains('hidden'), text: c.textContent };
    });
    assert.ok(st.hidden, '过期时间光标移上 chip 必须完全不出现');
    assert.ok(!st.text.includes('已过期'), '不得再有「已过期」文案');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑧ v5.46 已添加的未来时间：悬停两行展示卡（不可点/移开即消失）─────────
test('V546-1 已添加的未来时间悬停两行展示卡，点击不重复添加，移开立即消失', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V546B');
  try {
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>今天要买</div>';
    });
    await page.click('#editor');
    await page.keyboard.press('Control+End');
    await addViaPanel(page); // 走面板真实路径添加「明天 9:30 · 买牛奶」（回写+入库）
    const before = await page.evaluate(() => reminders.length);
    assert.ok(before >= 1, '前置：提醒已入库');

    // 光标落时间上（linkify 已把时间包进 u.rem-mark，从 u 内部取文本节点）
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const u = ed.querySelector('u.rem-mark');
      const tn = (u || ed.querySelector('div')).firstChild;
      const idx = tn.nodeValue.indexOf('9:30');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    const card = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      const l1 = c.querySelector('.chip-ok1'), l2 = c.querySelector('.chip-ok2');
      return {
        visible: !c.classList.contains('hidden'),
        feedback: c.classList.contains('feedback'),
        l1First: l1 && l1.firstChild ? l1.firstChild.nodeValue : '',
        hasDel: !!c.querySelector('.chip-del'),
        l2: l2 ? l2.textContent : '',
        hasCta: !!c.querySelector('.chip-cta'),
      };
    });
    assert.ok(card.visible, '已添加的未来时间必须浮出两行展示卡');
    assert.ok(card.feedback, '展示卡必须复用两行卡片样式');
    assert.strictEqual(card.l1First, '✅ 提醒已添加', '第一行必须是「✅ 提醒已添加」（v5.47：文本节点+删除按钮）');
    assert.ok(card.hasDel, 'v5.47 展示卡必须带「删除」按钮');
    assert.ok(card.l2.includes('9:30') && card.l2.includes('买牛奶'), '第二行必须是「时间　买牛奶」: ' + card.l2);
    assert.ok(!card.hasCta, '展示卡不得带「添加提醒」CTA（纯展示）');

    // 展示卡主体不可点：对卡本体派发 mousedown（不走坐标点击——v5.47 起卡上有「删除」热区，
    // 坐标点中心可能误中删除按钮，改用事件派发精确落在整卡路径上）
    await page.evaluate(() => {
      document.getElementById('timeChip').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => reminders.length);
    assert.strictEqual(after, before, '展示卡不可点：点击不得重复添加');

    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const tn = ed.querySelector('div').firstChild;
      const r = document.createRange();
      r.setStart(tn, 0); r.setEnd(tn, 0);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    const hidden = await page.evaluate(() => document.getElementById('timeChip').classList.contains('hidden'));
    assert.ok(hidden, '光标移开展示卡必须立即消失（无定时器拖尾）');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑨ v5.47 真实鼠标点击下划线时间 → 展示卡（用户报障路径，此前只测过程序化选区）──
test('V547-1 真实鼠标点击已添加提醒的下划线时间，必须浮出两行展示卡+删除按钮', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V547A');
  try {
    await page.evaluate(() => {
      document.getElementById('editor').innerHTML = '<div>今天要买</div>';
    });
    await page.click('#editor');
    await page.keyboard.press('Control+End');
    await addViaPanel(page); // 回写「YYYY-M-D 9:30　买牛奶」+ 入库 + linkify 下划线
    // 真实鼠标点击下划线时间串中心（用户真实路径：mousedown → caret 落进 u.rem-mark → selectionchange）
    const box = await page.evaluate(() => {
      const u = document.querySelector('#editor u.rem-mark');
      const r = u.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(450); // selectionchange 250ms 防抖 + 余量
    const card = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      const l1 = c.querySelector('.chip-ok1'), l2 = c.querySelector('.chip-ok2');
      return {
        visible: !c.classList.contains('hidden'),
        feedback: c.classList.contains('feedback'),
        l1First: l1 && l1.firstChild ? l1.firstChild.nodeValue : '',
        hasDel: !!c.querySelector('.chip-del'),
        l2: l2 ? l2.textContent : '',
      };
    });
    assert.ok(card.visible, '真实鼠标点击下划线时间必须浮出展示卡（用户报障：有些点了不弹）');
    assert.ok(card.feedback, '弹的必须是两行展示卡');
    assert.strictEqual(card.l1First, '✅ 提醒已添加', '第一行「✅ 提醒已添加」');
    assert.ok(card.hasDel, '展示卡必须带「删除」按钮');
    assert.ok(card.l2.includes('9:30') && card.l2.includes('买牛奶'), '第二行「时间　买牛奶」: ' + card.l2);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑩ v5.47 临近触发 30 秒窗口差修复 ──────────────────────────────────
test('V547-2 已添加提醒处于 30 秒过期判定窗口内（下划线在），点击时间仍必须弹展示卡', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V547B');
  try {
    await page.evaluate(() => {
      document.getElementById('editor').innerHTML = '<div>马上要做的</div>';
    });
    await page.click('#editor');
    await page.keyboard.press('Control+End');
    // 等到秒数≥30：下一个分钟边界必落在 (now, now+30s] 过期判定窗口内
    //（此窗口内旧逻辑 expired 先拦 chip、下划线却还在 → 「有下划线不弹卡」）
    await page.waitForFunction(() => new Date().getSeconds() >= 30, null, { timeout: 35000 });
    const t = new Date(Date.now());
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() + 1);
    const ymd = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    await addViaPanelAt(page, ymd, String(t.getHours()), String(t.getMinutes()).padStart(2, '0'), '快到点了');
    // 程序化把光标放进下划线时间串（本用例测阈值逻辑，鼠标路径由 V547-1 覆盖）
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const u = ed.querySelector('u.rem-mark');
      const tn = (u || ed.querySelector('div')).firstChild;
      const idx = tn.nodeValue.indexOf(':');
      const r = document.createRange();
      r.setStart(tn, Math.max(0, idx - 1)); r.setEnd(tn, Math.max(0, idx - 1));
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    const card = await page.evaluate(() => {
      const c = document.getElementById('timeChip');
      return {
        visible: !c.classList.contains('hidden'),
        feedback: c.classList.contains('feedback'),
        hasDel: !!c.querySelector('.chip-del'),
      };
    });
    assert.ok(card.visible, '30 秒窗口内的已添加提醒必须弹展示卡（v5.47 窗口差修复）');
    assert.ok(card.feedback, '弹的必须是两行展示卡');
    assert.ok(card.hasDel, '展示卡必须带「删除」按钮');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑪ v5.47 展示卡「删除」按钮 → 彻底移除提醒 ─────────────────────────
test('V547-3 展示卡点「删除」→ 提醒彻底移除（rem 清空同步）、下划线消失、展示卡收起回到 CTA', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V547C');
  try {
    await page.evaluate(() => {
      document.getElementById('editor').innerHTML = '<div>今天要买</div>';
    });
    await page.click('#editor');
    await page.keyboard.press('Control+End');
    await addViaPanel(page);
    const before = await page.evaluate(() => reminders.length);
    assert.ok(before >= 1, '前置：提醒已入库');
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const u = ed.querySelector('u.rem-mark');
      const tn = (u || ed.querySelector('div')).firstChild;
      const idx = tn.nodeValue.indexOf('9:30');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    assert.ok(await page.evaluate(() => !!document.querySelector('#timeChip .chip-del')), '前置：展示卡带「删除」按钮');
    await page.evaluate(() => {
      document.querySelector('#timeChip .chip-del').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await page.waitForTimeout(900); // 持久化 + linkify 400ms 防抖余量
    const st = await page.evaluate(() => ({
      count: reminders.length,
      hasU: !!document.querySelector('#editor u.rem-mark'),
      chipFeedback: document.getElementById('timeChip').classList.contains('feedback'),
      chipCta: !!document.querySelector('#timeChip .chip-cta'),
    }));
    assert.strictEqual(st.count, before - 1, '点删除后提醒必须从列表彻底移除');
    assert.ok(!st.hasU, '删除后正文下划线必须消失');
    assert.ok(!st.chipFeedback, '两行展示卡必须收起');
    // 删除后光标仍停在时间串上：该时间已变回「未添加」，chip 回到蓝色「添加提醒」CTA（预期状态转换）
    assert.ok(st.chipCta, '时间已未添加：chip 应回到蓝色「添加提醒」CTA');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑫ v5.47 确认卡「删除」按钮 → 误添加可立即反悔 ─────────────────────
test('V547-4 chip 点「添加提醒」后的确认卡点「删除」→ 提醒移除', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V547D');
  try {
    await page.evaluate(() => {
      const d = new Date(Date.now() + 86400e3);
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>开会 ' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' 9:15 记得带材料</div>';
      const tn = ed.querySelector('div').firstChild;
      const idx = tn.nodeValue.indexOf(d.getFullYear() + '-');
      const r = document.createRange();
      r.setStart(tn, idx + 2); r.setEnd(tn, idx + 2);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new window.Event('selectionchange'));
    });
    await page.waitForTimeout(450);
    assert.ok(await page.evaluate(() => !!document.querySelector('#timeChip .chip-cta')), '前置：蓝色 CTA 已浮出');
    await page.click('#timeChip'); // 单行 CTA chip 无删除热区，坐标点击安全
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => !!document.querySelector('#timeChip .chip-del')), '前置：确认卡带「删除」按钮');
    const before = await page.evaluate(() => reminders.length);
    await page.evaluate(() => {
      document.querySelector('#timeChip .chip-del').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => reminders.length);
    assert.strictEqual(after, before - 1, '确认卡点删除必须移除刚添加的提醒');
    assert.ok(await page.evaluate(() => document.getElementById('timeChip').classList.contains('hidden')), 'chip 必须收起');
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));

// ── ⑬ v5.47 面板列表：升序（最近在最上）+ 左对齐 ──────────────────────
test('V547-5 面板已设列表按时间升序排列且左对齐', guard(async () => {
  const { ctx, page } = await openDesktopEditor('V547E');
  try {
    const tomorrow = new Date(Date.now() + 86400e3);
    const ymd = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
    // 先添加晚的（20:00），再添加早的（9:00）——列表必须按时间升序，不是按添加顺序
    await addViaPanelAt(page, ymd, '20', '00', '晚上事件');
    await addViaPanelAt(page, ymd, '9', '00', '早上事件');
    await page.click('#remBtn'); // 重新打开面板
    await page.waitForSelector('#remPanel', { timeout: 5000 });
    const rows = await page.evaluate(() => {
      const list = document.getElementById('remBoxList');
      return [...list.querySelectorAll('.rem-row')].map(r => ({
        text: r.textContent,
        align: getComputedStyle(r).textAlign,
      }));
    });
    assert.ok(rows.length >= 2, '前置：列表有两条提醒');
    assert.ok(rows[0].text.includes('9:00'), '第一条必须是更早的 9:00（升序：最近的最上）: ' + JSON.stringify(rows.map(r => r.text)));
    assert.ok(rows[1].text.includes('20:00'), '第二条必须是更晚的 20:00');
    assert.strictEqual(rows[0].align, 'left', 'v5.47：列表行必须左对齐（覆盖 .qr-box 居中），实际: ' + rows[0].align);
    assert.deepStrictEqual(page.__errors, [], '不应有页面 JS 错误');
  } finally { await ctx.close(); }
}));
