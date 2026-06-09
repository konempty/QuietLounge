package kr.konempty.quietlounge.webview

import android.content.Context
import android.net.Uri
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private fun mkBridge(): Pair<NativeBridge, MutableList<BridgeMessage>> {
    val received = mutableListOf<BridgeMessage>()
    return NativeBridge { received += it } to received
}

private val noopReplyProxy =
    object : JavaScriptReplyProxy() {
        override fun postMessage(message: String) {}

        override fun postMessage(byteArray: ByteArray) {}
    }

private fun postFromLounge(
    bridge: NativeBridge,
    data: String,
    isMainFrame: Boolean = true,
) {
    simulate(
        bridge = bridge,
        sourceOrigin = "https://lounge.naver.com",
        data = data,
        isMainFrame = isMainFrame,
    )
}

private fun simulate(
    bridge: NativeBridge,
    sourceOrigin: String,
    data: String,
    isMainFrame: Boolean = true,
) {
    val ctx: Context = ApplicationProvider.getApplicationContext()
    val view = WebView(ctx)
    bridge.onPostMessage(
        view = view,
        message = WebMessageCompat(data),
        sourceOrigin = Uri.parse(sourceOrigin),
        isMainFrame = isMainFrame,
        replyProxy = noopReplyProxy,
    )
}

@RunWith(RobolectricTestRunner::class)
class NativeBridgeTest {
    private fun collect(): Pair<NativeBridge, MutableList<BridgeMessage>> = mkBridge()

    @Test
    fun `BLOCK_USER — personaId와 nickname 파싱`() {
        val (bridge, received) = collect()
        postFromLounge(
            bridge,
            """{"type":"BLOCK_USER","payload":{"personaId":"p123","nickname":"유저"}}""",
        )
        assertEquals(1, received.size)
        val msg = received.single() as BridgeMessage.BlockUser
        assertEquals("p123", msg.personaId)
        assertEquals("유저", msg.nickname)
    }

    @Test
    fun `BLOCK_USER — personaId 없으면 null`() {
        val (bridge, received) = collect()
        postFromLounge(
            bridge,
            """{"type":"BLOCK_USER","payload":{"nickname":"익명"}}""",
        )
        val msg = received.single() as BridgeMessage.BlockUser
        assertNull(msg.personaId)
        assertEquals("익명", msg.nickname)
    }

