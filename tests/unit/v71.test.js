// v7.1.0 单元测试——冲突弹窗误报根修（isDecorativelyEqual + 回填）、相对时间解析、
// reFullCn 带年份完整中文日期、提醒 UI 四修。
// 结构沿 reminder.test.js（jsdom loadApp）+ v62.test.js（源码断言）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');
const { loadApp } = require('../helpers');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
const FIX = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'reltime_cases.json'), 'utf8'));

function freshApp() {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
    catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    if (!w.Range.prototype.getClientRects) {
      w.Range.prototype.getClientRects = function () { return []; };
      w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    }
  });
  return { dom, window: dom.window, document: dom.window.document, editor: dom.window.document.getElementById('editor') };
}

const pad = x => String(x).padStart(2, '0');
const wall = at => { const d = new Date(at); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; };

// ── A：版本号 ──
test('V71-A 版本号 7.4.0 / BUILD_DATE 2026-09-08', () => {
  assert.ok(SRC.includes("const APP_VERSION = '7.4.0';"), 'APP_VERSION 应 7.4.0');
  assert.ok(SRC.includes("const BUILD_DATE = '2026-09-08';"), 'BUILD_DATE 应 2026-09-08');
});

// ── B：冲突弹窗误报根修（isDecorativelyEqual + 回填 + 判定点）──
test('V71-B1 isDecorativelyEqual/normDecorHtml/backfill 函数与挂载', () => {
  assert.ok(SRC.includes('function isDecorativelyEqual(a, b)'), '应存在 isDecorativelyEqual');
  assert.ok(SRC.includes('function normDecorHtml(html)'), '应存在 normDecorHtml');
  assert.ok(SRC.includes('function backfillLastHtmlIfDecorativelyEqual()'), '应存在回填函数');
  assert.ok(SRC.includes('window.isDecorativelyEqual = isDecorativelyEqual;'), 'isDecorativelyEqual 应挂 window 供测试');
  assert.ok(SRC.includes('window.collectRelTimeMatches = collectRelTimeMatches;'), 'collectRelTimeMatches 应挂 window 供测试');
  const calls = (SRC.match(/backfillLastHtmlIfDecorativelyEqual\(\);/g) || []).length;
  assert.ok(calls >= 3, '回填应至少 3 个调用点（linkify finally/applyStrike/applyState），实测 ' + calls);
  // linkify finally 内回填必须发生在 syncCurrentState 之后（\r?\n：容忍 CRLF/LF 漂移，同 V61-8 先例）
  const finallyIdx = SRC.search(/syncCurrentState\(\);\r?\n    backfillLastHtmlIfDecorativelyEqual\(\);/);
  assert.ok(finallyIdx > -1, 'linkify finally 应在 syncCurrentState 后回填');
});

test('V71-B2 判定点：poll unsaved 与 flushDirtySave 用装饰等价，严格比对三点不动', () => {
  // v7.4.0：unsaved 扩为「装饰等价 + 占位等价」双豁免——占位（回车格式克隆空块）同样不算未保存
  assert.ok(SRC.includes('const unsaved = !isDecorativelyEqual(editor.innerHTML, lastHtml) && !isPlaceholderEqual(editor.innerHTML, lastHtml);'), 'poll unsaved 应装饰等价+占位等价双判定');
  assert.ok(SRC.includes('if (isDecorativelyEqual(editor.innerHTML, lastHtml)) return;'), 'flushDirtySave 应装饰等价跳过');
  assert.ok(SRC.includes('if (isPlaceholderEqual(editor.innerHTML, lastHtml)) return;'), 'flushDirtySave 应占位等价跳过（v7.4.0）');
  // 严格比对三点（v7.1.0 铁律：真实字节差异必须走原路径）
  assert.ok(/if\s*\((?:\!force\s*&&\s*)?html === lastHtml\)\s*return;/.test(SRC), 'saveLocal 早退严格比对不得归一化（v7.3.3 恢复场景新增 force 旁路，仍严格比对）');
  assert.ok(SRC.includes('if (html === lastHtml) { clearDraft(); return; }'), '冲突草稿判定严格比对不得归一化');
  assert.ok(SRC.includes('if (html !== editor.innerHTML) {'), 'poll 替换判定严格比对不得归一化');
});

