// v10.0.4 e2e（真 Chromium）：①折叠三角两态"墨迹等大"像素实测 ②跨行合并按折叠语义、零丢字
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server');

let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }
let server, browser, baseURL;
before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  if (browser) await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 6000))]).catch(() => {});
  try { if (server) server.close(); } catch (e) {}
  process.exit(failures > 0 ? 1 : 0);
});
const FX = '<div>[折叠]阳台清单</div><div>花肥、喷壶[/折叠]</div><div>后面这行别删我</div>';
async function openNote(name, html) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.__errors = errors; page.__ctx = ctx;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', name);
  await page.click('#landingBtn');
  await page.waitForFunction(n => location.pathname.endsWith(n), encodeURIComponent(name), { timeout: 10000 });
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  await page.evaluate(h => {
    const ed = document.getElementById('editor');
    ed.innerHTML = h;
    try { localStorage.setItem('notesync_fold_open', '{}'); } catch (e) {}
    window.applyFolds();
  }, html);
  await page.waitForTimeout(200);
  return page;
}
// mark 自身 font-size:0、盒子高度为 0，locator.screenshot 会判"不可见"——改成按"把手行高 + 标记横向区间"裁图，
// 再把裁到的像素丢进 canvas 量"非背景像素"的包围盒＝肉眼看到的三角大小
async function inkBox(page, sel) {
  const geo = await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const row = (el.closest ? el.closest('.ns-fold') : null) || el.parentNode;
    const rr = row.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const m = (cs.color.match(/\d+/g) || [0, 0, 0]).map(Number);
    return { x: Math.max(0, Math.floor(r.x) - 1), y: Math.max(0, Math.floor(rr.y)), width: Math.ceil(r.width) + 3, height: Math.ceil(rr.height), rgb: m.slice(0, 3) };
  }, sel);
  assert.ok(geo, '标记元素在位：' + sel);
  const buf = await page.screenshot({ clip: { x: geo.x, y: geo.y, width: geo.width, height: geo.height }, timeout: 8000 });
  const b64 = buf.toString('base64');
  return page.evaluate(async arg => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + arg.b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const [R, G, B] = arg.rgb;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] < 24) continue;
      // 只数"三角色"的像素（三角吃 --muted，标题字吃 --fg，靠色距分开，裁框稍微压到字也不怕）
      if (Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B) < 90) {
        n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { w: n ? maxX - minX + 1 : 0, h: n ? maxY - minY + 1 : 0, px: n, box: n ? (maxX - minX + 1) * (maxY - minY + 1) : 0 };
  }, { b64, rgb: geo.rgb });
}
const caretAt = (page, i) => page.evaluate(idx => {
  const ed = document.getElementById('editor'); ed.focus();
  const blk = ed.children[idx];
  const r = document.createRange(); r.setStart(blk, 0); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}, i);
const snap = page => page.evaluate(() => ({
  txt: document.getElementById('editor').innerText.replace(/\n/g, '⏎'),
  sig: (document.getElementById('editor').textContent || '').replace(/[\u200B]/g, '').split('').sort().join(''),
  rows: Array.prototype.map.call(document.getElementById('editor').children, b => (getComputedStyle(b).display === 'none' ? 'H' : 'V') + '<' + (b.className || '组外') + '>' + b.textContent)
}));

