package kr.konempty.quietlounge

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.core.content.getSystemService
import kr.konempty.quietlounge.notification.NotificationHelper

class QuietLoungeApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService<NotificationManager>() ?: return
        val channel =
            NotificationChannel(
                NotificationHelper.CHANNEL_KEYWORD_ALERTS,
                getString(R.string.notification_channel_keyword_alerts),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = getString(R.string.notification_channel_keyword_alerts_desc)
                enableLights(true)
                enableVibration(true)
            }
        nm.createNotificationChannel(channel)
    }
}
