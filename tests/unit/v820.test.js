// NoteSync v8.2.0 彩蛋单元测试：节日/深夜徽章 · 节日雨 · 数字梗粒子 · 复古皮肤三态环。
// 约定：纯函数（nsFestAt/nsBadgeAt/nsDigitHit）行为钉死语义；皮肤环走真 DOM + theme-override 输出断言；
// 硬计数钉：nsFestWelcome 挂点恰 2 处（applyUnlocked 主路径 + 离线解锁）——新增挂点必同版改此数。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const D = (s) => new Date(s + 'T12:00:00');
function fresh() {
  const dom = loadApp();
  return { dom, window: dom.window };
}

// ── A1 节日表语义（日期真值经 lunar-javascript 双路径交叉验证）──
test('A1 节日判定：2026 春节档/元宵/端午/七夕/中秋/重阳/腊八 + 初四出档', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  assert.strictEqual(w.nsFestAt(D('2026-01-26')), 'lb');        // 腊八 2026-01-26
  assert.strictEqual(w.nsFestAt(D('2026-02-16')), 'cx');        // 除夕
  assert.strictEqual(w.nsFestAt(D('2026-02-17')), 'cj');        // 初一
  assert.strictEqual(w.nsFestAt(D('2026-02-18')), 'cj');        // 初二（运行时按 cj+1）
  assert.strictEqual(w.nsFestAt(D('2026-02-19')), 'cj');        // 初三（cj+2，春节档止）
  assert.strictEqual(w.nsFestAt(D('2026-02-20')), null);        // 初四不弹（用户拍板保持稀缺）
  assert.strictEqual(w.nsFestAt(D('2026-03-03')), 'yx');        // 元宵
  assert.strictEqual(w.nsFestAt(D('2026-06-19')), 'dy');        // 端午
  assert.strictEqual(w.nsFestAt(D('2026-08-19')), 'qx');        // 七夕
  assert.strictEqual(w.nsFestAt(D('2026-09-25')), 'zq');        // 中秋
  assert.strictEqual(w.nsFestAt(D('2026-10-18')), 'cy');        // 重阳
  assert.strictEqual(w.nsFestAt(D('2027-02-06')), 'cj');        // 2027 春节
  assert.strictEqual(w.nsFestAt(D('2024-09-17')), 'zq');        // 2024 中秋
  assert.strictEqual(w.nsFestAt(D('2025-01-29')), 'cj');        // 2025 春节
  assert.strictEqual(w.nsFestAt(D('2061-05-05')), null);        // 表外年份静默过期
  assert.strictEqual(w.nsFestAt(D('2061-01-01')), 'nj');        // 元旦走公历硬规则，永不过期
});

// ── A2 徽章优先级：深夜(22-06) > 节日 > 无 ──
test('A2 徽章状态机：深夜劝睡优先于节日，白天节日挂当日文案，普通日无徽章', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const night = w.nsBadgeAt(new Date('2026-09-25T23:30:00'));   // 中秋深夜
  assert.strictEqual(night.em, '🌙', '深夜时段必须让位给🌙（用户拍板：深夜优先）');
  assert.match(night.tx, /夜深了/);
  const day = w.nsBadgeAt(new Date('2026-09-25T12:00:00'));     // 中秋白天
  assert.strictEqual(day.em, '🌕');
  assert.strictEqual(day.tx, '但愿人长久');
  assert.strictEqual(w.nsBadgeAt(new Date('2026-09-25T05:59:00')).em, '🌙', '05:59 仍在深夜窗');
  assert.ok(w.nsBadgeAt(new Date('2026-09-25T06:01:00')), '06:01 深夜窗关，回到节日徽章');
  assert.strictEqual(w.nsBadgeAt(new Date('2026-09-12T12:00:00')), null, '普通日子无徽章');
});

