// v7.9.0 首页定制案（用户拍板五条：夜色随正文时间规则 / placeholder 变短 /
// 旧 URL hint 换实时网址预览 / 底部信任三图标 / 按此落地）
//
// 症状：首页只服务"第一次来的人"，底部 hint 与输入框信息重复且从不告诉用户
// 输入后会发生什么；placeholder 塞满校验符号像工程表单。
// 修法：预览行「你的笔记网址为： <当前域名>/<金色名字>」随输入实时变（空=整行隐身，
// 不闪无光杆域名）；校验与非法红字口径原样不动（sanitize 剔除后值必合法）；
// 扫码行下新增「服务器只见密文 · 无需账号 · 扫码跨设备」三枚 1.7px 细线信任图标。
//
// Z1 静态形态：文案、元素、顺序、三图标同族描边
// Z2 两套夜间对抗锁色同步（红线13：.hint 消费者清干净，.urlline/.trust 三板齐）
// Z3 jsdom 行为：净化→预览实时跟显；空→隐身；-/_ 直通不报错（校验不动拍板）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

// ── Z1：静态形态 ───────────────────────────────────────────
test('Z1 placeholder 变短、hint 退役换实时预览行、信任三图标就位', () => {
  const land = SRC.slice(SRC.indexOf('<div id="landing"'), SRC.indexOf('<div id="landing"') + 4000);
  assert.ok(land.includes('placeholder="笔记名（英文/数字）"'), 'placeholder 按拍板口径变短');
  assert.ok(!land.includes('在网址后加笔记名即可'), '旧 URL hint 文案退役（校验不动，规则挪给红字一行）');
  assert.ok(land.includes('你的笔记网址为：'), '新预览行文案（无标点短句族）');
  assert.ok(land.includes('id="landingUrlLine"') && land.includes('id="landingUrlName"'), '预览行+名字段挂点存在');
  assert.ok(land.includes('<span class="dyn-domain"></span>/'), '域名段复用 .dyn-domain 装载（location.hostname IIFE）');
  const iWarn = land.indexOf('id="landingWarn"'), iUrl = land.indexOf('id="landingUrlLine"'), iScan = land.indexOf('id="landingScan"'), iTrust = land.indexOf('class="trust"');
  assert.ok(iWarn < iUrl && iUrl < iScan && iScan < iTrust, '视觉流=输入→红字→预览→扫码→信任（拍板 mockup 顺序）');
  for (const t of ['服务器只见密文', '无需账号', '扫码跨设备']) assert.ok(land.includes(t), '信任行三文案必须在：' + t);
  const strokes = (land.match(/stroke-width="1\.7"/g) || []);
  assert.ok(strokes.length >= 3, '三枚图标必须 1.7px 细线与全页同族（且只 3 枚：trust 区内）');
});

