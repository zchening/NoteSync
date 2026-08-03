// _probe_undo_paste.js — 复现并验收：
//   Bug B: 空编辑器粘贴整段，第一行变空、内容整体下移一行
//   Bug A: Ctrl+Z 撤销异常（回退错位 / 按了没反应 / 需按几十次）
//
// 修复模型（v5.12）：自建撤销栈。用户真实编辑(input)压栈；linkify / poll 等
// 程序化改动只"同步"当前状态、不压栈。故 linkify 不产生额外撤销步，一次 Ctrl+Z
// 命中用户的上一步。
//
// 用法: node tests/e2e/_probe_undo_paste.js
// 直接在真实 Chromium 里跑（setContent 加载真实 index.html），避免 headless 盲区。

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  ✅ ' + label); }
  else { failed++; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });

  // 进入可编辑态（绕过解锁/landing），并 stub 掉网络 API 以免 autosave/poll 报错干扰
  await page.evaluate(() => {
    const l = document.getElementById('landing'); if (l) l.classList.add('hidden');
    const m = document.getElementById('mask'); if (m) m.classList.add('hidden');
    const e = document.getElementById('editor'); e.contentEditable = 'true'; e.focus();
    window.apiPut = async () => ({ v: (window.__v = (window.__v || 0) + 1) });
    window.apiGet = async () => ({ v: 0, ct: '', iv: '' });
  });

  const inner = () => page.evaluate(() => document.getElementById('editor').innerHTML);
  const text = () => page.evaluate(() => document.getElementById('editor').innerText);
  // 直接设置内容后重置撤销栈基线（模拟"用户没做过任何编辑"的初始态），避免测试用
  // innerHTML 直写导致 lastState 失同步。
  async function setHtml(html) {
    await page.evaluate(h => {
      const e = document.getElementById('editor'); e.innerHTML = h; e.focus();
      if (window.__undoReset) window.__undoReset();
    }, html);
  }
  async function doPaste(t) {
    await page.evaluate(v => {
      const editor = document.getElementById('editor');
      editor.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', v);
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      ev.clipboardData = dt;
      editor.dispatchEvent(ev);
    }, t);
  }

  // ===================== Bug B: 空编辑器粘贴 =====================
  console.log('\n===== Bug B: 空编辑器粘贴 "一二三\\n四五六" =====');
  await setHtml('');
  const beforeB = await inner();
  console.log('  粘贴前 innerHTML = ' + JSON.stringify(beforeB));

  await page.evaluate(() => { document.getElementById('editor').focus(); });
  await doPaste('一二三\n四五六');
  await page.waitForTimeout(60);
  const immediatelyB = await inner();
  console.log('  粘贴后即刻 innerHTML = ' + JSON.stringify(immediatelyB));
  await page.waitForTimeout(700); // 等 linkify 跑完
  const afterLinkifyB = await inner();
  console.log('  700ms(含linkify)后 innerHTML = ' + JSON.stringify(afterLinkifyB));
  const textB = await text();
  console.log('  渲染文本 innerText = ' + JSON.stringify(textB));

  // 期望：<div>一二三</div><div>四五六</div>（无空第一行）
  const okB = /<div>一二三<\/div><div>四五六<\/div>/.test(afterLinkifyB) && !/^<div><\/div>/.test(afterLinkifyB);
  check('Bug B: 结构为 <div>一二三</div><div>四五六</div> 且无空第一行', okB, afterLinkifyB);
  check('Bug B: 渲染文本恰好两行(非空)', textB.split('\n').filter(s => s !== '').length === 2, JSON.stringify(textB.split('\n')));
  // 粘贴是用户动作，应可被撤销：撤销栈 +1，且一次 Ctrl+Z 还原空编辑器
  const stB = await page.evaluate(() => window.__undoState());
  check('Bug B: 粘贴记入撤销栈(u=1)', stB.u === 1, 'u=' + stB.u);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(40);
  check('Bug B: 一次 Ctrl+Z 撤销粘贴(回到空)', (await text()).trim() === '', JSON.stringify(await text()));

  // ===================== Bug A2: 输入含URL后 Ctrl+Z 粒度 =====================
  console.log('\n===== Bug A2: 连续输入含URL文字后 Ctrl+Z 撤销粒度 =====');
  await setHtml('');
  const typed = 'abc http://x.com';
  await page.keyboard.type(typed, { delay: 10 });
  const afterType = await inner();
  console.log('  输入后(未linkify) innerHTML = ' + JSON.stringify(afterType));
  const stPre = await page.evaluate(() => window.__undoState());
  // 连续打字合并为单个撤销条目（贴近 Chrome：同一输入突发内逐字合并为一步）
  check('Bug A2: 连续输入合并为单个撤销条目(u=1)', stPre.u === 1, 'u=' + stPre.u);

  await page.waitForTimeout(700); // 等 linkify 把 URL 包成 <a>
  const afterLinkify = await inner();
  console.log('  输入+linkify后 innerHTML = ' + JSON.stringify(afterLinkify));
  const stPost = await page.evaluate(() => window.__undoState());
  // 核心修复点：linkify 是程序化改动，绝不能向撤销栈新增条目。
  // 旧模型里 linkify 把原生栈塞满，导致要按几十次 Ctrl+Z 才回到空；此处必须仍为 1。
  check('Bug A2: linkify 不新增撤销条目(仍为 u=1)', stPost.u === 1, 'u=' + stPost.u);

  // 统计多少次 Ctrl+Z 回到空（核心：应=1，绝不=60）
  let presses = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(20);
    presses++;
    if ((await text()).trim() === '') break;
  }
  console.log('  回到空内容用了 ' + presses + ' 次 Ctrl+Z（旧模型需 ~60 次）');
  check('Bug A2: 一次 Ctrl+Z 即回退整段输入(presses<=2)', presses <= 2, 'presses=' + presses);
  check('Bug A2: 首次 Ctrl+Z 内容确实变化(不再"按了没反应")', presses >= 1 && presses <= 2, 'presses=' + presses);

  // Ctrl+Y 重做恢复
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(40);
  const afterRedo = await text();
  // 重做恢复的是"已链接"状态，URL 内含有不可见零宽空格 \u200B（断行用），需剥离后再比对
  const norm = s => s.replace(/\u200B/g, '');
  check('Bug A2: Ctrl+Y 重做恢复文本', norm(afterRedo.trim()) === typed, JSON.stringify(afterRedo));

  // ===================== Bug A1: 选中行+空格后 Ctrl+Z =====================
  console.log('\n===== Bug A1: 选中整行+空格 后 Ctrl+Z 是否失效 =====');
  await setHtml('<div>第一行</div><div>第二行</div>');
  // 选中第一行
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const div = e.firstChild;
    const t = div.firstChild;
    const r = document.createRange();
    r.setStart(t, 0); r.setEnd(t, t.nodeValue.length);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Space'); // 选中态下按空格 → 替换选中内容为空格（F12 触发 rects=0 路径）
  await page.waitForTimeout(700); // 等 linkify + ensureCaret(relocate)
  const beforeUndo = await inner();
  console.log('  选中+空格后 innerHTML = ' + JSON.stringify(beforeUndo));
  const stA1 = await page.evaluate(() => window.__undoState());
  check('Bug A1: 选中+空格记入撤销栈(u=1)', stA1.u === 1, 'u=' + stA1.u);
  // 按 Ctrl+Z 期望还原第一行选中态
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  const afterUndoA1 = await inner();
  const selInfo = await page.evaluate(() => {
    const s = window.getSelection();
    return { collapsed: s.isCollapsed, text: s.toString(), ranges: s.rangeCount, connected: s.rangeCount ? s.getRangeAt(0).startContainer.isConnected : false };
  });
  console.log('  Ctrl+Z 后 innerHTML = ' + JSON.stringify(afterUndoA1));
  console.log('  Ctrl+Z 后 选区 = ' + JSON.stringify(selInfo));
  check('Bug A1: Ctrl+Z 后内容还原为两行(第一行回来)', /第一行/.test(afterUndoA1), afterUndoA1);
  check('Bug A1: Ctrl+Z 后选区仍有效(connected)', selInfo.connected !== false, JSON.stringify(selInfo));
  // 连续多次 Ctrl+Z 不应越界崩溃，且最终内容与初始一致或为空
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(20); }
  const finalA1 = await text();
  check('Bug A1: 连续撤销后无 JS 异常且内容合理', finalA1 !== null, JSON.stringify(finalA1));

  // ===================== 总结 =====================
  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  console.log(failed === 0 ? '✅ 全绿' : '❌ 有失败');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
