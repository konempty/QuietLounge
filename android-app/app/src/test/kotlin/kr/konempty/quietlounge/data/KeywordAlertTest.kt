package kr.konempty.quietlounge.data

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KeywordAlertTest {
    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

    @Test
    fun `KeywordAlert — 기본 필드 직렬화`() {
        val alert =
            KeywordAlert(
                id = "id1",
                channelId = "ch1",
                channelName = "공지채널",
                keywords = listOf("긴급", "공지"),
                enabled = true,
                createdAt = "2026-04-01T00:00:00Z",
            )
        val raw = json.encodeToString(KeywordAlert.serializer(), alert)
        val parsed = json.decodeFromString(KeywordAlert.serializer(), raw)
        assertEquals(alert, parsed)
    }

    @Test
    fun `KeywordAlert — enabled 기본값 true`() {
        val raw = """{"id":"i","channelId":"c","channelName":"n","keywords":[],"createdAt":"t"}"""
        val parsed = json.decodeFromString(KeywordAlert.serializer(), raw)
        assertTrue(parsed.enabled)
    }

    @Test
    fun `KeywordAlert 리스트 직렬화 왕복`() {
        val list =
            listOf(
                KeywordAlert("1", "c1", "채널1", listOf("a"), true, "t"),
                KeywordAlert("2", "c2", "채널2", listOf("b", "c"), false, "t"),
            )
        val serializer = ListSerializer(KeywordAlert.serializer())
        val raw = json.encodeToString(serializer, list)
        val parsed = json.decodeFromString(serializer, raw)
        assertEquals(list, parsed)
    }

    @Test
    fun `빈 keywords 리스트 허용`() {
        val alert = KeywordAlert("i", "c", "n", emptyList(), true, "t")
        val raw = json.encodeToString(KeywordAlert.serializer(), alert)
        val parsed = json.decodeFromString(KeywordAlert.serializer(), raw)
        assertTrue(parsed.keywords.isEmpty())
    }

    @Test
    fun `한글 채널 및 키워드 유니코드 보존`() {
        val alert = KeywordAlert("i", "c", "연예가중계", listOf("아이유", "BTS"), true, "t")
        val raw = json.encodeToString(KeywordAlert.serializer(), alert)
        val parsed = json.decodeFromString(KeywordAlert.serializer(), raw)
        assertEquals("연예가중계", parsed.channelName)
        assertEquals(listOf("아이유", "BTS"), parsed.keywords)
    }

    @Test
    fun `copy — 원본 불변`() {
        val a = KeywordAlert("i", "c", "n", listOf("k"), true, "t")
        val b = a.copy(enabled = false)
        assertTrue(a.enabled)
        assertTrue(!b.enabled)
    }
}
