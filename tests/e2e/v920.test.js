// NoteSync v9.2.0 E2E（真实 Chromium + 真 server.js）：
// 首页彩蛋入口 / 刷新开奖卡（含真 reload）/ 折叠光标透明 / 图片放大与菜单 /
// 夜间画布对比度 / 桌宠档案页真视口滚动与常驻底栏。
// 守护纪律：等异步一律 waitForFunction 真条件，禁定值 sleep 判绿；2 并发跑全套；
// 布局类断言只能在真浏览器里量（jsdom 里画布与滚动高度恒 0，等于没测）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startServer } = require('./server');

process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

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
  try { if (server) server.close(); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

// 桌面：落地页 → 笔记名 → 口令解锁 → 编辑器可打字
async function openEditor(noteName, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.__errors = errors;
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', noteName);
  await page.click('#landingBtn');
  await page.waitForFunction(n => location.pathname.endsWith(n), encodeURIComponent(noteName), { timeout: 10000 });
  await page.waitForSelector('#pw', { timeout: 15000 });
  await page.fill('#pw', 'test-pass-123');
  await page.click('#ok');
  await page.waitForFunction(() => document.getElementById('editor').contentEditable === 'true', { timeout: 10000 });
  return { ctx, page };
}

/* ── F1 首页命中门牌：按钮变「打开彩蛋」，点了真进游戏 ── */
test('F1 首页输 mirror → 按钮改文案上描边 → 点击直接进彩蛋，不新建笔记', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'mirror');
  await page.waitForFunction(() => document.getElementById('landingBtn').textContent === '打开彩蛋', null, { timeout: 5000 });
  const st = await page.evaluate(() => {
    const lb = document.getElementById('landingBtn'), li = document.getElementById('landingInput');
    const tip = document.getElementById('landingEggTip');
    return {
      text: lb.textContent, disabled: lb.disabled, egg: lb.classList.contains('egg'),
      inputKept: li.value, tipShown: tip && !tip.classList.contains('hidden'), tipText: tip ? tip.textContent : '',
      urlHidden: document.getElementById('landingUrlLine').classList.contains('hidden'),
      border: getComputedStyle(lb).borderTopColor
    };
  });
  assert.strictEqual(st.text, '打开彩蛋');
  assert.strictEqual(st.disabled, false, '命中门牌按钮必须解禁');
  assert.strictEqual(st.egg, true, '必须上金色描边态');
  assert.strictEqual(st.inputKept, 'mirror', '输入不许被清空（旧形态清空＝用户以为没反应）');
  assert.strictEqual(st.tipShown, true, '专属说明行必须出现');
  assert.ok(/\/mirror/.test(st.tipText), '说明行要带命中的门牌名');
  assert.strictEqual(st.urlHidden, true, '门牌不是笔记，不得显示「你的笔记网址为」');
  assert.notStrictEqual(st.border, 'rgba(0, 0, 0, 0)', '描边必须真的画出来');
  await page.click('#landingBtn');
  await page.waitForFunction(() => !!document.getElementById('nsGame'), null, { timeout: 8000 });
  assert.strictEqual(await page.evaluate(() => {
    const g = document.getElementById('nsGame');
    return !!(g && g.querySelector('.ns-gate') && g.querySelector('.ns-gate').textContent === '/mirror');
  }), true, '进的必须是 /mirror');
  assert.strictEqual(await page.evaluate(() => location.pathname), '/mirror');
  assert.strictEqual(errs.length, 0, 'pageerror: ' + errs.slice(0, 2).join('|'));
  await ctx.close();
}));
test('F1b 首页输普通名仍走「打开」并显示网址预览（零回归）', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  await page.fill('#landingInput', 'v920plain');
  await page.waitForFunction(() => !document.getElementById('landingUrlLine').classList.contains('hidden'), null, { timeout: 5000 });
  const st = await page.evaluate(() => ({
    text: document.getElementById('landingBtn').textContent,
    egg: document.getElementById('landingBtn').classList.contains('egg'),
    tip: document.getElementById('landingEggTip').classList.contains('hidden')
  }));
  assert.strictEqual(st.text, '打开');
  assert.strictEqual(st.egg, false);
  assert.strictEqual(st.tip, true, '普通名不得弹门牌说明');
  await ctx.close();
}));