test('V71-B3 isDecorativelyEqual 行为：打标等价 / 用户格式不等价 / ZWSP 等价', () => {
  const app = freshApp();
  try {
    const ide = app.window.isDecorativelyEqual;
    assert.strictEqual(typeof ide, 'function', 'isDecorativelyEqual 应挂 window');
    // 短路
    assert.strictEqual(ide('<div>1</div>', '<div>1</div>'), true, '相同串短路 true');
    // 打标 vs 素文：等价
    assert.strictEqual(ide('<div>明天10点开会</div>', '<div><u class="rem-mark">明天10点</u>开会</div>'), true, 'rem-mark 打标等价');
    assert.strictEqual(ide('<div>已过期的事</div>', '<div><s class="rem-done">已过期的事</s></div>'), true, 'rem-done 等价');
    assert.strictEqual(ide('<div>看x.com啊</div>', '<div>看<a data-url="1" href="https://x.com">x.com</a>啊</div>'), true, '自动链接等价');
    assert.strictEqual(ide('<div>1</div>', '<div><span>1</span></div>'), true, '裸 span 等价');
    // ZWSP
    assert.strictEqual(ide('<div>1\u200B</div>', '<div>1</div>'), true, '零宽空格等价');
    // 用户格式：绝不等价
    assert.strictEqual(ide('<div><b>1</b></div>', '<div>1</div>'), false, '用户 <b> 不等价');
    assert.strictEqual(ide('<div><s>1</s></div>', '<div>1</div>'), false, '用户手打 <s> 不等价（rem-done 才剥）');
    assert.strictEqual(ide('<div><u>1</u></div>', '<div>1</div>'), false, '用户手打 <u> 不等价（rem-mark 才剥）');
    assert.strictEqual(ide('<div><span style="font-weight:bold">1</span></div>', '<div>1</div>'), false, '带样式 span 不等价');
    assert.strictEqual(ide('<div>12</div>', '<div>13</div>'), false, '文本差异不等价');
    assert.strictEqual(ide('<div>1</div><div>2</div>', '<div>12</div>'), false, '块结构差异不等价');
    // 手动链接（无 data-url）不等价
    assert.strictEqual(ide('<div><a href="https://x.com">x.com</a></div>', '<div>x.com</div>'), false, '手动链接不等价');
  } finally { app.dom.window.close(); }
});

test('V71-B4 flushDirtySave：打标后装饰等价不触发保存；真实差异触发', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, editor } = app;
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const noteCt = await window.encryptText('<div>明天10点开会</div>', key);
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6 }) });
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });
  assert.strictEqual(editor.innerHTML, '<div>明天10点开会</div>', '前置：解锁载入');

  let saved = 0;
  const origSave = window.saveLocal;
  window.saveLocal = () => { saved++; return origSave.call(window); };

  // 程序化打标重写：装饰等价 → flushDirtySave 必须跳过
  editor.innerHTML = '<div><u class="rem-mark">明天10点</u>开会</div>';
  window.flushDirtySave();
  assert.strictEqual(saved, 0, '打标重写（装饰等价）不得触发保存——假 dirty 根因');

  // 真实文本差异 → 照常保存
  editor.innerHTML = '<div>明天10点开会+1</div>';
  window.flushDirtySave();
  assert.ok(saved >= 1, '真实差异必须触发保存');
  window.saveLocal = origSave;
});

// ── C：相对时间解析（fixtures 直调）──
test('V71-C1 fixtures 全量直调 collectRelTimeMatches（全量）', () => {
  const app = freshApp();
  try {
    const fn = app.window.collectRelTimeMatches;
    assert.strictEqual(typeof fn, 'function', 'collectRelTimeMatches 应挂 window');
    let idx = 0;
    for (const c of FIX.cases) {
      idx++;
      // 数字组（reFullCn）专属用例不在相对组词表内，由 V71-D 覆盖
      if (/^\d{4}年/.test(c.text)) continue;
      const now = new Date(c.now[0], c.now[1] - 1, c.now[2], c.now[3], c.now[4]);
      const rs = fn(c.text, now);
      if (c.expect === 'null') {
        assert.strictEqual(rs.length, 0, `#${idx} ${JSON.stringify(c.text)} 应不命中，got ${JSON.stringify(rs)}`);
        continue;
      }
      assert.ok(rs.length >= 1, `#${idx} ${JSON.stringify(c.text)} 应命中`);
      const r = rs[0];
      const [y, mo, d, h, mi] = wall(r.at);
      if (c.expect === 'expired') {
        assert.strictEqual(r.expired, true, `#${idx} ${JSON.stringify(c.text)} 应标 expired`);
      } else {
        assert.deepStrictEqual([y, mo, d, h, mi], [c.expect.y, c.expect.mo, c.expect.d, c.expect.h, c.expect.mi],
          `#${idx} ${JSON.stringify(c.text)} 时刻不符`);
        assert.strictEqual(r.expired, false, `#${idx} ${JSON.stringify(c.text)} 未来时刻不应标 expired`);
        assert.strictEqual(r.index, 0, `#${idx} 命中应从串首开始`);
        const hit = c.text.slice(r.index, r.index + r.length);
        assert.ok(hit.indexOf('\u3000') === -1, `#${idx} 命中不得吞事项区（全角空格后内容）`);
      }
    }
  } finally { app.dom.window.close(); }
});

