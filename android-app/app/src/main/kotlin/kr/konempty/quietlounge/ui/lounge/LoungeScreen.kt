package kr.konempty.quietlounge.ui.lounge

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.konempty.quietlounge.webview.BridgeMessage
import kr.konempty.quietlounge.webview.NativeBridge
import kr.konempty.quietlounge.webview.WebViewScripts

private const val LOUNGE_URL = "https://lounge.naver.com"
private const val MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

private data class PendingBlock(
    val personaId: String?,
    val nickname: String,
)

@Composable
fun LoungeScreen(
    modifier: Modifier = Modifier,
    pendingPostId: String?,
    onPendingPostIdConsumed: () -> Unit,
    viewModel: LoungeViewModel = viewModel(),
) {
    val context = LocalContext.current
    val blockData by viewModel.blockData.collectAsStateWithLifecycle()
    val filterMode by viewModel.filterMode.collectAsStateWithLifecycle()

    var webView by remember { mutableStateOf<WebView?>(null) }
    var pendingBlock by remember { mutableStateOf<PendingBlock?>(null) }

    val bridge =
        remember {
            NativeBridge { msg ->
                when (msg) {
                    is BridgeMessage.BlockUser -> {
                        pendingBlock = PendingBlock(personaId = msg.personaId, nickname = msg.nickname)
                    }

                    is BridgeMessage.PersonaMapUpdate -> {
                        msg.personaCache.forEach { (pid, nick) ->
                            viewModel.updatePersonaCache(pid, nick)
                        }
                    }

                    is BridgeMessage.PageChanged -> Unit
                }
            }
        }

    // Android 뒤로가기 → WebView 뒤로가기 (가능할 때만)
    BackHandler(enabled = webView?.canGoBack() == true) {
        webView?.goBack()
    }

    // blockData 변경 → WebView 에 push
    LaunchedEffect(blockData) {
        webView?.evaluateJavascript(WebViewScripts.buildBlockListUpdate(blockData), null)
    }

    // filterMode 변경 → WebView 에 push
    LaunchedEffect(filterMode) {
        webView?.evaluateJavascript(WebViewScripts.buildFilterModeUpdate(filterMode), null)
    }

    // 알림 클릭 → 해당 게시글 열기
    LaunchedEffect(pendingPostId) {
        val postId = pendingPostId
        val view = webView
        if (postId != null && view != null) {
            view.evaluateJavascript(WebViewScripts.buildOpenPostUrl(postId), null)
            onPendingPostIdConsumed()
        }
    }

    Box(modifier = modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                createLoungeWebView(
                    context = ctx,
                    bridge = bridge,
                    initialUrl = LOUNGE_URL,
                    afterScriptProvider = {
                        WebViewScripts.buildAfter(ctx, blockData, filterMode)
                    },
                    beforeScriptProvider = { WebViewScripts.loadBefore(ctx) },
                ).also { webView = it }
            },
        )

        pendingBlock?.let { pb ->
            AlertDialog(
                onDismissRequest = { pendingBlock = null },
                title = { Text("유저 차단") },
                text = { Text("\"${pb.nickname}\" 유저를 차단하시겠습니까?") },
                confirmButton = {
                    TextButton(onClick = {
                        viewModel.blockUser(pb.personaId, pb.nickname)
                        pendingBlock = null
                    }) {
                        Text("차단", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingBlock = null }) {
                        Text("취소")
                    }
                },
            )
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webView?.apply {
                stopLoading()
                removeJavascriptInterface(NativeBridge.NAME)
                (parent as? ViewGroup)?.removeView(this)
                destroy()
            }
            webView = null
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun createLoungeWebView(
    context: android.content.Context,
    bridge: NativeBridge,
    initialUrl: String,
    beforeScriptProvider: () -> String,
    afterScriptProvider: () -> String,
): WebView {
    return WebView(context).apply {
        layoutParams =
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )

        // 쿠키 (네이버 로그인 유지) — setAcceptThirdPartyCookies 의 첫 인자는 WebView
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(this, true)

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = MOBILE_UA
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }

        addJavascriptInterface(bridge, NativeBridge.NAME)

        webChromeClient = WebChromeClient()
        webViewClient =
            object : WebViewClient() {
                override fun onPageStarted(
                    view: WebView?,
                    url: String?,
                    favicon: android.graphics.Bitmap?,
                ) {
                    super.onPageStarted(view, url, favicon)
                    // before script — document_start 대체 (페이지가 막 시작될 때 주입)
                    view?.evaluateJavascript(beforeScriptProvider(), null)
                }

                override fun onPageFinished(
                    view: WebView?,
                    url: String?,
                ) {
                    super.onPageFinished(view, url)
                    // after script — document_idle 대체
                    view?.evaluateJavascript(afterScriptProvider(), null)
                }
            }

        loadUrl(initialUrl)
    }
}