/* ── F2 刷新开奖卡：真点刷新、真 reload、真开奖 ── */
test('F2 点右下角刷新 → 页面重建后浮出开奖卡，档位与文案合法', guard(async () => {
  const { ctx, page } = await openEditor('V920Draw');
  await page.waitForFunction(() => typeof window.nsDrawRoll === 'function', null, { timeout: 10000 });
  await page.evaluate(() => localStorage.removeItem('notesync_draw_seen'));
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('#refreshBtn')
  ]);
  // 真重载之后：袋子必须是新抽的（证明 reload 前那一次 nsDrawRoll 真跑过）
  await page.waitForFunction(() => !!sessionStorage.getItem('notesync_draw'), null, { timeout: 10000 });
  const bag = await page.evaluate(() => sessionStorage.getItem('notesync_draw'));
  assert.ok(/^\{"t":"(r|sr|ssr|ur)","i":\d+\}$/.test(bag), '袋子必须是 {t,i}，实得 ' + bag);
  // 桩服务端不跨会话持久化笔记，reload 后可能回到锁屏——那就按真实用户流把口令再输一遍，
  // 兑现钩子挂在 applyUnlocked 尾部，锁屏→解锁这条路径同样必须兑现。
  const needPw = await page.evaluate(() => !document.getElementById('mask').classList.contains('hidden'));
  if (needPw) {
    await page.fill('#pw', 'test-pass-123');
    await page.click('#ok');
  }
  const st = await page.waitForFunction(() => {
    const c = document.getElementById('nsDraw');
    return c && c.querySelector('.dw-tx') && c.querySelector('.dw-tx').textContent.length > 0 ? {
      cls: c.className, badge: (c.querySelector('.dw-rar') || {}).textContent,
      text: c.querySelector('.dw-tx').textContent, bag: sessionStorage.getItem('notesync_draw')
    } : null;
  }, null, { timeout: 15000 }).then(h => h.jsonValue());
  assert.ok(/^(r|sr|ssr|ur)$/.test(st.cls.split(' ')[0]), '档位类名合法，实得 ' + st.cls);
  const tier = st.cls.split(' ')[0];
  assert.strictEqual(st.badge.toLowerCase(), tier, '右上角标必须等于档位');
  assert.strictEqual(st.bag, null, '兑现一次即作废，sessionStorage 必须已清');
  assert.ok(st.text.length >= 4, '卡面必须有文案');
  // 文案必须真出自对应档次的池子（防抽卡逻辑与池子脱钩后各自演）
  const inPool = await page.evaluate(([t, s]) => (window.nsDrawPool[t] || []).indexOf(s), [tier, st.text]);
  assert.ok(inPool >= 0, '卡面文案必须出自 ' + tier + ' 档池子，实得「' + st.text + '」');
  // 几何钉（闸 R2 实锤：通用 rise 的 to 帧抹掉 translateX(-50%) 后卡片右偏 170px 溢出屏外，
  // 而"存在 + 内容"两项断言全绿——浮层必须量真位置，光量存在等于没测）
  const geo = await page.evaluate(() => {
    const r = document.getElementById('nsDraw').getBoundingClientRect();
    return { left: r.left, right: r.right, cx: (r.left + r.right) / 2, vw: window.innerWidth, bottom: r.bottom, vh: window.innerHeight };
  });
  assert.ok(Math.abs(geo.cx - geo.vw / 2) < 2, '卡片必须水平居中，中心偏 ' + (geo.cx - geo.vw / 2).toFixed(1) + 'px');
  assert.ok(geo.left >= 0 && geo.right <= geo.vw, '卡片必须完整落在视口内：' + JSON.stringify(geo));
  assert.ok(geo.bottom <= geo.vh, '卡片底部不得掉出视口');
  await ctx.close();
}));
test('F2b 未解锁时点刷新只提示不抽卡（坏路径不留残袋）', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(baseURL + 'V920Locked', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#refreshBtn', { timeout: 15000 });
  await page.evaluate(() => sessionStorage.removeItem('notesync_draw'));
  // 锁屏遮罩会拦住真实鼠标点击；这条测的是处理器里的「未解锁不抽卡」分支，直接派发 click 即可
  await page.evaluate(() => document.getElementById('refreshBtn').click());
  await page.waitForFunction(() => uploadStatus.textContent.indexOf('请先解锁') >= 0, null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('notesync_draw')), null,
    '未解锁不得抽卡——否则 reload 回锁屏页还会凭空浮一张卡');
  await ctx.close();
}));
test('F2c 四档视觉真的不同（描边/内框/字色至少三处随档位变化）', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#landingInput', { timeout: 15000 });
  // 量的是 CSS 分档差异，不必真走抽卡路径（抽卡本身由 F2 覆盖）：手工挂同类名节点取 computed 样式
  const sig = await page.evaluate(() => {
    const out = {};
    ['r', 'sr', 'ssr', 'ur'].forEach(t => {
      const c = document.createElement('div'); c.id = 'nsDraw'; c.className = t;
      c.innerHTML = '<span class="dw-rar">' + t.toUpperCase() + '</span><div class="dw-tx">测试句</div>';
      document.body.appendChild(c);
      const cs = getComputedStyle(c), im = getComputedStyle(c.querySelector('.dw-tx'));
      out[t] = {
        border: cs.borderTopColor,
        bgImg: cs.backgroundImage.slice(0, 24),           // 金渐变环画在这里，不在 border-color 上
        font: im.fontFamily, color: im.color,
        inner: getComputedStyle(c, '::before').borderTopColor,
        innerW: getComputedStyle(c, '::before').borderTopWidth
      };
      c.remove();
    });
    return out;
  });
  assert.notStrictEqual(sig.ssr.border, sig.r.border, 'SSR 必须有金边而 R 无');
  assert.notStrictEqual(sig.ssr.font, sig.r.font, 'SSR 正文必须换衬线');
  assert.notStrictEqual(sig.ur.color, sig.r.color, 'UR 正文必须上金色');
  // UR 的边框色本身就是 transparent（渐变环画在 background-image），量 border-color 会恒等、语法坏了也绿
  assert.ok(/gradient/.test(sig.ur.bgImg), 'UR 必须真有金渐变边框环，实得 background-image=' + sig.ur.bgImg);
  assert.ok(!/gradient/.test(sig.r.bgImg), 'R 不得有渐变环');
  assert.notStrictEqual(sig.sr.inner, 'rgba(0, 0, 0, 0)', 'SR 的冷银内描边必须真的画出来');
  assert.notStrictEqual(sig.ssr.inner, 'rgba(0, 0, 0, 0)', 'SSR 的内描边必须真的画出来');
  await ctx.close();
}));

