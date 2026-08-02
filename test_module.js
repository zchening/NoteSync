/*
 * NoteSync - "导出为图片" 功能模块测试
 * -------------------------------------------------------------
 * 测试目标：index.html 第 715-785 行的导出逻辑中三个核心修复点
 *   1. breakLongWords：长 URL 在分隔符后插入零宽空格 \u200B
 *   2. TreeWalker：先收集后处理，避免遍历时修改 DOM 导致跳过节点
 *   3. \n 转 <br>：white-space:normal 下保留换行
 *
 * 运行方式：
 *   npm install jsdom
 *   node test_module.js
 *
 * 依赖：jsdom（仅在测试环境模拟 DOM，与 index.html 运行时无关）
 */

'use strict';

// ---- 引入 jsdom 模拟 DOM 环境 ----
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.error('[ERROR] 未找到 jsdom，请先执行：npm install jsdom');
  process.exit(1);
}

// ============================================================
// 提取自 index.html 的被测逻辑（保持与源码一致）
// ============================================================

/**
 * 长 URL 处理：在 15+ 连续非空白字符中的分隔符后插入零宽空格 \u200B。
 * 源码位置：index.html 第 750-753 行
 */
const breakLongWords = s =>
  s.replace(/(\S{15,})/g, m =>
    m.replace(/([\/.?:=&#_-])/g, '$1\u200B')
  );

/**
 * 对一个 DOM 根节点执行导出前的文本规范化：
 *   - 用 TreeWalker 先收集所有文本节点（含嵌套在 a / s / div 中的），
 *     再统一处理，避免边遍历边修改导致跳过节点。
 *   - 含 \n 的文本节点：拆分为 文本 + <br> 序列。
 *   - 其余文本节点：仅原地替换 nodeValue。
 * 源码位置：index.html 第 742-766 行
 */
function normalizeForExport(doc, root) {
  // 测试环境兼容：浏览器中 NodeFilter 是全局，jsdom 中需从 window 取
  const NF = (doc.defaultView && doc.defaultView.NodeFilter) || globalThis.NodeFilter;
  const textNodes = [];
  const walker = doc.createTreeWalker(root, NF.SHOW_TEXT);
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(textNode => {
    const text = textNode.nodeValue;
    if (!text) return;

    if (text.includes('\n')) {
      const parts = text.split('\n');
      const frag = doc.createDocumentFragment();
      parts.forEach((p, i) => {
        if (p) frag.appendChild(doc.createTextNode(breakLongWords(p)));
        if (i < parts.length - 1) frag.appendChild(doc.createElement('br'));
      });
      textNode.parentNode.replaceChild(frag, textNode);
    } else {
      textNode.nodeValue = breakLongWords(text);
    }
  });
}

// ============================================================
// 极简测试框架
// ============================================================
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log('  [FAIL] ' + msg);
  }
}

function assertEqual(actual, expected, msg) {
  const ok = actual === expected;
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log('  [FAIL] ' + msg);
    console.log('        期望: ' + JSON.stringify(expected));
    console.log('        实际: ' + JSON.stringify(actual));
  }
}

function section(name) {
  console.log('\n── ' + name + ' ──────────────────────────────────');
}

