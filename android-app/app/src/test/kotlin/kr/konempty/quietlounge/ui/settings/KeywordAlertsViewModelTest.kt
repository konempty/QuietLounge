package kr.konempty.quietlounge.ui.settings

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KeywordAlertsViewModelTest {
    private fun obj(raw: String) = Json.parseToJsonElement(raw) as JsonObject

    private fun arr(raw: String) = Json.parseToJsonElement(raw) as JsonArray

    // ── parseCategories ───────────────────────────────────────

    @Test
    fun `parseCategories — 정상 응답`() {
        val root =
            obj(
                """{"data":{"items":[
                    {"categoryId":1,"name":"인기"},
                    {"categoryId":2,"name":"공지"}
                ]}}""",
            )
        val cats = parseCategories(root)
        assertEquals(2, cats.size)
        assertEquals(1, cats[0].categoryId)
        assertEquals("인기", cats[0].name)
        assertEquals("공지", cats[1].name)
    }

    @Test
    fun `parseCategories — null 입력`() {
        assertTrue(parseCategories(null).isEmpty())
    }

    @Test
    fun `parseCategories — data 없으면 빈 리스트`() {
        assertTrue(parseCategories(obj("""{}""")).isEmpty())
    }

    @Test
    fun `parseCategories — items 없으면 빈 리스트`() {
        assertTrue(parseCategories(obj("""{"data":{}}""")).isEmpty())
    }

    @Test
    fun `parseCategories — categoryId 없는 항목 스킵`() {
        val root = obj("""{"data":{"items":[{"name":"무ID"},{"categoryId":3,"name":"정상"}]}}""")
        val cats = parseCategories(root)
        assertEquals(1, cats.size)
        assertEquals(3, cats[0].categoryId)
    }

    @Test
    fun `parseCategories — name 누락 시 빈 문자열`() {
        val root = obj("""{"data":{"items":[{"categoryId":7}]}}""")
        val cats = parseCategories(root)
        assertEquals("", cats[0].name)
    }

    @Test
    fun `parseCategories — 원소가 object 가 아니면 스킵`() {
        val root = obj("""{"data":{"items":[123,"str",{"categoryId":9,"name":"진짜"}]}}""")
        val cats = parseCategories(root)
        assertEquals(1, cats.size)
        assertEquals(9, cats[0].categoryId)
    }

    // ── parseChannelsPage ─────────────────────────────────────

    @Test
    fun `parseChannelsPage — 정상 응답`() {
        val items =
            arr(
                """[
                {"finalChannelId":"c1","name":"채널1"},
                {"finalChannelId":"c2","name":"채널2"}
            ]""",
            )
        val chs = parseChannelsPage(items)
        assertEquals(2, chs.size)
        assertEquals("c1", chs[0].finalChannelId)
        assertEquals("채널2", chs[1].name)
    }

    @Test
    fun `parseChannelsPage — finalChannelId 없으면 스킵`() {
        val items = arr("""[{"name":"이름만"},{"finalChannelId":"cx","name":"정상"}]""")
        val chs = parseChannelsPage(items)
        assertEquals(1, chs.size)
        assertEquals("cx", chs[0].finalChannelId)
    }

    @Test
    fun `parseChannelsPage — 빈 배열`() {
        assertTrue(parseChannelsPage(arr("[]")).isEmpty())
    }

    @Test
    fun `parseChannelsPage — object 가 아닌 원소 스킵`() {
        val items = arr("""[null, 42, {"finalChannelId":"ok","name":"통과"}]""")
        assertEquals(1, parseChannelsPage(items).size)
    }

    // ── parseTotalElements ───────────────────────────────────

    @Test
    fun `parseTotalElements — 정상`() {
        assertEquals(123, parseTotalElements(obj("""{"page":{"totalElements":123}}""")))
    }

    @Test
    fun `parseTotalElements — page 없으면 0`() {
        assertEquals(0, parseTotalElements(obj("""{}""")))
    }

    @Test
    fun `parseTotalElements — null 입력`() {
        assertEquals(0, parseTotalElements(null))
    }

    @Test
    fun `parseTotalElements — totalElements 누락 시 0`() {
        assertEquals(0, parseTotalElements(obj("""{"page":{}}""")))
    }

    // ── data 클래스 sanity ───────────────────────────────────

    @Test
    fun `CategoryItem 동등성`() {
        assertEquals(CategoryItem(1, "x"), CategoryItem(1, "x"))
    }

    @Test
    fun `ChannelItem 동등성`() {
        assertEquals(ChannelItem("c", "n"), ChannelItem("c", "n"))
    }

    @Test
    fun `KeywordAlertsUiState 기본값`() {
        val s = KeywordAlertsUiState()
        assertTrue(s.alerts.isEmpty())
        assertEquals(5, s.intervalMinutes)
    }
}
