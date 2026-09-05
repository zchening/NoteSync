package cn.xuyinji.notesync;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import cn.xuyinji.notesync.rem.RemPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v5.51：注册自定义提醒桥（Capacitor 7 也支持自动扫描，显式注册更稳）
        registerPlugin(RemPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // v5.51：通知点击 → 通过事件通知 JS（带节流，等 WebView 就绪）
        if (intent != null && RemPlugin.ACTION_NOTIFY_CLICK.equals(intent.getAction())
                && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().post(() -> {
                if (bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('rem-notify-click'));",
                        null
                    );
                }
            });
        }
    }
}