// ============================================================
// 测试1：breakLongWords 函数
// ============================================================
function testBreakLongWords() {
  section('测试1：breakLongWords 函数');

  // 1.1 短文本原样返回
  assertEqual(breakLongWords('hello world'), 'hello world', '1.1 短文本原样返回');

  // 1.2 长 URL：在 / . ? = 后应有 \u200B
  const url = 'https://item.taobao.com/item.htm?id=12345';
  const out = breakLongWords(url);
  const hasZWSP = out.includes('\u200B');
  assert(hasZWSP, '1.2 长 URL 处理后含零宽空格');
  // 去掉零宽空格后应能还原为原 URL
  assertEqual(out.replace(/\u200B/g, ''), url, '1.2 去掉 \\u200B 后还原为原 URL');
  // 验证具体插入点：分隔符表 [/.?:=&#_-] 含 ':'，故 'https:' 的 ':' 后也插入 \u200B
  // https:// → https:\u200B/\u200B/\u200B
  assert(out.startsWith('https:\u200B/\u200B/\u200Bitem'), '1.2 协议头 :// 后均插入 \\u200B');

  // 1.3 中文长文本
  // 注意：\S 会匹配中文字符（中文不是空白），因此 15+ 连续中文会被外层正则命中，
  // 但内层只替换 [/.?:=&#_-]，纯中文不含这些符号，故最终原样返回。
  const cn = '这是一个很长的中文文本不应该被修改因为中文字符不是连续的非空白字符';
  assertEqual(breakLongWords(cn), cn, '1.3 纯中文长文本原样返回（无分隔符可插入）');

  // 1.4 空字符串
  assertEqual(breakLongWords(''), '', '1.4 空字符串原样返回');

  // 1.5 只有空格的字符串
  assertEqual(breakLongWords('     '), '     ', '1.5 仅空格原样返回');

  // 1.6 混合文本：只有 URL 被处理，短文本不变
  const mixed = '短文本 https://verylongurl.example.com/path 短文本';
  const mixedOut = breakLongWords(mixed);
  assert(mixedOut.includes('\u200B'), '1.6 混合文本中 URL 被处理');
  assert(mixedOut.startsWith('短文本 ') && mixedOut.endsWith(' 短文本'), '1.6 两侧短文本不变');
  assertEqual(mixedOut.replace(/\u200B/g, ''), mixed, '1.6 去掉 \\u200B 后还原');

  // 1.7 边界：恰好 15 个非空白字符（应被命中）
  const exactly15 = 'abcdefghijklmno'; // 15 字符
  assertEqual(breakLongWords(exactly15), exactly15, '1.7 恰好15字符无分隔符原样返回');
  // 15 字符但含分隔符（8 字母 + / + 6 字母 = 15）
  const exactly15WithSep = 'abcdefgh/ijklmn';
  assert(exactly15WithSep.length === 15, '1.7 校验长度确为15');
  assert(breakLongWords(exactly15WithSep).includes('\u200B'), '1.7 恰好15字符含分隔符应插入');

  // 1.8 14 字符不应被外层命中
  const short14 = 'abcdefgh/ijkl'; // 14 字符
  assertEqual(breakLongWords(short14), short14, '1.8 14字符不被处理');

  // 1.9 连续分隔符：每个分隔符后都插入
  const multiSep = 'a=b/c.d:e?f#g=h&i=j_k-l'; // 总长 > 15
  const multiOut = breakLongWords(multiSep);
  // 去掉 ZWSP 还原
  assertEqual(multiOut.replace(/\u200B/g, ''), multiSep, '1.9 连续分隔符可还原');
  // 不应出现连续两个 ZWSP（每个分隔符后恰好一个）
  assert(!multiOut.includes('\u200B\u200B'), '1.9 不出现连续两个 \\u200B');

  // 1.10 多个 URL 段落（全局 g 标志）
  const twoUrls = 'https://a.example.com/x and https://b.example.com/y';
  const twoOut = breakLongWords(twoUrls);
  const zwspCount = (twoOut.match(/\u200B/g) || []).length;
  assert(zwspCount >= 4, '1.10 两个 URL 都被处理（g 全局匹配）');
}

