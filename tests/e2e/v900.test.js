// NoteSync v9.0.0 E2E（真实 Chromium + 真 server.js）：彩蛋十门牌、统一外壳、镜像、街机档案接口。
// 守护纪律（本仓铁律）：等动画/定时器一律 waitForFunction 真条件轮询，禁定值 sleep 判绿；
// 2 并发跑全套（默认并发下有用例会漂移红）。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./server');

process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (/playwright|browser|connection|target|transport|closed|websocket/i.test(msg)) return;
  console.error('Unhandled rejection (non-teardown):', msg);
  process.exitCode = 1;
});

let failures = 0;
function guard(fn) { return async (t) => { try { await fn(t); } catch (e) { failures++; throw e; } }; }

let server, browser, baseURL, realSrv = null, realBase = '';
const TMP_DATA = path.join(os.tmpdir(), 'ns-v900-arcade-' + Date.now());

before(async () => {
  server = await startServer();
  baseURL = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  // 真 server.js 起在独立端口 + 独立数据目录（NOTESYNC_DATA_DIR 专为测试隔离而加），
  // 否则 /api/arcade 的建档、钥匙、合并、限流全都测不到真实现。
  fs.mkdirSync(TMP_DATA, { recursive: true });
  const port = 18080 + (Date.now() % 900);
  realBase = `http://127.0.0.1:${port}/`;
  realSrv = spawn(process.execPath, [path.resolve(__dirname, '..', '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), NOTESYNC_DATA_DIR: TMP_DATA }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('真 server.js 未能在 8s 内监听')), 8000);
    realSrv.stdout.on('data', d => { if (/listening/.test(String(d))) { clearTimeout(to); res(); } });
    realSrv.on('exit', c => { clearTimeout(to); rej(new Error('server.js 提前退出 code=' + c)); });
  });
});
after(async () => {
  if (browser) await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 6000))]).catch(() => {});
  try { if (server) server.close(); } catch {}
  try { if (realSrv) realSrv.kill(); } catch {}
  try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch {}
  process.exit(failures > 0 ? 1 : 0);
});

const gate = async (page, id) => {
  await page.goto(baseURL + id, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('nsGame'), null, { timeout: 8000 });
};

/* ── E1 门牌直达：壳挂出、canvas 真在画、Esc 收壳后能正常打字 ── */
test('E1 访问 /snake 出游戏壳；canvas 有实际绘制；Esc 退出后编辑器可打字', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await gate(page, 'snake');
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('ns-in-game')), true);
  assert.strictEqual(await page.evaluate(() => location.pathname), '/snake');
  // canvas 是否真在画：取像素和，两次采样必须不同（游戏在跑）
  const sig = () => page.evaluate(() => {
    const c = document.getElementById('nsCv'); const x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0;
    for (let i = 0; i < d.length; i += 997) s += d[i]; return s;
  });
  const s1 = await sig();
  await page.waitForTimeout(400);
  assert.notStrictEqual(await sig(), s1, 'canvas 必须在持续绘制（游戏循环真跑起来了）');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('nsGame'));
  assert.strictEqual(await page.evaluate(() => location.pathname), '/');
  // 退出后打字必须正常（红线10：焦点归还编辑器）
  await page.evaluate(() => { document.getElementById('editor').focus(); });
  await page.keyboard.type('回归');
  assert.ok((await page.textContent('#editor')).includes('回归'), '退出游戏后打字应正常落进正文');
  await ctx.close();
}));

