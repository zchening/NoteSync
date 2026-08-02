// 单元测试：saveSelectionOffsets / restoreSelectionOffsets (index.html:270-297)
// 用 jsdom 提供全局 document，两个函数原样提取，不依赖 window.getSelection。
import { pathToFileURL } from 'node:url';
const { JSDOM } = await import(pathToFileURL('C:/Users/zchen/.workbuddy/binaries/node/workspace/node_modules/jsdom/lib/api.js'));

const dom = new JSDOM('<!DOCTYPE html><body></body>');
// 让待测函数使用的全局 document 指向 jsdom 的 document
globalThis.document = dom.window.document;
// TreeWalker / NodeFilter 同样需要来自 jsdom 全局
globalThis.NodeFilter = dom.window.NodeFilter;

// ===== 从 index.html 原样提取 =====
function saveSelectionOffsets(root, range) {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const end = pre.toString().length;
  return { start, end };
}

function restoreSelectionOffsets(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let sn = null, so = 0, en = null, eo = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.length;
    if (sn === null && pos + len >= start) { sn = node; so = start - pos; }
    if (en === null && pos + len >= end)   { en = node; eo = end - pos; }
    if (sn !== null && en !== null) break;
    pos += len;
  }
  if (sn === null || en === null) return null;
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}
// ===== 提取结束 =====

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}` + (extra ? `\n      期望: ${extra.exp}\n      实际: ${extra.act}` : '')); }
}

const doc = document;

// 用例1：单文本节点，含全角括号中文
{
  const editor = doc.createElement('div');
  editor.contentEditable = 'true';
  editor.textContent = '你好（世界）abc123';
  const S = 2, E = 7; // "好（世界"
  const r = doc.createRange();
  r.setStart(editor.firstChild, S);
  r.setEnd(editor.firstChild, E);
  const off = saveSelectionOffsets(editor, r);
  const r2 = restoreSelectionOffsets(editor, off.start, off.end);
  const got = r2 ? r2.toString() : null;
  const exp = editor.textContent.slice(S, E);
  assert('1. 单文本节点往返一致', got === exp, { exp, act: got });
}

// 用例2：多文本节点，<s> 包裹中间文字，选区跨普通+<s>
{
  const editor = doc.createElement('div');
  editor.contentEditable = 'true';
  editor.innerHTML = '前面文字<s>中间删除线</s>后面文字';
  // 目标选区间：从 "前面文字" 的偏移3 到 "<s>中间删除线</s>后面文字" 的总偏移... 用根级 Range
  // 选区：开头"前面文字"中 "面文字" 起(偏移1) 到 "间删除线" 之后(偏移 1 + 5(面文字) + 4(中间) = 10)
  const S = 1, E = 10;
  // 在根节点上用字符偏移构造原始 range：start 在第1文本节点偏移1，end 跨到 <s> 内
  const tn1 = editor.childNodes[0];      // "前面文字"
  const sEl = editor.childNodes[1];      // <s>
  const tn2 = sEl.firstChild;            // "中间删除线"
  const r = doc.createRange();
  r.setStart(tn1, 1);
  r.setEnd(tn2, 4); // "中间删除线" 偏移4 -> 落在"中间删"
  const origText = r.toString(); // 权威期望：原 range 文本
  const off = saveSelectionOffsets(editor, r);
  const r2 = restoreSelectionOffsets(editor, off.start, off.end);
  const got = r2 ? r2.toString() : null;
  assert('2. 多文本节点跨<s>往返一致', got === origText, { exp: origText, act: got });
}

// 用例3：关键回归 A7 —— 节点被 replaceWith 替换后，字符偏移恢复不依赖旧节点
{
  const editor = doc.createElement('div');
  editor.contentEditable = 'true';
  editor.innerHTML = '前缀<span>链接文字</span>后缀';
  const span = editor.querySelector('span');
  const textNode = span.firstChild; // "链接文字"
  // 替换前：构造跨该文本节点的 range（如选中"接文"）
  const r = doc.createRange();
  r.setStart(textNode, 1);
  r.setEnd(textNode, 3);
  const off = saveSelectionOffsets(editor, r);
  const beforeText = editor.textContent.slice(off.start, off.end); // "接文"

  // 模拟 linkifyEditor 的破坏动作：用新节点替换旧文本节点（旧节点 detach）
  const fresh = doc.createTextNode(textNode.data);
  textNode.replaceWith(fresh);
  // 旧 textNode 已脱离文档

  const r2 = restoreSelectionOffsets(editor, off.start, off.end);
  const got = r2 ? r2.toString() : null;
  assert('3. A7 节点替换后字符偏移恢复一致',
         got === beforeText && got !== null,
         { exp: beforeText, act: got });
}

// 用例4：边界 start===end 折叠选区
{
  const editor = doc.createElement('div');
  editor.contentEditable = 'true';
  editor.textContent = '折叠测试ABCD';
  const S = 4; // 落在 '测'
  const r = doc.createRange();
  r.setStart(editor.firstChild, S);
  r.setEnd(editor.firstChild, S);
  const off = saveSelectionOffsets(editor, r);
  const r2 = restoreSelectionOffsets(editor, off.start, off.end);
  const ok = r2 !== null && r2.collapsed === true && r2.startOffset === S &&
             r2.startContainer === editor.firstChild;
  assert('4. 折叠选区返回正确位置且不报错', ok,
         { exp: `collapsed@offset${S}`, act: r2 ? `collapsed=${r2.collapsed}@offset${r2.startOffset}` : 'null' });
}

console.log(`\n==== 结果: ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