test('V1004-E1 三角两态墨迹等大（收起=右向、展开=下向，同一枚三角形旋转 90°）', guard(async () => {
  const page = await openNote('v1004e1', FX);
  const closed = await inkBox(page, '#editor .ns-fold-mark');
  await page.evaluate(() => document.querySelector('#editor .ns-fold-mark').click());
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 });
  const opened = await inkBox(page, '#editor .ns-fold-open > .ns-fold-mark');
  assert.ok(closed.px > 20 && opened.px > 20, '两态都画出了可见三角（墨迹像素 ' + closed.px + ' / ' + opened.px + '）');
  // 旧实现这里必然不等（▶ 与 ▼ 两个码位）；新实现是同一套边框，允许 1px 反锯齿差
  assert.ok(Math.abs(closed.w - opened.h) <= 1 && Math.abs(closed.h - opened.w) <= 1,
    '收起的宽×高 应等于 展开的高×宽（旋转关系）：收起 ' + closed.w + '×' + closed.h + '，展开 ' + opened.w + '×' + opened.h);
  assert.ok(Math.abs(closed.box - opened.box) <= Math.max(6, closed.box * 0.25), '两态包围盒面积接近：' + closed.box + ' vs ' + opened.box);
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1004-E2 收起态组外行首退格 → 整行并到标题末尾、隐藏正文一字不少、零丢字', guard(async () => {
  const page = await openNote('v1004e2', FX);
  const a = await snap(page);
  await caretAt(page, 2);
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.getElementById('editor').children.length === 2, null, { timeout: 8000 });
  const b = await snap(page);
  assert.ok(b.rows[0].indexOf('[折叠]阳台清单后面这行别删我') >= 0, '并到标题末尾：' + b.rows[0]);
  assert.ok(b.rows[1].indexOf('H<') === 0 && b.rows[1].indexOf('花肥、喷壶[/折叠]') >= 0, '隐藏正文原样：' + b.rows[1]);
  assert.strictEqual(b.sig, a.sig, '字符多重集不变（旧行为这里会整段吞字）');
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1004-E4 桌面/移动两态三角墨迹中心与标题文字中心对齐（闸 R1-P1：改画后曾整体偏下 6px）', guard(async () => {
  for (const vp of [{ width: 900, height: 760 }, { width: 390, height: 760 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landingInput', { timeout: 15000 });
    await page.fill('#landingInput', 'v1004e4' + (vp.width === 390 ? 'm' : ''));
    await page.click('#landingBtn');
    await page.waitForFunction(n => location.pathname.endsWith(n), encodeURIComponent('v1004e4' + (vp.width === 390 ? 'm' : '')), { timeout: 10000 });
    await page.waitForSelector('#pw', { timeout: 15000 });
    await page.fill('#pw', 'test-pass-123');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
    await page.evaluate(h => { const ed = document.getElementById('editor'); ed.innerHTML = h; try { localStorage.setItem('notesync_fold_open', '{}'); } catch (e) {} window.applyFolds(); }, FX);
    await page.waitForTimeout(250);
    for (const st of ['收起', '展开']) {
      if (st === '展开') { await page.evaluate(() => document.querySelector('#editor .ns-fold-mark').click()); await page.waitForTimeout(400); }
      const geo = await page.evaluate(() => {
        const mk = document.querySelector('#editor .ns-fold-mark'), row = document.querySelector('#editor .ns-fold');
        const mr = mk.getBoundingClientRect(), rr = row.getBoundingClientRect();
        const p = s => (getComputedStyle(mk)[s] || '').match(/\d+/g) || [0, 0, 0];
        const t = (getComputedStyle(row).color.match(/\d+/g) || [0, 0, 0]).map(Number);
        return { clip: { x: Math.floor(rr.x), y: Math.max(0, Math.floor(rr.y) - 2), width: Math.min(320, Math.ceil(rr.width)), height: Math.ceil(rr.height) + 4 }, markX: Math.floor(mr.x - rr.x), markW: Math.ceil(mr.width), rgb: p('color').slice(0, 3).map(Number), trgb: t };
      });
      const buf = await page.screenshot({ clip: geo.clip });
      const out = await page.evaluate(async arg => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + arg.b64; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const near = (i, rgb) => Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < 70;
        let a0 = 1e9, a1 = -1, b0 = 1e9, b1 = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (d[i + 3] < 40) continue;
          if (x <= arg.markX + arg.markW && near(i, arg.rgb)) { a0 = Math.min(a0, y); a1 = Math.max(a1, y); }
          if (x > arg.markX + arg.markW + 2 && near(i, arg.trgb)) { b0 = Math.min(b0, y); b1 = Math.max(b1, y); }
        }
        return { tri: [a0, a1], text: [b0, b1] };
      }, { b64: buf.toString('base64'), markX: geo.markX, markW: geo.markW, rgb: geo.rgb, trgb: geo.trgb });
      assert.ok(out.tri[1] >= out.tri[0] && out.text[1] >= out.text[0], '两态都量到墨迹（' + vp.width + ' ' + st + '）');
      const diff = (out.tri[0] + out.tri[1]) / 2 - (out.text[0] + out.text[1]) / 2;
      assert.ok(Math.abs(diff) <= 2, '三角墨迹中心与文字中心差须 ≤2px，实测 ' + diff.toFixed(1) + 'px（' + (vp.width === 390 ? '移动' : '桌面') + ' ' + st + '）');
    }
    assert.strictEqual(errs.length, 0, '零未捕获报错：' + errs[0]);
    await ctx.close();
  }
}));

