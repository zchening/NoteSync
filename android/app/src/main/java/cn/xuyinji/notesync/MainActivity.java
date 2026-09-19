package cn.xuyinji.notesync;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import cn.xuyinji.notesync.rem.RemPlugin;
import cn.xuyinji.notesync.img.ImgClipPlugin;
import cn.xuyinji.notesync.img.ImgSavePlugin;
import cn.xuyinji.notesync.link.LinkOpenPlugin;
import cn.xuyinji.notesync.update.UpdatePlugin;

public class MainActivity extends BridgeActivity {

    private boolean pendingRemNotifyClick = false;
    private static final String MAIN_DOC_CACHE = "cached_index.html";
    private static final String MAIN_DOC_ETAG = "cached_index.etag"; // v9.5.5：条件请求用弱/强 ETag 存文（fetchMainDoc 304 链路）
    // v9.5.4 启动自愈：①WebView 渲染进程被 MIUI 幻影进程查杀/系统冻结杀死后画布全白全黑不自复——
    // 零 onRenderProcessGone 处理是根因，进程内只允许一次 recreate 防重建循环；
    // ②后台超 10 分钟回前台主动 reload，兜「冻而未死」（JS 定时器停摆、keep-alive socket 半死）灰区。
    // 闸 R1/R2 双路命中：必须 static——recreate() 后新实例字段归零，实例旗标的「进程内一次」不成立，
    // 渲染进程慢性被杀会变成 recreate 死循环；static 才是真·进程级一次。
    private static boolean didRendererGoneRecreate = false;
    private long pausedAt = 0;
    // v9.5.5 首载 watchdog：Capacitor 在 super.onCreate 内就发起首载（早于 setWebViewClient），
    // 半死 socket 下首载绕过拦截器、无超时保护 → 全白很久。此标志随主文档 onPageFinished 置真；
    // 装完 client 后 postDelayed 探测，若首载迟迟不落地则 stopLoading+loadUrl 重走带超时的拦截器三级兜底。
    private volatile boolean mainFrameDone = false;

    // v9.5.6 启动页②：原生 A2 幕布（纸底+品牌环+字标+金细线+slogan），盖住 WebView 加载期。
    // v9.5.7 揭幕时机：页面落地≥250ms 且 系统闪屏退场(≈App 首帧)≥450ms 双条件才掀（slogan 必须被看见）；
    // 首帧回调没来（ROM 差异）则退化为 v9.5.6 时机不硬等；15s 硬超时与错误兜底页即掀不变。
    private View splashCurtain;
    private volatile boolean splashCurtainUp = false;
    private volatile long curtainPageDoneAt = 0L;
    private volatile long curtainSplashExitAt = 0L;
    private Runnable curtainDropPending;

    // v9.5.7：双条件调度揭幕——两个信号（页面落地/首帧退场）各自到达时都调它，取 max 重排；
    // 重排前撤旧帖（否则先到的短延时会把幕布提前掀掉）。页面未落地不调度（错误/15s 兜底管）。
    private void scheduleCurtainDrop() {
        if (!splashCurtainUp || isFinishing() || isDestroyed()) return;
        if (curtainPageDoneAt == 0) return;
        final long now = android.os.SystemClock.elapsedRealtime();
        long when = curtainPageDoneAt + 250;
        if (curtainSplashExitAt > 0) when = Math.max(when, curtainSplashExitAt + 450);
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        if (curtainDropPending != null) h.removeCallbacks(curtainDropPending);
        curtainDropPending = new Runnable() {
            @Override public void run() { curtainDropPending = null; dropSplashCurtain(); }
        };
        h.postDelayed(curtainDropPending, Math.max(0, when - now));
    }

    // v9.5.6：掀幕（幂等）——落地/失败/超时三方共用，淡出后必 remove，绝不吞异常卡启动链。
    // 仅可在主线程调用（三处调用点均已在主线程 Handler/WebView 回调上）。
    private void dropSplashCurtain() {
        if (!splashCurtainUp) return;
        splashCurtainUp = false;
        final View c = splashCurtain;
        splashCurtain = null;
        if (c == null) return;
        try {
            c.animate().alpha(0f).setDuration(300).withEndAction(new Runnable() {
                @Override public void run() {
                    try {
                        android.view.ViewGroup vg = (android.view.ViewGroup) c.getParent();
                        if (vg != null) vg.removeView(c);
                    } catch (Throwable ignored) { }
                }
            }).start();
        } catch (Throwable ignored) {
            try {
                android.view.ViewGroup vg = (android.view.ViewGroup) c.getParent();
                if (vg != null) vg.removeView(c);
            } catch (Throwable t) { }
        }
    }

