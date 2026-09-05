package cn.xuyinji.notesync.rem

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@CapacitorPlugin(name = "RemBridge")
class RemPlugin : Plugin() {

    data class Reminder(val at: Long, val text: String)
    data class AppVersionInfo(val version: String, val sha256: String, val size: Long)

    companion object {
        const val KEYSTORE_ALIAS = "notesync_rem_key"
        const val PREFS_NAME = "notesync_rem"
        const val KEY_CIPHER = "cipher_b64"
        const val KEY_IV = "iv_b64"
        const val NOTIF_CHANNEL_ID = "notesync_reminders"
        const val NOTIF_CHANNEL_NAME = "NoteSync 提醒"
        const val ACTION_FIRE = "cn.xuyinji.notesync.REM_FIRE"
        const val ACTION_NOTIFY_CLICK = "cn.xuyinji.notesync.NOTIFY_CLICK"

        fun getOrCreateKey(): SecretKey {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(KEYSTORE_ALIAS, null) as? SecretKey)?.let { return it }
            val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            kg.init(
                KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            return kg.generateKey()
        }

        fun encryptList(items: List<Reminder>): Pair<String, String> {
            val arr = JSONArray()
            for (r in items) {
                val o = JSONObject()
                o.put("at", r.at)
                o.put("text", r.text)
                arr.put(o)
            }
            val plain = arr.toString().toByteArray(Charsets.UTF_8)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val iv = cipher.iv
            val ct = cipher.doFinal(plain)
            return Pair(
                Base64.encodeToString(ct, Base64.NO_WRAP),
                Base64.encodeToString(iv, Base64.NO_WRAP)
            )
        }

        fun decryptList(cB64: String, ivB64: String): List<Reminder> {
            val ct = Base64.decode(cB64, Base64.DEFAULT)
            val iv = Base64.decode(ivB64, Base64.DEFAULT)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            val plain = cipher.doFinal(ct)
            val arr = JSONArray(String(plain, Charsets.UTF_8))
            val list = mutableListOf<Reminder>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(Reminder(o.getLong("at"), o.optString("text")))
            }
            return list
        }

        fun readItems(context: Context): List<Reminder> {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val c = prefs.getString(KEY_CIPHER, null) ?: return emptyList()
            val iv = prefs.getString(KEY_IV, null) ?: return emptyList()
            return try { decryptList(c, iv) } catch (_: Exception) { emptyList() }
        }

        fun scheduleAlarm(context: Context, r: Reminder) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, RemReceiver::class.java).apply {
                action = ACTION_FIRE
                putExtra("at", r.at)
                putExtra("text", r.text)
            }
            val pi = PendingIntent.getBroadcast(
                context, r.at.toInt(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
            }
        }

        fun cancelAlarm(context: Context, r: Reminder) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, RemReceiver::class.java).apply { action = ACTION_FIRE }
            val pi = PendingIntent.getBroadcast(
                context, r.at.toInt(), intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            ) ?: return
            am.cancel(pi)
        }

        /** 开机/覆盖安装后重排所有未来提醒；过期跳过 */
        fun rescheduleAll(context: Context) {
            val items = readItems(context)
            val now = System.currentTimeMillis()
            for (r in items) {
                if (r.at > now) scheduleAlarm(context, r)
            }
        }

        fun createNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(NOTIF_CHANNEL_ID) != null) return
            val ch = NotificationChannel(NOTIF_CHANNEL_ID, NOTIF_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH)
            ch.description = "NoteSync 时间提醒，关掉 App 也能推"
            ch.enableVibration(true)
            ch.setBypassDnd(true)
            ch.setShowBadge(true)
            nm.createNotificationChannel(ch)
        }
    }

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    override fun load() {
        super.load()
        createNotificationChannel(context)
    }

    @PluginMethod
    fun sync(call: PluginCall) {
        try {
            val listJson = call.getArray("list") ?: JSONArray()
            val now = System.currentTimeMillis()
            val items = mutableListOf<Reminder>()
            for (i in 0 until listJson.length()) {
                val o = listJson.getJSONObject(i)
                val at = o.optLong("at", 0)
                val text = o.optString("text", "")
                if (at > now - 60_000L) items.add(Reminder(at, text))
            }
            items.sortBy { it.at }
            // 先清旧 alarm（基于旧 prefs）
            val old = readItems(context)
            for (r in old) cancelAlarm(context, r)
            // 落盘加密 + 排程
            val (c, iv) = encryptList(items)
            prefs.edit()
                .putString(KEY_CIPHER, c)
                .putString(KEY_IV, iv)
                .apply()
            var scheduled = 0
            for (r in items) {
                scheduleAlarm(context, r)
                scheduled++
            }
            val ret = JSObject()
            ret.put("scheduled", scheduled)
            ret.put("failed", 0)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("sync error: ${e.message}", e)
        }
    }

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        try {
            val items = readItems(context)
            for (r in items) cancelAlarm(context, r)
            prefs.edit().remove(KEY_CIPHER).remove(KEY_IV).apply()
            call.resolve()
        } catch (e: Exception) {
            call.reject("cancelAll error: ${e.message}", e)
        }
    }

    @PluginMethod
    fun getVersion(call: PluginCall) {
        try {
            val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
            val ret = JSObject()
            ret.put("nativeVersion", pkg.versionName ?: "unknown")
            ret.put("scheduled", readItems(context).size)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("version error: ${e.message}", e)
        }
    }

    @PluginMethod
    fun checkUpdate(call: PluginCall) {
        // 在后台线程执行 fetch + 下载 + 校验；本机失败不报错（保留旧版）
        Thread {
            try {
                val current = call.getString("current") ?: ""
                val base = call.getString("base") ?: ""
                val info = fetchAppVersion(base)
                val ret = JSObject()
                if (info != null && info.version != current && info.sha256.isNotEmpty()) {
                    val ok = downloadAndStore(base, info)
                    ret.put("updateAvailable", ok)
                    ret.put("version", info.version)
                } else {
                    ret.put("updateAvailable", false)
                    ret.put("version", current)
                }
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("checkUpdate error: ${e.message}", e)
            }
        }.start()
    }

    private fun fetchAppVersion(base: String): AppVersionInfo? {
        val url = (if (base.isEmpty()) "http://127.0.0.1:8080" else base.trimEnd('/')) + "/api/app-version"
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 5000
        conn.readTimeout = 5000
        if (conn.responseCode != 200) return null
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        val obj = JSONObject(body)
        return AppVersionInfo(obj.getString("version"), obj.optString("sha256"), obj.optLong("size"))
    }

    private fun downloadAndStore(base: String, info: AppVersionInfo): Boolean {
        val url = if (base.isEmpty()) "http://127.0.0.1:8080/" else "${base.trimEnd('/')}/"
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 30_000
        val bytes = conn.inputStream.readBytes()
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(bytes).joinToString("") { "%02x".format(it) }
        if (digest != info.sha256) return false
        val hotDir = java.io.File(context.filesDir, "www-hot")
        if (!hotDir.exists()) hotDir.mkdirs()
        val tmp = java.io.File(hotDir, "index.html.tmp")
        tmp.writeBytes(bytes)
        val hot = java.io.File(hotDir, "index.html")
        if (hot.exists()) hot.delete()
        return tmp.renameTo(hot)
    }
}