// ── A3 徽章 DOM 落地：update 后 class/文案/去重（同内容不重播动画）──
test('A3 updateNsBadge 写 DOM：show 类 + data-ns 去重', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const el = w.document.getElementById('nsBadge');
  assert.ok(el, 'header 里应有徽章槽位');
  el.setAttribute('data-ns', '');
  el.classList.remove('show');
  // 直接驱动 DOM 落地函数（时间语义由 A2 覆盖）：测「同内容早退」与「空内容收起」两支纯 DOM 行为。
  w.eval("window.__origBadgeAt = nsBadgeAt;");
  try {
    w.eval("nsBadgeAt = function(){ return NS_FEST_META.night; };");
    w.updateNsBadge();
    assert.ok(el.classList.contains('show'), '有徽章时应挂 show');
    assert.strictEqual(el.querySelector('.ns-be').textContent, '🌙');
    const stamp = el.getAttribute('data-ns');
    w.eval("document.getElementById('nsBadge').classList.remove('show');");
    w.updateNsBadge(); // 同内容 → 早退，不再重播 pop
    assert.ok(!el.classList.contains('show'), '同内容早退不得重挂 show');
    assert.strictEqual(el.getAttribute('data-ns'), stamp);
    w.eval("nsBadgeAt = function(){ return null; };");
    w.updateNsBadge();
    assert.ok(!el.classList.contains('show'), '无徽章必须收起');
  } finally {
    w.eval("nsBadgeAt = window.__origBadgeAt;");
  }
});

// ── A4 数字梗判定（v8.2.1 语义）：纯尾匹配长梗优先；「前一位非数字」规则已删（3点666 误杀源头），
//    连打防重复由监听层 armed 跳变负责（A12 钉）──
test('A4 nsDigitHit：四梗命中；数字前缀/连打尾匹配均命中（armed 层防重爆）；无梗静默', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  assert.strictEqual(w.nsDigitHit('真厉害666'), '🔥');
  assert.strictEqual(w.nsDigitHit('爱你520'), '💕');
  assert.strictEqual(w.nsDigitHit('爱你一生一世1314'), '🎆');
  assert.strictEqual(w.nsDigitHit('哈哈233'), '😂');
  assert.strictEqual(w.nsDigitHit('666'), '🔥', '串首（前面没有字符）应命中');
  assert.strictEqual(w.nsDigitHit('下午3666'), '🔥', 'v8.2.1：数字前缀不再吞梗（用户实锤「3点666」）');
  assert.strictEqual(w.nsDigitHit('6666'), '🔥', '尾匹配命中=语义真；连打不重爆由 armed 挡（A12）');
  assert.strictEqual(w.nsDigitHit('5201314'), '🎆', '长梗优先');
  assert.strictEqual(w.nsDigitHit('2333'), null, '尾 333 非梗');
  assert.strictEqual(w.nsDigitHit('今天记一笔'), null, '无数字完全静默');
});

// ── A5 节日雨：起雨后自清（真条件轮询，禁定值 sleep 判据）──
test('A5 nsRainStart 起雨 30 粒并到时自清；night 无雨', async t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const layer = w.document.getElementById('nsRain');
  w.nsRainStart('cj', 300);
  assert.ok(!layer.classList.contains('hidden'), '雨层应展开');
  assert.strictEqual(layer.querySelectorAll('i').length, 30, '一轮 30 粒');
  const t0 = Date.now();
  while (!layer.classList.contains('hidden')) {
    if (Date.now() - t0 > 3000) assert.fail('雨层未在时长后自清');
    await new Promise(r => setTimeout(r, 30));
  }
  assert.strictEqual(layer.querySelectorAll('i').length, 0, '自清必须清空粒子');
  w.nsRainStart('night', 300); // 深夜无雨（rain 列表为空）
  assert.ok(layer.classList.contains('hidden'));
});

// ── A6 皮肤三态环：类切换/字标/theme-override 皮肤调色板/覆膜层回收 ──
test('A6 nsSetSkin 环：0→1→2→0 每态 DOM 与锁色输出正确，出环覆膜层移除', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const b = w.document.querySelector('header .brand b');
  w.nsSetSkin(1);
  assert.ok(w.document.body.classList.contains('skin-a'));
  assert.strictEqual(b.textContent, 'NOTE-SYNC.EXE');
  let ov = w.document.getElementById('theme-override').textContent;
  assert.ok(/#(8FE3A0|1E5F2D)/.test(ov), 'override 应为 A 调色板（夜荧光绿或日公文绿）');
  assert.ok(ov.includes('Cascadia Mono'), '皮肤应附等宽字体规则');
  assert.ok(w.document.getElementById('skinFx'), 'A 态应有扫描线覆膜层');
  w.nsSetSkin(2);
  assert.ok(w.document.body.classList.contains('skin-b'));
  assert.strictEqual(b.textContent, 'N O T E S Y N C');
  assert.match(w.document.getElementById('skinFx').className, /^paper/, 'B 态覆膜为稿纸导引（日夜档由 A7 显式测）');
  w.nsSetSkin(3); // 7 连点环回 0
  assert.ok(!w.document.body.classList.contains('skin-a') && !w.document.body.classList.contains('skin-b'));
  assert.strictEqual(b.textContent, 'NoteSync');
  assert.strictEqual(w.document.getElementById('skinFx'), null, '回默认必须移除覆膜层');
  ov = w.document.getElementById('theme-override').textContent;
  assert.ok(!ov.includes('Cascadia Mono'), '出环后 override 必须回主主题模板');
});

