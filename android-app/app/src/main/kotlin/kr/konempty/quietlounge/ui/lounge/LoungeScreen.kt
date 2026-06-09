package kr.konempty.quietlounge.ui.lounge

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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
    val blockData by viewModel.blockData.collectAsStateWithLifecycle()
    val filterMode by viewModel.filterMode.collectAsStateWithLifecycle()
    val showWebViewToolbar by viewModel.showWebViewToolbar.collectAsStateWithLifecycle()
    val showFilterHint by viewModel.showFilterHint.collectAsStateWithLifecycle()

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
                        // forEach 로 단건 호출하면 DataStore 쓰기 큐가 누적되어 다른 탭의 토글이
                        // 수십 초 대기하는 회귀 발생. 한 번에 배치로 처리.
                        viewModel.updatePersonaCacheBatch(msg.personaCache)
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
                    text = { Text("\"${pb.nickname}\" 유저를 어떻게 차단할까요?") },
                    confirmButton = {
                        BlockUserDialogActions(
                            onBlockPostsOnly = {
                                viewModel.blockUser(pb.personaId, pb.nickname, blockComments = false)
                                pendingBlock = null
                            },
                            onBlockPostsAndComments = {
                                viewModel.blockUser(pb.personaId, pb.nickname, blockComments = true)
                                pendingBlock = null
                            },
                            onCancel = { pendingBlock = null },
                        )
                    },
                )
            }

            if (showFilterHint) {
                AlertDialog(
                    onDismissRequest = { viewModel.dismissFilterHint() },
                    title = { Text("팁: 흐림 처리 모드") },
                    text = {
                        Text(
                            "차단된 글을 완전히 숨기는 대신 흐리게만 처리할 수도 있어요.\n" +
                                "설정 > 표시 설정 > '흐림 처리' 에서 켤 수 있습니다.",
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { viewModel.dismissFilterHint() }) {
                            Text("확인")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { viewModel.setDontShowFilterHint() }) {
                            Text("다시 보지 않기")
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
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    WebViewCompat.removeWebMessageListener(this, NativeBridge.NAME)
                }
                // 미지원 환경에서는 등록 자체를 안 했으니 해제도 불필요 (fail-closed).
                (parent as? ViewGroup)?.removeView(this)
                destroy()
            }
            webView = null
        }
    }
}

@Composable
internal fun BlockUserDialogActions(
    onBlockPostsOnly: () -> Unit,
    onBlockPostsAndComments: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag("block-user-dialog-actions"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TextButton(
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .testTag("block-user-posts-only"),
                onClick = onBlockPostsOnly,
            ) {
                Text("글만 차단")
            }
            TextButton(
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .testTag("block-user-posts-comments"),
                onClick = onBlockPostsAndComments,
            ) {
                Text("글과 댓글 차단", color = MaterialTheme.colorScheme.error)
            }
        }
        TextButton(
            modifier =
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .heightIn(min = 48.dp)
                    .testTag("block-user-cancel"),
            onClick = onCancel,
        ) {
            Text("취소")
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

        // Bridge 등록 — `WebViewCompat.addWebMessageListener` 가 frame allowed-origin rule 로
        // cross-origin iframe bypass (52 라운드 Codex F1 P1) 차단.
        //
        // 미지원 환경 (구버전 Chromium WebView) 은 **fail-closed** — legacy `addJavascriptInterface`
        // 는 모든 frame 에 같은 객체를 노출해 iframe bypass 회귀 (Codex 55 F1 P2). 차단 / personaCache
        // 기능을 안전하게 노출할 방법이 없으므로 bridge 등록 자체 skip — 라운지 보기는 그대로 작동,
        // 차단 / 키워드 알림 native handler 만 비활성. WebView 87+ (2020-11) 가 minSdk 24 의 거의
        // 모든 OEM 에 도달했지만 1% 미만의 stale 빌드에서 보안을 fail-open 하지 않기 위함.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                this,
                NativeBridge.NAME,
                setOf("https://lounge.naver.com"),
                bridge,
            )
        } else {
            android.util.Log.w(
                "QuietLounge",
                "WEB_MESSAGE_LISTENER not supported — native bridge disabled (block / keyword alert " +
                    "features unavailable). System WebView 업데이트 권장.",
            )
        }

        // 기본 WebChromeClient() 만 쓰면 JS alert / confirm / prompt 가 silent 봉쇄된다 — 라운지가
        // 사용자 확인을 받는 흐름에서 dialog 가 안 뜨고 JS 스레드가 응답을 못 받아 다음 동작이 멈춤.
        // iOS native 의 WKUIDelegate 와 동일 매개 패턴으로 AlertDialog 로 띄우고 result 콜백을 호출.
        webChromeClient = LoungeWebChromeClient(context)
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

/**
 * WebView 의 JS alert / confirm / prompt 를 native AlertDialog 로 매개.
 *
 * Android WebView 도 iOS WKWebView 와 마찬가지로 — 기본 [WebChromeClient] 의 onJsAlert /
 * onJsConfirm / onJsPrompt 가 false 를 반환하면 dialog 가 안 뜨고 JsResult.confirm/cancel 이
 * 호출되지 않아 JS 스레드가 응답 대기로 멈춤. 라운지 페이지가 confirm() 으로 사용자 확인을
 * 받는 흐름에서 회귀가 발생해 명시적으로 매개한다.
 *
 * `android.app.AlertDialog` 를 fully qualified name 으로 사용 — `androidx.compose.material3.AlertDialog`
 * 와 이름이 충돌해 import 하면 Compose 측 dialog 호출 (LoungeScreen 안의 차단 confirm 등) 이 깨진다.
 */
private class LoungeWebChromeClient(
    private val context: android.content.Context,
) : WebChromeClient() {
    override fun onJsAlert(
        view: WebView?,
        url: String?,
        message: String?,
        result: JsResult?,
    ): Boolean {
        android.app.AlertDialog
            .Builder(context)
            .setMessage(message)
            .setPositiveButton("확인") { _, _ -> result?.confirm() }
            .setOnCancelListener { result?.cancel() }
            .show()
        return true
    }

    override fun onJsConfirm(
        view: WebView?,
        url: String?,
        message: String?,
        result: JsResult?,
    ): Boolean {
        android.app.AlertDialog
            .Builder(context)
            .setMessage(message)
            .setPositiveButton("확인") { _, _ -> result?.confirm() }
            .setNegativeButton("취소") { _, _ -> result?.cancel() }
            .setOnCancelListener { result?.cancel() }
            .show()
        return true
    }

    override fun onJsPrompt(
        view: WebView?,
        url: String?,
        message: String?,
        defaultValue: String?,
        result: JsPromptResult?,
    ): Boolean {
        val input = EditText(context).apply { setText(defaultValue ?: "") }
        android.app.AlertDialog
            .Builder(context)
            .setMessage(message)
            .setView(input)
            .setPositiveButton("확인") { _, _ -> result?.confirm(input.text.toString()) }
            .setNegativeButton("취소") { _, _ -> result?.cancel() }
            .setOnCancelListener { result?.cancel() }
            .show()
        return true
    }
}