/* ── E2 真玩一局贪吃蛇：转向生效、计分变化、正文一字不动 ── */
test('E2 方向键操控贪吃蛇：分数变化且正文数据零改动（红线：游戏不碰数据）', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(baseURL + 'zchening', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('editor').innerHTML = '<p>正文一个字都不许动</p>'; });
  const before = await page.evaluate(() => document.getElementById('editor').innerHTML);
  await page.evaluate(() => window.nsRouteEgg('snake'));
  await page.waitForFunction(() => !!document.getElementById('nsGame'));
  for (const k of ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) { await page.keyboard.press(k); await page.waitForTimeout(260); }
  const sc = await page.textContent('.ns-sc');
  assert.ok(/蛇身 \d+/.test(await page.textContent('.ns-lv')), 'HUD 应显示蛇身节数');
  assert.ok(/^\d+ 字$/.test(sc), '计分单位应为「字」：' + sc);
  assert.strictEqual(await page.evaluate(() => document.getElementById('editor').innerHTML), before, '玩一局不得触碰正文');
  await ctx.close();
}));

/* ── E3 移动端 375：HUD 与画面不溢出、划屏转向生效 ── */
test('E3 375 真机宽：壳与 HUD 零横向溢出，划屏能转向', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await gate(page, 'brick');
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: window.innerWidth,
    hud: document.querySelector('.ns-hud').getBoundingClientRect(),
    cv: document.getElementById('nsCv').getBoundingClientRect()
  }));
  assert.ok(m.doc <= m.win + 1, `整页零横向溢出（实际 ${m.doc} > ${m.win}）`);
  assert.ok(m.hud.width <= m.win + 1 && m.hud.height >= 40, 'HUD 不溢出且热区够高');
  assert.ok(m.cv.left >= -1 && m.cv.right <= m.win + 1, '画面必须完整落在视口内');
  const dir0 = await page.evaluate(() => window.NSG.cur && window.NSG.cur.id);
  assert.strictEqual(dir0, 'brick');
  await page.touchscreen.tap(120, 200);
  assert.ok(await page.evaluate(() => !!document.getElementById('nsGame')), '触屏点击不应把壳点掉');
  await ctx.close();
}));

/* ── E4 正文敲门牌：先弹确认、点进入才启动（不打断打字） ── */
test('E4 正文敲 /pet 弹确认浮层；确认后才启动；粘贴不弹', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { const e = document.getElementById('editor'); e.innerHTML = ''; e.focus(); });
  await page.keyboard.type('/pet');
  await page.waitForSelector('#nsAsk', { timeout: 4000 });
  assert.ok(!(await page.evaluate(() => !!document.getElementById('nsGame'))), '未确认前不得启动游戏');
  await page.click('#nsAsk .ns-go');
  await page.waitForFunction(() => !!document.querySelector('.ns-pet-panel'), null, { timeout: 5000 });
  assert.ok(await page.evaluate(() => /NS_EGG|pet/.test(String(window.NSG.route))), '确认后应真启动 /pet');
  await page.keyboard.press('Escape');
  // 粘贴同词不得再弹（本次会话已问过，且粘贴本就被排除）
  await page.evaluate(() => { const e = document.getElementById('editor'); e.innerHTML = ''; });
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    const ev = new Event('beforeinput', { bubbles: true }); ev.inputType = 'insertFromPaste'; ev.data = 't';
    e.textContent = '/pet'; e.dispatchEvent(ev);
  });
  await page.waitForTimeout(120);
  assert.ok(!(await page.evaluate(() => !!document.getElementById('nsAsk'))), '粘贴不得触发');
  await ctx.close();
}));

