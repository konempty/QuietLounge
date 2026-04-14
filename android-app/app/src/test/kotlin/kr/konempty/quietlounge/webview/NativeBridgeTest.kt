package kr.konempty.quietlounge.webview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeBridgeTest {
    private fun collect(): Pair<NativeBridge, MutableList<BridgeMessage>> {
        val received = mutableListOf<BridgeMessage>()
        val bridge = NativeBridge { received += it }
        return bridge to received
    }

    @Test
    fun `BLOCK_USER — personaId와 nickname 파싱`() {
        val (bridge, received) = collect()
        bridge.postMessage(
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
        bridge.postMessage(
            """{"type":"BLOCK_USER","payload":{"nickname":"익명"}}""",
        )
        val msg = received.single() as BridgeMessage.BlockUser
        assertNull(msg.personaId)
        assertEquals("익명", msg.nickname)
    }

    @Test
    fun `BLOCK_USER — nickname 없으면 빈 문자열`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"type":"BLOCK_USER","payload":{"personaId":"p1"}}""")
        val msg = received.single() as BridgeMessage.BlockUser
        assertEquals("p1", msg.personaId)
        assertEquals("", msg.nickname)
    }

    @Test
    fun `PERSONA_MAP_UPDATE — personaCache 평탄화`() {
        val (bridge, received) = collect()
        bridge.postMessage(
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
        bridge.postMessage("""{"type":"PERSONA_MAP_UPDATE","payload":{}}""")
        val msg = received.single() as BridgeMessage.PersonaMapUpdate
        assertTrue(msg.personaCache.isEmpty())
    }

    @Test
    fun `PAGE_CHANGED — path 파싱`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"type":"PAGE_CHANGED","payload":{"path":"/channel/abc"}}""")
        val msg = received.single() as BridgeMessage.PageChanged
        assertEquals("/channel/abc", msg.path)
    }

    @Test
    fun `PAGE_CHANGED — path 누락 시 빈 문자열`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"type":"PAGE_CHANGED","payload":{}}""")
        val msg = received.single() as BridgeMessage.PageChanged
        assertEquals("", msg.path)
    }

    @Test
    fun `알 수 없는 타입 무시`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"type":"UNKNOWN","payload":{}}""")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `type 누락 시 무시`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"payload":{"nickname":"x"}}""")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `payload 누락해도 type만 있으면 기본값으로 처리`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"type":"BLOCK_USER"}""")
        val msg = received.single() as BridgeMessage.BlockUser
        assertNull(msg.personaId)
        assertEquals("", msg.nickname)
    }

    @Test
    fun `잘못된 JSON 무시 (예외 삼킴)`() {
        val (bridge, received) = collect()
        bridge.postMessage("not-json-at-all")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `빈 문자열 payload 무시`() {
        val (bridge, received) = collect()
        bridge.postMessage("")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `최상위가 JSON 배열이면 무시`() {
        val (bridge, received) = collect()
        bridge.postMessage("[1,2,3]")
        assertTrue(received.isEmpty())
    }

    @Test
    fun `여러 메시지 순차 수신`() {
        val (bridge, received) = collect()
        bridge.postMessage("""{"type":"BLOCK_USER","payload":{"nickname":"a"}}""")
        bridge.postMessage("""{"type":"PAGE_CHANGED","payload":{"path":"/x"}}""")
        bridge.postMessage("""{"type":"PERSONA_MAP_UPDATE","payload":{"personaCache":{"p1":"n"}}}""")
        assertEquals(3, received.size)
        assertTrue(received[0] is BridgeMessage.BlockUser)
        assertTrue(received[1] is BridgeMessage.PageChanged)
        assertTrue(received[2] is BridgeMessage.PersonaMapUpdate)
    }

    @Test
    fun `NAME 상수 값 고정`() {
        assertEquals("QuietLounge", NativeBridge.NAME)
    }
}
