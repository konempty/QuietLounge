package kr.konempty.quietlounge

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kr.konempty.quietlounge.notification.KeywordAlertScheduler
import kr.konempty.quietlounge.ui.MainScreen
import kr.konempty.quietlounge.ui.SplashScreen
import kr.konempty.quietlounge.ui.theme.QuietLoungeTheme

class MainActivity : ComponentActivity() {
    private val _pendingPostId = MutableStateFlow<String?>(null)
    val pendingPostId = _pendingPostId.asStateFlow()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(0, 0),
            navigationBarStyle = SystemBarStyle.auto(0, 0),
        )
        super.onCreate(savedInstanceState)
        consumeIntent(intent)
        setContent {
            QuietLoungeTheme {
                val postId by pendingPostId.collectAsStateWithLifecycle()
                // 프로세스 1회당 splash 한 번만 (구성 변경 시 재현 안 되도록 rememberSaveable)
                var splashDone by rememberSaveable { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    if (!splashDone) {
                        delay(SPLASH_DURATION_MS)
                        splashDone = true
                    }
                }
                Crossfade(
                    targetState = splashDone,
                    animationSpec = tween(durationMillis = 500),
                    label = "splash-crossfade",
                ) { showMain ->
                    if (showMain) {
                        MainScreen(
                            pendingPostId = postId,
                            onPendingPostIdConsumed = { _pendingPostId.value = null },
                        )
                    } else {
                        SplashScreen()
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        KeywordAlertScheduler.get(this).start()
    }

    override fun onPause() {
        super.onPause()
        KeywordAlertScheduler.get(this).stop()
    }

    private fun consumeIntent(intent: Intent?) {
        val postId = intent?.getStringExtra(EXTRA_OPEN_POST_ID) ?: return
        _pendingPostId.value = postId
    }

    companion object {
        const val EXTRA_OPEN_POST_ID = "open_post_id"
        private const val SPLASH_DURATION_MS = 2_000L
    }
}
