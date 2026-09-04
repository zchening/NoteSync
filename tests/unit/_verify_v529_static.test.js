// NoteSync v5.29 独立回归验证（jsdom，不启动浏览器）
//
// 针对"主题/深色模式对抗"改动，在内核不可知的 jsdom 环境里补做静态/DOM 层断言：
//   - #theme-override 挂在 <html> 末尾且全文档唯一（现代/旧内核打桩都验）
//   - 手动切换不写 localStorage / sessionStorage（刻意不持久化，刷新回时间规则）
//   - MutationObserver 连续注入后仍唯一且置末，无死循环（jsdom 实证）
// 不修改任何业务代码。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

const doms = [];
function open(extra) {
  const d = loadApp(extra);
  doms.push(d);
  return d.window;
}
after(() => { doms.forEach((d) => { try { d.window.close(); } catch (e) {} }); });

function stubModern(w) { w.CSS = { supports: (p, v) => v === 'only light' }; }
function stubLegacy(w) { w.CSS = { supports: () => false }; }

test('V529-U1 现代内核：#theme-override 挂 <html> 末位且唯一', () => {
  const w = open(stubModern);
  w.applyTheme(false);
  const ov = w.document.getElementById('theme-override');
  assert.ok(ov, 'theme-override 应存在');
  assert.strictEqual(ov.parentNode, w.document.documentElement, '必须挂在 <html>（</body> 之后）');
  assert.strictEqual(ov.nextSibling, null, '必须是最后一个子节点');
  assert.strictEqual(w.document.querySelectorAll('#theme-override').length, 1, '应唯一');
});

test('V529-U2 旧内核：#theme-override 同样挂 <html> 末位且唯一', () => {
  const w = open(stubLegacy);
  w.applyTheme(true);
  w.applyTheme(false);
  const ov = w.document.getElementById('theme-override');
  assert.strictEqual(ov.parentNode, w.document.documentElement);
  assert.strictEqual(ov.nextSibling, null);
  assert.strictEqual(w.document.querySelectorAll('#theme-override').length, 1);
});

test('V529-U3 手动切换不写 localStorage / sessionStorage', () => {
  const w = open(stubModern);
  w.applyTheme(false);
  w.applyTheme(true);
  const keys = [];
  for (let i = 0; i < w.localStorage.length; i++) keys.push(w.localStorage.key(i));
  for (let i = 0; i < w.sessionStorage.length; i++) keys.push(w.sessionStorage.key(i));
  assert.ok(!keys.some((k) => /theme|dark|night|color/i.test(String(k))),
    '主题选择不得持久化（刷新须回到时间规则），但发现键: ' + keys.join(','));
});

test('V529-U4 MutationObserver 连续注入后仍唯一且置末（无死循环）', async () => {
  const w = open(stubModern);
  w.applyTheme(false);
  const de = w.document.documentElement;
  const before = de.childElementCount;
  for (let i = 0; i < 20; i++) {
    const s = w.document.createElement('style');
    s.textContent = 'body{background:#000!important}';
    de.appendChild(s);
  }
  await new Promise((r) => setTimeout(r, 150));
  const ov2 = w.document.getElementById('theme-override');
  assert.strictEqual(w.document.querySelectorAll('#theme-override').length, 1, 'override 应唯一');
  assert.strictEqual(de.lastElementChild, ov2, 'override 应回到末尾');
  assert.ok(de.childElementCount <= before + 25, 'DOM 子节点不应无限增长（before=' + before + ', after=' + de.childElementCount + '）');
});

test('V529-U5 默认（无 ?themedi）不创建 #themeDiag', () => {
  const w = open(stubModern);
  assert.strictEqual(w.document.getElementById('themeDiag'), null, '无 ?themedi 不应存在 #themeDiag');
});
