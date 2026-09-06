package cn.xuyinji.notesync;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import cn.xuyinji.notesync.rem.RemPlugin;

public class MainActivity extends BridgeActivity {

    private boolean pendingRemNotifyClick = false;

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
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) fallback.setVisibility(View.VISIBLE);
            }
        });
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
        if (pendingRemNotifyClick) {
            dispatchRemNotifyClick();
        }
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