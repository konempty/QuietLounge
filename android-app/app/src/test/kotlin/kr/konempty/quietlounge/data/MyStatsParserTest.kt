package kr.konempty.quietlounge.data

import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class MyStatsParserTest {
    private fun parse(raw: String) = Json.parseToJsonElement(raw)

    // ── parsePersonaId ─────────────────────────────────────────

    @Test
    fun `parsePersonaId — data 가 array 인 경우 첫 원소에서 추출`() {
        val id =
            MyStatsParser.parsePersonaId(
                parse("""{"data":[{"personaId":"p123"}]}"""),
            )
        assertEquals("p123", id)
    }

    @Test
    fun `parsePersonaId — data 가 object 인 경우`() {
        val id = MyStatsParser.parsePersonaId(parse("""{"data":{"personaId":"p1"}}"""))
        assertEquals("p1", id)
    }

    @Test
    fun `parsePersonaId — data 없으면 null`() {
        assertNull(MyStatsParser.parsePersonaId(parse("""{}""")))
    }

    @Test
    fun `parsePersonaId — personaId 없으면 null`() {
        assertNull(MyStatsParser.parsePersonaId(parse("""{"data":{"other":"x"}}""")))
    }

    @Test
    fun `parsePersonaId — personaId 빈 문자열이면 null`() {
        assertNull(MyStatsParser.parsePersonaId(parse("""{"data":{"personaId":""}}""")))
    }

    @Test
    fun `parsePersonaId — null 입력`() {
        assertNull(MyStatsParser.parsePersonaId(null))
    }

    @Test
    fun `parsePersonaId — 배열이 비어있으면 null`() {
        assertNull(MyStatsParser.parsePersonaId(parse("""{"data":[]}""")))
    }

    @Test
    fun `parsePersonaId — data 가 primitive 이면 null`() {
        assertNull(MyStatsParser.parsePersonaId(parse("""{"data":"str"}""")))
    }

    // ── parseStats ─────────────────────────────────────────────

    @Test
    fun `parseStats — 전체 필드`() {
        val s =
            MyStatsParser.parseStats(
                parse(
                    """{"data":{"nickname":"홍길동","totalPostCount":12,"totalCommentCount":34,"createTime":"2026-01-05T00:00:00Z"}}""",
                ),
            )!!
        assertEquals("홍길동", s.nickname)
        assertEquals(12, s.totalPosts)
        assertEquals(34, s.totalComments)
        assertEquals("2026-01-05T00:00:00Z", s.createTime)
    }

    @Test
    fun `parseStats — 필드 누락 시 기본값`() {
        val s = MyStatsParser.parseStats(parse("""{"data":{}}"""))!!
        assertEquals("", s.nickname)
        assertEquals(0, s.totalPosts)
        assertEquals(0, s.totalComments)
        assertNull(s.createTime)
    }

    @Test
    fun `parseStats — data 없으면 null`() {
        assertNull(MyStatsParser.parseStats(parse("""{}""")))
    }

    @Test
    fun `parseStats — null 입력`() {
        assertNull(MyStatsParser.parseStats(null))
    }

    // ── isCreatedThisMonth ─────────────────────────────────────

    @Test
    fun `isCreatedThisMonth — 월초 이후면 true`() {
        val monthStart = 1_000_000L
        val ts = IsoDate.parseMillis("2026-04-01T00:00:00Z")!!
        assertTrue(MyStatsParser.isCreatedThisMonth("2026-04-01T00:00:00Z", ts - 1))
        assertTrue(MyStatsParser.isCreatedThisMonth("2026-04-01T00:00:00Z", ts))
        assertFalse(MyStatsParser.isCreatedThisMonth("2026-04-01T00:00:00Z", ts + 1))
        assertFalse(MyStatsParser.isCreatedThisMonth(null, monthStart))
        assertFalse(MyStatsParser.isCreatedThisMonth("invalid", monthStart))
    }

    // ── extractActivityIds ─────────────────────────────────────

    @Test
    fun `extractActivityIds — posts 모드`() {
        val json = parse("""{"data":{"items":[{"postId":"a"},{"postId":"b"}]}}""")
        assertEquals(listOf("a", "b"), MyStatsParser.extractActivityIds(json, isComments = false))
    }

    @Test
    fun `extractActivityIds — comments 모드`() {
        val json = parse("""{"data":{"items":[{"commentId":"c1"},{"commentId":"c2"}]}}""")
        assertEquals(listOf("c1", "c2"), MyStatsParser.extractActivityIds(json, isComments = true))
    }

    @Test
    fun `extractActivityIds — 빈 items`() {
        val json = parse("""{"data":{"items":[]}}""")
        assertTrue(MyStatsParser.extractActivityIds(json, false).isEmpty())
    }

    @Test
    fun `extractActivityIds — items 없으면 빈 리스트`() {
        assertTrue(MyStatsParser.extractActivityIds(parse("""{"data":{}}"""), false).isEmpty())
    }

    @Test
    fun `extractActivityIds — data 없으면 빈 리스트`() {
        assertTrue(MyStatsParser.extractActivityIds(parse("""{}"""), false).isEmpty())
    }

    @Test
    fun `extractActivityIds — null 입력`() {
        assertTrue(MyStatsParser.extractActivityIds(null, false).isEmpty())
    }

    @Test
    fun `extractActivityIds — 잘못된 원소는 skip`() {
        val json = parse("""{"data":{"items":[{"postId":"a"},123,{"postId":"b"}]}}""")
        assertEquals(listOf("a", "b"), MyStatsParser.extractActivityIds(json, false))
    }

    // ── parseCursor ────────────────────────────────────────────

    @Test
    fun `parseCursor — hasNext true + endCursor`() {
        val json =
            parse("""{"data":{"cursorInfo":{"hasNext":"true","endCursor":"c100"}}}""")
        val c = MyStatsParser.parseCursor(json)
        assertTrue(c.hasNext)
        assertEquals("c100", c.endCursor)
    }

    @Test
    fun `parseCursor — hasNext false`() {
        val json =
            parse("""{"data":{"cursorInfo":{"hasNext":"false","endCursor":""}}}""")
        val c = MyStatsParser.parseCursor(json)
        assertFalse(c.hasNext)
    }

    @Test
    fun `parseCursor — cursorInfo 없음 기본값`() {
        val c = MyStatsParser.parseCursor(parse("""{"data":{}}"""))
        assertFalse(c.hasNext)
        assertEquals("", c.endCursor)
    }

    @Test
    fun `parseCursor — null 입력`() {
        val c = MyStatsParser.parseCursor(null)
        assertFalse(c.hasNext)
    }

    @Test
    fun `parseCursor — hasNext 이상한 값 false`() {
        val json = parse("""{"data":{"cursorInfo":{"hasNext":"maybe"}}}""")
        assertFalse(MyStatsParser.parseCursor(json).hasNext)
    }

    // ── countPostsInMonth ──────────────────────────────────────

    @Test
    fun `countPostsInMonth — 이번달 이상만 카운트`() {
        val monthStart = IsoDate.parseMillis("2026-04-01T00:00:00Z")!!
        val json =
            parse(
                """{"data":[
                    {"createTime":"2026-04-10T00:00:00Z"},
                    {"createTime":"2026-03-20T00:00:00Z"},
                    {"createTime":"2026-04-01T00:00:00Z"}
                ]}""",
            )
        val result = MyStatsParser.countPostsInMonth(json, monthStart)
        assertEquals(2, result.countInMonth)
        assertTrue(result.hasThisMonth)
    }

    @Test
    fun `countPostsInMonth — 전부 이전달이면 hasThisMonth false`() {
        val monthStart = IsoDate.parseMillis("2026-04-01T00:00:00Z")!!
        val json =
            parse("""{"data":[{"createTime":"2026-03-20T00:00:00Z"}]}""")
        val result = MyStatsParser.countPostsInMonth(json, monthStart)
        assertEquals(0, result.countInMonth)
        assertFalse(result.hasThisMonth)
    }

    @Test
    fun `countPostsInMonth — createTime 없거나 깨진 값 스킵`() {
        val monthStart = IsoDate.parseMillis("2026-04-01T00:00:00Z")!!
        val json =
            parse(
                """{"data":[
                    {"createTime":"2026-04-10T00:00:00Z"},
                    {"createTime":"invalid"},
                    {"no_time":1}
                ]}""",
            )
        val result = MyStatsParser.countPostsInMonth(json, monthStart)
        assertEquals(1, result.countInMonth)
    }

    @Test
    fun `countPostsInMonth — data 없으면 0`() {
        val result = MyStatsParser.countPostsInMonth(parse("""{}"""), 0)
        assertEquals(0, result.countInMonth)
        assertFalse(result.hasThisMonth)
    }

    @Test
    fun `countPostsInMonth — null 입력`() {
        val result = MyStatsParser.countPostsInMonth(null, 0)
        assertEquals(0, result.countInMonth)
    }

    // ── countCommentsInMonth ───────────────────────────────────

    @Test
    fun `countCommentsInMonth — rawResponse 안 commentList 파싱`() {
        val monthStart = IsoDate.parseMillis("2026-04-01T00:00:00Z")!!
        val inner =
            """{"result":{"commentList":[
                {"regTimeGmt":"2026-04-10T00:00:00+0900"},
                {"regTimeGmt":"2026-03-10T00:00:00+0900"},
                {"regTimeGmt":"2026-04-02T00:00:00+0900"}
            ]}}"""
        val outer =
            """{"data":{"rawResponse":${Json.encodeToString(String.serializer(),inner)}}}"""
        val result = MyStatsParser.countCommentsInMonth(parse(outer), monthStart)
        assertEquals(2, result.countInMonth)
        assertTrue(result.hasThisMonth)
    }

    @Test
    fun `countCommentsInMonth — rawResponse 빈 값`() {
        val json = parse("""{"data":{"rawResponse":""}}""")
        val result = MyStatsParser.countCommentsInMonth(json, 0)
        assertEquals(0, result.countInMonth)
        assertFalse(result.hasThisMonth)
    }

    @Test
    fun `countCommentsInMonth — rawResponse 없음`() {
        val result = MyStatsParser.countCommentsInMonth(parse("""{"data":{}}"""), 0)
        assertEquals(0, result.countInMonth)
    }

    @Test
    fun `countCommentsInMonth — rawResponse 가 JSON이 아니어도 예외 삼킴`() {
        val json = parse("""{"data":{"rawResponse":"not-json"}}""")
        val result = MyStatsParser.countCommentsInMonth(json, 0)
        assertEquals(0, result.countInMonth)
    }

    @Test
    fun `countCommentsInMonth — result 필드 없음`() {
        val inner = Json.encodeToString(String.serializer(), """{"other":"x"}""")
        val json = parse("""{"data":{"rawResponse":$inner}}""")
        val result = MyStatsParser.countCommentsInMonth(json, 0)
        assertEquals(0, result.countInMonth)
    }

    @Test
    fun `countCommentsInMonth — null 입력`() {
        assertEquals(0, MyStatsParser.countCommentsInMonth(null, 0).countInMonth)
    }

    // ── startOfMonthMillis ─────────────────────────────────────

    @Test
    fun `startOfMonthMillis — 주어진 시각의 월초 반환`() {
        // 2026-04-15 12:34:56 → 2026-04-01 00:00:00 (local)
        val cal = Calendar.getInstance(TimeZone.getDefault())
        cal.set(2026, Calendar.APRIL, 15, 12, 34, 56)
        cal.set(Calendar.MILLISECOND, 789)
        val monthStart = MyStatsParser.startOfMonthMillis(cal.timeInMillis)

        val expected = Calendar.getInstance(TimeZone.getDefault())
        expected.set(2026, Calendar.APRIL, 1, 0, 0, 0)
        expected.set(Calendar.MILLISECOND, 0)
        assertEquals(expected.timeInMillis, monthStart)
    }

    @Test
    fun `startOfMonthMillis — 월초 자신을 넣어도 동일`() {
        val cal = Calendar.getInstance(TimeZone.getDefault())
        cal.set(2026, Calendar.APRIL, 1, 0, 0, 0)
        cal.set(Calendar.MILLISECOND, 0)
        assertEquals(cal.timeInMillis, MyStatsParser.startOfMonthMillis(cal.timeInMillis))
    }
}
