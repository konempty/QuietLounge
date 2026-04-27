package kr.konempty.quietlounge.webview

import java.net.URISyntaxException

/**
 * 웹뷰 하단 네비게이션 툴바의 버튼 상태 계산 — 순수 로직.
 *
 * iOS `QuietLoungeCore.computeNavigationToolbarState` / `isLoungeHome` 과 동일한 시맨틱.
 * Android 단위 테스트로 검증 가능하게 android.net.Uri 대신 java.net.URI 사용.
 */
object WebViewToolbarLogic {
    enum class ReloadMode { RELOAD, STOP }

    data class NavigationToolbarState(
        val backEnabled: Boolean,
        val forwardEnabled: Boolean,
        val homeEnabled: Boolean,
        val reloadMode: ReloadMode,
    )

    /**
     * - `currentUrl` 이 null/empty 면 아직 로드 전이라 홈으로 "가는 중" 이므로 홈 버튼 비활성.
     * - `isLoading` 중이면 reload 버튼이 stop 토글로 바뀐다.
     */
    fun computeToolbarState(
        canGoBack: Boolean,
        canGoForward: Boolean,
        isLoading: Boolean,
        currentUrl: String?,
    ): NavigationToolbarState {
        val atHome = currentUrl.isNullOrEmpty() || isLoungeHome(currentUrl)
        return NavigationToolbarState(
            backEnabled = canGoBack,
            forwardEnabled = canGoForward,
            homeEnabled = !atHome,
            reloadMode = if (isLoading) ReloadMode.STOP else ReloadMode.RELOAD,
        )
    }

    /**
     * `lounge.naver.com` 또는 그 서브도메인의 루트 경로(`""` / `"/"`)인지 판정.
     * - 호스트 미일치 → false
     * - `/posts/123`, `/channels/x` 등 sub-path → false
     * - 파싱 실패 → false (안전 측 디폴트)
     */
    fun isLoungeHome(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val host = extractHost(url) ?: return false
        if (host != "lounge.naver.com" && !host.endsWith(".lounge.naver.com")) return false
        val path = extractPath(url) ?: return true // path 없는 호스트만은 홈으로 간주
        return path.isEmpty() || path == "/"
    }

    /**
     * 앱 시작 시 "툴바 켜는 법 안내" 팝업을 띄울지 판정.
     * - 이미 툴바를 켠 사용자에겐 안내 불필요 → false
     * - "다시 보지 않기" 를 누른 사용자에겐 표시 안 함 → false
     * - 그 외에는 매 앱 실행마다 표시 → true
     */
    fun shouldShowToolbarHint(
        showWebViewToolbar: Boolean,
        dontShowToolbarHint: Boolean,
    ): Boolean {
        if (showWebViewToolbar) return false
        if (dontShowToolbarHint) return false
        return true
    }

    /**
     * 유저 차단 직후 "흐림 처리 모드 안내" 팝업을 띄울지 판정.
     * - 이미 BLUR 모드면 안내 불필요 (사용자가 이미 알고 있음) → false
     * - "다시 보지 않기" 누른 사용자 → false
     * - HIDE 모드 + 안내 안 끔 → true (매 차단마다 노출)
     */
    fun shouldShowFilterModeHint(
        isBlurMode: Boolean,
        dontShowFilterHint: Boolean,
    ): Boolean {
        if (isBlurMode) return false
        if (dontShowFilterHint) return false
        return true
    }

    private fun extractHost(url: String): String? {
        return try {
            java.net.URI(url).host
        } catch (_: URISyntaxException) {
            null
        }
    }

    private fun extractPath(url: String): String? {
        return try {
            java.net.URI(url).path
        } catch (_: URISyntaxException) {
            null
        }
    }
}