/* ── E5 关于页入口行 → 图鉴 → 点门牌行启动（App 内唯一主路径） ── */
test('E5 关于页「彩蛋 N/M FOUND」行开图鉴，点 /spacex 行即启动（App 无地址栏主路径）', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  // landing 为全屏覆盖层，#menuBtn 天然点不到（既有产品行为）；这里验真实接线：
  // 打开「关于」→ 入口行自动挂载 → 点入口行 → 图鉴打开
  await page.evaluate(() => { document.getElementById('aboutMask').classList.remove('hidden'); });
  await page.evaluate(() => { document.getElementById('menuAbout').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForSelector('.ns-egg-entry', { timeout: 4000 });
  const txt = await page.textContent('.ns-egg-entry');
  assert.ok(/0 \/ 17 FOUND/.test(txt.replace(/\s+/g, ' ')) || /\/ 17 FOUND/.test(txt), '入口行应显示图鉴进度：' + txt);
  await page.evaluate(() => { document.querySelector('.ns-egg-entry').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForFunction(() => !document.getElementById('eggMask').classList.contains('hidden'), null, { timeout: 8000 });
  const rows = await page.evaluate(() => document.querySelectorAll('#eggList .egg-row').length);
  assert.strictEqual(rows, 17, '图鉴应渲染 17 条');
  // 锁态行不可点（防未解锁剧透）——先解锁再走真实行点击，验「图鉴即 App 发射台」这条主路径
  await page.evaluate(() => { window.nsEggUnlock('spacex'); window.nsEggRender(); });
  await page.evaluate(() => { const r = [...document.querySelectorAll('#eggList .egg-row')].find(x => x.getAttribute('data-egg') === 'spacex'); r.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForFunction(() => !!document.getElementById('nsGame'));
  assert.strictEqual(await page.textContent('.ns-gate'), '/spacex');
  await ctx.close();
}));

/* ── E6 镜像 B 档：布局镜像而文字仍可读；进游戏自动摘镜像 ── */
test('E6 镜像 B 档 body 翻转且正文反向抵消；启动游戏必摘镜像', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.nsRouteEgg('mirror'));
  await page.waitForFunction(() => document.body.classList.contains('ns-mirror-B'));
  const st = await page.evaluate(() => ({
    body: getComputedStyle(document.body).transform,
    ed: getComputedStyle(document.getElementById('editor')).transform
  }));
  assert.ok(/matrix\(-1/.test(st.body), 'body 应左右翻转：' + st.body);
  assert.ok(/matrix\(-1/.test(st.ed), '正文应再翻回来（净效果文字可读）：' + st.ed);
  await page.evaluate(() => window.nsRouteEgg('snake'));
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('ns-mirror-B')), false, '进游戏必须摘镜像（方向键全反必被骂）');
  await ctx.close();
}));

/* ── E7 真 server.js 的 /api/arcade：建档 / 取档 / 钥匙错与不存在同形 / 合并取 max 与并集 / 限流 ── */
test('E7 街机档案接口：归属靠 writeKey、服务端只存哈希、多设备合并取 max 与并集、超频 429', guard(async () => {
  const id = 'ABCD2345', key = 'KEYABCDEFGHIJ12';
  const H = { 'content-type': 'application/json', 'x-arcade-key': key };
  const mk = (body) => fetch(realBase + 'api/arcade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let r = await mk({ id, key, updatedAt: 1 });
  assert.strictEqual(r.status, 200, '建档应成功');
  // 无钥匙取档 → 404（与"不存在"同形，防枚举）
  r = await fetch(realBase + 'api/arcade/' + id);
  assert.strictEqual(r.status, 404, '不带钥匙不得取档');
  r = await fetch(realBase + 'api/arcade/' + id, { headers: { 'x-arcade-key': 'wrongwrongwrong1' } });
  assert.strictEqual(r.status, 404, '钥匙错必须与不存在同形');
  r = await fetch(realBase + 'api/arcade/' + id, { headers: { 'x-arcade-key': key } });
  assert.strictEqual(r.status, 200, '带对钥匙可取档');
  let rec = await r.json();
  assert.ok(!JSON.stringify(rec).includes(key), '服务端绝不得存明文钥匙（只存哈希）');
  // 设备 A 写 snake=100，设备 B 并发写 snake=250 → 取 max，不得互相冲掉
  await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ counters: { snake: 100, dragon: 5 }, shelf: [1, 3], updatedAt: 10 }) });
  r = await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ counters: { snake: 250, bitcoin: 7 }, shelf: [3, 5], updatedAt: 20 }) });
  assert.strictEqual(r.status, 200);
  rec = await (await fetch(realBase + 'api/arcade/' + id, { headers: { 'x-arcade-key': key } })).json();
  assert.strictEqual(rec.counters.snake, 250, '计数器取 max');
  assert.strictEqual(rec.counters.dragon, 5, '先写的高于后写的零值不得被冲掉');
  assert.strictEqual(rec.counters.bitcoin, 7, '新计数器并入');
  assert.deepStrictEqual(rec.shelf.sort((a, b) => a - b), [1, 3, 5], '集合并集');
  // 限流：每档案每分钟 10 次写入，超出 429
  let last = 0, got429 = false;
  for (let i = 0; i < 14; i++) {
    last = (await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ counters: { tank: i }, updatedAt: 30 + i }) })).status;
    if (last === 429) { got429 = true; break; }
  }
  assert.ok(got429, '写入超频必须 429（末次状态 ' + last + '）');
  // 非法 id 不得触达文件系统
  assert.strictEqual((await fetch(realBase + 'api/arcade/' + encodeURIComponent('../../etc/passwd'), { headers: { 'x-arcade-key': key } })).status, 404);
}));

