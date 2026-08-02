// NoteSync 模块测试：选区保留 + 删除线 (A1-A7)
// 函数体从 index.html 原样复制，不修改源码。
import { createRequire } from 'module';
const require = createRequire('C:/Users/zchen/.workbuddy/binaries/node/workspace/noop.js');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="editor" contenteditable="true" tabindex="0"></div></body></html>',
  { pretendToBeVisual: true }
);
const window = dom.window;
const document = window.document;
const NodeFilter = window.NodeFilter;
const Range = window.Range;
let editor = document.getElementById('editor');

// ============ 以下为 index.html 原样复制 ============

// index.html:272-287
const ZWSP = '\u200B';
function visibleLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] !== ZWSP) n++;
  return n;
}
function visibleToRealOffset(node, visOff) {
  let n = 0;
  const len = node.length;
  for (let i = 0; i < len; i++) {
    if (n === visOff) return i;
    if (node.nodeValue[i] !== ZWSP) n++;
  }
  return len;
}

// index.html:289-297
function saveSelectionOffsets(root, range) {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = visibleLen(pre.toString());
  pre.setEnd(range.endContainer, range.endOffset);
  const end = visibleLen(pre.toString());
  return { start, end };
}

// index.html:299-316
function restoreSelectionOffsets(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let sn = null, so = 0, en = null, eo = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const vlen = visibleLen(node.nodeValue);
    if (sn === null && pos + vlen >= start) { sn = node; so = visibleToRealOffset(node, start - pos); }
    if (en === null && pos + vlen >= end)   { en = node; eo = visibleToRealOffset(node, end - pos); }
    if (sn !== null && en !== null) break;
    pos += vlen;
  }
  if (sn === null || en === null) return null;
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}

// index.html:388-393
function rangeIntersectsNode(range, node) {
  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(node);
  return range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0 &&
         range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0;
}