/* ── F3 折叠隐形标记对光标透明 ── */
test('F3 折叠标题最左位按←跳到上一行末尾；标记内不驻留；退格仍整删', guard(async () => {
  const { ctx, page } = await openEditor('V920Fold');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.innerHTML = '<div>第一行abc</div><div>[折叠]标题def</div>';
    window.applyFolds();
  });
  assert.strictEqual(await page.evaluate(() => {
    const b = document.getElementById('editor').children[1];
    return !!(b.firstElementChild && b.firstElementChild.classList.contains('ns-fold-mark'));
  }), true, '折叠标记应已建出');
  // ① 光标落进隐形标记 → selectionchange 归一化推到标记右
  //（归一化带 activeElement 守卫：真人场景下光标能进标记必然是编辑器已聚焦，测试必须先 focus）
  await page.evaluate(() => document.getElementById('editor').focus());
  const norm = await page.evaluate(async () => {
    const b = document.getElementById('editor').children[1];
    const mk = b.firstElementChild;
    getSelection().collapse(mk.firstChild, 2);
    const inside = window.foldCaretHelpers.insideMark(getSelection().getRangeAt(0));
    await new Promise(r => requestAnimationFrame(r));
    return { inside: !!inside, nowLeftmost: window.foldCaretHelpers.atLeftmost(getSelection().getRangeAt(0)), focused: document.activeElement === document.getElementById('editor') };
  });
  assert.strictEqual(norm.focused, true, '前置条件：编辑器必须持有焦点');
  assert.strictEqual(norm.inside, true, '标记内应被识别');
  assert.strictEqual(norm.nowLeftmost, true, 'selectionchange 必须把它推出标记');
  // ② 真键盘在最左位按 ← → 跳上一行末尾
  const jump = await page.evaluate(() => {
    const b = document.getElementById('editor').children[1];
    getSelection().collapse(b.firstChild.nextSibling, 0);
    return window.foldCaretHelpers.atLeftmost(getSelection().getRangeAt(0));
  });
  assert.strictEqual(jump, true, '起点必须在最左位');
  await page.click('#editor');
  await page.evaluate(() => {
    const b = document.getElementById('editor').children[1];
    getSelection().collapse(b.firstChild.nextSibling, 0);
    document.getElementById('editor').focus();
  });
  await page.keyboard.press('ArrowLeft');
  const landed = await page.evaluate(() => {
    const r = getSelection().getRangeAt(0);
    const first = document.getElementById('editor').children[0].firstChild;
    return { isPrev: r.startContainer === first, off: r.startOffset };
  });
  assert.strictEqual(landed.isPrev, true, '← 必须落到上一行的文本节点');
  assert.strictEqual(landed.off, 6, '必须落在上一行末尾（第一行abc 共 6 字）');
  // ③ 退格原子整删仍在。先断言光标确实停在合法最左位（原来写了个恒真的 bs===true，测不到东西）
  const atLeftmost = await page.evaluate(() => {
    const b = document.getElementById('editor').children[1];
    getSelection().collapse(b.firstChild.nextSibling, 0);
    return window.foldCaretHelpers.atLeftmost(getSelection().getRangeAt(0));
  });
  assert.strictEqual(atLeftmost, true, '退格前光标必须停在「三角右、标题首字前」这个最左位');
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => {
    const b = document.getElementById('editor').children[1];
    return b && !b.querySelector('.ns-fold-mark');
  }, null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => document.getElementById('editor').children[1].textContent), '标题def',
    '退格必须整删 [折叠] 而不是啃掉半个标记');
  await ctx.close();
}));

