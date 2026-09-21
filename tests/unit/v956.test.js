// v9.5.6 守护：启动页纸墨化（用户拍板方案 A2 + slogan「落笔即心安」）——
// ①系统 SplashScreen 正规启用（纸底+带箭尖环，时间制 Day/Night 显式变体，install 先于 super.onCreate）；
// ②原生 A2 幕布（环+字标+金细线+slogan 盖加载期，落地 250ms 淡出，12s 硬超时，错误页立即掀幕）；
// ③网页首页 landing sub 换 slogan（功能句退役，信任行仍承载功能语义）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ACT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/cn/xuyinji/notesync/MainActivity.java'), 'utf8');
const STY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/styles.xml'), 'utf8');
const COL = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/colors.xml'), 'utf8');
const STR = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/strings.xml'), 'utf8');
const LOGO_DAY = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_logo_day.xml'), 'utf8');
const LOGO_NIGHT = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/splash_logo_night.xml'), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
const SHELL_WWW = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const SHELL_APK = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/public/index.html'), 'utf8');

test('v9.5.6 网页：landing sub=「落笔即心安」、旧功能句 sub 退役、三 bump 到位', () => {
  assert.ok(SRC.includes('<p class="sub">落笔即心安</p>'), 'landing sub 已换 slogan');
  assert.ok(!SRC.includes('<p class="sub">端到端加密 · 多设备同步</p>'), '旧功能句 sub 不残留（功能语义由底部信任行承载）');
  assert.ok(SRC.includes("const APP_VERSION = '10.0.3';"), 'APP_VERSION 9.5.6');
  assert.ok(GRADLE.includes('versionCode 1003') && GRADLE.includes('versionName "10.0.3"'), 'gradle 956/9.5.6');
});

test('v9.5.6 原生①：installSplashScreen 先于 super.onCreate、时间规则与 JS 逐字同、异常有 try 护栏', () => {
  const iInstall = ACT.indexOf('androidx.core.splashscreen.SplashScreen.installSplashScreen(this)');
  const iSuper = ACT.indexOf('super.onCreate(savedInstanceState)');
  assert.ok(iInstall > 0, 'installSplashScreen 在位');
  assert.ok(iInstall < iSuper, 'install 必须先于 super.onCreate（官方姿势）');
  assert.ok(ACT.includes('splashMin < 420 || splashMin >= 1140'), '原生时间规则 420/1140');
  assert.ok(SRC.includes('mm<420||mm>=1140'), 'JS head boot 同规则未漂移');
  assert.ok(SRC.includes('const THEME_DAY_START = 7 * 60;') && SRC.includes('const THEME_NIGHT_START = 19 * 60;'), 'JS 主脚本常量同源');
  assert.ok(ACT.includes('setTheme(splashNight ? R.style.AppTheme_NoActionBarLaunch_Night : R.style.AppTheme_NoActionBarLaunch_Day)'), '按时间规则选显式变体（不跟随系统）');
  assert.ok(ACT.includes('final boolean splashNight'), 'splashNight 声明一次供主题+幕布共用（与后文 bootNight 不重名）');
});