// index.html:396-435
function addStrikeToRange(range) {
  const textNodes = [];
  const walkerRoot = range.commonAncestorContainer.nodeType === 3
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const walker = document.createTreeWalker(
    walkerRoot,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: node => {
        if (!editor.contains(node)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest('s')) return NodeFilter.FILTER_REJECT;
        if (!rangeIntersectsNode(range, node)) return NodeFilter.FILTER_SKIP;
        if (node.length === 0) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (let i = textNodes.length - 1; i >= 0; i--) {
    const node = textNodes[i];
    let startOff = 0;
    let endOff = node.length;
    if (node === range.startContainer) startOff = range.startOffset;
    if (node === range.endContainer) endOff = range.endOffset;
    if (startOff >= endOff) continue;

    let workNode = node;
    if (endOff < node.length) node.splitText(endOff);
    if (startOff > 0) {
      node.splitText(startOff);
      workNode = node.nextSibling;
    }

    const s = document.createElement('s');
    workNode.parentNode.insertBefore(s, workNode);
    s.appendChild(workNode);
  }
}

// index.html:438-504
function removeStrikeFromRange(range) {
  const sTags = [];
  const walkerRoot = range.commonAncestorContainer.nodeType === 3
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const walker = document.createTreeWalker(
    walkerRoot,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: n => (n.tagName === 'S' || n.tagName === 'STRIKE') && rangeIntersectsNode(range, n)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    }
  );
  while (walker.nextNode()) sTags.push(walker.currentNode);

  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentNode;
  let ancestorS = container;
  while (ancestorS && ancestorS !== editor) {
    if (ancestorS.tagName === 'S' || ancestorS.tagName === 'STRIKE') {
      if (sTags.indexOf(ancestorS) === -1) sTags.unshift(ancestorS);
      break;
    }
    ancestorS = ancestorS.parentNode;
  }

  for (const sTag of sTags) {
    const sRange = document.createRange();
    sRange.selectNodeContents(sTag);
    const fullyCovered =
      range.compareBoundaryPoints(Range.START_TO_START, sRange) <= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, sRange) >= 0;

    if (fullyCovered) {
      const p = sTag.parentNode;
      while (sTag.firstChild) p.insertBefore(sTag.firstChild, sTag);
      p.removeChild(sTag);
      continue;
    }

    const innerTextNodes = [];
    const innerWalker = document.createTreeWalker(
      sTag,
      NodeFilter.SHOW_TEXT,
      { acceptNode: node => rangeIntersectsNode(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP }
    );
    while (innerWalker.nextNode()) innerTextNodes.push(innerWalker.currentNode);

    for (let i = innerTextNodes.length - 1; i >= 0; i--) {
      const textNode = innerTextNodes[i];
      let startOff = 0;
      let endOff = textNode.length;
      if (textNode === range.startContainer) startOff = range.startOffset;
      if (textNode === range.endContainer) endOff = range.endOffset;
      if (startOff >= endOff) continue;

      let workNode = textNode;
      if (endOff < textNode.length) textNode.splitText(endOff);
      if (startOff > 0) {
        textNode.splitText(startOff);
        workNode = textNode.nextSibling;
      }

      moveNodeOutOfS(workNode, sTag);
    }
  }
}

// index.html:507-530
function moveNodeOutOfS(node, sTag) {
  const sParent = sTag.parentNode;
  const isFirst = (node === sTag.firstChild);
  const isLast = (node === sTag.lastChild);

  if (isFirst && isLast) {
    sParent.insertBefore(node, sTag);
    sParent.removeChild(sTag);
  } else if (isFirst) {
    sParent.insertBefore(node, sTag);
  } else if (isLast) {
    sParent.insertBefore(node, sTag.nextSibling);
  } else {
    const newS = document.createElement('s');
    let sibling = node.nextSibling;
    while (sibling) {
      const next = sibling.nextSibling;
      newS.appendChild(sibling);
      sibling = next;
    }
    sParent.insertBefore(node, sTag.nextSibling);
    sParent.insertBefore(newS, node.nextSibling);
  }
}

// index.html:863
let saveTimer = null, linkifyTimer = null, isLinkifying = false;

// index.html:866-933
function linkifyEditor(opts) {
  const keepSelection = opts ? opts.keepSelection !== false : true;
  if (isLinkifying) return;
  isLinkifying = true;
  try {
    const urlTest = /(?:https?|file|ftp):\/\/[^\s<]+/;
    const urlRegex = /((?:https?|file|ftp):\/\/[^\s<]+)/g;
    const longWordTest = /\S{15,}/;
    const phoneTest = /(?<!\d)1[3-9]\d{9}(?!\d)/;
    const phoneRegex = /(?<!\d)(1[3-9]\d{9})(?!\d)/g;
    const breakSeparators = /([\/.?:=&#_%-])/g;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        let p = node.parentNode;
        while (p && p !== editor) {
          if (p.tagName === 'A') return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return (urlTest.test(node.nodeValue) || phoneTest.test(node.nodeValue) || longWordTest.test(node.nodeValue)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const targets = [];
    let n;
    while (n = walker.nextNode()) targets.push(n);
    if (targets.length === 0) return;
    const sel = window.getSelection();
    let savedOffsets = null;
    if (keepSelection && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editor.contains(r.commonAncestorContainer)) {
        try { savedOffsets = saveSelectionOffsets(editor, r); } catch (e) {}
      }
    }
    for (const textNode of targets) {
      const text = textNode.nodeValue;
      const span = document.createElement('span');
      span.innerHTML = text
        .replace(urlRegex, (m) => '<a href="' + m + '" target="_blank" rel="noopener noreferrer">' + m.replace(breakSeparators, '$1\u200B') + '</a>')
        .replace(phoneRegex, '<a href="tel:$1">$1</a>');
      const tw = document.createTreeWalker(span, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          let p = node.parentNode;
          while (p && p !== span) {
            if (p.tagName === 'A') return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return /\S{15,}/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      const longNodes = [];
      while (tw.nextNode()) longNodes.push(tw.currentNode);
      longNodes.forEach(node => {
        if (!node.nodeValue.includes('\u200B')) {
          node.nodeValue = node.nodeValue.replace(breakSeparators, '$1\u200B');
        }
      });
      textNode.replaceWith(...span.childNodes);
    }
    if (savedOffsets && document.activeElement === editor) {
      try {
        const newRange = restoreSelectionOffsets(editor, savedOffsets.start, savedOffsets.end);
        if (newRange) { sel.removeAllRanges(); sel.addRange(newRange); }
      } catch (e) {}
    }
  } finally { isLinkifying = false; }
}

// index.html:354-360 (applyStrike 内的空 <s> 清理步骤)
function cleanupEmptyS() {
  editor.querySelectorAll('s').forEach(sTag => {
    if (!sTag.textContent.trim() && !sTag.querySelector('img')) {
      const p = sTag.parentNode;
      while (sTag.firstChild) p.insertBefore(sTag.firstChild, sTag);
      p.removeChild(sTag);
    }
  });
}

// ============ 测试框架 ============
let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : ''));
  }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
const strip = s => s.replace(/\u200B/g, '');

function reset(html) {
  editor.innerHTML = html;
  editor.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
}
// 在 editor 纯文本中按子串定位 range（要求该子串位于单个文本节点内）
function rangeForSubstring(sub) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const i = node.nodeValue.indexOf(sub);
    if (i !== -1) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + sub.length);
      return r;
    }
  }
  throw new Error('substring not found: ' + sub);
}
function setSel(range) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
function sText() {
  return Array.from(editor.querySelectorAll('s')).map(s => strip(s.textContent)).join('');
}
function emptySCount() {
  return Array.from(editor.querySelectorAll('s')).filter(s => !s.textContent.trim()).length;
}