    // v5.56：离线兜底诊断计数（JS 端 ?diag 经 RemPlugin.cacheInfo 只读——定位兜底断在哪一环）
    public static volatile int interceptCount = 0;
    public static volatile int fetchFailCount = 0;
    public static volatile int cacheHitCount = 0;
    public static volatile int assetHitCount = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v9.5.6 启动页①：正规启用系统 SplashScreen（纸底+带箭尖品牌环）承接冷启空窗。
        // 日夜按时间规则（<420 分或 >=1140 分=夜），与 JS shouldBeDark、下方 v9.5.5 WebView 表面
        // 预置块逐字同规则——本 App 夜不跟随系统，故 setTheme 显式选变体再 install（官方
        // setTheme-before-onCreate 模式，<31 由 androidx 读当前主题、31+ 平台首帧同认）。
        // 整块 try/catch：任何意外退回 manifest 基础主题（仍是纸底+环+日间色），绝不影响既有启动链。
        java.util.Calendar splashCal = java.util.Calendar.getInstance();
        int splashMin = splashCal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + splashCal.get(java.util.Calendar.MINUTE);
        final boolean splashNight = splashMin < 420 || splashMin >= 1140;
        try {
            setTheme(splashNight ? R.style.AppTheme_NoActionBarLaunch_Night : R.style.AppTheme_NoActionBarLaunch_Day);
            androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        } catch (Throwable ignored) { }
        // v5.51：注册自定义提醒桥（Capacitor 7 也支持自动扫描，显式注册更稳）
        registerPlugin(RemPlugin.class);
        registerPlugin(ImgClipPlugin.class); // v7.7.0：图片写系统剪贴板原生桥
        registerPlugin(ImgSavePlugin.class); // v9.2.0：正文图片保存到相册原生桥（零新权限，壳内 a[download] 是哑弹）
        registerPlugin(LinkOpenPlugin.class); // v8.1.0：链接打开方式（外跳默认浏览器/应用内子 WebView）
        registerPlugin(UpdatePlugin.class); // v9.3.0：应用内升级原生桥（DownloadManager 下 APK + FileProvider 拉安装）
        super.onCreate(savedInstanceState);