test('V1004-E5 合并后光标必须可见；独立行锚与无锚组两种形态同样接管零丢字（闸 R2-P0/R1-P0a-b）', guard(async () => {
  // 独立行锚形态
  let page = await openNote('v1004e5a', '<div>[折叠]甲</div><div>[/折叠]</div><div>外面这行</div>');
  let a = await snap(page);
  assert.ok(a.rows[1].includes('ns-fold-endline'), '前置：第二块是 0 高独立行锚');
  await caretAt(page, 2);
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.getElementById('editor').children.length === 2, null, { timeout: 8000 });
  let b = await snap(page);
  assert.ok(b.rows[0].includes('[折叠]甲外面这行'), '落点是标题末尾，不是隐形行：' + b.rows[0]);
  assert.strictEqual(b.sig, a.sig, '独立行锚形态零丢字');
  const vis1 = await page.evaluate(() => {
    const ed = document.getElementById('editor'); const s = getSelection();
    if (!s.rangeCount) return 'NO_RANGE';
    let n = s.getRangeAt(0).startContainer; while (n.parentNode && n.parentNode !== ed) n = n.parentNode;
    return (n.classList ? n.classList.contains('ns-fold-hide') : false) ? 'HIDDEN' : 'VISIBLE';
  });
  assert.strictEqual(vis1, 'VISIBLE', '光标不得留在隐藏块里');
  await page.__ctx.close();
  // 无锚组 + 紧邻下一把手
  page = await openNote('v1004e5b', '<div>[折叠]标题A</div><div>正文A1</div><div>[折叠]标题B</div>');
  a = await snap(page);
  await caretAt(page, 2);
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.getElementById('editor').children.length === 2, null, { timeout: 8000 });
  b = await snap(page);
  assert.strictEqual(b.sig, a.sig, '无锚组同样零丢字（旧行为实测 31→22）：' + b.rows.join(' | '));
  const vis2 = await page.evaluate(() => {
    const ed = document.getElementById('editor'); const s = getSelection();
    if (!s.rangeCount) return 'NO_RANGE';
    let n = s.getRangeAt(0).startContainer; while (n.parentNode && n.parentNode !== ed) n = n.parentNode;
    return (n.classList ? n.classList.contains('ns-fold-hide') : false) ? 'HIDDEN' : 'VISIBLE';
  });
  assert.strictEqual(vis2, 'VISIBLE', '光标不得留在隐藏块里');
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1004-E3 展开态组外行首退格 → 并到组内正文尾、锚仍在行尾、零丢字；回车保持原生', guard(async () => {
  const page = await openNote('v1004e3', FX);
  await page.evaluate(() => document.querySelector('#editor .ns-fold-mark').click());
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 });
  const a = await snap(page);
  await caretAt(page, 2);
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.getElementById('editor').children.length === 2, null, { timeout: 8000 });
  const b = await snap(page);
  assert.ok(b.rows[1].indexOf('花肥、喷壶后面这行别删我[/折叠]') >= 0, '并到组内正文尾且锚在行尾：' + b.rows[1]);
  assert.strictEqual(b.sig, a.sig, '零丢字');
  // 回车：再来一次组外行（重新载入），按回车不许拼接
  await page.evaluate(() => { document.getElementById('editor').innerHTML = '<div>[折叠]甲</div><div>a1[/折叠]</div><div>乙行</div>'; window.applyFolds(); });
  const c0 = await snap(page);
  await caretAt(page, 2);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  const c1 = await snap(page);
  assert.ok(c1.rows[0].includes('[折叠]甲') && !c1.rows[0].includes('乙行'), '回车保持原生：没被拼到标题上：' + c1.rows[0]);
  assert.strictEqual(c1.sig.split('').sort().join(''), c0.sig.split('').sort().join(''), '回车未吞字（字符多重集不变）');
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1004-E6 展开→点进正文→点三角收起：光标必须逃出隐藏块，退格不得无声啃字（闸 R3三审 探针实锤）', guard(async () => {
  const page = await openNote('v1004e6', '<div>[折叠]标题</div><div>正文一[/折叠]</div><div>正文二</div>');
  await page.evaluate(() => document.querySelector('#editor .ns-fold-mark').click());           // 展开
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 });
  await page.click('#editor .ns-fold-body');                                                    // 光标落进正文行
  const inBody = await page.evaluate(() => {
    const ed = document.getElementById('editor'); const s = getSelection();
    if (!s.rangeCount) return 'NO_RANGE';
    let n = s.getRangeAt(0).startContainer; while (n.parentNode && n.parentNode !== ed) n = n.parentNode;
    return n.className;
  });
  assert.ok(inBody.includes('ns-fold-body'), '前置：光标确实在正文块里（展开态可见）：' + inBody);
  await page.evaluate(() => document.querySelector('#editor .ns-fold-mark').click());           // 收起（焦点不离开编辑器）
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const ed = document.getElementById('editor'); const s = getSelection();
    if (!s.rangeCount) return { where: 'NO_RANGE' };
    let n = s.getRangeAt(0).startContainer; while (n.parentNode && n.parentNode !== ed) n = n.parentNode;
    const cls = n === ed ? '(ROOT)' : (n.className || '无类');
    return { where: cls, hidden: n !== ed && !!n.classList && n.classList.contains('ns-fold-hide'), sig: (ed.textContent || '').replace(/[\u200B]/g, '').split('').sort().join('') };
  });
  assert.strictEqual(after.hidden, false, '收起后光标不得留在隐藏正文块里（否则用户看不见地在改字）：' + after.where);
  assert.ok(/ns-fold/.test(after.where), '光标应被弹回该组把手等可见位置：' + after.where);
  const atEnd = await page.evaluate(() => {
    const ed = document.getElementById('editor'), s = getSelection();
    if (!s.rangeCount) return { err: 'NO_RANGE' };
    const r = s.getRangeAt(0);
    const pre = document.createRange(); pre.selectNodeContents(ed.querySelector('.ns-fold')); pre.setEnd(r.startContainer, r.startOffset);
    const txt = pre.toString().replace(/[\u200B]/g, '');
    return { caretFromLeft: txt.length, titleLen: (ed.querySelector('.ns-fold').textContent || '').replace(/[\u200B]/g, '').length };
  });
  assert.ok(atEnd.err || atEnd.caretFromLeft === atEnd.titleLen, '落点须是把手可见文字的**末尾**，不许自动停在行最左位（那一格下一记退格会整删 [折叠] 并连带隐形的 [/折叠]，一记键拆掉整组结构）：' + JSON.stringify(atEnd));
  const sig0 = after.sig;
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1500);
  const fin = await page.evaluate(() => ({
    sig: document.getElementById('editor').textContent.replace(/[\u200B]/g, ''),
    sorted: document.getElementById('editor').textContent.replace(/[\u200B]/g, '').split('').sort().join(''),
    text: document.getElementById('editor').innerText.replace(/\n/g, '⏎')
  }));
  // 光标在标题末尾 → 退格就是删掉标题最后一个字（看得见、可撤销），折叠结构必须原样还在
  const lost = sig0.length - fin.sorted.length;
  assert.ok(lost === 0 || lost === 1, '退格最多删掉标题一个字（丢 4/9 字＝整组折叠结构被一记键拆掉）：丢 ' + lost + ' 字，屏幕=' + fin.text);
  assert.ok(fin.sig.includes('[折叠]') && fin.sig.includes('正文一') && fin.sig.includes('正文二'), '折叠标记与两段正文都必须还在：' + fin.sig);
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