const LONG = '本月账单汇总：电费15.34元，水费743.42元，合计需要在月底前完成缴纳，逾期将产生滞纳金。';
const T = '电费15.34元，水费743.42元';

// ---------- 用例 1: A7 核心（加删除线 + linkify 后选区保留） ----------
section('A7 核心：addStrikeToRange + normalize + linkifyEditor 后选区保留');
{
  reset(LONG);
  const r = rangeForSubstring(T);
  assert('前置：选中文本 === T', r.toString() === T, 'got=' + JSON.stringify(r.toString()));

  const { start: S, end: E } = saveSelectionOffsets(editor, r);
  console.log('  [info] 保存偏移 S=' + S + ' E=' + E + ' (T.length=' + T.length + ')');

  addStrikeToRange(r);
  editor.normalize();
  setSel(restoreSelectionOffsets(editor, S, E));
  linkifyEditor();

  const zwspCount = (editor.textContent.match(/\u200B/g) || []).length;
  console.log('  [info] linkify 注入 ZWSP 数量 = ' + zwspCount);
  assert('linkify 确实注入了 ZWSP（否则本用例无意义）', zwspCount > 0, 'zwsp=' + zwspCount);

  const rr = restoreSelectionOffsets(editor, S, E);
  assert('restoreSelectionOffsets 返回非 null', rr !== null);
  const got = rr ? rr.toString() : '';
  assert('A7-1 选区精确保留（忽略 ZWSP）=== T', strip(got) === T,
    'got=' + JSON.stringify(strip(got)) + '\n          exp=' + JSON.stringify(T));
  assert('A7-1b 尾字未丢失（末字符为「元」）', strip(got).endsWith('元'),
    'tail=' + JSON.stringify(strip(got).slice(-3)));
  assert('A7-1c 首字未丢失（首字符为「电」）', strip(got).startsWith('电'));
  assert('A7-2 <s> 存在且完整覆盖 T', sText() === T,
    'sText=' + JSON.stringify(sText()) + '\n          exp=' + JSON.stringify(T));
  assert('A7-3 全文内容未被破坏', strip(editor.textContent) === LONG);
  console.log('  [info] raw(含ZWSP) = ' + JSON.stringify(got));
}

