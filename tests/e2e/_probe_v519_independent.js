'use strict';
// ============================================================================
// _probe_v519_independent.js — NoteSync v5.19 修复点独立验证探针（全新设计）
//
// 覆盖项（每条独立断言）：
//   [I1] linkify XSS 三连：属性注入 / onerror 执行 / 标签篡改
//   [I2] 粘贴：非空行中单行合并与光标接续、两行拆分不嵌套、空编辑器多行无空首行、
//        粘贴单步撤销
//   [I3] URL 边界：CJK 处即停（不吞尾部中文）+ ASCII 尾部回归（(B) 仍在 href）
//   [I4] 保存失败 3s 退避自动重试（apiPut stub 注入一次失败）
//   [I5] 笔记名：_/- 放行、非法字符 400 且前端提示、fetchRetry 对 4xx 不重试、
//        落地页输入净化
//   [I6] copyBtn 复制剥离 ZWSP
//
// 环境：spawn 真实 server.js 到 8148 端口（localhost 安全上下文，crypto.subtle 可用，
// 解锁走真实 PBKDF2 派生）。除 I4 的 apiPut stub 外不替换任何应用函数。
//
// 用法: node tests/e2e/_probe_v519_independent.js
// ============================================================================

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO = path.join(__dirname, '..', '..');
const PORT = '8148';
const BASE = 'http://localhost:' + PORT;
const PASS_PHRASE = 'probe-v519-independent';

// ---- 结果收集 ----
const results = [];
let passed = 0, failed = 0;
function check(section, label, ok, extra) {
  ok = !!ok;
  if (ok) passed++; else failed++;
  results.push({ section, label, ok, extra });
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + section + ' :: ' + label +
    (!ok && extra ? '\n         -> ' + extra : ''));
}
const strip = s => String(s == null ? '' : s).replace(/\u200B/g, '');

// 本探针创建的笔记文件，结束后清理（绝不动既有文件）
const NOTES_DIR = path.join(REPO, 'data', 'notes');
const PRE_EXISTING = new Set(fs.existsSync(NOTES_DIR) ? fs.readdirSync(NOTES_DIR) : []);
const createdNotes = [];

// ============================================================================
// 基础设施
// ============================================================================
function startServer() {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let up = false;
    child.stdout.on('data', d => {
      if (!up && d.toString().indexOf('listening on :' + PORT) !== -1) { up = true; resolve(child); }
    });
    child.stderr.on('data', d => process.stderr.write('[server] ' + d));
    child.on('exit', code => { if (!up) reject(new Error('server exited early, code=' + code)); });
    setTimeout(() => { if (!up) reject(new Error('server not ready within 10s')); }, 10000);
  });
}

// 解锁指定笔记（真实 PBKDF2 路径）。返回是否成功进入编辑器。
async function unlockNote(page, noteName) {
  createdNotes.push(noteName);
  await page.goto(BASE + '/' + encodeURIComponent(noteName), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pw', { state: 'visible', timeout: 10000 });
  await page.fill('#pw', PASS_PHRASE);
  await page.click('#ok');
  await page.waitForFunction(() => {
    const ed = document.getElementById('editor');
    const mask = document.getElementById('mask');
    return ed && ed.contentEditable === 'true' && mask && mask.classList.contains('hidden');
  }, null, { timeout: 20000 });
}

// 通过 execCommand('insertText') 真实输入（先确保焦点与合法光标）
function typeText(page, text) {
  return page.evaluate(t => {
    const ed = document.getElementById('editor');
    ed.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
      try { sel.setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset); } catch (e) {}
    }
    return document.execCommand('insertText', false, t);
  }, text);
}

// 把光标放到编辑器内"可见偏移"处（忽略 ZWSP）
function caretTo(page, visibleOffset) {
  return page.evaluate(off => {
    const ed = document.getElementById('editor');
    ed.focus();
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let pos = 0, n;
    while ((n = walker.nextNode())) {
      const raw = n.nodeValue;
      const vis = raw.replace(/\u200B/g, '').length;
      if (pos + vis >= off) {
        let real = 0, seen = 0, want = off - pos;
        while (seen < want && real < raw.length) {
          if (raw[real] !== '\u200B') seen++;
          real++;
        }
        const sel = window.getSelection();
        sel.setBaseAndExtent(n, real, n, real);
        return true;
      }
      pos += vis;
    }
    return false;
  }, visibleOffset);
}

