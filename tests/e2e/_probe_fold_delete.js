// _probe_fold_delete.js — v10.2.0 长按删除折叠列表（仿 NoteSyncX v3.2.5 报障⑤）端到端验证
//   P1 长按标题文字 ≥600ms → 删除确认框弹出（自建 .mask/.box；外围点击不关）
//   P2 点「取消」→ 折叠组原样还在
//   P3 长按中间组 → 点「删除」→ 整组（标题+正文+闭合锚）消失；其余组结构与展开态保持；
//      展开集按新序号前移重落库（删组后把手序号前移，状态不许错位一格）
//   P4 Ctrl+Z → 整组找回（自建撤销栈）
//   P5 反向闸：短按即抬 / 长按三角 / 鼠标指针 / 长按正文 / 组字期，一个都不弹确认框
//   P6 独立行锚组：[/折叠] 锚块随组一起走，不留无主裸字
// 环境：spawn 真实 server.js（localhost 安全上下文），走真实解锁链路；手势用合成 PointerEvent
//      （pointerType:'touch'，监听器不挑 isTrusted，与 NoteSyncX e2e 同法）。
// 用法: node tests/e2e/_probe_fold_delete.js（退出码 0 = 全绿）
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const PORT = '8153';
const BASE = 'http://localhost:' + PORT;
const NOTE = 'probeFoldDel';
const PASS = 'probe-fold-del-pass';