// ---------- 用例 2: A7 取消（取消删除线 + linkify 后选区保留） ----------
section('A7 取消：removeStrikeFromRange + normalize + linkifyEditor 后选区保留');
{
  reset(LONG);
  // 先加上删除线
  addStrikeToRange(rangeForSubstring(T));
  editor.normalize();
  assert('前置：已加上 <s> 覆盖 T', sText() === T, 'sText=' + JSON.stringify(sText()));

  // 重新选中 T 并保存偏移
  const r = rangeForSubstring(T);
  const { start: S, end: E } = saveSelectionOffsets(editor, r);
  console.log('  [info] 保存偏移 S=' + S + ' E=' + E);

  removeStrikeFromRange(r);
  editor.normalize();
  const restored = restoreSelectionOffsets(editor, S, E);
  if (restored) setSel(restored);
  linkifyEditor();

  const zwspCount = (editor.textContent.match(/\u200B/g) || []).length;
  console.log('  [info] linkify 注入 ZWSP 数量 = ' + zwspCount);

  const rr = restoreSelectionOffsets(editor, S, E);
  assert('restoreSelectionOffsets 返回非 null', rr !== null);
  const got = rr ? rr.toString() : '';
  assert('A7-4 取消后选区精确保留（忽略 ZWSP）=== T', strip(got) === T,
    'got=' + JSON.stringify(strip(got)) + '\n          exp=' + JSON.stringify(T));
  assert('A7-4b 尾字未丢失（末字符为「元」）', strip(got).endsWith('元'),
    'tail=' + JSON.stringify(strip(got).slice(-3)));
  assert('A7-5 <s> 完全清除（无任何残余 <s>）', editor.querySelectorAll('s').length === 0,
    'remaining=' + editor.querySelectorAll('s').length + ' html=' + editor.innerHTML);
  assert('A7-6 全文内容未被破坏', strip(editor.textContent) === LONG);
}

// ---------- 用例 3: A1/A2 跨行加/取消删除线，行数不变 ----------
section('A1/A2 跨行选中加/取消删除线：行数不变');
{
  reset('<div>第一行内容ABC</div><div>第二行内容DEF</div><div>第三行内容GHI</div>');
  const lines0 = editor.querySelectorAll('div').length;
  const text0 = editor.textContent;

  const startNode = rangeForSubstring('第一行内容ABC').startContainer;
  const endNode = rangeForSubstring('第三行内容GHI').startContainer;
  const r = document.createRange();
  r.setStart(startNode, 3);           // 「行内容ABC」起
  r.setEnd(endNode, 5);               // 「第三行内容」止
  const expected = r.toString();
  const { start: S, end: E } = saveSelectionOffsets(editor, r);

  addStrikeToRange(r);
  editor.normalize();
  assert('A1 跨行加删除线后行数不变', editor.querySelectorAll('div').length === lines0,
    lines0 + ' -> ' + editor.querySelectorAll('div').length);
  assert('A1 跨行加删除线后文本不变', editor.textContent === text0);
  assert('A1 跨行 <s> 覆盖内容正确', sText() === expected.replace(/\n/g, ''),
    'sText=' + JSON.stringify(sText()) + ' exp=' + JSON.stringify(expected));
  assert('A1 跨行加后选区保留', (restoreSelectionOffsets(editor, S, E) || {}).toString?.() === expected,
    'got=' + JSON.stringify((restoreSelectionOffsets(editor, S, E) || '').toString()));

  const r2 = restoreSelectionOffsets(editor, S, E);
  removeStrikeFromRange(r2);
  editor.normalize();
  cleanupEmptyS();
  assert('A2 跨行取消删除线后行数不变', editor.querySelectorAll('div').length === lines0,
    lines0 + ' -> ' + editor.querySelectorAll('div').length);
  assert('A2 跨行取消后 <s> 清空', editor.querySelectorAll('s').length === 0,
    'html=' + editor.innerHTML);
  assert('A2 跨行取消后文本不变', editor.textContent === text0);
  assert('A2 跨行取消后选区保留', (restoreSelectionOffsets(editor, S, E) || '').toString() === expected);
}

// ---------- 用例 4: A3/A4 单行加/取消 ----------
section('A3/A4 单行选中加/取消删除线');
{
  reset('<div>单行测试内容XYZ结束</div>');
  const text0 = editor.textContent;
  const r = rangeForSubstring('测试内容XYZ');
  const { start: S, end: E } = saveSelectionOffsets(editor, r);

  addStrikeToRange(r);
  editor.normalize();
  assert('A3 单行加删除线生效', sText() === '测试内容XYZ', 'sText=' + JSON.stringify(sText()));
  assert('A3 单行加后文本不变', editor.textContent === text0);
  assert('A3 单行加后选区保留', (restoreSelectionOffsets(editor, S, E) || '').toString() === '测试内容XYZ');

  const r2 = restoreSelectionOffsets(editor, S, E);
  removeStrikeFromRange(r2);
  editor.normalize();
  cleanupEmptyS();
  assert('A4 单行取消删除线生效', editor.querySelectorAll('s').length === 0, 'html=' + editor.innerHTML);
  assert('A4 单行取消后文本不变', editor.textContent === text0);
  assert('A4 单行取消后选区保留', (restoreSelectionOffsets(editor, S, E) || '').toString() === '测试内容XYZ');
}

