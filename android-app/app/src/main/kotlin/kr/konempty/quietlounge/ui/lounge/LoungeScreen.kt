package kr.konempty.quietlounge.ui.lounge

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.konempty.quietlounge.webview.BridgeMessage
import kr.konempty.quietlounge.webview.NativeBridge
import kr.konempty.quietlounge.webview.WebViewScripts
import kr.konempty.quietlounge.webview.WebViewToolbarLogic

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
    val showWebViewToolbar by viewModel.showWebViewToolbar.collectAsStateWithLifecycle()

    var webView by remember { mutableStateOf<WebView?>(null) }
    var pendingBlock by remember { mutableStateOf<PendingBlock?>(null) }

    // 툴바 상태 — WebViewClient 콜백으로 갱신.
    // KVO 가 없는 Android 에선 onPageStarted/onPageFinished 가 가장 안정적인 갱신 포인트.
    var canGoBack by remember { mutableStateOf(false) }
    var canGoForward by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var currentUrl by remember { mutableStateOf<String?>(null) }
    val toolbarState =
        remember(canGoBack, canGoForward, isLoading, currentUrl) {
            WebViewToolbarLogic.computeToolbarState(canGoBack, canGoForward, isLoading, currentUrl)
        }

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
        val view = webView
        if (pendingPostId != null && view != null) {
            view.evaluateJavascript(WebViewScripts.buildOpenPostUrl(pendingPostId), null)
            onPendingPostIdConsumed()
        }
    }

    Column(modifier = modifier) {
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    createLoungeWebView(
                        context = ctx,
                        bridge = bridge,
                        afterScriptProvider = {
                            WebViewScripts.buildAfter(ctx, blockData, filterMode)
                        },
                        beforeScriptProvider = { WebViewScripts.loadBefore(ctx) },
                        onPageStarted = { url ->
                            isLoading = true
                            if (url != null) currentUrl = url
                        },
                        onPageFinished = { url ->
                            isLoading = false
                            if (url != null) currentUrl = url
                            webView?.let {
                                canGoBack = it.canGoBack()
                                canGoForward = it.canGoForward()
                            }
                        },
                        onUrlChanged = { url ->
                            if (url != null) currentUrl = url
                            webView?.let {
                                canGoBack = it.canGoBack()
                                canGoForward = it.canGoForward()
                            }
                        },
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

        if (showWebViewToolbar) {
            WebViewToolbar(
                state = toolbarState,
                onBack = { webView?.goBack() },
                onForward = { webView?.goForward() },
                onHome = { webView?.loadUrl(LOUNGE_URL) },
                onReload = {
                    val wv = webView ?: return@WebViewToolbar
                    if (toolbarState.reloadMode == WebViewToolbarLogic.ReloadMode.STOP) {
                        wv.stopLoading()
                    } else {
                        wv.reload()
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
    beforeScriptProvider: () -> String,
    afterScriptProvider: () -> String,
    onPageStarted: (url: String?) -> Unit = {},
    onPageFinished: (url: String?) -> Unit = {},
    onUrlChanged: (url: String?) -> Unit = {},
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
                    onPageStarted(url)
                }

                override fun onPageFinished(
                    view: WebView?,
                    url: String?,
                ) {
                    super.onPageFinished(view, url)
                    // after script — document_idle 대체
                    view?.evaluateJavascript(afterScriptProvider(), null)
                    onPageFinished(url)
                }

                // 라운지는 SPA — 글 상세 진입 등 클라이언트 사이드 라우팅에서는
                // onPageStarted/Finished 가 호출되지 않으므로 history 변경 콜백으로
                // URL/네비게이션 상태를 따라잡는다 (홈 버튼 stale 이슈 방어).
                override fun doUpdateVisitedHistory(
                    view: WebView?,
                    url: String?,
                    isReload: Boolean,
                ) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    onUrlChanged(url)
                }
            }

        loadUrl(LOUNGE_URL)
    }
}

@Composable
private fun WebViewToolbar(
    state: WebViewToolbarLogic.NavigationToolbarState,
    onBack: () -> Unit,
    onForward: () -> Unit,
    onHome: () -> Unit,
    onReload: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface),
    ) {
        HorizontalDivider(
            thickness = 0.5.dp,
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
        )
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                description = "뒤로",
                enabled = state.backEnabled,
                onClick = onBack,
            )
            ToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowForward,
                description = "앞으로",
                enabled = state.forwardEnabled,
                onClick = onForward,
            )
            ToolbarButton(
                icon = Icons.Outlined.Home,
                description = "홈",
                enabled = state.homeEnabled,
                onClick = onHome,
            )
            val reloadIcon =
                if (state.reloadMode == WebViewToolbarLogic.ReloadMode.STOP) {
                    Icons.Outlined.Close
                } else {
                    Icons.Outlined.Refresh
                }
            ToolbarButton(
                icon = reloadIcon,
                description = if (state.reloadMode == WebViewToolbarLogic.ReloadMode.STOP) "중지" else "새로고침",
                enabled = true,
                onClick = onReload,
            )
        }
    }
}

@Composable
private fun ToolbarButton(
    icon: ImageVector,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick, enabled = enabled) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            tint =
                if (enabled) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                },
        )
    }
}