// ── Z2：锁色三板同步 ───────────────────────────────────────
test('Z2 两套夜间对抗清单：.hint 消费者清零，.urlline/.trust 锁色齐（红线13）', () => {
  assert.strictEqual((SRC.match(/#landing \.hint/g) || []).length, 0, '#landing .hint 选择器应全退役（CSS 规则+两处锁色）');
  assert.ok(SRC.includes('#landing .sub,#landing .urlline,#landing .trust{color:${p.muted}!important'), 'mountThemeOverride：预览/信任文字锁 muted');
  assert.ok(SRC.includes('#landing .urlline .u-name,#landing .trust svg{color:${accent}!important'), 'mountThemeOverride：金色段+图标锁 accent');
  assert.ok(SRC.includes("'#landing .sub,#landing .urlline,#landing .trust{color:#676A75!important"), '深色壳清单：muted 锁同步');
  assert.ok(SRC.includes("'#landing .urlline .u-name,#landing .trust svg{color:#708ED9!important"), '深色壳清单：金色段换壳蓝（brand svg 同款）');
  assert.ok(/#landing \.urlline\{[^}]*color:var\(--muted\)/.test(SRC), '日间规则本体走令牌（两板自动适配的根基）');
  assert.ok(/#landing>\*:nth-child\(8\)\{animation-delay:\.42s\}/.test(SRC), '新末子元素续上 0.06s 入场步进');
});

// ── Z3：jsdom 行为 ─────────────────────────────────────────
test('Z3 净化后预览实时跟显；空值整行隐身；-_ 直通（校验不动拍板）', () => {
  const dom = loadApp(); // http://localhost/ → init() landing 分支
  const w = dom.window;
  const li = w.document.getElementById('landingInput');
  const line = w.document.getElementById('landingUrlLine');
  const name = w.document.getElementById('landingUrlName');
  const warn = w.document.getElementById('landingWarn');
  assert.ok(li && line && name && warn, '挂点四件套必须在');
  assert.ok(line.classList.contains('hidden'), '初始空值：预览行隐身，不闪光杆域名');

  li.value = '我的笔记biji';
  li.dispatchEvent(new w.Event('input'));
  assert.strictEqual(li.value, 'biji', '前置：sanitize 既有行为——非法字符剔除、按钮解锁（v553 D4 同源）');
  assert.ok(!line.classList.contains('hidden'), '净化后非空 → 预览行出现');
  assert.strictEqual(name.textContent, 'biji', '金色名字段跟着输入变');

  li.value = 'my-note_2';
  li.dispatchEvent(new w.Event('input'));
  assert.strictEqual(li.value, 'my-note_2', '校验口径不动拍板：-_ 直通不剔除');
  assert.ok(warn.classList.contains('hidden'), '-_ 合法 → 红字不出');
  assert.strictEqual(name.textContent, 'my-note_2', '预览同步跟上');

  li.value = '';
  li.dispatchEvent(new w.Event('input'));
  assert.ok(line.classList.contains('hidden'), '清空 → 整行再隐身');
  dom.window.close();
});

// ── Z4：v7.9.1 信任行贴底 + 键盘期淡出 + 「无需账号」换品牌环款 ──
test('Z4 贴底锚点/淡出通道/套A环图标（旧禁止标记退役）', () => {
  assert.ok(/#landing \.trust\{position:absolute;left:0;right:0;bottom:44px;bottom:calc\(44px \+ env\(safe-area-inset-bottom\)\)/.test(SRC), '贴底：44px 兜底老内核 + calc(env) 渐进，两行缺一不可');
  assert.ok(SRC.includes('#landing.trust-away .trust{opacity:0}'), '淡出通道类在位');
  assert.ok(SRC.includes('transition:opacity .25s;animation-fill-mode:backwards}'), 'fill-mode 必 backwards：rise 的 both 会动画级锁死 opacity=1 压过淡出（闸 R2/R3 双路命中 P0，真浏览器守门在 e2e trust_keyboard K1）');
  assert.ok(SRC.includes("li.addEventListener('focus', () => landingBox.classList.add('trust-away'));"), '聚焦键盘弹起 → 贴底行淡出（软键盘必盖贴底元素，实锤已拍板让位）');
  assert.ok(SRC.includes("li.addEventListener('blur', () => landingBox.classList.remove('trust-away'));"), '失焦 → 淡回');
  const trust = SRC.slice(SRC.indexOf('<div class="trust"'), SRC.indexOf('<div class="trust"') + 2400);
  assert.ok(trust.includes('M20.3 7.2A9.6 9.6 0 0 1 7.2 20.3') && trust.includes('M3.7 16.8A9.6 9.6 0 0 1 16.8 3.7'), '无需账号=套A品牌双弧环（与 3A logo 同族弧段）');
  assert.ok(trust.includes('circle cx="12" cy="10.4"') && trust.includes('M12 12.1v2.7'), '环心钥匙孔（圆+柄）');
  assert.ok(!trust.includes('<circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/>'), '旧「圆圈+斜线」禁止标记退役（廉价感）');
  assert.ok(trust.includes('M12 3l7 3v6'), '盾牌（服务器只见密文）按拍板保持现状');
  assert.ok(trust.includes('rect x="3" y="6" width="12" height="9"'), '双设备（扫码跨设备）按拍板保持现状');
});
