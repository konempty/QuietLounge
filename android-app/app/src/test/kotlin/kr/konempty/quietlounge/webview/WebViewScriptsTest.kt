package kr.konempty.quietlounge.webview

import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockedUser
import kr.konempty.quietlounge.data.FilterMode
import kr.konempty.quietlounge.data.NicknameOnlyBlock
import kr.konempty.quietlounge.data.PersonaCacheEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebViewScriptsTest {
    private val emptyData = BlockListData()

    @Test
    fun `renderTemplate — 두 플레이스홀더 모두 치환`() {
        val template = "BLOCK=${WebViewScripts.BLOCK_DATA_PLACEHOLDER};MODE=${WebViewScripts.FILTER_MODE_PLACEHOLDER};"
        val out = WebViewScripts.renderTemplate(template, emptyData, FilterMode.Hide)
        assertFalse(out.contains(WebViewScripts.BLOCK_DATA_PLACEHOLDER))
        assertFalse(out.contains(WebViewScripts.FILTER_MODE_PLACEHOLDER))
        assertTrue(out.contains("MODE=hide;"))
    }

    @Test
    fun `renderTemplate — FilterMode blur 치환`() {
        val template = "m=${WebViewScripts.FILTER_MODE_PLACEHOLDER}"
        val out = WebViewScripts.renderTemplate(template, emptyData, FilterMode.Blur)
        assertEquals("m=blur", out)
    }

    @Test
    fun `renderTemplate — blockData 직렬화에 필수 키 포함`() {
        val template = WebViewScripts.BLOCK_DATA_PLACEHOLDER
        val out = WebViewScripts.renderTemplate(template, emptyData, FilterMode.Hide)
        // encodeDefaults = true 이므로 기본 필드들까지 포함
        assertTrue(out.contains("\"version\":2"))
        assertTrue(out.contains("\"blockedUsers\":{}"))
        assertTrue(out.contains("\"nicknameOnlyBlocks\":[]"))
        assertTrue(out.contains("\"personaCache\":{}"))
    }

    @Test
    fun `renderTemplate — blockedUsers 내용 포함`() {
        val data =
            BlockListData(
                blockedUsers =
                    mapOf(
                        "p1" to BlockedUser("p1", "닉네임", listOf("이전"), "2026-01-01T00:00:00Z", "스팸"),
                    ),
                nicknameOnlyBlocks = listOf(NicknameOnlyBlock("only", "2026-01-02T00:00:00Z", "")),
                personaCache = mapOf("p2" to PersonaCacheEntry("캐시", "2026-01-03T00:00:00Z")),
            )
        val template = WebViewScripts.BLOCK_DATA_PLACEHOLDER
        val out = WebViewScripts.renderTemplate(template, data, FilterMode.Hide)
        assertTrue(out.contains("\"p1\""))
        assertTrue(out.contains("\"닉네임\""))
        assertTrue(out.contains("\"이전\""))
        assertTrue(out.contains("\"only\""))
        assertTrue(out.contains("\"캐시\""))
    }

    @Test
    fun `renderTemplate — 플레이스홀더 없으면 원본 유지`() {
        val template = "no placeholders here"
        val out = WebViewScripts.renderTemplate(template, emptyData, FilterMode.Hide)
        assertEquals(template, out)
    }

    @Test
    fun `renderTemplate — 같은 플레이스홀더 여러 번 치환`() {
        val template =
            "${WebViewScripts.BLOCK_DATA_PLACEHOLDER}|${WebViewScripts.BLOCK_DATA_PLACEHOLDER}"
        val out = WebViewScripts.renderTemplate(template, emptyData, FilterMode.Hide)
        assertFalse(out.contains(WebViewScripts.BLOCK_DATA_PLACEHOLDER))
        // 두 번 모두 치환됐는지 — '|' 기준으로 양쪽 동일한 JSON
        val parts = out.split("|")
        assertEquals(2, parts.size)
        assertEquals(parts[0], parts[1])
    }

    @Test
    fun `buildBlockListUpdate — 핵심 문자열 포함`() {
        val data =
            BlockListData(
                blockedUsers =
                    mapOf("p1" to BlockedUser("p1", "n", emptyList(), "2026-01-01T00:00:00Z", "")),
            )
        val script = WebViewScripts.buildBlockListUpdate(data)
        assertTrue(script.contains("window.__QL_BLOCK_DATA ="))
        assertTrue(script.contains("window.__QL_onBlockListUpdate"))
        assertTrue(script.contains("\"p1\""))
        assertTrue(script.trimEnd().endsWith("true;"))
    }

    @Test
    fun `buildFilterModeUpdate — mode 문자열 주입`() {
        val script = WebViewScripts.buildFilterModeUpdate(FilterMode.Blur)
        assertTrue(script.contains("window.__QL_setFilterMode"))
        assertTrue(script.contains("'blur'"))
        assertTrue(script.trimEnd().endsWith("true;"))
    }

    @Test
    fun `buildFilterModeUpdate — Hide`() {
        val script = WebViewScripts.buildFilterModeUpdate(FilterMode.Hide)
        assertTrue(script.contains("'hide'"))
    }

    @Test
    fun `buildOpenPostUrl — 정상 postId`() {
        val script = WebViewScripts.buildOpenPostUrl("abc123")
        assertTrue(script.contains("https://lounge.naver.com/posts/abc123"))
        assertTrue(script.trimEnd().endsWith("true;"))
    }

    @Test
    fun `buildOpenPostUrl — 싱글쿼터 제거 (JS 인젝션 방지)`() {
        val script = WebViewScripts.buildOpenPostUrl("abc'; alert(1);//")
        // 싱글쿼터가 전부 제거되어야 함
        val urlPart = script.substringAfter("posts/").substringBefore("'")
        assertFalse(urlPart.contains("'"))
        assertTrue(script.contains("https://lounge.naver.com/posts/"))
    }

    @Test
    fun `buildOpenPostUrl — 빈 문자열`() {
        val script = WebViewScripts.buildOpenPostUrl("")
        assertTrue(script.contains("https://lounge.naver.com/posts/"))
    }
}
