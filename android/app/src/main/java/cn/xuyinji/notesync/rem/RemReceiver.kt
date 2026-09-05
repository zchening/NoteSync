package cn.xuyinji.notesync.rem

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import cn.xuyinji.notesync.MainActivity
import cn.xuyinji.notesync.R

class RemReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != RemPlugin.ACTION_FIRE) return
        val at = intent.getLongExtra("at", 0)
        val text = intent.getStringExtra("text") ?: "该看笔记了"
        val idx = intent.getIntExtra("idx", 0)
        RemPlugin.createNotificationChannel(context)

        // 点击通知 → 回 MainActivity → onNewIntent → JS 抛 rem-notify-click 事件
        val clickIntent = Intent(context, MainActivity::class.java).apply {
            action = RemPlugin.ACTION_NOTIFY_CLICK
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("at", at)
        }
        val pi = PendingIntent.getActivity(
            context, idx, clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(context, RemPlugin.NOTIF_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("\u23F0 NoteSync 提醒")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true) // 锁屏强弹（需 USE_FULL_SCREEN_INTENT 权限）
            .build()

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(idx, notif)
    }
}