// 构造 DataTransfer 派发可取消 paste 事件；返回事件是否被应用 preventDefault（即被接管）
function pastePlain(page, text) {
  return page.evaluate(t => {
    const ed = document.getElementById('editor');
    ed.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    let ev = null;
    try { ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); } catch (e) {}
    if (!ev || !ev.clipboardData) {
      ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: dt });
    }
    return ed.dispatchEvent(ev) === false; // false = 应用 preventDefault 接管了粘贴
  }, text);
}

// 读取编辑器状态：可见文本行、纯文本、HTML、链接信息
function readEditor(page) {
  return page.evaluate(() => {
    const ed = document.getElementById('editor');
    const zw = s => String(s == null ? '' : s).replace(/\u200B/g, '');
    const links = Array.from(ed.querySelectorAll('a')).map(a => ({
      hrefAttr: a.getAttribute('href'),
      text: zw(a.textContent),
      dataUrl: a.getAttribute('data-url'),
      onAttrs: Array.from(a.attributes).filter(x => /^on/i.test(x.name)).map(x => x.name),
    }));
    // 嵌套块判定：沿父链检查（#editor 本身是 div，直接用 'div div' 选择器会把
    // 根下每个 div 子节点都误判成嵌套）
    let nestedBlock = false;
    for (const el of ed.querySelectorAll('div,p')) {
      let p = el.parentElement;
      while (p && p !== ed) {
        if (p.tagName === 'DIV' || p.tagName === 'P') { nestedBlock = true; break; }
        p = p.parentElement;
      }
      if (nestedBlock) break;
    }
    // 根下裸节点：非块级直接子节点（非空裸文本 / 裸元素），违反应用自身
    // ensureBlockWrapped 约定（"编辑器根下必须是块级子元素"）
    const rootBare = Array.from(ed.childNodes).some(n =>
      n.nodeType === 3 ? n.nodeValue.replace(/\s/g, '').length > 0
        : (n.nodeType === 1 && n.tagName !== 'DIV' && n.tagName !== 'P'));
    return {
      text: zw(ed.innerText),
      lines: zw(ed.innerText).split('\n'),
      fullText: zw(ed.textContent),
      html: ed.innerHTML,
      hasZwsp: ed.innerHTML.indexOf('\u200B') !== -1,
      nestedBlock,
      rootBare,
      imgCount: ed.querySelectorAll('img').length,
      bCount: ed.querySelectorAll('b').length,
      links,
    };
  });
}