// ── A7 皮肤 × 强制反色环境：环内绝不借壳，浅色皮肤在反色环境自动走夜变体自保 ──
test('A7 借壳环境+皮肤环：无 theme-shell、body.dark、皮肤夜版调色板；出环恢复借壳', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.localStorage.setItem('notesync_darkshell', '1');
  w.nsSetSkin(1);
  w.applyTheme(false); // 用户语义：日间
  assert.strictEqual(w.document.getElementById('theme-shell'), null, '皮肤环内不得挂借壳滤镜（会把皮肤色反花）');
  assert.ok(w.document.body.classList.contains('dark'), '反色环境里皮肤强制夜变体自保');
  assert.ok(w.document.getElementById('theme-override').textContent.includes('#8FE3A0'), '应为 A 夜版荧光绿');
  assert.ok(w.document.getElementById('skinFx').className.includes('scan'), '夜档扫描线');
  w.nsSetSkin(0);
  w.applyTheme(false);
  assert.ok(w.document.getElementById('theme-shell'), '出环后借壳机制原样恢复');
});

// ── A8 皮肤不持久化（与主题选择同纪律）：localStorage 无 skin 键 + sessionStorage 无写入 ──
test('A8 换肤不写任何 storage：localStorage 无 skin 键、sessionStorage 零写入', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const sesBefore = (() => { const a = []; for (let i = 0; i < w.sessionStorage.length; i++) a.push(w.sessionStorage.key(i)); return a.join(','); })();
  w.nsSetSkin(1); w.nsSetSkin(2); w.nsSetSkin(0);
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = String(w.localStorage.key(i));
    assert.ok(!/skin/i.test(k), '皮肤不得持久化，发现键 ' + k);
  }
  const sesAfter = (() => { const a = []; for (let i = 0; i < w.sessionStorage.length; i++) a.push(w.sessionStorage.key(i)); return a.join(','); })();
  assert.strictEqual(sesAfter.replace(/notejumped|notejumpedkey/ig, ''), sesBefore.replace(/notejumped|notejumpedkey/ig, ''), '换肤不得新增 sessionStorage 键');
});

// ── A9 静态钉：旧版本气泡彩蛋退役干净 + 挂点恰 2 处 + 雨/粒子层在位 ──
test('A9 源码字面量钉：旧彩蛋无残留、钩子恰2处、浮层/字体/表完整', () => {
  assert.ok(!SRC.includes('setupVersionBadge'), 'setupVersionBadge 已退役');
  assert.ok(!SRC.includes("'NoteSync V'"), '版本气泡文案不得残留');
  assert.ok(!/location\.search\.indexOf\('about'\)/.test(SRC), '?about 常显已随旧彩蛋退役');
  assert.strictEqual((SRC.match(/nsFestWelcome\(\);/g) || []).length, 2, '雨钩子恰 2 处（主解锁+离线解锁），新增挂点必同版改此数');
  assert.strictEqual((SRC.match(/return themeOverrideCss|if \(nsSkin\) return nsSkinOverrideCss/g) || []).length, 1, '皮肤分支入口恰 1 处');
  const fest = /const NS_FEST = '([^']*)';/.exec(SRC);
  assert.ok(fest, '节日表在位');
  assert.ok(!fest[1].includes('NS_FEST_TABLE'), '占位符必须已被真实表替换');
  const segs = fest[1].split('|');
  assert.strictEqual(segs.length, 37, '表覆盖 2024-2060 恰 37 年');
  segs.forEach((s, i) => assert.strictEqual(s.slice(0, 4), String(2024 + i), '年份连续'));
  assert.ok(SRC.includes('<div id="nsRain" class="hidden"'), '雨浮层在位');
  assert.ok(SRC.includes('<span id="nsBadge"'), '徽章槽位在位');
  assert.ok(SRC.includes("e instanceof InputEvent"), '数字粒子只认真实打字事件');
  // 用户拍板不做的候选（手速冒火/里程碑纸屑/控制台便利贴）与已删彩蛋（logo 盯鼠标）禁现钉
  for (const dead of ['confetti', 'nsWpm', 'nsMilestone', 'nsConsoleArt', 'setupLogoGaze']) {
    assert.ok(!SRC.includes(dead), '已否决/已删除功能禁现：' + dead);
  }
});

