// v10.1.2 真浏览器复现 v2：严格对齐用户操作（回车 → 空行输标题 → 行首键入 [折叠]）
const { chromium } = require('playwright');
const { startServer } = require('./server');

const HTML = [
  '<div>1，橙子：尿不湿→内裤</div>',
  '<div>2，橙子吃桃子，牛奶。燕麦片。</div>',
  '<div>3，菜：</div>',
  '<div>-豆腐，娃娃菜，番茄，雪菜。包子，馒头，炖鸡汤，牛肉丸。</div>',
  '<div>-鱼。</div>',
  '<div>4，蛀牙处理</div>',
  '<div>5，找高跟鞋，修旧高跟鞋</div>',
  '<div>6，发票信息备注确认@梁静13958084173</div>',
  '<div>7，趣学桌游→能否生成完全线上版本</div>',
  '<div>8，银吉iPhone备份</div>',
].join('');

async function dump(page, tag) {
  const d = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const rows = Array.prototype.map.call(ed.children, (b, i) => ({
      i, cls: b.className || '(none)',
      txt: (b.textContent || '').replace(/\u200B/g, '').slice(0, 18),
      kind: (window.foldEndKind && window.foldEndKind(b)) || '-',
    }));
    return { rows, anchors: (ed.textContent.match(/\[\/折叠\]/g) || []).length };
  });
  console.log('--- ' + tag + ' --- anchors=' + d.anchors);
  d.rows.forEach(r => console.log(String(r.i).padStart(2), '|', String(r.cls).padEnd(38), '|', r.kind.padEnd(4), '|', r.txt));
}

(async () => {
  const server = await startServer();
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput');
  await page.fill('#landingInput', 'seedprobe2');
  await page.click('#landingBtn');
  await page.waitForFunction(n => location.pathname.endsWith(n), 'seedprobe2', { timeout: 10000 });
  await page.waitForSelector('#pw');
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true');
  await page.evaluate(h => {
    const ed = document.getElementById('editor');
    ed.innerHTML = h;
    try { localStorage.setItem('notesync_fold_open', '{}'); } catch (e) {}
    window.applyFolds();
  }, HTML);
  await page.waitForTimeout(300);

  // ① "1，"前行首回车
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const b = ed.children[0];
    const r = document.createRange(); r.setStart(b.firstChild, 0); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await dump(page, '回车后（应有空行+1，橙子下移）');

  // ② 光标挪到第一行（空行）末尾，输入标题
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const b = ed.children[0];
    const r = document.createRange(); r.selectNodeContents(b); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.insertText('哈哈');
  await page.waitForTimeout(700);
  await dump(page, '输入哈哈后');

  // ③ Home → 逐字键入 [折叠]
  await page.keyboard.press('Home');
  for (const ch of ['[', '折', '叠', ']']) {
    await page.keyboard.insertText(ch);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(900);
  await dump(page, '键入[折叠]后 900ms');

  // ④ 手动补一次 applyFolds：区分「applyFolds 没被链路触发」vs「触发了但把手判定失败」
  const manual = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const first = ed.children[1] || ed.children[0];
    const before = first.className || '(none)';
    window.applyFolds();
    return { before, after: first.className || '(none)',
      lead: !!(window.foldLeadInfo && window.foldLeadInfo(first)),
      isHandle: !!(window.isFoldHandleBlock && window.isFoldHandleBlock(first)),
      firstHTML: first.innerHTML.slice(0, 160) };
  });
  console.log('--- 手动 applyFolds ---');
  console.log('把手行 class before=', manual.before, ' after=', manual.after);
  console.log('foldLeadInfo=', manual.lead, ' isFoldHandleBlock=', manual.isHandle);
  console.log('把手行 innerHTML=', manual.firstHTML);

  await browser.close().catch(() => {});
  try { server.close(); } catch (e) {}
  process.exit(0);
})();
