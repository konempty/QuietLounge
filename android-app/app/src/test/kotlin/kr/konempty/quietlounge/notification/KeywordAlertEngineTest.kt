package kr.konempty.quietlounge.notification

import kr.konempty.quietlounge.data.KeywordAlert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeywordAlertEngineTest {
    private fun alert(
        keywords: List<String>,
        channelName: String = "채널A",
        channelId: String = "ch1",
    ) = KeywordAlert(
        id = "a1",
        channelId = channelId,
        channelName = channelName,
        keywords = keywords,
        enabled = true,
        createdAt = "2026-01-01T00:00:00Z",
    )

    private fun post(
        id: String,
        title: String,
        createTime: String,
    ) = KeywordAlertEngine.PostDetail(id, title, createTime)

    @Test
    fun `lastChecked 이후 글만 매칭된다`() {
        val details =
            listOf(
                post("p1", "옛 공지", "2026-04-01T00:00:00Z"),
                post("p2", "새 공지", "2026-04-05T00:00:00Z"),
            )
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = "2026-04-03T00:00:00Z",
            )
        assertEquals(1, result.matches.size)
        assertEquals("p2", result.matches[0].postId)
    }

    @Test
    fun `lastChecked null이면 전체 글 대상 (매칭만 반환)`() {
        val details =
            listOf(
                post("p1", "공지A", "2026-04-01T00:00:00Z"),
                post("p2", "잡담", "2026-04-02T00:00:00Z"),
            )
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = null,
            )
        assertEquals(1, result.matches.size)
        assertEquals("p1", result.matches[0].postId)
    }

    @Test
    fun `키워드 대소문자 무시`() {
        val details = listOf(post("p1", "BTS 신곡", "2026-04-05T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("bts"))),
                lastChecked = null,
            )
        assertEquals(1, result.matches.size)
        assertEquals("bts", result.matches[0].matchedKeyword)
    }

    @Test
    fun `한글 키워드 매칭`() {
        val details = listOf(post("p1", "아이유 콘서트 공지", "2026-04-05T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("아이유"))),
                lastChecked = null,
            )
        assertEquals("아이유", result.matches.single().matchedKeyword)
    }

    @Test
    fun `매칭 없으면 matches 빈 리스트`() {
        val details = listOf(post("p1", "일상 글", "2026-04-05T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = null,
            )
        assertTrue(result.matches.isEmpty())
    }

    @Test
    fun `여러 키워드 중 첫 매칭만 반환`() {
        val details = listOf(post("p1", "공지 BTS 이벤트", "2026-04-05T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지", "BTS"))),
                lastChecked = null,
            )
        assertEquals(1, result.matches.size)
        assertEquals("공지", result.matches[0].matchedKeyword)
    }

    @Test
    fun `같은 post가 여러 alert에 매칭되면 각각 반환`() {
        val details = listOf(post("p1", "공지 이벤트", "2026-04-05T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts =
                    listOf(
                        alert(listOf("공지"), channelName = "채널A"),
                        alert(listOf("이벤트"), channelName = "채널A"),
                    ),
                lastChecked = null,
            )
        assertEquals(2, result.matches.size)
    }

    @Test
    fun `newLastChecked는 details의 최대 createTime`() {
        val details =
            listOf(
                post("p1", "a", "2026-04-01T00:00:00Z"),
                post("p2", "b", "2026-04-10T00:00:00Z"),
                post("p3", "c", "2026-04-05T00:00:00Z"),
            )
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("없음"))),
                lastChecked = "2026-03-01T00:00:00Z",
            )
        assertEquals("2026-04-10T00:00:00Z", result.newLastChecked)
    }

    @Test
    fun `매칭 없어도 newLastChecked 전진`() {
        val details = listOf(post("p1", "잡담", "2026-04-10T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = "2026-04-01T00:00:00Z",
            )
        assertTrue(result.matches.isEmpty())
        assertEquals("2026-04-10T00:00:00Z", result.newLastChecked)
    }

    @Test
    fun `details가 비어있으면 newLastChecked는 이전 값 그대로`() {
        val result =
            KeywordAlertEngine.processChannel(
                details = emptyList(),
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = "2026-04-01T00:00:00Z",
            )
        assertEquals("2026-04-01T00:00:00Z", result.newLastChecked)
    }

    @Test
    fun `details 모두 빈 createTime이면 newLastChecked는 이전 값`() {
        val details = listOf(post("p1", "a", ""), post("p2", "b", ""))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("a"))),
                lastChecked = "2026-04-01T00:00:00Z",
            )
        assertEquals("2026-04-01T00:00:00Z", result.newLastChecked)
    }

    @Test
    fun `createTime이 lastChecked와 정확히 같으면 제외 (strict greater than)`() {
        val details = listOf(post("p1", "공지", "2026-04-01T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = "2026-04-01T00:00:00Z",
            )
        assertTrue(result.matches.isEmpty())
    }

    @Test
    fun `createTime 파싱 실패하면 해당 글 스킵`() {
        val details =
            listOf(
                post("p1", "공지", "invalid-date"),
                post("p2", "공지2", "2026-04-05T00:00:00Z"),
            )
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"))),
                lastChecked = null,
            )
        assertEquals(1, result.matches.size)
        assertEquals("p2", result.matches[0].postId)
    }

    @Test
    fun `matched 필드 — 채널명과 키워드 함께 전달`() {
        val details = listOf(post("p1", "특별 공지", "2026-04-05T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = listOf(alert(listOf("공지"), channelName = "공식채널")),
                lastChecked = null,
            )
        val m = result.matches.single()
        assertEquals("p1", m.postId)
        assertEquals("특별 공지", m.title)
        assertEquals("공식채널", m.channelName)
        assertEquals("공지", m.matchedKeyword)
    }

    @Test
    fun `details null createTime 무시하고 나머지로 max 계산`() {
        val details =
            listOf(
                post("p1", "a", ""),
                post("p2", "b", "2026-04-10T00:00:00Z"),
            )
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = emptyList(),
                lastChecked = null,
            )
        assertEquals("2026-04-10T00:00:00Z", result.newLastChecked)
    }

    @Test
    fun `빈 alerts로 호출해도 newLastChecked 계산은 유효`() {
        val details = listOf(post("p1", "a", "2026-04-10T00:00:00Z"))
        val result =
            KeywordAlertEngine.processChannel(
                details = details,
                alerts = emptyList(),
                lastChecked = null,
            )
        assertTrue(result.matches.isEmpty())
        assertEquals("2026-04-10T00:00:00Z", result.newLastChecked)
    }

    @Test
    fun `details와 lastChecked 모두 없으면 newLastChecked null`() {
        val result =
            KeywordAlertEngine.processChannel(
                details = emptyList(),
                alerts = emptyList(),
                lastChecked = null,
            )
        assertNull(result.newLastChecked)
    }
}