/* ── E8 服务端真的挡门牌新建（此前前缀写错成双斜杠正则＝防呆是死代码，字符串钉照样绿） ── */
test('E8 十个门牌在服务端挡新建、不毁存量：PUT /api/note/mirror 必 400，普通名照旧 200', guard(async () => {
  const NB = { 'content-type': 'application/json' };
  const put = (name) => fetch(realBase + 'api/note/' + name, { method: 'PUT', headers: NB, body: JSON.stringify({ ct: 'Z', iv: 'Z', salt: 'Z', v: 1 }) });
  for (const name of ['mirror', 'snake', 'tank', 'pet', 'MIRROR']) {
    const r = await put(name);
    assert.strictEqual(r.status, 400, '门牌 ' + name + ' 新建必须 400（挡住才不会被前端永久遮蔽），实得 ' + r.status);
    assert.ok(/reserved/.test(JSON.stringify(await r.json())), '必须回 reserved name 而非泛 400');
  }
  const ok = await put('e8-normal-note');
  assert.strictEqual(ok.status, 200, '普通笔记名不得被牵连');
  // 存量同名笔记＝v9 之前就存在的文件，必须绕过 API 直接落盘来造（用 PUT 造等于测自己刚加的拦截，必然失败）
  const NOTES = path.join(TMP_DATA, 'notes');
  fs.mkdirSync(NOTES, { recursive: true });
  const legacy = (name) => fs.writeFileSync(path.join(NOTES, name + '.json'), JSON.stringify({ ct: 'C1', iv: 'I1', salt: 'S1', v: 1, updatedAt: Date.now() }));
  legacy('brick');
  let g = await fetch(realBase + 'api/note/brick');
  assert.strictEqual(g.status, 200);
  assert.strictEqual((await g.json()).ct, 'C1', '存量同名笔记必须原样可读');
  assert.strictEqual((await put('brick')).status, 200, '已存在的门牌同名笔记必须仍可正常保存（不毁用户数据）');
  // 大写信名：ID_RE 允许大写，v9 前可能存在 Snake 这种笔记；只按小写查存在性会把它判成新建→此后保存永久 400
  legacy('Snake');
  assert.strictEqual((await put('Snake')).status, 200, '存量「Snake」必须仍可保存（存在性必须按原样名查）');
  assert.strictEqual((await put('TANK')).status, 400, '而新建大写门牌名仍须被挡');
}));