/* ── 闸 R2-P0/P1 补（E6 属假绿：它用 element.click() 开合，走的正是 applyFolds 存/还原选区那趟、会派发
   selectionchange；真鼠标点三角时 mousedown 被 preventDefault＝选区原地不动、事件根本不派发，守卫一次都没跑，
   真机路径实测 8/8 稳定啃掉标题尾字并自动同步上云。以下两条一律改用真 page.mouse。） ── */
// 把手三角的可命中几何：逐像素扫 elementFromPoint 取命中该 mark 的点集，顺带取行盒与标题首字起点
async function foldHit(page) {
  return page.evaluate(() => {
    const ed = document.getElementById('editor');
    const handle = ed.querySelector('.ns-fold'); if (!handle) return { err: 'NO_HANDLE' };
    const mk = handle.querySelector('.ns-fold-mark'); if (!mk) return { err: 'NO_MARK' };
    const rr = handle.getBoundingClientRect(), mr = mk.getBoundingClientRect();
    const tn = mk.nextSibling;
    let titleX = rr.right;
    if (tn && tn.nodeType === 3) { const cr = document.createRange(); cr.setStart(tn, 0); cr.setEnd(tn, 1); const b = cr.getBoundingClientRect(); if (b.width) titleX = b.left; }
    const pts = [];
    for (let y = Math.floor(rr.top) - 24; y <= Math.ceil(rr.bottom) + 24; y++) {
      for (let x = Math.floor(mr.left) - 40; x <= Math.ceil(mr.left) + 80; x++) {
        const el = document.elementFromPoint(x + 0.5, y + 0.5);
        if (el && el.closest && el.closest('.ns-fold-mark') === mk) pts.push([x, y]);
      }
    }
    if (!pts.length) return { n: 0, rowT: rr.top, rowB: rr.bottom, titleX, markR: mr.right };
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { n: pts.length, x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys),
      cx: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 + 0.5, cy: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 + 0.5,
      rowT: rr.top, rowB: rr.bottom, titleX, markR: mr.right };
  });
}

