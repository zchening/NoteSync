// v9.5.7 守护：启动页真机三坑修复（用户选 A 案保留幕布）——
// ①A12+ 把系统闪屏 AnimatedIcon 放大 288dp 套蒙版裁外圈 1/3，v9.5.6 满幅环被切成"角括号"
//   → 新建中央 1/3 安全区素材 splash_icon_day/night（144 画布 group 平移 48），styles 改指；
//   幕布继续用满幅 splash_logo_*（ImageView 无蒙版），两套素材各司其职。
// ②CoordinatorLayout 默认子参数=WRAP_CONTENT×WRAP_CONTENT+左上 → 幕布塌左上窄条
//   → 显式 MATCH_PARENT addView + 单列 LinearLayout 整体居中（v956 契约测已随版翻转）。
// ③秒开时幕布叠在系统退场动画下 250ms 即掀，slogan 永不可见
//   → 双条件揭幕（落地+250 与 首帧退场+450 取 max），首帧用 postFrameCallback 记时刻，
//   禁 setOnExitAnimationListener（会接管吞掉系统 radial-wipe 退场）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ACT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/MainActivity.java'), 'utf8');
const STY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/styles.xml'), 'utf8');
const ICON_DAY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_icon_day.xml'), 'utf8');
const ICON_NIGHT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_icon_night.xml'), 'utf8');
const LOGO_DAY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_logo_day.xml'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const SHELL_WWW = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const SHELL_APK = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'), 'utf8');

test('v9.5.7 素材分职：闪屏=中央1/3安全区版，幕布=满幅版，styles 指向正确', () => {
  for (const [ic, hex] of [[ICON_DAY, '#8F7126'], [ICON_NIGHT, '#D4B068']]) {
    assert.ok(ic.includes('android:width="144dp"') && ic.includes('android:viewportWidth="144"'), '144 画布');
    assert.ok(ic.includes('android:translateX="48"') && ic.includes('android:translateY="48"'), '内容 group 平移 48 占中央 1/3（A12+ 288 足迹裁外圈 1/3 仍完整）');
    assert.ok(ic.includes('M40.5,14.5A19,19 0 0,1 14.5,40.5') && ic.includes('M14.5,35.5v5h-5'), '带箭尖全细节几何与满幅版逐字同');
    assert.ok(ic.includes(hex), '主色 ' + hex);
  }
  assert.ok(STY.includes('windowSplashScreenAnimatedIcon">@drawable/splash_icon_day'), '日主题指安全区版');
  assert.ok(STY.includes('windowSplashScreenAnimatedIcon">@drawable/splash_icon_night'), '夜变体指安全区夜版');
  assert.ok(!LOGO_DAY.includes('viewportWidth="144"'), '满幅版未被误改（幕布 96dp ImageView 用）');
});

test('v9.5.7 揭幕调度：双条件取 max、未落地不调度、重排撤旧帖、退场只记不驱动', () => {
  assert.ok(ACT.includes('private void scheduleCurtainDrop()'), '调度器在位');
  assert.ok(ACT.includes('if (curtainPageDoneAt == 0) return;'), '页面未落地直接不调度（错误即掀/15s 兜底独立驱动）');
  assert.ok(ACT.includes('long when = curtainPageDoneAt + 250;') && ACT.includes('when = Math.max(when, curtainSplashExitAt + 450);'), 'max(落地+250, 退场+450)');
  assert.ok(ACT.includes('if (curtainDropPending != null) h.removeCallbacks(curtainDropPending);'), '重排必撤旧帖（防先到的短延时提前掀幕）');
  const iFrame = ACT.indexOf('addOnPreDrawListener');
  assert.ok(iFrame > 0 && ACT.slice(iFrame, iFrame + 300).includes('markSplashExit.run()'), 'OnPreDraw 首帧委托统一记时块');
  assert.ok(ACT.includes('removeOnPreDrawListener(this)') && ACT.slice(ACT.indexOf('onPreDraw'), ACT.indexOf('onPreDraw') + 400).includes('return true'), '首帧后自摘且放行绘制');
  const iMark = ACT.indexOf('final Runnable markSplashExit');
  assert.ok(iMark > 0 && ACT.slice(iMark, iMark + 300).includes('curtainSplashExitAt =') && ACT.slice(iMark, iMark + 300).includes('scheduleCurtainDrop()'), '记时块只写时间戳+交调度，不直接掀幕');
  assert.ok(!ACT.includes('setOnExitAnimationListener'), 'exit listener 禁用（31+ 接管吞系统 radial-wipe 退场）');
  assert.ok(!ACT.includes('postFrameCallback('), 'postFrameCallback 禁回潮（CI android.jar 无此符号，两次编译红实锤）');
  assert.ok(ACT.includes('if (!splashCurtainUp || isFinishing() || isDestroyed()) return;'), 'scheduleCurtainDrop 存活+挂旗双护栏');
});

test('v9.5.7 构建失败不再静默：catch 记 Log.w', () => {
  assert.ok(ACT.includes('android.util.Log.w("NoteSync", "splash curtain build failed", t)'), '真机排查有痕');
});

test('v9.5.7 三 bump + 双壳 + slogan 未动', () => {
  assert.ok(SRC.includes("const APP_VERSION = '9.5.7';"), 'APP_VERSION 9.5.7');
  assert.ok(GRADLE.includes('versionCode 957') && GRADLE.includes('versionName "9.5.7"'), 'gradle 957/9.5.7');
  assert.ok(SRC.includes('<p class="sub">落笔即安心</p>'), 'landing slogan 未动');
  assert.strictEqual(SHELL_WWW.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'www 壳一致');
  assert.strictEqual(SHELL_APK.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'APK 内置壳一致');
});
