package kr.konempty.quietlounge.webview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.experimental.runners.Enclosed
import org.junit.runner.RunWith

/**
 * iOS QuietLoungeCore 의 동일 로직과 시맨틱 매칭 테스트.
 * — currentUrl null/empty 는 "홈으로 가는 중" → homeEnabled=false (iOS 와 동일).
 * — `lounge.naver.com` 의 루트만 홈, sub-path 는 홈 아님.
 * — 서브도메인(`m.lounge.naver.com` 등)도 홈으로 인정.
 */
@RunWith(Enclosed::class)
class WebViewToolbarLogicTest {
    class ComputeToolbarStateTests {
        @Test
        fun `초기 — URL 없으면 모든 네비 및 홈 비활성, RELOAD 모드`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = false,
                    canGoForward = false,
                    isLoading = false,
                    currentUrl = null,
                )
            assertFalse(s.backEnabled)
            assertFalse(s.forwardEnabled)
            assertFalse(s.homeEnabled)
            assertEquals(WebViewToolbarLogic.ReloadMode.RELOAD, s.reloadMode)
        }

        @Test
        fun `라운지 홈 — 홈 버튼 비활성`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = true,
                    canGoForward = false,
                    isLoading = false,
                    currentUrl = "https://lounge.naver.com/",
                )
            assertFalse(s.homeEnabled)
            assertTrue(s.backEnabled)
        }

        @Test
        fun `채널 페이지 — 홈 버튼 활성`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = true,
                    canGoForward = false,
                    isLoading = false,
                    currentUrl = "https://lounge.naver.com/channel/some",
                )
            assertTrue(s.homeEnabled)
        }

        @Test
        fun `로딩 중 — STOP 모드`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = false,
                    canGoForward = false,
                    isLoading = true,
                    currentUrl = "https://lounge.naver.com/",
                )
            assertEquals(WebViewToolbarLogic.ReloadMode.STOP, s.reloadMode)
        }

        @Test
        fun `로딩 끝 — RELOAD 모드`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = false,
                    canGoForward = false,
                    isLoading = false,
                    currentUrl = "https://lounge.naver.com/",
                )
            assertEquals(WebViewToolbarLogic.ReloadMode.RELOAD, s.reloadMode)
        }

        @Test
        fun `back forward 패스스루`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = true,
                    canGoForward = true,
                    isLoading = false,
                    currentUrl = "https://lounge.naver.com/channel/x",
                )
            assertTrue(s.backEnabled)
            assertTrue(s.forwardEnabled)
            assertTrue(s.homeEnabled)
        }

        @Test
        fun `빈 문자열 URL — null 과 동일하게 처리 (홈 비활성)`() {
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = false,
                    canGoForward = false,
                    isLoading = false,
                    currentUrl = "",
                )
            assertFalse(s.homeEnabled)
        }

        @Test
        fun `잘못된 URL — 안전하게 fallback (homeEnabled=true 또는 false 모두 일관 보장)`() {
            // 파싱 실패 → 홈 아님으로 판정 → 홈 버튼 활성 (사용자가 클릭으로 라운지 홈 갈 수 있도록).
            val s =
                WebViewToolbarLogic.computeToolbarState(
                    canGoBack = false,
                    canGoForward = false,
                    isLoading = false,
                    currentUrl = "javascript:void(0)",
                )
            // 홈이 아니라고 판정 → 홈 버튼 활성. crash 만 안 나면 OK.
            assertTrue(s.homeEnabled)
        }
    }

    class ShouldShowToolbarHintTests {
        @Test
        fun `둘 다 false — 안내 표시`() {
            assertTrue(
                WebViewToolbarLogic.shouldShowToolbarHint(
                    showWebViewToolbar = false,
                    dontShowToolbarHint = false,
                ),
            )
        }

        @Test
        fun `이미 툴바 켰으면 안내 안 함`() {
            assertFalse(
                WebViewToolbarLogic.shouldShowToolbarHint(
                    showWebViewToolbar = true,
                    dontShowToolbarHint = false,
                ),
            )
        }

        @Test
        fun `다시 보지 않기 선택했으면 안내 안 함`() {
            assertFalse(
                WebViewToolbarLogic.shouldShowToolbarHint(
                    showWebViewToolbar = false,
                    dontShowToolbarHint = true,
                ),
            )
        }

        @Test
        fun `툴바 켰고 다시 보지 않기도 누른 경우 — 안내 안 함`() {
            assertFalse(
                WebViewToolbarLogic.shouldShowToolbarHint(
                    showWebViewToolbar = true,
                    dontShowToolbarHint = true,
                ),
            )
        }
    }

    class ShouldShowFilterModeHintTests {
        @Test
        fun `HIDE 모드 + dontShow false — 안내 표시`() {
            assertTrue(
                WebViewToolbarLogic.shouldShowFilterModeHint(
                    isBlurMode = false,
                    dontShowFilterHint = false,
                ),
            )
        }

        @Test
        fun `이미 BLUR 모드면 안내 안 함`() {
            assertFalse(
                WebViewToolbarLogic.shouldShowFilterModeHint(
                    isBlurMode = true,
                    dontShowFilterHint = false,
                ),
            )
        }

        @Test
        fun `다시 보지 않기 누른 사용자 안내 안 함`() {
            assertFalse(
                WebViewToolbarLogic.shouldShowFilterModeHint(
                    isBlurMode = false,
                    dontShowFilterHint = true,
                ),
            )
        }

        @Test
        fun `BLUR 모드이면서 다시 보지 않기도 누른 경우 안내 안 함`() {
            assertFalse(
                WebViewToolbarLogic.shouldShowFilterModeHint(
                    isBlurMode = true,
                    dontShowFilterHint = true,
                ),
            )
        }
    }

    class IsLoungeHomeTests {
        @Test
        fun `홈 — path 없는 호스트`() {
            assertTrue(WebViewToolbarLogic.isLoungeHome("https://lounge.naver.com"))
        }

        @Test
        fun `홈 — 루트 path`() {
            assertTrue(WebViewToolbarLogic.isLoungeHome("https://lounge.naver.com/"))
        }

        @Test
        fun `홈 아님 — 채널 sub-path`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome("https://lounge.naver.com/channel/x"))
        }

        @Test
        fun `홈 아님 — posts sub-path`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome("https://lounge.naver.com/posts/123"))
        }

        @Test
        fun `홈 아님 — 다른 호스트`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome("https://www.naver.com/"))
        }

        @Test
        fun `홈 아님 — 비슷하지만 호스트가 다름`() {
            // 'lounge.naver.com.evil.com' 같은 prefix-match 함정 방어
            assertFalse(WebViewToolbarLogic.isLoungeHome("https://lounge.naver.com.evil.com/"))
        }

        @Test
        fun `홈 — 서브도메인 인정`() {
            assertTrue(WebViewToolbarLogic.isLoungeHome("https://m.lounge.naver.com/"))
        }

        @Test
        fun `홈 아님 — 서브도메인이지만 sub-path 있음`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome("https://m.lounge.naver.com/channel/x"))
        }

        @Test
        fun `null URL — 홈 아님`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome(null))
        }

        @Test
        fun `빈 문자열 — 홈 아님`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome(""))
        }

        @Test
        fun `잘못된 URL — 홈 아님 (파싱 실패 안전 처리)`() {
            assertFalse(WebViewToolbarLogic.isLoungeHome("not a url"))
        }
    }
}