// ============================================================
// 测试2：DOM 遍历安全性（TreeWalker 收集嵌套文本节点）
// ============================================================
function testTreeWalkerCollection() {
  section('测试2：DOM 遍历安全性（TreeWalker 收集）');

  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="editor">
      第一行文本
      <div>第二行<br>第三行</div>
      <a href="https://example.com">https://example.com/very/long/path</a>
      <s>删除线文本</s>
      <div>
        <div>嵌套<div>深层\n文本</div></div>
      </div>
    </div>
  </body></html>`);
  const { document } = dom.window;
  const editor = document.getElementById('editor');

  // 处理前：用 TreeWalker 统计原始文本节点
  const before = [];
  let w = document.createTreeWalker(editor, dom.window.NodeFilter.SHOW_TEXT);
  while (w.nextNode()) before.push(w.currentNode.nodeValue);

  // 执行规范化
  normalizeForExport(document, editor);

  // 处理后：再统计文本节点
  const after = [];
  w = document.createTreeWalker(editor, dom.window.NodeFilter.SHOW_TEXT);
  while (w.nextNode()) after.push(w.currentNode.nodeValue);

  // 2.1 处理前应收集到所有嵌套文本（包括 a / s / 深层 div）
  const joinedBefore = before.join('|');
  assert(joinedBefore.includes('第一行文本'), '2.1 收集到顶层文本');
  assert(joinedBefore.includes('第二行'), '2.1 收集到 div 内文本');
  assert(joinedBefore.includes('第三行'), '2.1 收集到 br 后文本');
  assert(joinedBefore.includes('example.com'), '2.1 收集到 a 内文本');
  assert(joinedBefore.includes('删除线文本'), '2.1 收集到 s 内文本');
  assert(joinedBefore.includes('嵌套'), '2.1 收集到嵌套 div 文本');
  assert(joinedBefore.includes('深层'), '2.1 收集到深层 div 文本');

  // 2.2 关键：处理过程中没有节点被“跳过”
  //     验证方式：所有原始文本内容（去掉 ZWSP 后）在处理后仍可找到
  const afterJoined = after.join('|').replace(/\u200B/g, '');
  for (const original of before) {
    const clean = original.replace(/\u200B/g, '');
    if (!clean) continue;
    // 含 \n 的会被拆分，按拆分后的片段逐一检查
    const fragments = clean.split('\n').filter(Boolean);
    for (const frag of fragments) {
      assert(afterJoined.includes(frag),
        '2.2 文本片段未被跳过："' + (frag.length > 20 ? frag.slice(0, 20) + '…' : frag) + '"');
    }
  }

  // 2.3 处理后 a 标签内的长 URL 被插入了 \u200B
  const aEl = editor.querySelector('a');
  assert(aEl && aEl.textContent.includes('\u200B'), '2.3 a 内长 URL 被插入 \\u200B');

  // 2.4 处理后 s 标签文本仍存在（结构未被破坏）
  const sEl = editor.querySelector('s');
  assert(sEl && sEl.textContent.includes('删除线文本'), '2.4 s 标签文本保留');

  // 2.5 replaceChild 用 DocumentFragment 替换后，父节点结构完整
  assert(editor.querySelector('div > div > div') !== null, '2.5 深层嵌套结构完整');

  // 2.6 重复执行不应丢失内容（幂等性：第二次处理的输入已含 ZWSP）
  const beforeCount = after.length;
  normalizeForExport(document, editor);
  w = document.createTreeWalker(editor, dom.window.NodeFilter.SHOW_TEXT);
  const after2 = [];
  while (w.nextNode()) after2.push(w.currentNode.nodeValue);
  // 第二次不应丢内容
  const after2Joined = after2.join('|').replace(/\u200B/g, '');
  assert(after2Joined.includes('深层'), '2.6 重复执行不丢失深层文本');
  assert(after2Joined.includes('删除线文本'), '2.6 重复执行不丢失 s 文本');
}

// ============================================================
// 测试3：\n 转 <br> 正确性
// ============================================================
function testNewlineToBr() {
  section('测试3：\\n 转 <br> 正确性');

  // 3.1 单个 \n：a\nb → a <br> b
  let dom = new JSDOM('<!DOCTYPE html><div id="e">a\nb</div>');
  let doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  let brs = doc.getElementById('e').querySelectorAll('br');
  assert(brs.length === 1, '3.1 "a\\nb" 产生 1 个 <br>');
  assert(doc.getElementById('e').textContent.replace(/\u200B/g, '') === 'ab', '3.1 文本内容保留');

  // 3.2 连续 \n：a\n\nb → a <br> <br> b（中间空行）
  dom = new JSDOM('<!DOCTYPE html><div id="e">a\n\nb</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  brs = doc.getElementById('e').querySelectorAll('br');
  assert(brs.length === 2, '3.2 "a\\n\\nb" 产生 2 个 <br>');

  // 3.3 仅 \n：→ 单个 <br>
  dom = new JSDOM('<!DOCTYPE html><div id="e">\n</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  brs = doc.getElementById('e').querySelectorAll('br');
  assert(brs.length === 1, '3.3 "\\n" 产生 1 个 <br>');

  // 3.4 行首 \n：\na → <br> a
  dom = new JSDOM('<!DOCTYPE html><div id="e">\na</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  brs = doc.getElementById('e').querySelectorAll('br');
  assert(brs.length === 1, '3.4 "\\na" 产生 1 个 <br>');
  // 第一个子节点应是 <br>
  assert(doc.getElementById('e').firstChild.tagName === 'BR', '3.4 行首 <br> 在最前');

  // 3.5 行尾 \n：a\n → a <br>
  dom = new JSDOM('<!DOCTYPE html><div id="e">a\n</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  brs = doc.getElementById('e').querySelectorAll('br');
  assert(brs.length === 1, '3.5 "a\\n" 产生 1 个 <br>');
  assert(doc.getElementById('e').lastChild.tagName === 'BR', '3.5 行尾 <br> 在最后');

  // 3.6 多行：a\nb\nc → a <br> b <br> c
  dom = new JSDOM('<!DOCTYPE html><div id="e">a\nb\nc</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  brs = doc.getElementById('e').querySelectorAll('br');
  assert(brs.length === 2, '3.6 "a\\nb\\nc" 产生 2 个 <br>');

  // 3.7 含 \n 的文本同时含长 URL：URL 仍被 breakLongWords 处理
  dom = new JSDOM('<!DOCTYPE html><div id="e">https://example.com/very/long\nsecond</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  const e = doc.getElementById('e');
  // 第一段文本节点应含 ZWSP
  const firstText = e.firstChild;
  assert(firstText && firstText.nodeType === 3 && firstText.nodeValue.includes('\u200B'),
    '3.7 换行前长 URL 段被插入 \\u200B');
  assert(e.querySelectorAll('br').length === 1, '3.7 产生 1 个 <br>');

  // 3.8 不含 \n 的文本节点走 else 分支（原地改 nodeValue），不应产生 <br>
  dom = new JSDOM('<!DOCTYPE html><div id="e">plain text no newline</div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  assert(doc.getElementById('e').querySelectorAll('br').length === 0, '3.8 无 \\n 不产生 <br>');
}

// ============================================================
// 测试4：边界与回归（补充审查中发现的隐患）
// ============================================================
function testEdgeCases() {
  section('测试4：边界与回归');

  // 4.1 空文本节点（nodeValue 为 ''）应被跳过，不产生 <br>
  let dom = new JSDOM('<!DOCTYPE html><div id="e"></div>');
  let doc = dom.window.document;
  let e = doc.getElementById('e');
  e.appendChild(doc.createTextNode(''));
  normalizeForExport(doc, e);
  assert(e.querySelectorAll('br').length === 0, '4.1 空文本节点不产生 <br>');

  // 4.2 仅空白文本节点
  dom = new JSDOM('<!DOCTYPE html><div id="e">   </div>');
  doc = dom.window.document;
  normalizeForExport(doc, doc.getElementById('e'));
  assert(doc.getElementById('e').querySelectorAll('br').length === 0, '4.2 仅空格不产生 <br>');

  // 4.3 长中文串 + 分隔符：分隔符后应插入 ZWSP（中文也被 \S 命中）
  const cnWithSep = '这是一个很长的中文文本带分隔符/还有更多中文内容.继续';
  const cnOut = breakLongWords(cnWithSep);
  assert(cnOut.includes('\u200B'), '4.3 含分隔符的长中文串被处理');
  assertEqual(cnOut.replace(/\u200B/g, ''), cnWithSep, '4.3 含分隔符中文串可还原');

  // 4.4 TreeWalker 在根节点本身是文本节点时不丢失（虽然 editor 是元素，这里测函数健壮性）
  dom = new JSDOM('<!DOCTYPE html><div id="e"><span>hello world node</span></div>');
  doc = dom.window.document;
  e = doc.getElementById('e');
  normalizeForExport(doc, e);
  assert(e.textContent.includes('hello world node'), '4.4 单层 span 文本保留');

  // 4.5 多个相邻文本节点（模拟 normalize 前的状态）都被处理
  dom = new JSDOM('<!DOCTYPE html><div id="e"></div>');
  doc = dom.window.document;
  e = doc.getElementById('e');
  e.appendChild(doc.createTextNode('https://aa.example.com/x'));
  e.appendChild(doc.createTextNode('https://bb.example.com/y'));
  normalizeForExport(doc, e);
  assert(e.childNodes[0].nodeValue.includes('\u200B'), '4.5 第一个相邻文本节点被处理');
  assert(e.childNodes[1].nodeValue.includes('\u200B'), '4.5 第二个相邻文本节点被处理（未被跳过）');
}

// ============================================================
// 主入口
// ============================================================
function main() {
  console.log('NoteSync 导出功能模块测试');
  console.log('================================');

  testBreakLongWords();
  testTreeWalkerCollection();
  testNewlineToBr();
  testEdgeCases();

  console.log('\n================================');
  console.log('通过: ' + passed + '  失败: ' + failed);
  if (failed > 0) {
    console.log('\n失败用例:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  } else {
    console.log('全部通过 ✔');
    process.exit(0);
  }
}

main();
