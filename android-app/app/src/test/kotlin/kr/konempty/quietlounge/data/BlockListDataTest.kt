package kr.konempty.quietlounge.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class BlockListDataTest {
    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

    @Test
    fun `BlockListData — 빈 객체 직렬화`() {
        val data = BlockListData()
        val raw = json.encodeToString(BlockListData.serializer(), data)
        val parsed = json.decodeFromString(BlockListData.serializer(), raw)
        assertEquals(data, parsed)
    }

    @Test
    fun `BlockListData — 풍부한 데이터 왕복`() {
        val data =
            BlockListData(
                version = 2,
                blockedUsers =
                    mapOf(
                        "p1" to BlockedUser("p1", "n1", listOf("old"), "2026-01-01T00:00:00Z", "스팸"),
                    ),
                nicknameOnlyBlocks = listOf(NicknameOnlyBlock("nonly", "2026-01-02T00:00:00Z", "")),
                personaCache = mapOf("p2" to PersonaCacheEntry("cached", "2026-01-03T00:00:00Z")),
            )
        val raw = json.encodeToString(BlockListData.serializer(), data)
        val parsed = json.decodeFromString(BlockListData.serializer(), raw)
        assertEquals(data, parsed)
    }

    @Test
    fun `알 수 없는 필드 무시`() {
        val raw = """{"version":2,"blockedUsers":{},"nicknameOnlyBlocks":[],"personaCache":{},"extra":"ignored"}"""
        val parsed = json.decodeFromString(BlockListData.serializer(), raw)
        assertEquals(2, parsed.version)
    }

    @Test
    fun `FilterMode — fromValue 매핑`() {
        assertEquals(FilterMode.Blur, FilterMode.fromValue("blur"))
        assertEquals(FilterMode.Hide, FilterMode.fromValue("hide"))
        assertEquals(FilterMode.Hide, FilterMode.fromValue(null))
        assertEquals(FilterMode.Hide, FilterMode.fromValue("unknown"))
    }

    @Test
    fun `FilterMode — value 속성`() {
        assertEquals("hide", FilterMode.Hide.value)
        assertEquals("blur", FilterMode.Blur.value)
    }

    @Test
    fun `BlockedUser — previousNicknames 기본값 빈 리스트`() {
        val raw = """{"personaId":"p1","nickname":"n","blockedAt":"2026-01-01T00:00:00Z"}"""
        val parsed = json.decodeFromString(BlockedUser.serializer(), raw)
        assertEquals(emptyList<String>(), parsed.previousNicknames)
        assertEquals("", parsed.reason)
    }

    @Test
    fun `NicknameOnlyBlock — reason 기본값`() {
        val raw = """{"nickname":"a","blockedAt":"2026-01-01T00:00:00Z"}"""
        val parsed = json.decodeFromString(NicknameOnlyBlock.serializer(), raw)
        assertEquals("", parsed.reason)
    }

    @Test
    fun `PersonaCacheEntry — 필드 검증`() {
        val entry = PersonaCacheEntry("nick", "2026-01-01T00:00:00Z")
        val raw = json.encodeToString(PersonaCacheEntry.serializer(), entry)
        val parsed = json.decodeFromString(PersonaCacheEntry.serializer(), raw)
        assertEquals(entry, parsed)
    }

    @Test
    fun `BlockListData copy — 불변성 검증`() {
        val original =
            BlockListData(
                blockedUsers =
                    mapOf(
                        "p1" to BlockedUser("p1", "n1", emptyList(), "2026-01-01T00:00:00Z", ""),
                    ),
            )
        val modified = original.copy(blockedUsers = emptyMap())
        assertNotNull(original.blockedUsers["p1"])
        assertEquals(0, modified.blockedUsers.size)
    }
}
