package kr.konempty.quietlounge.notification

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kr.konempty.quietlounge.MainActivity
import kr.konempty.quietlounge.R

object NotificationHelper {
    const val CHANNEL_KEYWORD_ALERTS = "keyword_alerts"

    // notify() 호출 직전에 hasPermission() 으로 체크하고 runCatching 으로 감쌌지만,
    // @RequiresPermission annotation 기반 lint 가 이를 인식 못해 ERROR 를 냄 → suppress.
    @SuppressLint("MissingPermission")
    fun showKeywordMatch(
        context: Context,
        postId: String,
        channelName: String,
        matchedKeyword: String,
        title: String,
    ) {
        if (!hasPermission(context)) return

        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(MainActivity.EXTRA_OPEN_POST_ID, postId)
            }
        val pending =
            PendingIntent.getActivity(
                context,
                postId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val notification =
            NotificationCompat
                .Builder(context, CHANNEL_KEYWORD_ALERTS)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFF4A6CF7.toInt()) // 앱 아이콘 배경색과 동일
                .setContentTitle("[$channelName] 키워드 알림")
                .setContentText("\"$matchedKeyword\" — $title")
                .setStyle(NotificationCompat.BigTextStyle().bigText("\"$matchedKeyword\" — $title"))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()

        runCatching {
            NotificationManagerCompat.from(context).notify(postId.hashCode(), notification)
        }
    }

    private fun hasPermission(context: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }
}