// ── 49 周组合矩阵：7 今天星期 × 7 目标星期X × 这周/下周 = 98 组合 ──
test('V71-C2 周组合矩阵 98 例：这周X/下周X 均落位正确（周一=周首）', () => {
  const app = freshApp();
  try {
    const fn = app.window.collectRelTimeMatches;
    const WD = '一二三四五六日天';
    const dayIdx = ch => { const i = WD.indexOf(ch); return i <= 5 ? i : 6; };
    let n = 0;
    for (let todayIdx = 0; todayIdx < 7; todayIdx++) {      // todayIdx: 0=周一..6=周日（9月7日=周一）
      const now = new Date(2026, 8, 7 + todayIdx, 8, 0);
      for (let t = 0; t < 7; t++) {
        const ch = WD[t];
        for (const prefix of ['这周', '下周']) {
          n++;
          const rs = fn(prefix + ch + ' 10:00', now);
          assert.strictEqual(rs.length, 1, `${prefix}${ch} @周${WD[todayIdx]} 应恰命中 1 条`);
          const [, , d] = wall(rs[0].at);
          const expectD = 7 + todayIdx - todayIdx + dayIdx(ch) + (prefix === '下周' ? 7 : 0); // 本周一=9月7日
          assert.strictEqual(d, expectD, `${prefix}${ch} @${2026}-09-${7 + todayIdx} 应落 9月${expectD}日，got 9月${d}日`);
          assert.strictEqual(wall(rs[0].at)[3], 10, '时刻应为 10:00');
        }
      }
    }
    assert.strictEqual(n, 98, '矩阵应 98 组合');
  } finally { app.dom.window.close(); }
});

// ── MCP 对齐（tools/notesync-mcp-server.js parseAt——并行代理正在加 module.exports）──
test('V71-C3 fixtures 与 MCP parseAt 两端对齐', t => {
  let mcp = null;
  try { mcp = require('../../tools/notesync-mcp-server.js'); } catch (e) { mcp = null; }
  if (!mcp || typeof mcp.parseAt !== 'function') {
    t.skip('待并行代理落地 notesync-mcp-server.js module.exports/parseAt——测试已就位');
    return;
  }
  const atOf = r => (r == null) ? null
    : (typeof r === 'number' ? r
      : (typeof r.at === 'number' ? r.at
        : (r.match && typeof r.match.at === 'number' ? r.match.at : null)));
  let idx = 0;
  const appAll = freshApp();
  try {
    for (const c of FIX.cases) {
      idx++;
      const now = new Date(c.now[0], c.now[1] - 1, c.now[2], c.now[3], c.now[4]);
      // MCP parseAt 是「整串时间表达式」语义——正文混排（事项后缀）用例不适用，豁免。
      // 判定口径用 collectTimeMatches（P2-3：collectRelTimeMatches 看不到 reFullCn 数字组命中，
      // 会把「2027年5月1日 07:00」这类整串用例误豁免出 MCP 对齐）。
      // v7.2.0：now 注入两端同源（v7.1.0 缺陷：web 侧用真实 now，fixtures 隔日必红——#79 实锤）。
      const webHit = appAll.window.collectTimeMatches(c.text, now.getTime())[0];
      const pureTime = webHit && webHit.length === c.text.length;
      if (!pureTime && c.expect !== 'null') continue;
      let ret = null;
      try { ret = mcp.parseAt(c.text, now); } catch (e) { ret = null; } // 过去相对时间 MCP 报错提示 → 视同不命中
      const at = atOf(ret);
      if (c.expect === 'null') {
        assert.strictEqual(at, null, `#${idx} ${JSON.stringify(c.text)} MCP 应不命中`);
      } else if (c.expect === 'expired') {
        // MCP 对字面过去可能报错（提示改下周五）或返回过期时刻——都不应是未来有效时间
        if (at !== null) {
          assert.ok(at <= now.getTime() + 30000, `#${idx} ${JSON.stringify(c.text)} MCP 过去时刻不得判未来`);
          if (webHit) assert.deepStrictEqual(wall(at), wall(webHit.at), `#${idx} expired 用例两端时刻应一致`);
        }
      } else {
        assert.ok(at !== null, `#${idx} ${JSON.stringify(c.text)} MCP 应命中`);
        assert.deepStrictEqual(wall(at), [c.expect.y, c.expect.mo, c.expect.d, c.expect.h, c.expect.mi],
          `#${idx} ${JSON.stringify(c.text)} MCP 时刻与 fixture 不符`);
      }
    }
  } finally { appAll.dom.window.close(); }
});