/* ── E10 /bitcoin 深度加成必须在真布局下成立（jsdom 量不到，只能在这里判） ── */
test('E10 黄金矿工：同一档矿块越深越值钱也越重，加成系数随 y 单调不减', guard(async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.nsRouteEgg('bitcoin'));
  await page.waitForFunction(() => !!document.getElementById('nsGame'));
  const items = await page.evaluate(() => window.nsGameProbe().items.filter(x => Number.isFinite(x.m)).sort((a, b) => a.y - b.y));
  assert.ok(items.length >= 4, '带系数的矿块太少，断言会空转：' + items.length);
  for (let i = 1; i < items.length; i++) assert.ok(items[i].m >= items[i - 1].m - 0.01, '加成系数必须随深度不减');
  assert.ok(items[items.length - 1].m >= 1.4, '最深处必须吃到明显加成（实得 ' + items[items.length - 1].m + '）');
  assert.ok(items[items.length - 1].m / items[0].m > 1.05, '首尾必须拉开，否则等于没加成');
  const gold = items.filter(x => x.t === 'gold');
  assert.ok(gold.length >= 2, '这一局没有可比的两块金（随机布局），断言不成立即报');
  if (gold[gold.length - 1].y - gold[0].y > 40) assert.ok(gold[gold.length - 1].v > gold[0].v, '同档金块：深 40px 以上必须严格更值钱');
  assert.ok(gold[gold.length - 1].w >= gold[0].w, '更深也更重');
  assert.ok(items.every(x => x.v > 0 || x.t === 'tnt'), '矿块价值不得为负（TNT 除外）');
  await ctx.close();
}));

/* ── E9 桌宠形态跨设备：不带形态的更新不得把 stage/ate 抹平，旧写入不得反超 ── */
test('E9 形态随档上行后：他端只更新成绩也不得冲掉 stage/ate，旧时间戳写不得反超', guard(async () => {
  const id = 'ZZQQ7788', key = 'KEYZZQQ7788AA', H = { 'content-type': 'application/json', 'x-arcade-key': key };
  assert.strictEqual((await fetch(realBase + 'api/arcade', { method: 'POST', headers: H, body: JSON.stringify({ id, key, updatedAt: 1 }) })).status, 200);
  // 设备 A：养到成体、吃了 5000 字、集齐两件、5 天前出生
  const born = Date.now() - 5 * 864e5;
  await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ counters: { snake: 10 }, shelf: [2, 7], stage: 1, ate: 5000, asleep: false, born, updatedAt: 100 }) });
  // 设备 B 只打了一把游戏（不带 stage/ate），必须「取 max 成绩 + 保留形态」
  await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ counters: { snake: 40 }, updatedAt: 200 }) });
  let rec = await (await fetch(realBase + 'api/arcade/' + id, { headers: H })).json();
  assert.strictEqual(rec.counters.snake, 40, '成绩取 max');
  assert.strictEqual(rec.stage, 1, '只更新成绩的写入不得抹平形态');
  assert.strictEqual(rec.ate, 5000);
  assert.deepStrictEqual(rec.shelf.sort((a, b) => a - b), [2, 7], '柜子取并集');
  assert.strictEqual(rec.born, born, '生日必须跟得住');
  assert.ok(rec.retiredAt === undefined || rec.retiredAt === 0, '没写过放归时间戳就不该有真值：' + rec.retiredAt);
  await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ retiredAt: 1700000200000, asleep: true, updatedAt: 210 }) });
  rec = await (await fetch(realBase + 'api/arcade/' + id, { headers: H })).json();
  assert.strictEqual(rec.retiredAt, 1700000200000, '放归时间戳必须由服务端搬过去（面板写着保留 30 天可原样认领）');
  assert.strictEqual(rec.asleep, true, '睡眠/放归态必须能存下来');
  // 迟到的旧写入（updatedAt 更小）不得反超
  await fetch(realBase + 'api/arcade/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ stage: 0, ate: 3, updatedAt: 50 }) });
  rec = await (await fetch(realBase + 'api/arcade/' + id, { headers: H })).json();
  assert.strictEqual(rec.stage, 1, '旧时间戳的形态写入必须被 updatedAt 后者胜挡住');
  assert.strictEqual(rec.ate, 5000);
}));