// ── A13 v8.2.1 结构钉：数字粒子=文档捕获阶段+光标前缀判定；移动端徽章出文案；标签回拍板文案 ──
test('A13 v8.2.1：捕获监听+nsCaretPrefix 光标前缀、capture true、≤560 无文案隐藏规则、已恢复默认精确', () => {
  assert.ok(SRC.includes("document.addEventListener('input', (e) => {"), '数字粒子应为 document 级监听');
  assert.ok(SRC.includes('function nsCaretPrefix(container, offset)'), '判定面=自写 TreeWalker 光标前缀（克隆 Range.textContent 在 Chromium 真机返回空串，探针实锤弃用）');
  assert.ok(SRC.includes('const p = nsCaretPrefix(r.startContainer, r.startOffset);'), '监听器接光标前缀函数（三态返回）');
  assert.ok(SRC.includes('if (p === null) return;'), '元素位光标：不爆且不碰 armed');
  assert.ok(SRC.includes('if (!r.collapsed) return;'), '选区覆盖打字：不判状态不碰 armed（复验 P2 收口）');
  assert.ok(SRC.includes('if (e.target !== editor && !(editor.contains && editor.contains(e.target))) return;'), 'document 级监听须按编辑器子树过滤（块 div 才是 input target，v8.2.1 探针实锤）');
  assert.match(SRC, /\}, true\);\s*\nasync function chipActivate/, '监听必须以捕获阶段挂载（true）且紧邻彩蛋段尾');
  assert.ok(!SRC.includes('#nsBadge .ns-bt{display:none}'), 'v8.2.1：移动端不得再隐藏徽章文案（用户拍板）');
  assert.ok(SRC.includes("@media (max-width:560px){ #nsBadge{max-width:min(44vw,190px)"), '移动端徽章应为限宽省略号方案');
  assert.ok(SRC.includes("const LABELS = ['已恢复默认', '复古 · 终端绿', '复古 · 打字机纸'];"), '标签文案=拍板口径（无日夜尾巴）');
  assert.ok(!SRC.includes('header .brand svg{transition'), '盯鼠标遗留 transition 应删净');
});

// ── A10 主主题输出逐字节回归：模板抽取后 themeOverrideCss(false/true) 与 v8.1.8 等价 ──
test('A10 非皮肤态 override 输出不变（模板抽薄的字节级回归钉）', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.nsSetSkin(0);
  w.applyTheme(false);
  const lightCss = w.document.getElementById('theme-override').textContent;
  w.applyTheme(true);
  const darkCss = w.document.getElementById('theme-override').textContent;
  assert.ok(lightCss.includes('background:#FBFBF8!important'), '日间米白底板原样');
  assert.ok(lightCss.includes('#8F7126'), '日间金色 accent 原样');
  assert.ok(darkCss.includes('background:#0F0F11!important'), '夜间墨黑底板原样');
  assert.ok(darkCss.includes('#D4B068'), '夜间暖金 accent 原样');
  assert.ok(!lightCss.includes('Cascadia Mono'), '非皮肤态不得混入等宽规则');
});