test('V1004-E7 真鼠标点三角收起（不发 selectionchange 那条路）：光标必须逃出隐藏块，退格零散啃字一律禁止（闸 R2-P0）', guard(async () => {
  const page = await openNote('v1004e7', '<div>[折叠]标题一二三</div><div>正文甲甲[/折叠]</div><div>正文乙乙</div>');
  const h0 = await foldHit(page);
  assert.ok(!h0.err && h0.n > 0, '把手三角可命中（否则本用例测不到真机路径）：' + JSON.stringify(h0));
  await page.mouse.click(h0.cx, h0.cy);                                        // 真鼠标展开
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 });
  const bp = await page.evaluate(() => { const r = document.querySelector('#editor .ns-fold-body').getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
  await page.mouse.click(bp.x, bp.y);                                          // 真鼠标落进正文行
  await page.waitForTimeout(200);
  const where1 = await page.evaluate(() => {
    const ed = document.getElementById('editor'), s = getSelection(); if (!s.rangeCount) return 'NO_RANGE';
    let n = s.getRangeAt(0).startContainer; while (n.parentNode && n.parentNode !== ed) n = n.parentNode;
    return n.className;
  });
  assert.ok(/ns-fold-body/.test(where1), '前置：真鼠标点正文后光标应在正文块：' + where1);
  await page.mouse.click(h0.cx, h0.cy);                                        // 真鼠标收起＝选区原地不动、无 selectionchange
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => {
    const ed = document.getElementById('editor'), s = getSelection();
    let n = null, cls = '(NO_RANGE)';
    if (s.rangeCount) { n = s.getRangeAt(0).startContainer; while (n.parentNode && n.parentNode !== ed) n = n.parentNode; cls = n === ed ? '(ROOT)' : (n.className || '无类'); }
    return { cls, hidden: !!(n && n.classList && n.classList.contains('ns-fold-hide')),
      sig: (ed.textContent || '').replace(/[\u200B]/g, '').split('').sort().join('') };
  });
  assert.strictEqual(a.hidden, false, '真鼠标收起后光标不得留在隐藏正文块里（v10.0.3 实锤：下一记退格啃掉标题尾字还自动上云）：' + a.cls);
  assert.ok(/ns-fold/.test(a.cls), '光标应被弹回该组把手等可见位置：' + a.cls);
  const atEnd = await page.evaluate(() => {
    const ed = document.getElementById('editor'), s = getSelection();
    if (!s.rangeCount) return { err: 'NO_RANGE' };
    const r = s.getRangeAt(0);
    const h = ed.querySelector('.ns-fold');
    const pre = document.createRange(); pre.selectNodeContents(h); pre.setEnd(r.startContainer, r.startOffset);
    return { caretFromLeft: pre.toString().replace(/[\u200B]/g, '').length, titleLen: (h.textContent || '').replace(/[\u200B]/g, '').length };
  });
  assert.ok(atEnd.err || atEnd.caretFromLeft === atEnd.titleLen, '落点须是把手可见文字末尾，不是行最左位（闸 R2 复审二轮：最左位＝一记退格拆掉整组结构的陷阱格）：' + JSON.stringify(atEnd));
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1200);
  const fin = await page.evaluate(() => ({
    raw: document.getElementById('editor').textContent.replace(/[\u200B]/g, ''),
    sorted: document.getElementById('editor').textContent.replace(/[\u200B]/g, '').split('').sort().join(''),
    text: document.getElementById('editor').innerText.replace(/\n/g, '⏎')
  }));
  const lost = a.sig.length - fin.sorted.length;
  assert.ok(lost === 0 || lost === 1, '退格最多删掉标题一个字，丢 4/9 字＝整组折叠结构被一记键拆掉：丢 ' + lost + ' 字，屏幕=' + fin.text);
  assert.ok(fin.raw.includes('[折叠]') && fin.raw.includes('正文甲甲') && fin.raw.includes('正文乙乙'), '折叠标记与两段正文必须一个字都还在：' + fin.raw);
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));