    @Test
    fun `BLOCK_USER — nickname 없으면 빈 문자열`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"BLOCK_USER","payload":{"personaId":"p1"}}""")
        val msg = received.single() as BridgeMessage.BlockUser
        assertEquals("p1", msg.personaId)
        assertEquals("", msg.nickname)
    }

    @Test
    fun `PERSONA_MAP_UPDATE — personaCache 평탄화`() {
        val (bridge, received) = collect()
        postFromLounge(
            bridge,
            """{"type":"PERSONA_MAP_UPDATE","payload":{"personaCache":{"p1":"닉A","p2":"닉B"}}}""",
        )
        val msg = received.single() as BridgeMessage.PersonaMapUpdate
        assertEquals("닉A", msg.personaCache["p1"])
        assertEquals("닉B", msg.personaCache["p2"])
        assertEquals(2, msg.personaCache.size)
    }

    @Test
    fun `PERSONA_MAP_UPDATE — personaCache 누락 시 빈 맵`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"PERSONA_MAP_UPDATE","payload":{}}""")
        val msg = received.single() as BridgeMessage.PersonaMapUpdate
        assertTrue(msg.personaCache.isEmpty())
    }

    @Test
    fun `PAGE_CHANGED — path 파싱`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"PAGE_CHANGED","payload":{"path":"/channel/abc"}}""")
        val msg = received.single() as BridgeMessage.PageChanged
        assertEquals("/channel/abc", msg.path)
    }

    @Test
    fun `PAGE_CHANGED — path 누락 시 빈 문자열`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"PAGE_CHANGED","payload":{}}""")
        val msg = received.single() as BridgeMessage.PageChanged
        assertEquals("", msg.path)
    }

    @Test
    fun `알 수 없는 타입 무시`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"UNKNOWN","payload":{}}""")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `type 누락 시 무시`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"payload":{"nickname":"x"}}""")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `payload 누락해도 type만 있으면 기본값으로 처리`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"BLOCK_USER"}""")
        val msg = received.single() as BridgeMessage.BlockUser
        assertNull(msg.personaId)
        assertEquals("", msg.nickname)
    }

    @Test
    fun `잘못된 JSON 무시 (예외 삼킴)`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, "not-json-at-all")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `빈 문자열 payload 무시`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, "")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `최상위가 JSON 배열이면 무시`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, "[1,2,3]")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `여러 메시지 순차 수신`() {
        val (bridge, received) = collect()
        postFromLounge(bridge, """{"type":"BLOCK_USER","payload":{"nickname":"a"}}""")
        postFromLounge(bridge, """{"type":"PAGE_CHANGED","payload":{"path":"/x"}}""")
        postFromLounge(bridge, """{"type":"PERSONA_MAP_UPDATE","payload":{"personaCache":{"p1":"n"}}}""")
        assertEquals(3, received.size)
        assertTrue(received[0] is BridgeMessage.BlockUser)
        assertTrue(received[1] is BridgeMessage.PageChanged)
        assertTrue(received[2] is BridgeMessage.PersonaMapUpdate)
    }

    @Test
    fun `NAME 상수 값 고정`() {
        assertEquals("QuietLounge", NativeBridge.NAME)
    }

    @Test
    fun `companion isLoungeHost — exact match 만 허용`() {
        // iOS QuietLoungeCore_isLoungeHost 와 정책 대칭 검증.
        assertTrue(NativeBridge.isLoungeHost("lounge.naver.com"))
        assertEquals(false, NativeBridge.isLoungeHost(null))
        assertEquals(false, NativeBridge.isLoungeHost(""))
        assertEquals(false, NativeBridge.isLoungeHost("lounge.naver.com.evil.com"))
        assertEquals(false, NativeBridge.isLoungeHost("api.lounge.naver.com"))
        assertEquals(false, NativeBridge.isLoungeHost("naver.com"))
        assertEquals(false, NativeBridge.isLoungeHost("LOUNGE.NAVER.COM"))
        assertEquals(false, NativeBridge.isLoungeHost("evil.com"))
    }
}

// ── WebMessageListener (1차 origin guard) 회귀 가드 (52 라운드 Codex F1 — P1) ─────────
//
// `addWebMessageListener` 의 allowed origin rule 이 lounge.naver.com 외 frame 의 listener 호출을
// 차단하지만, 방어적으로 `onPostMessage` 진입점에서도 sourceOrigin host 검증. iframe bypass 시도가
// listener 까지 도달하더라도 차단되는지 확인. Robolectric 으로 Uri.parse / WebView 인스턴스화 지원.
@RunWith(RobolectricTestRunner::class)
class NativeBridgeWebMessageListenerTest {
    @Test
    fun `onPostMessage — main frame lounge_naver_com 통과`() {
        val (bridge, received) = mkBridge()
        simulate(bridge, "https://lounge.naver.com", """{"type":"PAGE_CHANGED","payload":{"path":"/x"}}""")
        assertEquals(1, received.size)
    }

    @Test
    fun `onPostMessage — main frame 이 아니어도 sourceOrigin 이 lounge면 통과 (same-origin iframe)`() {
        // 라운지 도메인 내부 iframe 은 trust boundary 안 — 처리 허용.
        val (bridge, received) = mkBridge()
        simulate(
            bridge,
            "https://lounge.naver.com",
            """{"type":"PAGE_CHANGED","payload":{"path":"/y"}}""",
            isMainFrame = false,
        )
        assertEquals(1, received.size)
    }

    @Test
    fun `onPostMessage — cross-origin iframe (evil_example) 차단 (P1 회귀 가드)`() {
        // 핵심 가드 — `addJavascriptInterface` 패턴에서 우회됐던 iframe bypass.
        val (bridge, received) = mkBridge()
        simulate(
            bridge,
            "https://evil.example",
            """{"type":"BLOCK_USER","payload":{"nickname":"악의"}}""",
            isMainFrame = false,
        )
        assertTrue(received.isEmpty())
    }

    @Test
    fun `onPostMessage — prefix 함정 (lounge_naver_com_evil_com) 차단`() {
        val (bridge, received) = mkBridge()
        simulate(
            bridge,
            "https://lounge.naver.com.evil.com",
            """{"type":"PERSONA_MAP_UPDATE","payload":{"personaCache":{"p":"n"}}}""",
        )
        assertTrue(received.isEmpty())
    }

    @Test
    fun `onPostMessage — 다른 sub-domain (api_lounge_naver_com) 차단`() {
        val (bridge, received) = mkBridge()
        simulate(
            bridge,
            "https://api.lounge.naver.com",
            """{"type":"PAGE_CHANGED","payload":{"path":"/z"}}""",
        )
        assertTrue(received.isEmpty())
    }
}
