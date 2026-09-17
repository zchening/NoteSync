// v9.3.8 守护：① 查看器底栏两按钮改纯白/纯黑字（近白/近黑在手机上仍发灰）；② 彩蛋光标落位改为每次重新定位都弹（点✕关闭后移开再移回仍弹）。
// 铁律：行为优先于文本；新断言锚定补丁行。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers');

const INDEX = path.resolve(__dirname, '..', '..', 'index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');
function ed(w) { return w.document.getElementById('editor'); }

/* ① 按钮纯色（静态锚定补丁行） */
test('v9.3.8 按钮：次按钮纯白字 + 主按钮纯白底纯黑字', () => {
  assert.ok(SRC.includes('background:var(--zoom-chip);color:#FFFFFF;cursor:pointer'), '次按钮文字纯白 #FFFFFF');
  assert.ok(SRC.includes('#nsZoom .nz-bar button.nz-pri{background:#FFFFFF;color:#000000;border-color:#FFFFFF}'), '主按钮纯白底 + 纯黑字');
});

/* ② 彩蛋光标：每次重新定位到彩蛋词都弹，点✕关闭后移开再移回仍弹 */
test('v9.3.8 彩蛋光标落位：弹→点✕→移开→再移回，仍重新弹（不受 asked[] 会话抑制）', async t => {
  const app = loadApp(); t.after(() => app.window.close());
  const w = app.window, d = w.document;
  ed(w).innerHTML = '<div>见 /dragon 里</div>';
  const tn = ed(w).querySelector('div').firstChild;
  const idx = tn.nodeValue.indexOf('/dragon');
  ed(w).focus();
  function place(off) {
    const r = d.createRange(); r.setStart(tn, off); r.setEnd(tn, off);
    w.getSelection().removeAllRanges(); w.getSelection().addRange(r);
    d.dispatchEvent(new w.Event('selectionchange', { bubbles: true }));
  }
  const wait = () => new Promise(res => setTimeout(res, 340));

  place(idx + 3); await wait();
  assert.ok(d.getElementById('nsAsk'), '首次定位到 /dragon 应弹');
  // 点 ✕ 关闭
  d.querySelector('#nsAsk .ns-no').click();
  assert.ok(!d.getElementById('nsAsk'), '点✕后确认层关闭');
  // 移开到非彩蛋词位置（词首「见」处）
  place(0); await wait();
  assert.ok(!d.getElementById('nsAsk'), '移开到普通文字不再弹');
  // 再移回 /dragon
  place(idx + 3); await wait();
  assert.ok(d.getElementById('nsAsk'), '重新定位回 /dragon 应再次弹（用户拍板：每次都要弹）');
});