// ---------- 用例 5: A5 取消后再次加删除线 ----------
section('A5 取消后再次选中加删除线');
{
  reset('<div>反复切换删除线的文本内容</div>');
  const text0 = editor.textContent;
  const target = '切换删除线';
  let r = rangeForSubstring(target);
  const { start: S, end: E } = saveSelectionOffsets(editor, r);

  addStrikeToRange(r); editor.normalize(); cleanupEmptyS();
  assert('A5 第1次加删除线生效', sText() === target, 'sText=' + JSON.stringify(sText()));

  r = restoreSelectionOffsets(editor, S, E);
  removeStrikeFromRange(r); editor.normalize(); cleanupEmptyS();
  assert('A5 取消删除线生效', editor.querySelectorAll('s').length === 0, 'html=' + editor.innerHTML);

  r = restoreSelectionOffsets(editor, S, E);
  assert('A5 取消后选区仍可恢复', r && r.toString() === target,
    'got=' + JSON.stringify(r ? r.toString() : null));
  addStrikeToRange(r); editor.normalize(); cleanupEmptyS();
  assert('A5 第2次加删除线生效（关键回归）', sText() === target,
    'sText=' + JSON.stringify(sText()) + ' html=' + editor.innerHTML);
  assert('A5 反复切换后文本不变', editor.textContent === text0);

  // 第三轮
  r = restoreSelectionOffsets(editor, S, E);
  removeStrikeFromRange(r); editor.normalize(); cleanupEmptyS();
  r = restoreSelectionOffsets(editor, S, E);
  addStrikeToRange(r); editor.normalize(); cleanupEmptyS();
  assert('A5 第3次加删除线仍生效', sText() === target, 'sText=' + JSON.stringify(sText()));
}

// ---------- 用例 6: A6 不残留空 <s></s> ----------
section('A6 DOM 不残留空 <s></s>');
{
  reset('<div>空标签检测用例文本</div>');
  const target = '标签检测';
  let r = rangeForSubstring(target);
  const { start: S, end: E } = saveSelectionOffsets(editor, r);

  addStrikeToRange(r); editor.normalize();
  assert('A6-1 加删除线后无空 <s>（未经清理）', emptySCount() === 0,
    'empty=' + emptySCount() + ' html=' + editor.innerHTML);

  r = restoreSelectionOffsets(editor, S, E);
  removeStrikeFromRange(r); editor.normalize();
  assert('A6-2 取消删除线后无空 <s>（未经清理）', emptySCount() === 0,
    'empty=' + emptySCount() + ' html=' + editor.innerHTML);
  assert('A6-3 取消后 innerHTML 不含 <s></s>', !/<s>\s*<\/s>/.test(editor.innerHTML),
    'html=' + editor.innerHTML);

  // 部分覆盖场景：只取消 <s> 的中间一段，应拆成两个非空 <s>
  reset('<div>前缀<s>ABCDEFGHIJ</s>后缀</div>');
  const rMid = document.createRange();
  const sInner = editor.querySelector('s').firstChild;
  rMid.setStart(sInner, 3);
  rMid.setEnd(sInner, 6);
  removeStrikeFromRange(rMid);
  editor.normalize();
  assert('A6-4 部分取消后无空 <s>', emptySCount() === 0,
    'empty=' + emptySCount() + ' html=' + editor.innerHTML);
  assert('A6-5 部分取消结果正确（DEF 移出 <s>）', sText() === 'ABC' + 'GHIJ',
    'sText=' + JSON.stringify(sText()) + ' html=' + editor.innerHTML);
  assert('A6-6 部分取消后文本不变', editor.textContent === '前缀ABCDEFGHIJ后缀',
    'text=' + JSON.stringify(editor.textContent));
}

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(52));
console.log('总计: ' + (pass + fail) + '  PASS: ' + pass + '  FAIL: ' + fail);
if (fail) console.log('失败项:\n  - ' + failures.join('\n  - '));
console.log('结论: ' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURES'));
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
