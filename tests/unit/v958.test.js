// v9.5.8 守护：四件事（用户拍板）——
// ①slogan 定稿「落笔即心安」（心安=此心安处是吾乡的人本状态，非保险话术"安心"），landing+幕布两处同词；
// ②甲案：系统闪屏改纯纸底（品牌只由幕布呈现一次，杜绝双源环位置跳动）——空图/退役断言在 v957 测；
// ③tank 基地与 bitcoin 创世块弃记事本纸片，改画布品牌图章 nsBrandMark（无尖 F2 形态、纯令牌）；
// ④安装引导单行 hintbar 升级扫码配对同款浮卡（衬线标题+细金线+反相主按钮+以后再说/×双出口）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STR = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/strings.xml'), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const MCP = fs.readFileSync(path.join(ROOT, 'tools/notesync-mcp-server.js'), 'utf8');
const SHELL_WWW = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const SHELL_APK = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'), 'utf8');

test('v9.5.8 ①：slogan 定稿「落笔即心安」两处同词，旧词「安心」网页/资源零残留', () => {
  assert.ok(SRC.includes('<p class="sub">落笔即心安</p>'), 'landing sub=心安');
  assert.ok(!SRC.includes('落笔即安心'), '旧词「安心」网页零残留');
  assert.ok(STR.includes('<string name="splash_slogan">落笔即心安</string>'), '幕布字符串同词（两处同改铁律）');
});

test('v9.5.8 ③：nsBrandMark 图章在位（角度与 favicon 同、纯令牌、无尖档），tank/bitcoin 双接入，纸片画法禁回潮', () => {
  const iDef = SRC.indexOf('function nsBrandMark(');
  assert.ok(iDef > 0, '图章函数在彩蛋层共享作用域');
  const def = SRC.slice(iDef, iDef + 600);
  assert.ok(def.includes('-Math.PI / 6, Math.PI * 2 / 3') && def.includes('Math.PI * 5 / 6, Math.PI * 10 / 6'), '两弧起止角与 favicon 环逐字同');
  assert.ok(def.includes('P.ac') && !/#[0-9a-fA-F]{3,6}/.test(def), '颜色只吃令牌零色值字面量');
  assert.ok(def.includes('Georgia'), '衬线 N');
  assert.ok(def.includes('function nsBrandMark') && iDef > SRC.indexOf('function rr('), '定义在共享工具区（rr 之后两游戏皆可见）');
  const iTank = SRC.indexOf('if (v === 9) { nsBrandMark(');
  assert.ok(iTank > 0, 'tank 基地=品牌图章');
  assert.ok(!SRC.includes('c.moveTo(px + 5, py + u * .45)'), 'tank 旧记事本横线画法禁回潮');
  assert.ok(SRC.includes('nsBrandMark(c, P, 0, 0, 15)'), 'bitcoin 创世块=品牌图章');
  assert.ok(!SRC.includes('c.fillRect(-22, -14, 44, 28)'), 'bitcoin 旧纸片矩形禁回潮');
});

test('v9.5.8 ④：安装卡=浮卡语言四 id 齐、双出口语义分死（以后再说只收会话、× 才永久）、iOS 如实文案未动', () => {
  assert.ok(!SRC.includes('id="installBar" class="hintbar'), '旧单行 hintbar 形态退役');
  assert.ok(SRC.includes('<div class="instcard">'), '浮卡结构在位');
  assert.ok(SRC.includes('#installTitle::after{content:\'\';display:block;width:52px;height:1px;background:var(--accent)'), '衬线标题+细金线（aboutTitle 同款语言）');
  assert.ok(SRC.includes('#installGo{background:var(--fg);color:var(--bg);-webkit-text-fill-color:var(--bg)'), '主按钮反相（提醒「知道了」同款），全令牌');
  assert.ok(SRC.includes('#installMsg{font-size:12.5px;line-height:1.7;color:var(--muted);-webkit-text-fill-color:var(--muted)'), '文字色必配 -webkit-text-fill-color（动态板 body !important fill 会继承压死裸 color，headless 实锤按钮文字隐身）');
  assert.ok(SRC.includes('#installDismiss svg{width:13px;height:13px;display:block}'), 'v800 锚：× svg 档位未动');
  assert.ok(SRC.includes('id="installLater">以后再说<'), '双出口按钮在位');
  const iLater = SRC.indexOf('installLater.addEventListener');
  assert.ok(iLater > 0, '以后再说有处理器');
  const blk = SRC.slice(iLater, SRC.indexOf('});', iLater) + 2);
  assert.ok(blk.includes("installBar.classList.add('hidden')") && !blk.includes('localStorage'), '以后再说=只收本会话，绝不写永久');
  const iDis = SRC.indexOf('installDismiss.addEventListener');
  assert.ok(SRC.slice(iDis, iDis + 200).includes("localStorage.setItem('notesync_install_dismissed', '1')"), '× 仍承担「不再提示」永久语义（pwa P10 契约）');
  assert.ok(SRC.includes('分享菜单选「添加到主屏幕」'), 'iOS 如实指引未动（pwa P9 契约）');
});

test('v9.5.8 三 bump + 双壳一致', () => {
  assert.ok(SRC.includes("const APP_VERSION = '10.0.0';"), 'APP_VERSION 9.5.8');
  assert.ok(GRADLE.includes('versionCode 1000') && GRADLE.includes('versionName "10.0.0"'), 'gradle 958/9.5.8');
  assert.ok(MCP.includes("version: '10.0.0'"), 'mcp serverInfo 9.5.8');
  assert.strictEqual(SHELL_WWW.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'www 壳一致');
  assert.strictEqual(SHELL_APK.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'APK 内置壳一致');
});