// ── A11 闸 P1-1 回归钉：覆膜层与 theme-color 由 applyTheme 统一驱动（环内切日/夜三路径跟随）──
test('A11 环内 applyTheme 翻日夜：#skinFx 档位与 theme-color 同步换，绝不停旧档', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  w.nsSetSkin(1);
  w.applyTheme(false);
  assert.strictEqual(w.document.getElementById('skinFx').className, 'scan light', '日间底层=A 公文档浅墨线');
  assert.ok(w.document.getElementById('theme-override').textContent.includes('#1E5F2D'), 'override 应 A 日版深绿');
  assert.strictEqual(w.document.querySelector('meta[name="theme-color"]').getAttribute('content'), '#F7F8F2', 'theme-color 应随皮肤日版底');
  w.applyTheme(true);
  assert.strictEqual(w.document.getElementById('skinFx').className, 'scan', '切夜间=A 荧光档深线');
  assert.ok(w.document.getElementById('theme-override').textContent.includes('#8FE3A0'), 'override 应换 A 夜版');
  assert.strictEqual(w.document.querySelector('meta[name="theme-color"]').getAttribute('content'), '#0B120C', 'theme-color 应随皮肤夜版底');
  w.nsSetSkin(2); w.applyTheme(true);
  assert.strictEqual(w.document.getElementById('skinFx').className, 'paper night', 'B 夜档暗房');
  w.nsSetSkin(0);
  assert.strictEqual(w.document.getElementById('skinFx'), null, '出环覆膜层必须移除');
});

// ── A12 闸 P1-2 回归钉：数字粒子跳变触发——尾部持续成梗时反复击键只爆一次，脱离后重新上膛 ──
test('A12 持续梗态连续击键只爆发一次；脱离梗形再入才二次爆发（armed 跳变机）', async t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  const fire = () => ed.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  const bursts = () => w.document.querySelectorAll('.ns-burst').length;
  ed.textContent = '房间号233'; fire();
  assert.strictEqual(bursts(), 1, '首次成梗应爆发');
  ed.textContent = '房间号233啊'; fire(); // 尾部脱离梗形 → 解除上膛（同时清掉不弹）
  ed.textContent = '房间号233啊！'; fire();
  assert.strictEqual(bursts(), 1, '脱离后不新增爆发');
  // 重新上膛路径：把尾敲回梗形
  ed.textContent = '房间号233啊233'; fire();
  assert.strictEqual(bursts(), 2, '非态→态跳变应二次爆发');
  // 关键回归（P1-2 主症状）：同一梗态里反复击键不得连爆
  for (let i = 0; i < 5; i++) { ed.textContent = '房间号233啊233'; fire(); }
  assert.strictEqual(bursts(), 2, '持续梗态 5 连击不得再爆（旧实现必连爆）');
  // 持续梗态 5 连击后，簇随各自 1.3s 动画自然自清——轮询到 0 作收尾（真条件，不定值判据）
  const t0 = Date.now();
  while (bursts() > 0) {
    if (Date.now() - t0 > 4000) assert.fail('爆发簇未在 1.3s+ 余量内自清');
    await new Promise(r => setTimeout(r, 60));
  }
});

// ── A14 v8.2.1 行为钉：nsCaretPrefix 三态 + 非编辑器 input 不误吃 + 元素位不爆 ──
test('A14 三态前缀与输入源过滤：文本命中前缀/元素位 null/圈外 false；landingInput 打字零爆发', t => {
  const app = fresh(); t.after(() => app.dom.window.close());
  const w = app.window;
  const ed = w.document.getElementById('editor');
  ed.innerHTML = '';
  const tn = w.document.createTextNode('AB666尾部');
  ed.appendChild(tn);
  assert.strictEqual(w.nsCaretPrefix(tn, 5), 'AB666', '文本节点：命中返回光标前缀');
  assert.strictEqual(w.nsCaretPrefix(tn, 0), '', '光标在文本头：合法空前缀（不许落兜底）');
  assert.strictEqual(w.nsCaretPrefix(ed, 1), null, '元素位容器：null（不爆不解上膛）');
  const foreign = w.document.createElement('span'); // 编辑器外节点
  assert.strictEqual(w.nsCaretPrefix(foreign, 0), false, '不在编辑器文本流：false（走兜底）');
  // 非编辑器 input 反证：editor 尾成串 + 对 landingInput 派发 InputEvent → 必须零爆发
  const li = w.document.getElementById('landingInput');
  ed.textContent = '收尾是233';
  const before = w.document.querySelectorAll('.ns-burst').length;
  li.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  assert.strictEqual(w.document.querySelectorAll('.ns-burst').length, before, '非编辑器输入不得被彩蛋误吃');
});
