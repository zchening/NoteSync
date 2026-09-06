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

public class MainActivity extends BridgeActivity {

    private boolean pendingRemNotifyClick = false;
    private static final String MAIN_DOC_CACHE = "cached_index.html";

    // v5.56：离线兜底诊断计数（JS 端 ?diag 经 RemPlugin.cacheInfo 只读——定位兜底断在哪一环）
    public static volatile int interceptCount = 0;
    public static volatile int fetchFailCount = 0;
    public static volatile int cacheHitCount = 0;
    public static volatile int assetHitCount = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v5.51：注册自定义提醒桥（Capacitor 7 也支持自动扫描，显式注册更稳）
        registerPlugin(RemPlugin.class);
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
        ViewGroup parent = (ViewGroup) wv.getParent();
        if (parent == null) return;
        final View fallback = getLayoutInflater().inflate(R.layout.activity_offline, parent, false);
        parent.addView(fallback);
        fallback.setVisibility(View.GONE);
        fallback.findViewById(R.id.btn_retry).setOnClickListener(v -> {
            fallback.setVisibility(View.GONE);
            wv.reload();
        });
        wv.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // v5.55 离线 P0 修复：主文档 native 层缓存，替代不可靠的 WebView SW 兜底。
                // 现象（v5.52~5.54）：server.url 直连线上，断网时主文档加载失败 → onReceivedError
                // 盖上原生"网络连接失败"页 → JS 的 notesync_cache_* 离线缓存体系根本没机会跑。
                // 修法：联网时 native 自己 fetch 线上 HTML 并落盘；断网/失败时回本地缓存文件，
                // 页面照常打开，JS 照常跑（localStorage origin 不变），离线阅读生效。
                // 热更新不受影响：联网时永远先拿线上最新版。
                if (request.isForMainFrame() && "GET".equalsIgnoreCase(request.getMethod())) {
                    interceptCount++;
                    try {
                        byte[] bytes = fetchMainDoc(request.getUrl().toString());
                        if (bytes != null && bytes.length > 0) {
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
                if (request.isForMainFrame()) fallback.setVisibility(View.VISIBLE);
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
    }

    /** v5.57：缓存引导 reload 只跑一次（防循环），进程重建后若仍无缓存允许再试 */
    private boolean didCacheBootstrapReload = false;

    /** 联网时 native 侧抓主文档；无网络直接返回 null 快败（不阻塞拦截层） */
    private byte[] fetchMainDoc(String urlStr) throws Exception {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo ni = cm.getActiveNetworkInfo();
        if (ni == null || !ni.isConnected()) return null;
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(3000);
        conn.setReadTimeout(6000);
        conn.setRequestProperty("Accept", "text/html");
        try {
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return null;
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
        if (pendingRemNotifyClick) {
            dispatchRemNotifyClick();
        }
    }

    @Override
    public void onPause() { // BridgeActivity.onPause 是 public，override 不能降 visibility（同 onResume 教训）
        super.onPause();
        // v5.55：非前台（后台/被杀/冷启）一律推通知栏——正是用户要的语义
        RemPlugin.isForeground = false;
    }

    private void dispatchRemNotifyClick() {
        if (bridge == null || bridge.getWebView() == null) return;
        pendingRemNotifyClick = false;
        bridge.getWebView().post(() -> {
            if (bridge.getWebView() != null) {
                // 等页面 JS 就绪（DOMContentLoaded/interactive）再派发，避免事件丢失
                bridge.getWebView().evaluateJavascript(
                    "(function(){var f=function(){window.dispatchEvent(new CustomEvent('rem-notify-click'));};"
                        + "if(document.readyState==='complete'||document.readyState==='interactive'){f();}"
                        + "else{window.addEventListener('DOMContentLoaded',f);}})();",
                    null
                );
            }
        });
    }
}