/* ── F4 正文图片：放大 / 桌面右键交还 / 触屏菜单（v9.3.0 翻转） ── */
test('F4 点图开放大层（底栏两钮）；桌面右键不出自建菜单；菜单「放大查看」进查看器且自收', guard(async () => {
  const { ctx, page } = await openEditor('V920Img');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const d = document.createElement('div');
    const im = document.createElement('img');
    im.id = 'v920img';
    im.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
    d.appendChild(im); ed.appendChild(d);
  });
  await page.click('#v920img');
  await page.waitForFunction(() => !!document.getElementById('nsZoom'), null, { timeout: 5000 });
  const z = await page.evaluate(() => {
    const el = document.getElementById('nsZoom');
    return { btns: [].map.call(el.querySelectorAll('.nz-bar button'), b => b.textContent).join('/'), z: getComputedStyle(el).zIndex };
  });
  assert.strictEqual(z.btns, '保存到相册/复制链接');
  assert.ok(+z.z < 90, '图鉴 z90 是钉住的天花板');
  await page.click('#nsZoom .nz-x');
  await page.waitForFunction(() => !document.getElementById('nsZoom'), null, { timeout: 5000 });
  // 桌面右键：Playwright headless 有 fine 指针 → contextmenu 提前 return，自建菜单绝不出现
  await page.click('#v920img', { button: 'right' });
  await page.waitForTimeout(350);
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('nsImgMenu')), false,
    'v9.3.0：桌面右键必须交还系统菜单，自建菜单不得出现');
  // 触屏菜单内容与自收：直调触屏入口（长按计时器由 unit V8 钉阈值）
  await page.evaluate(() => window.nsImgMenu(document.getElementById('v920img'), 60, 60));
  const m = await page.evaluate(() => [].map.call(document.querySelectorAll('#nsImgMenu button'), b => b.textContent).join('/'));
  assert.strictEqual(m, '放大查看/保存到相册/复制图片链接');
  await page.click('#nsImgMenu button:nth-child(1)');
  await page.waitForFunction(() => !!document.getElementById('nsZoom'), null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('nsImgMenu')), false, '动作后菜单必须自收');
  assert.strictEqual(await page.evaluate(() => !!document.getElementById('v920img')), true, 'v9.3.0：菜单任何一项都不得删正文图（删除入口已退役）');
  assert.strictEqual(page.__errors.length, 0, 'pageerror: ' + page.__errors.slice(0, 2).join('|'));
  await ctx.close();
}));