// ============================================================================
(async () => {
  const server = await startServer();
  console.log('server ready on :' + PORT);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // ========================================================================
    console.log('\n===== I5 笔记名校验 =====');
    // ========================================================================

    // I5-1: my_note-1（含 _ 与 -）应正常出现解锁框并可解锁（服务端不 400）
    {
      await page.goto(BASE + '/my_note-1', { waitUntil: 'domcontentloaded' });
      createdNotes.push('my_note-1');
      await page.waitForSelector('#pw', { state: 'visible', timeout: 10000 });
      const errBefore = await page.evaluate(() => document.getElementById('err').textContent);
      check('I5', '/my_note-1 正常出现解锁框且无报错文案', errBefore.trim() === '', 'err=' + JSON.stringify(errBefore));
      await page.fill('#pw', PASS_PHRASE);
      await page.click('#ok');
      const okUnlock = await page.waitForFunction(() => {
        const ed = document.getElementById('editor');
        return ed && ed.contentEditable === 'true' && document.getElementById('mask').classList.contains('hidden');
      }, null, { timeout: 20000 }).then(() => true).catch(() => false);
      check('I5', '/my_note-1 解锁成功（服务端接受 _ 和 -）', okUnlock);
    }

    // I5-2: /bad*name → 前端提示"笔记名不合法"，且 fetchRetry 对 4xx 只发一次请求
    {
      await page.goto(BASE + '/bad*name', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#pw', { state: 'visible', timeout: 10000 });
      await page.evaluate(() => {
        window.__noteFetches = [];
        const orig = window.fetch;
        window.fetch = function (input, init) {
          const u = typeof input === 'string' ? input : (input && input.url) || '';
          window.__noteFetches.push(((init && init.method) || 'GET') + ' ' + u);
          return orig.apply(this, arguments);
        };
      });
      await page.fill('#pw', PASS_PHRASE);
      await page.click('#ok');
      await page.waitForFunction(() =>
        (document.getElementById('err').textContent || '').indexOf('笔记名不合法') !== -1,
        null, { timeout: 10000 }).catch(() => {});
      const st = await page.evaluate(() => ({
        err: document.getElementById('err').textContent,
        fetches: window.__noteFetches.filter(s => s.indexOf('/api/note/') !== -1),
        maskVisible: !document.getElementById('mask').classList.contains('hidden'),
        pwVisible: !!document.getElementById('pw').offsetParent,
        foot: document.getElementById('foot').textContent,
      }));
      check('I5', '/bad*name 前端显示"笔记名不合法"提示', st.err.indexOf('笔记名不合法') !== -1, 'err=' + JSON.stringify(st.err));
      // 注意：index.html 静态标记里 #editor 恒为 contenteditable="true"，真实门槛是 mask 遮罩，
      // 因此这里以"遮罩保持可见 + 口令框仍显示 + 页脚未进入'已解锁'态"作为未解锁判据
      check('I5', '400 后保持锁定态（遮罩未收起、未进入已解锁态）',
        st.maskVisible && st.pwVisible && st.foot.indexOf('已解锁') === -1,
        JSON.stringify(st));
      check('I5', 'fetchRetry 对 4xx 不重试（仅 1 次 /api/note/ 请求）',
        st.fetches.length === 1, JSON.stringify(st.fetches));
    }

    // I5-3: 落地页输入净化：ab_cd-9 保留；中文xY → xY
    {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#landingInput', { state: 'visible', timeout: 10000 });
      await page.fill('#landingInput', 'ab_cd-9');
      let st = await page.evaluate(() => ({
        v: document.getElementById('landingInput').value,
        warnHidden: document.getElementById('landingWarn').classList.contains('hidden'),
      }));
      check('I5', '落地页输入 ab_cd-9 完整保留（_ 与 - 恢复）', st.v === 'ab_cd-9', 'value=' + JSON.stringify(st.v));
      check('I5', '合法名不触发警告文案', st.warnHidden);
      await page.fill('#landingInput', '中文xY');
      st = await page.evaluate(() => ({
        v: document.getElementById('landingInput').value,
        warnHidden: document.getElementById('landingWarn').classList.contains('hidden'),
      }));
      check('I5', '落地页输入 中文xY 被净化为 xY', st.v === 'xY', 'value=' + JSON.stringify(st.v));
      check('I5', '含中文输入触发警告提示', !st.warnHidden);
    }

    // ========================================================================
    console.log('\n===== I1 linkify XSS 三连 =====');
    // ========================================================================

    // I1-1: 属性注入载荷 —— 不得产生 onmouseover 等事件属性
    {
      const payload = 'https://a.com/"onmouseover="alert(1)';
      await unlockNote(page, 'probeV519xssAttr');
      await typeText(page, payload);
      await page.waitForTimeout(1000); // linkify 防抖 500ms + 余量
      const st = await readEditor(page);
      const onAttrsAll = await page.evaluate(() => {
        const out = [];
        document.getElementById('editor').querySelectorAll('*').forEach(el => {
          for (const a of el.attributes) if (/^on/i.test(a.name)) out.push(el.tagName + '[' + a.name + ']');
        });
        return out;
      });
      check('I1', '属性注入：编辑器内无任何 on* 事件属性', onAttrsAll.length === 0, JSON.stringify(onAttrsAll));
      check('I1', '属性注入：URL 仍被识别为链接（功能未因修复退化）', st.links.length === 1,
        'links=' + JSON.stringify(st.links));
      check('I1', '属性注入：内容未被篡改（全文保持纯文本）', st.fullText === payload,
        'got=' + JSON.stringify(st.fullText));
    }

    // I1-2: onerror 执行载荷 —— 不执行 JS、img 不成元素
    {
      const payload = '<img src=x onerror="window.__pwned=1">http://a.com';
      await unlockNote(page, 'probeV519xssImg');
      await typeText(page, payload);
      await page.waitForTimeout(1000);
      const st = await readEditor(page);
      const pwned = await page.evaluate(() => window.__pwned);
      check('I1', 'onerror 载荷：window.__pwned 未被执行', pwned === undefined, 'pwned=' + JSON.stringify(pwned));
      check('I1', 'onerror 载荷：img 未成为 DOM 元素', st.imgCount === 0, 'imgCount=' + st.imgCount);
      check('I1', 'onerror 载荷：尾部 URL 正常成链接且 href 干净',
        st.links.length === 1 && st.links[0].hrefAttr === 'http://a.com', JSON.stringify(st.links));
      check('I1', 'onerror 载荷：全文保持纯文本', st.fullText === payload, 'got=' + JSON.stringify(st.fullText));
    }

    // I1-3: 标签篡改载荷 —— <b>x</b> 保持纯文本
    {
      const payload = '<b>x</b>';
      await unlockNote(page, 'probeV519xssBold');
      await typeText(page, payload);
      await page.waitForTimeout(1000);
      const st = await readEditor(page);
      check('I1', '标签载荷：未产生 <b> 元素', st.bCount === 0, 'bCount=' + st.bCount);
      check('I1', '标签载荷：<b>x</b> 保持纯文本', st.fullText === payload, 'got=' + JSON.stringify(st.fullText));
    }

    // ========================================================================
    console.log('\n===== I2 非空编辑器粘贴 =====');
    // ========================================================================

    // I2-1: 行中粘贴单行 → 合并一行，光标落在粘贴内容之后
    {
      await unlockNote(page, 'probeV519pasteSingle');
      await typeText(page, 'abc');
      await caretTo(page, 2); // a b | c
      const handled = await pastePlain(page, 'XY');
      await page.waitForTimeout(150);
      let st = await readEditor(page);
      check('I2', '单行粘贴被应用接管（preventDefault）', handled === true);
      check('I2', '单行粘贴合并为一行 abXYc', st.lines.length === 1 && st.lines[0] === 'abXYc',
        'lines=' + JSON.stringify(st.lines));
      check('I2', '单行粘贴无嵌套块', !st.nestedBlock, 'html=' + JSON.stringify(st.html));
      await typeText(page, 'Z'); // 光标若正确，Z 应接续在 XY 之后
      st = await readEditor(page);
      check('I2', '粘贴后继续打字接续在粘贴内容之后（abXYZc）',
        st.lines.length === 1 && st.lines[0] === 'abXYZc', 'lines=' + JSON.stringify(st.lines));
    }

    // I2-2: 行中粘贴两行 → 正确拆为两行，不嵌套
    {
      await unlockNote(page, 'probeV519pasteTwo');
      await typeText(page, 'abc');
      await caretTo(page, 2);
      await pastePlain(page, 'X\nY');
      await page.waitForTimeout(700); // 跨过 linkify 500ms 防抖，取稳定后的结构
      const st = await readEditor(page);
      check('I2', '两行粘贴拆为 [abX, Yc] 两行',
        st.lines.length === 2 && st.lines[0] === 'abX' && st.lines[1] === 'Yc',
        'lines=' + JSON.stringify(st.lines) + ' html=' + JSON.stringify(st.html));
      check('I2', '两行粘贴无嵌套块（无块中套块）', !st.nestedBlock, 'html=' + JSON.stringify(st.html));
      // 产品不变量探针（非需求断言）：应用自身 ensureBlockWrapped 约定"编辑器根下必须是
      // 块级子元素"，且其注释明确把"粘贴到非空编辑器"列为必须包裹裸文本节点的场景。
      // 当前实现：无可链接文本时 linkifyEditor 早退，跳过整理 → 裸文本节点滞留根下。
      check('I2', '[不变量] 两行粘贴后根下全为块级子节点（无裸文本节点挂根）',
        !st.rootBare, 'html=' + JSON.stringify(st.html));
    }

    // I2-3: 空编辑器粘贴多行 → 无空首行
    {
      await unlockNote(page, 'probeV519pasteEmpty');
      const handled = await pastePlain(page, 'L1\nL2\nL3');
      await page.waitForTimeout(150);
      const st = await readEditor(page);
      const firstLineOk = await page.evaluate(() => {
        const ed = document.getElementById('editor');
        const f = ed.firstElementChild;
        return !!f && f.textContent.replace(/\u200B/g, '').trim() === 'L1';
      });
      check('I2', '空编辑器粘贴被应用接管', handled === true);
      check('I2', '空编辑器粘贴三行内容完整 [L1,L2,L3]',
        st.lines.length === 3 && st.lines[0] === 'L1' && st.lines[1] === 'L2' && st.lines[2] === 'L3',
        'lines=' + JSON.stringify(st.lines) + ' html=' + JSON.stringify(st.html));
      check('I2', '空编辑器粘贴无空首行（首个块即 L1）', firstLineOk, 'html=' + JSON.stringify(st.html));
    }

    // I2-4: 粘贴整体单步撤销
    {
      await unlockNote(page, 'probeV519pasteUndo');
      await typeText(page, 'abc');
      await caretTo(page, 2);
      await pastePlain(page, 'X\nY');
      await page.waitForTimeout(250);
      const before = await readEditor(page);
      check('I2', '撤销前置：粘贴结果确为两行', before.lines.length === 2 && before.lines[0] === 'abX',
        'lines=' + JSON.stringify(before.lines));
      await page.evaluate(() => document.getElementById('editor').focus());
      await page.keyboard.press('Control+KeyZ');
      await page.waitForTimeout(250);
      const after = await readEditor(page);
      check('I2', '一次 Ctrl+Z 整体还原粘贴（回到 abc）',
        after.lines.length === 1 && after.lines[0] === 'abc',
        'lines=' + JSON.stringify(after.lines) + ' html=' + JSON.stringify(after.html));
    }

    // ========================================================================
    console.log('\n===== I3 URL 边界（CJK / ASCII 尾部） =====');
    // ========================================================================

    // I3-1: 看https://baidu.com。很好 —— 链接恰为 https://baidu.com
    {
      await unlockNote(page, 'probeV519urlCjk1');
      await typeText(page, '看https://baidu.com。很好');
      await page.waitForTimeout(1200);
      const st = await readEditor(page);
      check('I3', '尾部中文：恰有 1 个链接', st.links.length === 1, JSON.stringify(st.links));
      if (st.links.length >= 1) {
        check('I3', '尾部中文：href 恰为 https://baidu.com',
          st.links[0].hrefAttr === 'https://baidu.com', 'href=' + JSON.stringify(st.links[0].hrefAttr));
        check('I3', '尾部中文：链接文本未吞"。很好"',
          st.links[0].text === 'https://baidu.com', 'text=' + JSON.stringify(st.links[0].text));
      }
      check('I3', '尾部中文：整句内容未丢失', st.fullText === '看https://baidu.com。很好',
        'got=' + JSON.stringify(st.fullText));
    }

    // I3-2: 访问 www.test.com，谢谢 —— 链接文本不含"，谢谢"
    {
      await unlockNote(page, 'probeV519urlCjk2');
      await typeText(page, '访问 www.test.com，谢谢');
      await page.waitForTimeout(1200);
      const st = await readEditor(page);
      check('I3', '中文逗号：恰有 1 个链接', st.links.length === 1, JSON.stringify(st.links));
      if (st.links.length >= 1) {
        check('I3', '中文逗号：链接文本为 www.test.com（不含"，谢谢"）',
          st.links[0].text === 'www.test.com' && st.links[0].text.indexOf('，') === -1,
          'text=' + JSON.stringify(st.links[0].text));
        check('I3', '中文逗号：裸 www 域名 href 补全 https',
          st.links[0].hrefAttr === 'https://www.test.com', 'href=' + JSON.stringify(st.links[0].hrefAttr));
      }
      check('I3', '中文逗号：整句内容未丢失', st.fullText === '访问 www.test.com，谢谢',
        'got=' + JSON.stringify(st.fullText));
    }

    // I3-3: 回归 —— ASCII 尾部行为不变，(B) 仍在 href 内
    {
      await unlockNote(page, 'probeV519urlAscii');
      await typeText(page, 'see https://en.wikipedia.org/wiki/A_(B).');
      await page.waitForTimeout(1200);
      const st = await readEditor(page);
      check('I3', 'ASCII 回归：链接仍被识别', st.links.length === 1, JSON.stringify(st.links));
      if (st.links.length >= 1) {
        check('I3', 'ASCII 回归：href 含 /wiki/A_(B)（括号未被截断）',
          (st.links[0].hrefAttr || '').indexOf('/wiki/A_(B)') !== -1,
          'href=' + JSON.stringify(st.links[0].hrefAttr));
      }
    }

    // ========================================================================
    console.log('\n===== I6 复制剥离 ZWSP =====');
    // ========================================================================
    {
      const ctxClip = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
      const clipPage = await ctxClip.newPage();
      await unlockNote(clipPage, 'probeV519copy');
      await typeText(clipPage, 'https://example.com/aaa/bbb/ccc');
      await clipPage.waitForTimeout(1200);
      const pre = await readEditor(clipPage);
      check('I6', '前置：链接文本内确实存在 ZWSP（断行符）', pre.hasZwsp, 'html=' + JSON.stringify(pre.html));
      await clipPage.click('#copyBtn');
      await clipPage.waitForTimeout(400);
      let clip = '';
      try {
        clip = await clipPage.evaluate(() => navigator.clipboard.readText());
      } catch (e) {
        clip = '<<read clipboard failed: ' + e.message + '>>';
      }
      check('I6', '复制结果不含 ZWSP', clip.indexOf('\u200B') === -1, 'clipboard=' + JSON.stringify(clip));
      check('I6', '复制结果保留完整 URL 文本', strip(clip).indexOf('https://example.com/aaa/bbb/ccc') !== -1,
        'clipboard=' + JSON.stringify(clip));
      await ctxClip.close();
    }

    // ========================================================================
    console.log('\n===== I4 保存失败退避重试 =====');
    // ========================================================================
    {
      await unlockNote(page, 'probeV519retry');
      await page.waitForTimeout(500); // 等 unlock 时的 salt 初存落定
      await page.evaluate(() => {
        window.__putAttempts = 0;
        window.__putSucc = 0;
        window.__failAt = 0;
        window.__succAt = 0;
        window.__failOnceDone = false;
        window.apiPut = async () => {
          window.__putAttempts++;
          if (!window.__failOnceDone) {
            window.__failOnceDone = true;
            window.__failAt = Date.now();
            throw new Error('injected save failure (probe)');
          }
          window.__putSucc++;
          if (!window.__succAt) window.__succAt = Date.now();
          return { v: 900 + window.__putSucc };
        };
      });
      await typeText(page, 'retry-me');
      await page.waitForFunction(() => window.__putAttempts >= 1, null, { timeout: 4000 }).catch(() => {});
      const mid = await page.evaluate(() => ({
        a: window.__putAttempts, s: window.__putSucc,
        status: document.getElementById('statustext').textContent,
      }));
      check('I4', '第一次保存尝试已发起且失败（成功数仍为 0）',
        mid.a === 1 && mid.s === 0, JSON.stringify(mid));
      check('I4', '失败后状态显示"保存失败"', mid.status.indexOf('保存失败') !== -1, 'status=' + JSON.stringify(mid.status));
      await page.waitForFunction(() => window.__putSucc >= 1, null, { timeout: 9000 }).catch(() => {});
      await page.waitForTimeout(300);
      const fin = await page.evaluate(() => ({
        a: window.__putAttempts, s: window.__putSucc,
        dt: window.__succAt - window.__failAt,
        status: document.getElementById('statustext').textContent,
      }));
      check('I4', '自动重试后出现成功 PUT（成功数增加）', fin.s >= 1 && fin.a === fin.s + 1,
        'attempts=' + fin.a + ' succ=' + fin.s);
      check('I4', '重试延迟符合 ~3s 退避（2.4s ~ 6.5s）', fin.dt >= 2400 && fin.dt <= 6500, 'dt=' + fin.dt + 'ms');
      check('I4', '重试成功后状态回到"已同步"', fin.status === '已同步', 'status=' + JSON.stringify(fin.status));
      await page.waitForTimeout(2000);
      const stable = await page.evaluate(() => window.__putAttempts);
      check('I4', '成功后不再多余重试（尝试次数稳定为 2）', stable === 2, 'attempts=' + stable);
    }

    await ctx.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.kill('SIGKILL'); } catch (e) {}
    // 清理本探针创建的笔记文件（不动既有文件）
    try {
      for (const name of createdNotes) {
        const f = path.join(NOTES_DIR, name + '.json');
        if (!PRE_EXISTING.has(name + '.json') && fs.existsSync(f)) fs.rmSync(f);
      }
    } catch (e) { console.error('清理笔记文件失败: ' + e.message); }
  }

  console.log('\n========================================================');
  console.log('总计: ' + passed + ' 通过 / ' + failed + ' 失败（共 ' + (passed + failed) + ' 项断言）');
  if (failed > 0) {
    console.log('\n失败项清单:');
    results.filter(r => !r.ok).forEach(r => {
      console.log('  - [' + r.section + '] ' + r.label + (r.extra ? '\n      ' + r.extra : ''));
    });
  }
  console.log('========================================================');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('探针自身异常: ', e);
  process.exit(2);
});