let passed = 0, failed = 0;
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let started = false;
    child.stdout.on('data', d => {
      if (!started && d.toString().includes('listening on :' + PORT)) { started = true; resolve(); }
    });
    child.stderr.on('data', d => process.stderr.write('[server] ' + d));
    child.on('exit', code => { if (!started) reject(new Error('server exited early, code=' + code)); });
    setTimeout(() => { if (!started) reject(new Error('server did not start within 10s')); }, 10000);
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE + '/' + NOTE);
    await page.waitForSelector('#pw', { timeout: 10000 });
    await page.fill('#pw', PASS);
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true'
      && document.getElementById('mask').classList.contains('hidden'), { timeout: 20000 });

    // ---- 种子：三处折叠（甲/丙/戊），正文行 + 一行普通文字 ----
    // 注意用普通 Event（非 InputEvent）：inputType='insertText' 会被 v10.1.2 判成"用户敲出
    // [折叠]"而触发建组定界补锚，种子形态就不干净了（那是打字路径的真实行为，P6 单独验锚）。
    await page.evaluate(() => {
      const e = document.getElementById('editor');
      e.innerHTML = '<div>[折叠]甲</div><div>乙</div><div>[折叠]丙</div><div>丁</div><div>[折叠]戊</div><div>己</div><div>普通行</div>';
      e.dispatchEvent(new Event('input', { bubbles: true }));
      window.applyFolds(); // input 链的 linkify 有 600ms 延迟，这里显式重绘一次拿稳形态
      // 展开第 1、3 处（点三角，走真实开合链路 + 落库）
      document.querySelectorAll('#editor span.ns-fold-mark')[0].click();
      document.querySelectorAll('#editor span.ns-fold-mark')[2].click();
    });
    await sleep(1400); // 等 800ms 防抖保存落地，避免 poll 把种子冲掉
    await sleep(200);
    const seed = await page.evaluate(() => ({
      handles: document.querySelectorAll('#editor .ns-fold').length,
      states: Array.from(document.querySelectorAll('#editor .ns-fold')).map(h => h.classList.contains('ns-fold-open') ? '展开' : '收起'),
      open: JSON.parse(localStorage.getItem('notesync_fold_open') || '{}'),
    }));
    check('P0 种子就位：三处折叠，展开态 [展开,收起,展开] 落库',
      seed.handles === 3 && JSON.stringify(seed.states) === JSON.stringify(['展开', '收起', '展开']),
      JSON.stringify(seed));

    // ---- P1 长按标题文字（dx=80 避开三角；800ms 不抬起）→ 确认框 ----
    await page.evaluate(() => {
      const head = document.querySelectorAll('#editor .ns-fold')[1];
      const r = head.getBoundingClientRect();
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 80, clientY: r.top + 10 }));
    });    await page.waitForSelector('#foldDeleteOk', { timeout: 5000 });
    check('P1 长按标题 ≥600ms 弹出删除确认框', true);
    const boxGeom = await page.evaluate(() => {
      const ok = document.getElementById('foldDeleteOk').getBoundingClientRect();
      const box = document.querySelector('#nsFoldDelModal .box').getBoundingClientRect();
      return { okRight: ok.right, boxRight: box.right, boxLeft: box.left, okLeft: ok.left };
    });
    check('P1b 确认框按钮不横向溢出盒体（v3.2.4 同款事故护栏）',
      boxGeom.okRight <= boxGeom.boxRight + 1 && boxGeom.okLeft >= boxGeom.boxLeft - 1, JSON.stringify(boxGeom));

    // ---- P2 取消 → 原样 ----
    await page.click('#foldDeleteCancel');
    await sleep(300);
    const afterCancel = await page.evaluate(() => ({
      handles: document.querySelectorAll('#editor .ns-fold').length,
      text: document.getElementById('editor').textContent.replace(/[\u200B]/g, ''),
      modal: !!document.getElementById('foldDeleteOk'),
    }));
    check('P2 取消后确认框关闭、折叠组原样还在',
      !afterCancel.modal && afterCancel.handles === 3 && afterCancel.text === '[折叠]甲乙[折叠]丙丁[折叠]戊己普通行',
      JSON.stringify(afterCancel));

    // ---- P5 反向闸 ----
    // 长按第 idx 处折叠的标题（dx 避开左端三角区；ptype 默认 touch）
    const lp = (idx, dx, ptype) => page.evaluate(([idx, dx, ptype]) => {
      const head = document.querySelectorAll('#editor .ns-fold')[idx];
      const r = head.getBoundingClientRect();
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: ptype || 'touch', clientX: r.left + (dx || 0), clientY: r.top + 10 }));
    }, [idx, dx, ptype]);
    // 5a 短按即抬
    await lp(0, 80); await page.evaluate(() => document.querySelectorAll('#editor .ns-fold')[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
    await sleep(700);
    check('P5a 600ms 内抬起不弹确认框', !(await page.$('#foldDeleteOk')));
    // 5b 长按三角
    await page.evaluate(() => {
      const mk = document.querySelectorAll('#editor .ns-fold span.ns-fold-mark')[0];
      const r = mk.getBoundingClientRect();
      mk.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 4, clientY: r.top + 6 }));
    });
    await sleep(700);
    check('P5b 长按三角不弹确认框（留给点按开合）', !(await page.$('#foldDeleteOk')));
    // 5c 鼠标指针
    await lp(0, 80, 'mouse');
    await sleep(700);
    check('P5c 鼠标指针不弹确认框（桌面按住是拖选）', !(await page.$('#foldDeleteOk')));
    // 5d 长按正文
    await page.evaluate(() => {
      const body = document.querySelector('#editor .ns-fold-body');
      const r = body.getBoundingClientRect();
      body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 40, clientY: r.top + 10 }));
    });
    await sleep(700);
    check('P5d 长按正文不弹确认框', !(await page.$('#foldDeleteOk')));
    // 5e 组字期
    await page.evaluate(() => document.getElementById('editor').dispatchEvent(new Event('compositionstart')));
    await lp(0, 80);
    await sleep(700);
    check('P5e 组字期不弹确认框（红线9）', !(await page.$('#foldDeleteOk')));
    await page.evaluate(() => document.getElementById('editor').dispatchEvent(new Event('compositionend')));
    // 5f 移动超 10px（滚动意图）
    await page.evaluate(() => {
      const head = document.querySelectorAll('#editor .ns-fold')[1];
      const r = head.getBoundingClientRect();
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 80, clientY: r.top + 10 }));
      head.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: r.left + 80, clientY: r.top + 90 }));
    });
    await sleep(700);
    check('P5f 移动超 10px（滚动意图）不弹确认框', !(await page.$('#foldDeleteOk')));

    // ---- P3 长按中间组 → 删除 ----
    await page.evaluate(() => window.__undoReset());
    await lp(1, 80);
    await page.waitForSelector('#foldDeleteOk', { timeout: 5000 });
    await page.click('#foldDeleteOk');
    await sleep(300);
    const afterDel = await page.evaluate(() => ({
      handles: document.querySelectorAll('#editor .ns-fold').length,
      states: Array.from(document.querySelectorAll('#editor .ns-fold')).map(h => h.classList.contains('ns-fold-open') ? '展开' : '收起'),
      text: document.getElementById('editor').textContent.replace(/[\u200B]/g, ''),
      open: JSON.parse(localStorage.getItem('notesync_fold_open') || '{}'),
      u: window.__undoState().u,
    }));
    check('P3a 删除后中间组整组消失（标题+正文），其余组一个字不丢',
      afterDel.handles === 2 && afterDel.text === '[折叠]甲乙[折叠]戊己普通行', JSON.stringify(afterDel));
    check('P3b 删除后其余组展开态保持（原第 3 处展开，前移后仍展开——序号重映射）',
      JSON.stringify(afterDel.states) === JSON.stringify(['展开', '展开']), JSON.stringify(afterDel.states));
    const openArr = (afterDel.open && afterDel.open[Object.keys(afterDel.open)[0]]) || [];
    check('P3c 展开集按新序号前移重落库（[0,2]→[0,1]）',
      JSON.stringify(openArr) === JSON.stringify([0, 1]), JSON.stringify(afterDel.open));
    check('P3d 删除进了自建撤销栈', afterDel.u >= 1, JSON.stringify(afterDel.u));

    // ---- P4 Ctrl+Z 找回 ----
    await page.evaluate(() => {
      document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await sleep(300);
    const afterUndo = await page.evaluate(() => ({
      handles: document.querySelectorAll('#editor .ns-fold').length,
      text: document.getElementById('editor').textContent.replace(/[\u200B]/g, ''),
    }));
    check('P4 Ctrl+Z 整组找回', afterUndo.handles === 3 && afterUndo.text === '[折叠]甲乙[折叠]丙丁[折叠]戊己普通行', JSON.stringify(afterUndo));

    // ---- P6 独立行锚组：锚块随组走 ----
    await page.evaluate(() => {
      const e = document.getElementById('editor');
      e.innerHTML = '<div>[折叠]带锚组</div><div>锚内正文</div><div>[/折叠]</div><div>组外行</div>';
      window.applyFolds();
    });
    await sleep(200);
    const beforeP6 = await page.evaluate(() => ({
      endline: document.querySelectorAll('#editor .ns-fold-endline').length,
      anchors: (document.getElementById('editor').textContent.match(/\[\/折叠\]/g) || []).length,
    }));
    await lp(0, 80);
    await page.waitForSelector('#foldDeleteOk', { timeout: 5000 });
    await page.click('#foldDeleteOk');
    await sleep(300);
    const afterP6 = await page.evaluate(() => ({
      endline: document.querySelectorAll('#editor .ns-fold-endline').length,
      anchors: (document.getElementById('editor').textContent.match(/\[\/折叠\]/g) || []).length,
      handles: document.querySelectorAll('#editor .ns-fold').length,
      text: document.getElementById('editor').textContent.replace(/[\u200B]/g, ''),
    }));
    check('P6a 前置：独立行锚组就位', beforeP6.endline === 1 && beforeP6.anchors === 1, JSON.stringify(beforeP6));
    check('P6b 删除后独立行锚块随组一起走，不留无主裸字',
      afterP6.endline === 0 && afterP6.anchors === 0 && afterP6.handles === 0 && afterP6.text === '组外行', JSON.stringify(afterP6));

    check('P7 全程无页面脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    if (browser) await browser.close();
    child.kill();
  }

  console.log(`\n${failed === 0 ? 'ALL GREEN' : 'HAS FAILURES'}  pass=${passed} fail=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('probe crashed:', e); process.exit(1); });