// ── D：reFullCn 带年份完整中文日期 ──
test('V71-D reFullCn：2027年5月1日 07:00 整段命中且年份不滚动；内层 reCn 不重复', () => {
  assert.ok(SRC.includes('/(\\d{4})年(\\d{1,2})月(\\d{1,2})日\\s*(\\d{1,2}):(\\d{2})/g'), '应存在 reFullCn 正则');
  const app = freshApp();
  try {
    const rs = app.window.collectTimeMatches('2027年5月1日 07:00');
    assert.strictEqual(rs.length, 1, '应恰 1 条（内层 reCn 被 spans 排除）');
    assert.deepStrictEqual(wall(rs[0].at), [2027, 5, 1, 7, 0], '年份应 2027 不滚动');
    assert.strictEqual(rs[0].length, '2027年5月1日 07:00'.length, '整段命中');
    // 无空格形态
    const rs2 = app.window.collectTimeMatches('2027年5月1日07:00');
    assert.strictEqual(rs2.length, 1, '无空格形态也应命中');
    assert.deepStrictEqual(wall(rs2[0].at), [2027, 5, 1, 7, 0], '无空格年份 2027');
    // 过去年份灰态
    const rs3 = app.window.collectTimeMatches('2020年1月1日 07:00');
    assert.strictEqual(rs3.length, 1, '过去完整日期仍返回');
    assert.strictEqual(rs3[0].expired, true, '过去完整日期应 expired');
  } finally { app.dom.window.close(); }
});

