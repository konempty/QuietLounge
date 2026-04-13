package kr.konempty.quietlounge.webview

import android.content.Context
import kotlinx.serialization.json.Json
import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.FilterMode

/**
 * assets/webview-scripts/{before,after}.js 를 로드하고 동적 부분(blockData, filterMode)을
 * 치환해 WebView 에 주입할 JS 문자열을 생성.
 *
 * before.js / after.js 동적 치환 + blockData push / filterMode push 스크립트 생성.
 */
object WebViewScripts {
    private const val BLOCK_DATA_PLACEHOLDER = "__QL_BLOCK_DATA_PLACEHOLDER__"
    private const val FILTER_MODE_PLACEHOLDER = "__QL_FILTER_MODE_PLACEHOLDER__"

    private val json = Json { encodeDefaults = true }

    @Volatile private var beforeCache: String? = null

    @Volatile private var afterTemplateCache: String? = null

    fun loadBefore(context: Context): String {
        beforeCache?.let { return it }
        val text =
            context.assets
                .open("webview-scripts/before.js")
                .bufferedReader()
                .use { it.readText() }
        beforeCache = text
        return text
    }

    private fun loadAfterTemplate(context: Context): String {
        afterTemplateCache?.let { return it }
        val text =
            context.assets
                .open("webview-scripts/after.js")
                .bufferedReader()
                .use { it.readText() }
        afterTemplateCache = text
        return text
    }

    fun buildAfter(
        context: Context,
        blockData: BlockListData,
        filterMode: FilterMode,
    ): String {
        val template = loadAfterTemplate(context)
        val blockDataJson = json.encodeToString(BlockListData.serializer(), blockData)
        return template
            .replace(BLOCK_DATA_PLACEHOLDER, blockDataJson)
            .replace(FILTER_MODE_PLACEHOLDER, filterMode.value)
    }

    fun buildBlockListUpdate(blockData: BlockListData): String {
        val blockDataJson = json.encodeToString(BlockListData.serializer(), blockData)
        return """
            (function () {
              window.__QL_BLOCK_DATA = $blockDataJson;
              if (window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate();
            })();
            true;
            """.trimIndent()
    }

    fun buildFilterModeUpdate(mode: FilterMode): String {
        return """
            (function () {
              if (window.__QL_setFilterMode) window.__QL_setFilterMode('${mode.value}');
            })();
            true;
            """.trimIndent()
    }

    fun buildOpenPostUrl(postId: String): String {
        // 네이티브 알림 클릭 → 해당 게시글로 이동
        val safe = postId.replace("'", "")
        return "window.location.href = 'https://lounge.naver.com/posts/$safe'; true;"
    }
}
