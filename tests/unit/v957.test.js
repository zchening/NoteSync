// v9.5.7 守护：启动页真机三坑修复（用户选 A 案保留幕布）——
// ①A12+ 把系统闪屏 AnimatedIcon 放大 288dp 套蒙版裁外圈 1/3，v9.5.6 满幅环被切成"角括号"。
//   v9.5.7 曾改中央 1/3 安全区素材；v9.5.8 甲案再进一步：闪屏纯纸底（透明空图），
//   品牌只由幕布呈现一次，杜绝双源位置跳动。幕布满幅 splash_logo_* 不变。
// ②CoordinatorLayout 默认子参数=WRAP_CONTENT×WRAP_CONTENT+左上 → 幕布塌左上窄条
//   → 显式 MATCH_PARENT addView + 单列 LinearLayout 整体居中（v956 契约测已随版翻转）。
// ③秒开时幕布叠在系统退场动画下即掀，slogan 永不可见
//   → 双条件揭幕（落地+250 与 首帧退场+450 取 max），首帧 OnPreDrawListener 记时刻
//   （postFrameCallback 在 CI android.jar 无符号，两度编译红后换），禁 setOnExitAnimationListener。
// 注：本文件不钉 APP_VERSION/gradle 版本号（历版教训：版本断言归当期守护测 v958，防每版必红）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ACT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/MainActivity.java'), 'utf8');
const STY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/styles.xml'), 'utf8');
const EMPTY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_icon_empty.xml'), 'utf8');
const LOGO_DAY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_logo_day.xml'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SHELL_WWW = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const SHELL_APK = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'), 'utf8');

test('v9.5.7→8 素材链：闪屏=纯纸空图（显式给防 Launcher 回落），幕布=满幅版，安全区素材退役', () => {
  assert.ok(EMPTY.includes('android:viewportWidth="144"'), '空图为 144 画布矢量');
  assert.ok(!EMPTY.includes('<path'), '空图无任何 path（纯透明）');
  assert.ok(STY.includes('windowSplashScreenAnimatedIcon">@drawable/splash_icon_empty'), '日主题指空图（缺省会回落 Launcher 图标，必须显式）');
  assert.ok(!STY.includes('splash_icon_day') && !STY.includes('splash_icon_night'), '中央 1/3 素材已从主题退役');
  assert.ok(!fs.existsSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_icon_day.xml')), 'splash_icon_day.xml 已删');
  assert.ok(!fs.existsSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_icon_night.xml')), 'splash_icon_night.xml 已删');
  assert.ok(STY.includes('windowSplashScreenBackground">@color/splash_bg_night'), '夜变体仍换纸夜色（只留底色差异）');
  assert.ok(LOGO_DAY.includes('android:width="96dp"') && LOGO_DAY.includes('M14.5,35.5v5h-5'), '幕布满幅带尖版原样在位');
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

test('v9.5.7 双壳一致 + slogan 两处同词（心安）', () => {
  assert.ok(SRC.includes('<p class="sub">落笔即心安</p>'), 'landing slogan=心安');
  assert.ok(ACT.includes('R.string.splash_slogan'), '幕布吃同一字符串资源');
  assert.strictEqual(SHELL_WWW.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'www 壳一致');
  assert.strictEqual(SHELL_APK.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'APK 内置壳一致');
});
