// _probe_user_bugs.js — 严格按用户原话逐字复现 v5.12 修复的两个用户 bug：
//   Bug B: 空编辑器粘贴整段，顶部多出空行、内容整体下移一行
//   Bug A: Ctrl+Z 撤销异常（A-1 按了没反应 / 需按几十次；A-2 回退内容不是上一步/半链接错乱）
//
// 每个 bug 场景用【全新页面】隔离复现，忠实于"用户独立上报"的逐字场景；
// 复用 _probe_undo_paste.js 的初始化套路：隐藏 landing/mask、editor.contentEditable='true'、
// focus、stub apiPut/apiGet、用 window.__undoReset() 在直接设 innerHTML 后重置基线。
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

// 全新页面 + 完整初始化（每次隔离一个用户场景）
async function freshScenario(browser) {
  const page = await browser.newPage();
  await page.setContent(HTML);
  await page.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 10000 });
  await page.evaluate(() => {
    const l = document.getElementById('landing'); if (l) l.classList.add('hidden');
    const m = document.getElementById('mask'); if (m) m.classList.add('hidden');
    const e = document.getElementById('editor'); e.contentEditable = 'true'; e.focus();
    window.apiPut = async () => ({ v: (window.__v = (window.__v || 0) + 1) });
    window.apiGet = async () => ({ v: 0, ct: '', iv: '' });
  });
  const inner = () => page.evaluate(() => document.getElementById('editor').innerHTML);
  const text  = () => page.evaluate(() => document.getElementById('editor').innerText);
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
  return { page, inner, text, setHtml, doPaste };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });

  // ===================== Bug B：粘贴空行（用户原话逐字复现） =====================
  // 原话：页面没有任何内容，光标在第一行最左侧，我粘贴一下文字 第一行"一二三"，第二行"四五六"。
  //      期望：第一行"一二三"，第二行"四五六"。
  //      实际：第一行空行，第二行"一二三"，第三行"四五六"。
  {
    console.log('\n===== Bug B：空编辑器 + 光标左上角，粘贴 "一二三\\n四五六" =====');
    const { page, inner, text, setHtml, doPaste } = await freshScenario(browser);
    await setHtml('');
    await page.evaluate(() => {
      const e = document.getElementById('editor'); e.focus();
      const r = document.createRange();
      r.selectNodeContents(e); r.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await doPaste('一二三\n四五六');
    await page.waitForTimeout(700); // 等 linkify 跑完
    const htmlB = await inner();
    const txtB = await text();
    console.log('  700ms后 innerHTML = ' + JSON.stringify(htmlB));
    console.log('  700ms后 innerText = ' + JSON.stringify(txtB));
    check('Bug B: innerHTML 恰好为 <div>一二三</div><div>四五六</div>',
          htmlB === '<div>一二三</div><div>四五六</div>', htmlB);
    check('Bug B: innerHTML 不以 <div></div> 开头（无顶部空行）',
          !/^<div><\/div>/.test(htmlB), htmlB);
    const linesB = txtB.split('\n').filter(s => s !== '');
    check('Bug B: innerText 恰好两行非空(一二三 / 四五六)',
          linesB.length === 2 && linesB[0] === '一二三' && linesB[1] === '四五六',
          JSON.stringify(txtB.split('\n')));
    await page.close();
  }

  // ===================== Bug A-2：回退内容不是上一步 / 半链接错乱 =====================
  // 原话：「有时候按了回复的内容不是上一步的」；旧症状：按一次只删末字符、留下 http://x.co
  // （独立全新页面，与 A-1 隔离；参考 _probe_undo_paste.js 的 A2 章节验证手法）
  {
    console.log('\n===== Bug A-2：输入 "abc http://x.com" 后 Ctrl+Z 粒度 =====');
    const { page, inner, text, setHtml } = await freshScenario(browser);
    await setHtml('');
    await page.keyboard.type('abc http://x.com', { delay: 10 });
    const stPre = await page.evaluate(() => window.__undoState());
    console.log('  linkify前 u=' + stPre.u);
    check('Bug A-2: 连续输入合并为单个撤销条目(u=1，linkify前)', stPre.u === 1, 'u=' + stPre.u);

    await page.waitForTimeout(700); // 等 linkify 把 URL 包成 <a>
    const htmlLinked = await inner();
    console.log('  linkify后 innerHTML = ' + JSON.stringify(htmlLinked));
    const stPost = await page.evaluate(() => window.__undoState());
    // 核心修复点：linkify 是程序化改动，绝不能向撤销栈新增条目
    check('Bug A-2: linkify 不新增撤销条目(u 仍为 1，linkify后)', stPost.u === 1, 'u=' + stPost.u);

    // 按【一次】Ctrl+Z：应回退到"用户的上一步"（此处只有一次编辑突发，应为空 / 回退整个输入），
    // 绝不能出现"半链接"错乱内容(如 http://x.co)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(40);
    const htmlUndo = await inner();
    const txtUndo = await text();
    console.log('  一次 Ctrl+Z 后 innerHTML = ' + JSON.stringify(htmlUndo));
    console.log('  一次 Ctrl+Z 后 innerText = ' + JSON.stringify(txtUndo));
    check('Bug A-2: 一次 Ctrl+Z 回退整段输入回到空(非只删末字符)',
          txtUndo.trim() === '', JSON.stringify(txtUndo));
    const hasHalfLink = /http:\/\/x\.co(?!m)/.test(htmlUndo);
    check('Bug A-2: 不出现"半链接"错乱内容(http://x.co)', !hasHalfLink, htmlUndo);
    check('Bug A-2: 回退后无残留 <a> 标签(整段输入撤销)', !/<a[ >]/.test(htmlUndo), htmlUndo);
    await page.close();
  }

  // ===================== Bug A-1：按了没反应 / 需按几十次 =====================
  // 原话：「有时候按了没反应」+ 旧 bug 需按 ~60 次才回空
  {
    console.log('\n===== Bug A-1：输入 "hello world" 后 Ctrl+Z =====');
    const { page, text, setHtml } = await freshScenario(browser);
    await setHtml('');
    await page.keyboard.type('hello world', { delay: 10 });
    const beforeUndo = await text();
    console.log('  输入后 innerText = ' + JSON.stringify(beforeUndo));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(40);
    const afterOne = await text();
    console.log('  一次 Ctrl+Z 后 innerText = ' + JSON.stringify(afterOne));
    check('Bug A-1: 一次 Ctrl+Z 内容确实变化(不再"按了没反应")',
          afterOne !== beforeUndo, 'before=' + JSON.stringify(beforeUndo) + ' after=' + JSON.stringify(afterOne));
    let presses = 1;
    for (let i = 0; i < 80; i++) {
      if ((await text()).trim() === '') break;
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(20);
      presses++;
    }
    console.log('  回到空内容共用了 ' + presses + ' 次 Ctrl+Z（旧 bug 需 ~60 次）');
    check('Bug A-1: 回空只需很少按压次数(≤3，绝非几十次)', presses <= 3, 'presses=' + presses);
    await page.close();
  }

  // ===================== 总结 =====================
  console.log('\n' + '='.repeat(48));
  console.log('结果: ' + passed + ' 通过 / ' + failed + ' 失败');
  console.log(failed === 0 ? '✅ 全绿' : '❌ 有失败');

  // 直接按结果退出，避免 headless 下 browser.close() 偶发挂起导致拿不到退出码
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('探针异常:', e); process.exit(2); });