test('V1004-E8 桌面三角命中区不得被改画砍掉（闸 R2-P1：旧字形版 187px² → 裸边框三角只剩 63px²），感应区不得越进标题首字或邻行', guard(async () => {
  for (const vp of [{ width: 900, height: 760 }, { width: 390, height: 760 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const nm = 'v1004e8' + (vp.width === 390 ? 'm' : '');
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landingInput', { timeout: 15000 });
    await page.fill('#landingInput', nm);
    await page.click('#landingBtn');
    await page.waitForSelector('#pw', { timeout: 15000 });
    await page.fill('#pw', 'test-pass-123');
    await page.click('#ok');
    await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.innerHTML = '<div>上面这行别抢</div><div>[折叠]标题一二三</div><div>下面这行别抢</div>';
      try { localStorage.setItem('notesync_fold_open', '{}'); } catch (e) {}
      window.applyFolds();
    });
    await page.waitForTimeout(250);
    const closed = await foldHit(page);
    assert.ok(!closed.err && closed.n > 0, '把手三角在位：' + closed.err);
    assert.ok(closed.n >= 300, (vp.width + 'px 收起态命中区不得掉回裸边框三角那一档（实测曾 63px²，改画前 187px²）：' + closed.n + 'px²'));
    const opened = await (async () => { await page.mouse.click(closed.cx, closed.cy); await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 }); return foldHit(page); })();
    assert.ok(Math.abs(opened.n - closed.n) <= 4, '两态命中区必须同样大——"展开和收起一样大"连落点也算：' + closed.n + ' vs ' + opened.n);
    if (vp.width === 900) { // 桌面这枚补出来的感应区必须严丝合缝收在本行行盒内、右缘不碰标题首字（窄屏 44×44 是 v9.3.0 既定的跨行大感应区，不在此约束内）
      assert.ok(closed.x1 + 1 < closed.titleX, '感应区右缘 x≤' + closed.x1 + ' 不得越进标题首字（首字起于 ' + closed.titleX + '）→ 点标题会误开合');
      assert.ok(closed.y0 >= Math.floor(closed.rowT) - 1 && closed.y1 <= Math.ceil(closed.rowB), '感应区上下缘须收在本行行盒 ' + closed.rowT.toFixed(1) + '~' + closed.rowB.toFixed(1) + ' 内，实测 ' + closed.y0 + '~' + closed.y1 + ' → 会抢相邻行的点击落点');
    }
    assert.strictEqual(errs.length, 0, '零未捕获报错：' + errs[0]);
    await ctx.close();
  }
}));