test('v9.5.6 原生②：A2 幕布契约（v9.5.7 重构版）——单列全屏/双条件揭幕/错误即掀/幂等旗标', () => {
  assert.ok(ACT.includes('splashCurtain = curtain') && ACT.includes('splashCurtainUp = true'), '幕布挂旗');
  assert.ok(ACT.includes('R.string.splash_slogan') && ACT.includes('R.drawable.splash_logo_night'), '幕布吃 slogan 与满幅夜环素材');
  assert.ok(ACT.includes('curtain.setOrientation(android.widget.LinearLayout.VERTICAL)') && ACT.includes('curtain.setGravity(android.view.Gravity.CENTER)'), '单列整体居中（弃 center+topMargin 下沉算式）');
  assert.ok(ACT.includes('parent.addView(curtain, new android.view.ViewGroup.LayoutParams('), '显式全屏参数（CoordinatorLayout 默认 WC×WC 塌左上，真机实锤）');
  assert.ok(!ACT.includes('parent.addView(curtain);'), '裸 addView 禁回潮');
  assert.ok(!ACT.includes('92 * dens') && !ACT.includes('174 * dens'), '两代错误下沉算式均禁回潮');
  assert.ok(ACT.includes('wm.setMaxLines(1)') && ACT.includes('sg.setMaxLines(1)'), '字标/slogan 锁单行防折');
  assert.ok(ACT.includes('}, 15000);'), '15s 硬超时兜底');
  assert.ok(ACT.includes('curtainPageDoneAt + 250') && ACT.includes('curtainSplashExitAt + 450'), '双条件：落地+250 与 退场+450 取 max');
  assert.ok(ACT.includes('if (curtainPageDoneAt == 0) return;'), '页面未落地不调度（错误/15s 兜底管）');
  assert.ok(ACT.includes('addOnPreDrawListener') && !ACT.includes('setOnExitAnimationListener'), '首帧 OnPreDrawListener 记退场时刻；exit listener 禁用（会吞 A12+ radial-wipe）');
  assert.ok(ACT.includes('h.removeCallbacks(curtainDropPending)'), '重排撤旧帖（短延时不得提前掀）');
  assert.ok(ACT.includes('MainActivity.this.scheduleCurtainDrop()'), '匿名 client 内显式外嵌 this（历版教训）');
  assert.ok(ACT.includes('if (!splashCurtainUp) return;'), 'drop 幂等短路（重复导航/超时/错误不互踩）');
  const iErr = ACT.indexOf('fallback.setVisibility(View.VISIBLE);');
  assert.ok(ACT.slice(iErr, iErr + 400).includes('dropSplashCurtain'), '错误兜底页出现即掀幕（绕过 dwell），重试按钮不被压');
});

test('v9.5.6 主题：SplashScreen 四属性齐、bitmap 退役、Night 变体换纸夜+夜金', () => {
  assert.ok(STY.includes('parent="Theme.SplashScreen"'), '启动主题父=Theme.SplashScreen');
  assert.ok(STY.includes('windowSplashScreenBackground') && STY.includes('windowSplashScreenAnimatedIcon') && STY.includes('postSplashScreenTheme'), 'compat 三属性（无 android: 前缀）齐');
  assert.ok(STY.includes('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>'), 'postSplash 交回 NoActionBar');
  assert.ok(!STY.includes('@drawable/splash</item>'), '旧 Capacitor 位图闪屏退役（精确锚，不误伤 splash_logo_*）');
  assert.ok(STY.includes('AppTheme.NoActionBarLaunch.Night') && STY.includes('@color/splash_bg_night'), '夜变体在位');
});

test('v9.5.6 资源：环=带箭尖全细节版、日夜色与 THEME_PALETTE 同值、slogan 字符串在位', () => {
  for (const [logo, hex] of [[LOGO_DAY, '#8F7126'], [LOGO_NIGHT, '#D4B068']]) {
    assert.ok(logo.includes('M14.5,35.5v5h-5') && logo.includes('M33.5,12.5v-5h5'), '直角箭尖两笔在位（≥40px 全细节版，非 16px 弃尖版）');
    assert.ok(logo.includes('A19,19 0 0,1') && logo.includes('strokeWidth="2.3"'), '双弧环 2.3 描边');
    assert.ok(logo.includes('M18.72,16.96h2.2l6.16,11V16.96h2.2v14.08h-2.2l-6.16,-11V31.04h-2.2Z'), '衬线 N 与 index.html landing 逐字同');
    assert.ok(logo.includes(hex), '主色 ' + hex);
  }
  assert.ok(COL.includes('#FBFBF8') && COL.includes('#0F0F11') && COL.includes('#1C1C1A') && COL.includes('#E9E8E3') && COL.includes('#98958A') && COL.includes('#7A786F'), '四对色与 THEME_PALETTE 逐值同');
  assert.ok(STR.includes('<string name="splash_slogan">落笔即心安</string>'), 'slogan 资源与 landing 同词');
});

test('v9.5.6 双壳一致：www 与 APK 内置壳 = 根 index.html 同字节（含 slogan+9.5.6）', () => {
  assert.strictEqual(SHELL_WWW.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'www 壳与根一致');
  assert.strictEqual(SHELL_APK.replace(/\r\n/g, '\n'), SRC.replace(/\r\n/g, '\n'), 'APK 内置壳与根一致');
});