/* ── F5 夜间画布对比度（真像素量，jsdom 量不到） ── */
test('F5 夜间 /dragon 画面必须有亮精灵：暗底上亮像素占比远高于纯背景', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 720 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(baseURL + 'dragon', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('nsCv'), null, { timeout: 10000 });
  await page.waitForFunction(() => {
    document.body.classList.add('dark');
    return getComputedStyle(document.body).getPropertyValue('--fg').trim().toUpperCase() === '#E9E8E3';
  }, null, { timeout: 5000 });
  // 一步到位：让 waitForFunction 自己数亮像素并以 >50 为真条件，取到的数就是断言的数。
  // 分两步测会自相矛盾——等的时候画面有一帧、量的时候已经换帧。
  const got = await page.waitForFunction(() => {
    const c = document.getElementById('nsCv'); if (!c || !c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 180 && d[i + 2] > 180) n++;
    return n > 50 ? n : 0;
  }, null, { timeout: 12000 }).then(h => h.jsonValue())
    .catch(() => { throw new Error('夜间画布始终没有亮精灵（--fg=' + '仍可能被锁在日间色板，旧根因）'); });
  assert.ok(got > 50, '夜间画布亮像素过少，实得 ' + got);
  await ctx.close();
}));

/* ── F6 桌宠档案页：真视口下可滚 + 底栏常驻 ── */
test('F6 小屏视口打开 /pet：底栏三钮常驻可见，滚到底能看全说明文字', guard(async () => {
  const { ctx, page } = await openEditor('V920Pet', { width: 390, height: 640 });
  await page.evaluate(() => { try { localStorage.setItem('notesync_arcade', null); } catch (e) {} });
  await page.goto(baseURL + 'pet', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('.ns-pet-dock'), null, { timeout: 10000 });
  const box = await page.evaluate(() => {
    const dock = document.querySelector('.ns-pet-dock'), sc = document.querySelector('.ns-pet-scroll');
    const db = dock.getBoundingClientRect();
    const sleep = document.querySelector('.ns-pet-sleep').getBoundingClientRect();
    return {
      vh: window.innerHeight, dockBottom: db.bottom, dockTop: db.top,
      sleepVisible: sleep.top >= 0 && sleep.bottom <= window.innerHeight,
      scrollable: sc.scrollHeight - sc.clientHeight,
      noteVisibleBefore: document.querySelector('.ns-pnote').getBoundingClientRect().bottom <= window.innerHeight
    };
  });
  assert.ok(box.dockBottom <= box.vh + 0.6, '底栏必须完整落在视口内，实得 ' + box.dockBottom + ' vs ' + box.vh);
  assert.strictEqual(box.sleepVisible, true, '「让它去睡」必须一进页面就可点（旧形态它被裁在视口外）');
  assert.ok(box.scrollable > 0, '内容区必须真的可滚，实得溢出 ' + box.scrollable + 'px');
  await page.evaluate(() => { const sc = document.querySelector('.ns-pet-scroll'); sc.scrollTop = sc.scrollHeight; });
  await page.waitForFunction(() => {
    const sc = document.querySelector('.ns-pet-scroll'), p = document.querySelector('.ns-pnote');
    return sc.scrollTop > 0 && p.getBoundingClientRect().bottom <= window.innerHeight;
  }, null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => {
    const r = document.querySelector('.ns-pnote').getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight;
  }), true, '滚到底必须能看全护照说明');
  await ctx.close();
}));

/* ── F7 关于页 FOUND 行不换行（真布局量） ── */
test('F7 关于页彩蛋行单行排下，尾字母不掉到下一行', guard(async () => {
  const { ctx, page } = await openEditor('V920About', { width: 360, height: 700 });
  await page.click('#menuBtn');
  await page.waitForFunction(() => !!document.getElementById('menuMask') && !document.getElementById('menuMask').classList.contains('hidden'), null, { timeout: 5000 });
  await page.click('#menuAbout');
  await page.waitForFunction(() => {
    const n = document.querySelector('.ns-egg-entry .ns-num');
    return n && n.textContent.indexOf('FOUND') > 0;
  }, null, { timeout: 6000 });
  const geo = await page.evaluate(() => {
    const n = document.querySelector('.ns-egg-entry .ns-num');
    const cs = getComputedStyle(n);
    return { h: n.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight) || 18, ws: cs.whiteSpace, wb: getComputedStyle(n.parentElement).wordBreak };
  });
  assert.ok(geo.h < geo.lh * 1.9, '计数串必须单行，实得高 ' + geo.h + '（行高 ' + geo.lh + '）');
  assert.strictEqual(geo.ws, 'nowrap');
  assert.strictEqual(geo.wb, 'normal', '彩蛋行必须解掉 .about-v 基础板的 break-all');
  await ctx.close();
}));