// ── E：提醒 UI 四修 ──
test('V71-E1 源码：行距收紧 + 双列表限高内滚', () => {
  assert.ok(/#remCardList\{[^}]*gap:6px/.test(SRC), 'remCardList 行距应收紧为 gap:6px');
  assert.ok(/#remCardList\{[^}]*line-height:1\.4/.test(SRC), 'remCardList line-height 应 1.4');
  assert.ok(/#remCardList \.rem-item\{[^}]*min-height:40px/.test(SRC), '.rem-item 应保 40px 热区');
  const mh = (SRC.match(/max-height:min\(60vh,440px\)/g) || []).length;
  assert.strictEqual(mh, 2, 'remCardList/remBoxList 均应 max-height:min(60vh,440px)，实测 ' + mh);
  const ob = (SRC.match(/overscroll-behavior:contain/g) || []).length;
  assert.ok(ob >= 2, '两个列表容器均应 overscroll-behavior:contain');
  assert.ok(/#remCardList\{[^}]*-webkit-overflow-scrolling:touch/.test(SRC), 'remCardList 应带 touch 滚动');
  assert.ok(/#remBoxList\{[^}]*max-height:min\(60vh,440px\)/.test(SRC), 'remBoxList 应限高');
});

test('V71-E2 右上角 X：div 伪按钮（非原生 button）+ 在 remBoxForm 之外 + 复用 .box-x', () => {
  assert.ok(SRC.includes('<div id="remCardX" class="box-x"'), 'remCard X 应为 div.box-x 伪按钮');
  assert.ok(SRC.includes('<div id="remPanelX" class="box-x"'), 'remPanel X 应为 div.box-x 伪按钮');
  assert.ok(!SRC.includes('<button type="button" id="remCardX"'), 'remCard X 禁止原生 button（v5.39 铁律）');
  assert.ok(!SRC.includes('<button type="button" id="remPanelX"'), 'remPanel X 禁止原生 button');
  assert.ok(SRC.includes('#remCardX{position:absolute;top:14px;right:14px}'), 'remCard X 应绝对定位右上');
  assert.ok(!SRC.includes('.box-x{position:absolute'), '.box-x 本体不得绝对定位（v6.2 流内断言）');
  const xi = SRC.indexOf('id="remPanelX"');
  const fi = SRC.indexOf('id="remBoxForm"');
  assert.ok(xi > -1 && fi > -1 && xi < fi, 'remPanel X 必须在 #remBoxForm 之外（v63 e2e 裸选择器约束）');
  assert.ok(SRC.includes("$('#remCardX').addEventListener('click'"), 'remCardX 应绑点击');
  assert.ok(SRC.includes("$('#remPanelX').addEventListener('click', () => toggleRemPanel(false));"), 'remPanelX 应关面板');
});

test('V71-E3 仅 PC 自动聚焦事项输入框 + Enter isComposing 守卫', () => {
  assert.ok(SRC.includes('function focusRemItemInput()'), '应存在 focusRemItemInput');
  // hover 特性合法值只有 hover/none，「hover: fine」恒 false——门控须用 hover:hover（与 focusRemTimeInput 同款）
  assert.ok(SRC.includes("window.matchMedia('(hover: hover) and (pointer: fine)').matches"), '聚焦应 hover:hover+pointer:fine 双门控');
  assert.ok(SRC.includes("document.querySelector('#remBoxForm .rem-item')"), '聚焦选择器必须带 #remBoxForm 前缀（.rem-item 与卡片列表项撞名）');
  assert.ok(/resetWheelScroll\(\);[^}]*focusRemTimeInput\(\);[^}]*focusRemItemInput\(\);/.test(SRC), '面板显示后先滚轮后事项聚焦');
  assert.ok(SRC.includes('if (e.isComposing || e.keyCode === 229) return;'), '事项框 Enter 应带 IME 组合守卫');
  // v5.44 原有滚轮聚焦行为不动
  assert.ok(SRC.includes("window.matchMedia('(hover:hover) and (pointer:fine)').matches"), 'focusRemTimeInput 原门控串不动（theme.test.js:342 依赖）');
});

test('V71-E4 jsdom 行为：X 关闭卡片/面板 + PC 聚焦事项框', async t => {
  const app = freshApp();
  t.after(() => app.dom.window.close());
  const { window, document, editor } = app;
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const noteCt = await window.encryptText('x', key);
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 6 }) });
  await window.applyUnlocked(key, { v: 5, ct: noteCt.ct, iv: noteCt.iv, salt: 'x' });

  // remCard X 关闭卡片
  window.showRemCard([{ at: Date.now() - 60000, text: '迟到的事', fired: true }], true);
  assert.ok(!document.getElementById('remCard').classList.contains('hidden'), '前置：卡片显示');
  const xEvt = new window.MouseEvent('click', { bubbles: true });
  document.getElementById('remCardX').dispatchEvent(xEvt);
  assert.ok(document.getElementById('remCard').classList.contains('hidden'), 'remCardX 点击应关卡片');

  // remPanel X 关面板（jsdom matchMedia 不命中 fine → 不聚焦，仅验证开关）
  window.toggleRemPanel(true);
  assert.ok(!document.getElementById('remMask').classList.contains('hidden'), '前置：面板打开');
  document.getElementById('remPanelX').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(document.getElementById('remMask').classList.contains('hidden'), 'remPanelX 点击应收面板');
});

// ── 集成：collectTimeMatches 与相对组避让 ──
test('V71-C4 集成：数字组优先、相对组避让已命中区间', () => {
  const app = freshApp();
  try {
    const ct = app.window.collectTimeMatches;
    // reShort 命中后相对组不得对同一串重复命中
    assert.strictEqual(ct('9-2 07:00').length, 1, '9-2 07:00 应恰 1 条');
    // 「明天10:30」唯一且整段
    const r = ct('明天10:30');
    assert.strictEqual(r.length, 1, '明天10:30 应恰 1 条');
    assert.strictEqual(r[0].length, '明天10:30'.length, '相对命中应整段');
    // 事项区：U+3000 之后不命中（数字组照常）
    const r2 = ct('2026-9-8 14:00\u3000明天10点买东西');
    assert.strictEqual(r2.length, 1, 'U+3000 事项区相对词不命中、数字组照常');
    assert.deepStrictEqual(wall(r2[0].at), [2026, 9, 8, 14, 0]);
  } finally { app.dom.window.close(); }
});
