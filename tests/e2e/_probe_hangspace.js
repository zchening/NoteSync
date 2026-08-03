// 验证假设：white-space:pre-wrap 下「行尾空格 hanging」是否影响 caret 定位/行框宽度。
// 对比 pre-wrap vs break-spaces（唯一区别就是行尾空格不 hang）。
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8">
  <style>
    body{margin:0;font:17px/1.9 sans-serif}
    .ed{width:400px;padding:20px;border:1px solid #ccc;
        word-wrap:break-word;overflow-wrap:anywhere;word-break:break-all;}
    #a{white-space:pre-wrap}
    #b{white-space:break-spaces}
  </style>
  <div class="ed" id="a" contenteditable="true"><div> </div><div>四五六</div></div>
  <div class="ed" id="b" contenteditable="true"><div> </div><div>四五六</div></div>`);

  const res = await page.evaluate(() => {
    const out = {};
    for (const id of ['a', 'b']) {
      const ed = document.getElementById(id);
      const blk = ed.firstChild;          // <div> </div>
      const tn = blk.firstChild;          // 空格文本节点
      const r = document.createRange();
      r.setStart(tn, 1); r.collapse(true); // caret 在空格之后
      const rects = Array.from(r.getClientRects()).map(x => ({ x: +x.x.toFixed(2), w: +x.width.toFixed(2), h: +x.height.toFixed(2) }));
      const b = blk.getBoundingClientRect();
      // 用 Range 量「空格本身」的宽度（选中这个空格）
      const r2 = document.createRange(); r2.setStart(tn, 0); r2.setEnd(tn, 1);
      const sp = Array.from(r2.getClientRects()).map(x => ({ x: +x.x.toFixed(2), w: +x.width.toFixed(2) }));
      out[id] = {
        ws: getComputedStyle(ed).whiteSpace,
        blockX: +b.x.toFixed(2), blockW: +b.width.toFixed(2), blockH: +b.height.toFixed(2),
        caretRects: rects,
        spaceRects: sp,
        caretOffsetFromBlockStart: rects.length ? +(rects[0].x - b.x).toFixed(2) : null,
      };
    }
    return out;
  });

  console.log(JSON.stringify(res, null, 2));
  console.log('\n--- 结论 ---');
  const a = res.a, b = res.b;
  console.log('pre-wrap     行尾空格宽度 =', a.spaceRects.map(s => s.w).join(','), ' caret 距行首 =', a.caretOffsetFromBlockStart);
  console.log('break-spaces 行尾空格宽度 =', b.spaceRects.map(s => s.w).join(','), ' caret 距行首 =', b.caretOffsetFromBlockStart);
  if (a.caretOffsetFromBlockStart !== b.caretOffsetFromBlockStart) {
    console.log('>>> 两者 caret 位置不同 → hanging 确实影响 caret 定位');
  } else {
    console.log('>>> caret 位置相同 → hanging 不影响 caret 定位，需另找根因');
  }
  await browser.close();
})();