        // v5.53：返回键接 WebView 历史——Capacitor 不接管返回键，默认 finish 直接回桌面。
        // 笔记页按返回 → 回首页（自动跳转时 assign 留下的历史）；首页再按 → 退出。
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = (bridge != null) ? bridge.getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                } else {
                    finish();
                }
            }
        });

        // 离线兜底页：断网/服务器不可达时 WebView 白屏，显示重试界面
        if (bridge == null) return;
        WebView wv = bridge.getWebView();
        if (wv == null) return;

        // v9.3.8：关闭 WebView 强制/算法深色——国产 ROM「浅色检测型反色」会把图片查看器里的浅色按钮
        // （保存到相册）单独翻色，导致浅底配浅字/黑底配黑字看不清。关掉后 WebView 按作者 CSS 原样渲染，
        // App 自带日夜由 JS 的 body.dark 管，系统强制深色不再作用于本 App。整段 try/catch(Throwable)：
        // 缺类/缺 API 时静默降级，绝不崩启动。
        try {
            android.webkit.WebSettings ws = wv.getSettings();
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                androidx.webkit.WebSettingsCompat.setAlgorithmicDarkeningAllowed(ws, false);
            } else if (android.os.Build.VERSION.SDK_INT >= 29) {
                androidx.webkit.WebSettingsCompat.setForceDark(ws, androidx.webkit.WebSettingsCompat.FORCE_DARK_OFF);
            }
        } catch (Throwable ignored) { }

        ViewGroup parent = (ViewGroup) wv.getParent();
        if (parent == null) return;
        final View fallback = getLayoutInflater().inflate(R.layout.activity_offline, parent, false);
        parent.addView(fallback);
        fallback.setVisibility(View.GONE);
        fallback.findViewById(R.id.btn_retry).setOnClickListener(v -> {
            fallback.setVisibility(View.GONE);
            wv.reload();
        });

        // v9.5.7 启动页②：A2 原生幕布（重构，真机三坑见下）。环=满幅矢量 splash_logo_* 96dp，
        // 衬线字标 19sp+金细线 34dp+slogan 12sp 单列整体居中（色值同 THEME_PALETTE/DayNight 变体）。
        // 揭幕=页面落地≥250ms 且 首帧退场≥450ms 双条件（scheduleCurtainDrop），15s 硬超时兜底，
        // 错误兜底页即掀；构建失败 Log.w 不再静默。系统闪屏另用中央 1/3 安全区素材 splash_icon_*。
        try {
            final float dens = getResources().getDisplayMetrics().density;
            android.widget.LinearLayout curtain = new android.widget.LinearLayout(this);
            curtain.setOrientation(android.widget.LinearLayout.VERTICAL);
            curtain.setGravity(android.view.Gravity.CENTER);
            curtain.setBackgroundColor(splashNight ? 0xFF0F0F11 : 0xFFFBFBF8);
            android.widget.ImageView ring = new android.widget.ImageView(this);
            ring.setImageResource(splashNight ? R.drawable.splash_logo_night : R.drawable.splash_logo_day);
            curtain.addView(ring, new android.widget.LinearLayout.LayoutParams(
                    (int)(96 * dens + 0.5f), (int)(96 * dens + 0.5f)));
            android.widget.TextView wm = new android.widget.TextView(this);
            wm.setText(R.string.app_name);
            wm.setTypeface(android.graphics.Typeface.SERIF);
            wm.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 19);
            wm.setLetterSpacing(0.14f);
            wm.setMaxLines(1);
            wm.setTextColor(splashNight ? 0xFFE9E8E3 : 0xFF1C1C1A);
            android.widget.LinearLayout.LayoutParams wlp = new android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
            wlp.topMargin = (int)(18 * dens + 0.5f);
            curtain.addView(wm, wlp);
            View hair = new View(this);
            android.widget.LinearLayout.LayoutParams hlp = new android.widget.LinearLayout.LayoutParams(
                    (int)(34 * dens + 0.5f), Math.max(1, (int)(1 * dens + 0.5f)));
            hlp.topMargin = (int)(15 * dens + 0.5f);
            hair.setLayoutParams(hlp);
            hair.setBackgroundColor(splashNight ? 0x80D4B068 : 0x808F7126);
            curtain.addView(hair);
            android.widget.TextView sg = new android.widget.TextView(this);
            sg.setText(R.string.splash_slogan);
            sg.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12);
            sg.setLetterSpacing(0.30f);
            sg.setMaxLines(1);
            sg.setTextColor(splashNight ? 0xFF7A786F : 0xFF98958A);
            android.widget.LinearLayout.LayoutParams sgp = new android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
            sgp.topMargin = (int)(13 * dens + 0.5f);
            curtain.addView(sg, sgp);
            // 显式 MATCH_PARENT：CoordinatorLayout 默认子参数=WRAP_CONTENT×WRAP_CONTENT+左上，
            // v9.5.6 裸 addView 真机塌成左上窄条（字标折成「NoteS」、金线/slogan 被裁）。
            parent.addView(curtain, new android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT));
            splashCurtain = curtain;
            splashCurtainUp = true;
            // App 首帧≈系统闪屏退场启动时刻：只记时间戳供双条件调度；
            // 禁用退场动画接管监听（31+ 上会接管并吞掉系统 radial-wipe 退场动画）。
            // 首帧探测用 ViewTreeObserver.OnPreDrawListener（自 API1 存在，首次绘制前恰发一次，
            // 自摘）——View.postFrameCallback 在 CI 的 android.jar 无此符号（24/31 版本口径文档打架），
            // 本机无 SDK 肉眼过两次皆红，CI 编译是终裁，换零悬念 API。
            final Runnable markSplashExit = new Runnable() {
                @Override public void run() {
                    curtainSplashExitAt = android.os.SystemClock.elapsedRealtime();
                    scheduleCurtainDrop();
                }
            };
            final View curtainDv = getWindow().getDecorView();
            curtainDv.getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener() {
                @Override public boolean onPreDraw() {
                    try { curtainDv.getViewTreeObserver().removeOnPreDrawListener(this); } catch (Throwable ignored) { }
                    markSplashExit.run();
                    return true;
                }
            });
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override public void run() { dropSplashCurtain(); }
            }, 15000);
        } catch (Throwable t) {
            android.util.Log.w("NoteSync", "splash curtain build failed", t);
        }

        wv.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // v5.55 离线 P0 修复：主文档 native 层缓存，替代不可靠的 WebView SW 兜底。
                // 现象（v5.52~5.54）：server.url 直连线上，断网时主文档加载失败 → onReceivedError
                // 盖上原生"网络连接失败"页 → JS 的 notesync_cache_* 离线缓存体系根本没机会跑。
                // 修法：联网时 native 自己 fetch 线上 HTML 并落盘；断网/失败时回本地缓存文件，
                // 页面照常打开，JS 照常跑（localStorage origin 不变），离线阅读生效。
                // 热更新不受影响：联网时永远先拿线上最新版。
                // v8.1.0 同源白名单：主文档缓存链路只许笔记域走（note/biji 双域同库）。
                // 无白名单时「应用内打开外站」的整页 GET 也会被 fetchMainDoc+saveMainDoc 当笔记主页缓存——
                // 断网启动兜底页变成外站 HTML（离线 P0 级污染）。外站请求落 super 正常加载。
                String host = request.getUrl().getHost();
                boolean appHost = "note.xuyinji.com.cn".equals(host) || "biji.xuyinji.com.cn".equals(host);
                if (appHost && request.isForMainFrame() && "GET".equalsIgnoreCase(request.getMethod())) {
                    interceptCount++;
                    try {
                        byte[] bytes = fetchMainDoc(request.getUrl().toString());
                        if (bytes != null && bytes.length == 0) {
                            // v9.5.5：304 条件命中——磁盘缓存仍新鲜，直接吐缓存（冷启主文档传输≈0），不计失败
                            byte[] fresh = readMainDoc();
                            if (fresh != null && fresh.length > 0) {
                                cacheHitCount++;
                                return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(fresh));
                            }
                        } else if (bytes != null && bytes.length > 0) {
                            saveMainDoc(bytes);
                            return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(bytes));
                        }
                    } catch (Exception ignored) { }
                    fetchFailCount++;
                    byte[] cached = readMainDoc();
                    if (cached != null && cached.length > 0) {
                        cacheHitCount++;
                        return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(cached));
                    }
                    // v5.56 三级兜底：磁盘缓存也没有（首装未联网/数据被清/旧版拦截器从未生效）→ 回 APK 内置壳。
                    // CI 构建时 cap sync 已把当版 index.html 打进 assets/public，壳必然存在；
                    // 壳起后 JS 的 notesync_cache_* 离线缓存接管正文，「网络连接失败」页近乎不可达。
                    byte[] asset = readAssetMainDoc();
                    if (asset != null && asset.length > 0) {
                        assetHitCount++;
                        return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(asset));
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                // 走到这里 = 联网失败且本地也无缓存（仅首次安装从未联网过的极端场景）
                if (request.isForMainFrame()) {
                    fallback.setVisibility(View.VISIBLE);
                    // v9.5.6：兜底页与幕布平级——立刻掀幕，重试按钮绝不被压在幕布后
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable() {
                        @Override public void run() { MainActivity.this.dropSplashCurtain(); }
                    });
                }
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                mainFrameDone = false; // v9.5.5：每次导航开始复位，供首载 watchdog 判本轮是否落地
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                mainFrameDone = true;  // v9.5.5：主文档落地，watchdog 不再补重载
                // v9.5.7：记页面落地时刻，交双条件调度器定掀幕点（落地+250 与 退场+450 取 max；
                // 匿名 client 内必须 MainActivity.this）
                curtainPageDoneAt = android.os.SystemClock.elapsedRealtime();
                MainActivity.this.scheduleCurtainDrop();
                super.onPageFinished(view, url);
            }

            // v9.5.4 启动自愈：MIUI 幻影进程查杀/系统冻结会杀掉 WebView 渲染进程，画布留全白/全黑死屏。
            // 不消费此回调＝某些版本按未处理直接杀整 App，处理了不重建也永远白屏。
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (!didRendererGoneRecreate) {
                    didRendererGoneRecreate = true;
                    try {
                        if (view != null) {
                            android.view.ViewParent vp = view.getParent();
                            if (vp instanceof ViewGroup) ((ViewGroup) vp).removeView(view);
                            view.destroy();
                        }
                    } catch (Throwable ignored) { }
                    try { recreate(); return true; } catch (Throwable ignored) { }
                }
                // v9.5.5：进程内已重建过一次仍再死（渲染进程被反复查杀的极端机型）→ 静默 finish 像闪退，补一条提示
                try { android.widget.Toast.makeText(MainActivity.this, "界面渲染异常，请重新打开", android.widget.Toast.LENGTH_LONG).show(); } catch (Throwable ignored) { }
                try { finish(); } catch (Throwable ignored) { }
                return true;
            }
        });

        // v5.57 离线 P0 根治：super.onCreate() 一执行 Capacitor 立刻发起首次主文档加载，
        // 上面 setWebViewClient 装得太晚 → 每次冷启动主文档都绕过拦截器，
        // 磁盘缓存永远写不进（真机诊断 mainDocCache=none 实锤，intercept 计数恒 0）。
        // 装完 client 后发现缓存不存在就补一次 reload：这次加载走拦截器，缓存落盘，
        // 三级兜底（联网→磁盘→APK 内置壳）自此真正激活。进程内布尔防循环。
        if (!didCacheBootstrapReload && !new java.io.File(getFilesDir(), MAIN_DOC_CACHE).exists()) {
            didCacheBootstrapReload = true;
            wv.reload();
        }

        // v9.5.5 ⑩ WebView 表面背景预置：默认白底在夜间冷启首帧前露出白闪（windowBackground 管不到
        // WebView 自身表面）。按与 shouldBeDark/head boot 同一时间规则预置夜色，首帧起就是对的底色。
        try {
            java.util.Calendar bootCal = java.util.Calendar.getInstance();
            int bootMin = bootCal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + bootCal.get(java.util.Calendar.MINUTE);
            boolean bootNight = bootMin < 420 || bootMin >= 1140;
            wv.setBackgroundColor(bootNight ? 0xFF0F0F11 : 0xFFFBFBF8);
        } catch (Throwable ignored) { }

        // v9.5.5 ⑧ 首载 watchdog（「全白很久」根治）：Capacitor 首载在 super.onCreate 内发起，早于
        // setWebViewClient——绕过拦截器的 3+6s 超时与三级兜底，半死 socket 下 Chromium 自身无应用层
        // 读超时（分钟级）。6s 主文档仍未 onPageFinished → stopLoading+loadUrl 当前目标重走拦截器：
        // 联网 3+6s 封顶 → 磁盘缓存 → 内置壳，白屏总封顶从「无限」压到 ~15s 内必有页面。
        final WebView wvBoot = wv;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() {
                if (mainFrameDone || wvBoot == null || isFinishing() || isDestroyed()) return;
                try {
                    String cur = wvBoot.getUrl();
                    wvBoot.stopLoading();
                    wvBoot.loadUrl(cur != null && cur.startsWith("http") ? cur : "https://biji.xuyinji.com.cn/");
                } catch (Throwable ignored) { }
            }
        }, 6000);

        // v6.0：冷启动也接住通知点击（进程被杀后点通知拉起 APP，intent 走 onCreate 不走 onNewIntent）
        // v6.3 P1 根治「点通知有时进错笔记」：此前首屏加载根页后，JS 的「自动进入上次笔记」
        // (NOTE_LAST_KEY→assign('/B')) 与原生 rem-notify-click→assign('/A') 两个 location.assign
        // 竞速，谁的导航后 commit 谁赢（取决于网络/缓存时序）——有时 A 有时 B。
        // 修法：带 ACTION_NOTIFY_CLICK 冷启时首屏 URL 直接定到 '/'+noteId，根页竞速彻底消失；
        // 热启动路径（onNewIntent→rem-notify-click 事件）保留不变。
        Intent cold = getIntent();
        if (cold != null && RemPlugin.ACTION_NOTIFY_CLICK.equals(cold.getAction())) {
            pendingRemNotifyClick = true;
            String nid = cold.getStringExtra("noteId");
            if (nid != null && nid.matches("[A-Za-z0-9_-]{1,64}") && bridge != null && bridge.getWebView() != null) {
                String base = bridge.getAppUrl();
                if (base != null && base.length() > 0 && !base.endsWith("/")) {
                    final String target = base + "/" + nid;
                    android.util.Log.d("NoteSync", "cold-start notify click -> direct load: " + target);
                    bridge.getWebView().post(() -> {
                        if (bridge.getWebView() != null) bridge.getWebView().loadUrl(target);
                    });
                }
            }
        }

        // v8.1.0 App Links（§K2 另一半）：assetlinks 校验通过后点笔记域链接直达 APK——intent 里的 URL
        // 必须转发给 WebView，否则「开了 App 却落错页」（根页/上次笔记）。冷启沿用 v6.3 防竞速范式
        // post 直载目标；热启（singleTop）走 onNewIntent。只认双域 https，其余不转发（钓鱼链接不进 App）。
        // 闸R1-P1：转发前 origin 归一到 App 自身域（server.url=biji）——note 域链接若原样直载，
        // WebView 换源后 localStorage 按 origin 隔离（密钥/缓存/草稿全另一套）=「直达即锁屏」，
        // 老人用户比落浏览器更糟。path/query/fragment 原样保留，只换 scheme+authority。
        Intent link = getIntent();
        if (isAppLink(link)) {
            final String target = appLinkTarget(link.getData().toString());
            if (target != null && bridge != null && bridge.getWebView() != null) {
                android.util.Log.d("NoteSync", "cold-start app link -> direct load: " + target);
                bridge.getWebView().post(() -> {
                    if (bridge.getWebView() != null) bridge.getWebView().loadUrl(target);
                });
            }
        }
    }

    /** v8.1.0：App Links 目标 URL 的 host 归一到 getAppUrl() origin（闸R1-P1 跨源锁屏修） */
    private String appLinkTarget(String url) {
        try {
            android.net.Uri base = android.net.Uri.parse(bridge.getAppUrl());
            if (base.getHost() == null) return url; // 拿不到 origin 就原样放行（退化=旧行为）
            return android.net.Uri.parse(url).buildUpon()
                .scheme(base.getScheme()).authority(base.getAuthority())
                .build().toString();
        } catch (Exception e) {
            return url;
        }
    }

    /** v8.1.0：仅收笔记双域（note/biji.xuyinji.com.cn）的 https ACTION_VIEW 链接 */
    private boolean isAppLink(Intent it) {
        if (it == null || !Intent.ACTION_VIEW.equals(it.getAction())) return false;
        android.net.Uri u = it.getData();
        if (u == null || !"https".equals(u.getScheme())) return false;
        String h = u.getHost();
        return "note.xuyinji.com.cn".equals(h) || "biji.xuyinji.com.cn".equals(h);
    }

    /** v5.57：缓存引导 reload 只跑一次（防循环），进程重建后若仍无缓存允许再试 */
    private boolean didCacheBootstrapReload = false;

    /** 联网时 native 侧抓主文档；无网络直接返回 null 快败（不阻塞拦截层）。
     *  v9.5.5 闸修（R1/R2 P1：ETag 在 App 链路是死代码——拦截器自抓不带条件头，冷启仍全量 275KB）：
     *  有磁盘缓存且存过 ETag 时带 If-None-Match 条件请求；304 返回空数组（byte[0]）信号，调用方直接吐磁盘缓存。 */
    private byte[] fetchMainDoc(String urlStr) throws Exception {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo ni = cm.getActiveNetworkInfo();
        if (ni == null || !ni.isConnected()) return null;
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(3000);
        conn.setReadTimeout(6000);
        conn.setRequestProperty("Accept", "text/html");
        try {
            java.io.File df = new java.io.File(getFilesDir(), MAIN_DOC_CACHE);
            String savedEtag = readSmallText(MAIN_DOC_ETAG);
            if (df.exists() && savedEtag != null && !savedEtag.isEmpty()) conn.setRequestProperty("If-None-Match", savedEtag);
        } catch (Exception ignored) { }
        try {
            int code = conn.getResponseCode();
            if (code == 304) return new byte[0]; // 条件命中：磁盘缓存仍新鲜
            if (code < 200 || code >= 300) return null;
            try {
                String et = conn.getHeaderField("ETag");
                if (et != null && !et.isEmpty()) writeSmallText(MAIN_DOC_ETAG, et);
            } catch (Exception ignored) { }
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                return bo.toByteArray();
            }
        } finally {
            conn.disconnect();
        }
    }

    private String readSmallText(String name) {
        try (FileInputStream fi = openFileInput(name); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
            byte[] buf = new byte[512]; int n;
            while ((n = fi.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8").trim();
        } catch (Exception e) { return null; }
    }

    private void writeSmallText(String name, String val) {
        try (FileOutputStream fo = openFileOutput(name, MODE_PRIVATE)) {
            fo.write(val.getBytes("UTF-8"));
        } catch (Exception ignored) { }
    }

    private void saveMainDoc(byte[] bytes) {
        try (FileOutputStream fo = openFileOutput(MAIN_DOC_CACHE, MODE_PRIVATE)) {
            fo.write(bytes);
        } catch (Exception ignored) { }
    }

    private byte[] readMainDoc() {
        try (FileInputStream fi = openFileInput(MAIN_DOC_CACHE); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fi.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    /** v5.56 末级兜底：APK 内置壳（assets/public/index.html，构建时 cap sync 打入当版） */
    private byte[] readAssetMainDoc() {
        try (InputStream in = getAssets().open("public/index.html"); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // v8.1.0 热启 App Links：singleTop 复用实例，新 intent 的 URL 直载 WebView（页内导航，
        // 脏保存由既有 pagehide→flushDirtySave 链兜底）；origin 归一同冷启（闸R1-P1）
        if (isAppLink(intent) && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().loadUrl(appLinkTarget(intent.getData().toString()));
        }
        // 通知点击 → 通过事件通知 JS。
        // App 被杀后冷启时 WebView 尚未就绪，先缓存，待 onResume 补发。
        if (intent != null && RemPlugin.ACTION_NOTIFY_CLICK.equals(intent.getAction())) {
            if (bridge != null && bridge.getWebView() != null) {
                dispatchRemNotifyClick();
            } else {
                pendingRemNotifyClick = true;
            }
        }
    }

    // 必须是 public：BridgeActivity.onResume() 是 public，override 收窄为 protected 会编译失败
    @Override
    public void onResume() {
        super.onResume();
        // v5.55：前台标志——前台时 JS 提醒卡+声音已负责，RemReceiver 不重复推通知
        RemPlugin.isForeground = true;
        // v9.5.5 修正：v9.5.4 的无条件 reload 本身就是「黑屏闪几下→白加载中→黑加载中」的制造者
        // （躺 11 分钟回来必闪一整轮）。改为心跳探活：JS 每秒写 window.__nsBeat，取不到或落后 >15s
        // 才说明页面真「冻而未死」→ reload；活着就静默返回，一帧都不闪。
        if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 10 * 60_000L) {
            final WebView wvResume = (bridge != null) ? bridge.getWebView() : null;
            pausedAt = 0;
            if (wvResume != null) {
                try {
                    wvResume.evaluateJavascript("String(Date.now()-(window.__nsBeat||0))", new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String value) {
                            long gap = Long.MAX_VALUE; // 取不到/非数字＝当死页处理
                            try { gap = Long.parseLong(String.valueOf(value).replace("\"", "")); } catch (Exception ignored) { }
                            if (gap > 15000) {
                                try { if (!isFinishing() && !isDestroyed()) { wvResume.stopLoading(); wvResume.reload(); } } catch (Throwable ignored) { }
                            }
                        }
                    });
                } catch (Throwable ignored) { }
            }
        }
        if (pendingRemNotifyClick) {
            dispatchRemNotifyClick();
        }
    }

    @Override
    public void onPause() { // BridgeActivity.onPause 是 public，override 不能降 visibility（同 onResume 教训）
        super.onPause();
        // v5.55：非前台（后台/被杀/冷启）一律推通知栏——正是用户要的语义
        RemPlugin.isForeground = false;
        pausedAt = System.currentTimeMillis(); // v9.5.4：onResume 陈旧守卫时间戳
    }

    private void dispatchRemNotifyClick() {
        if (bridge == null || bridge.getWebView() == null) return;
        pendingRemNotifyClick = false;
        // v6.0：带 noteId 派发——JS 收到后若不是当前笔记，直接跳到提醒所属的笔记
        Intent it = getIntent();
        String nid = (it != null) ? it.getStringExtra("noteId") : null;
        final String nidJson = (nid == null) ? "null" : org.json.JSONObject.quote(nid);
        bridge.getWebView().post(() -> {
            if (bridge.getWebView() != null) {
                // 等页面 JS 就绪（DOMContentLoaded/interactive）再派发，避免事件丢失
                bridge.getWebView().evaluateJavascript(
                    "(function(){var f=function(){window.dispatchEvent(new CustomEvent('rem-notify-click',{detail:{noteId:" + nidJson + "}}));};"
                        + "if(document.readyState==='complete'||document.readyState==='interactive'){f();}"
                        + "else{window.addEventListener('DOMContentLoaded',f);}})();",
                    null
                );
            }
        });
    }
}
