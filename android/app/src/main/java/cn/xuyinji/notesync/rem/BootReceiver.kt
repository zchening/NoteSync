package cn.xuyinji.notesync.rem

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a != Intent.ACTION_BOOT_COMPLETED &&
            a != Intent.ACTION_MY_PACKAGE_REPLACED &&
            a != "android.intent.action.QUICKBOOT_POWERON"
        ) return
        // 开机/覆盖安装/快速开机后，重排所有未来提醒
        RemPlugin.rescheduleAll(context)
    }
}