test('V1004-E9 组外行尾那枚撑行高的 <br> 不许跟着整行搬进组（闸 R2-P2③：展开态组末凭空多一条空行、收起态标题当场变两行）', guard(async () => {
  const page = await openNote('v1004e9', '<div>[折叠]甲标题</div><div>a1正文[/折叠]</div><div>乙行文字<br></div>');
  await page.evaluate(() => document.querySelector('#editor .ns-fold-mark').click());
  await page.waitForFunction(() => !!document.querySelector('#editor .ns-fold-open'), null, { timeout: 8000 });
  const a = await snap(page);
  await caretAt(page, 2);
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.getElementById('editor').children.length === 2, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const b = await snap(page);
  assert.strictEqual(b.txt.split('⏎').length, 2, '展开态合并后屏幕上必须还是两行，不许凭空多一条空行：' + b.txt);
  assert.ok(b.txt.indexOf('a1正文乙行文字') >= 0, '整行须拼到组内正文尾：' + b.txt);
  assert.strictEqual(b.sig, a.sig, '零丢字');
  // 收起态同款：拼到标题末尾也不许把标题撑成两行
  await page.evaluate(() => {
    document.getElementById('editor').innerHTML = '<div>[折叠]丙标题</div><div>c1正文[/折叠]</div><div>丁行文字<br></div>';
    try { localStorage.setItem('notesync_fold_open', '{}'); } catch (e) {}
    window.applyFolds();
  });
  await page.waitForTimeout(200);
  const c = await snap(page);
  await caretAt(page, 2);
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.getElementById('editor').children.length === 2, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const d = await snap(page);
  assert.ok(d.txt.indexOf('丙标题丁行文字') >= 0, '收起态须拼到标题末尾且标题仍是一行：' + d.txt);
  assert.strictEqual(d.txt, '[折叠]丙标题丁行文字', '收起态屏上就剩这一行，标题不许被撑成两行（原 c.txt 里那枚行尾 <br> 若不剥掉，这里会多出 ⏎）：' + d.txt);
  assert.strictEqual(d.sig, c.sig, '零丢字');
  assert.strictEqual(page.__errors.length, 0, '零未捕获报错：' + page.__errors[0]);
  await page.__ctx.close();
}));
