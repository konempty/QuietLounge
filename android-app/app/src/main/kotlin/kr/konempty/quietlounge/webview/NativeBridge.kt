package kr.konempty.quietlounge.webview

import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * window.QuietLounge.postMessage(jsonString) — content script 가 호출하는 브릿지.
 *
 * 메시지 타입:
 *   BLOCK_USER          { personaId?, nickname }
 *   PERSONA_MAP_UPDATE  { personaMap, personaCache }
 *   PAGE_CHANGED        { path }
 *
 * Origin guard — 라운지 외부 frame (cross-origin iframe 포함) 의 bridge 호출 차단.
 *
 * 1차: `WebViewCompat.addWebMessageListener` + allowed origin rule (LoungeScreen 측 등록).
 *      lounge.naver.com 외 frame 은 listener 진입조차 안 함. iOS `frameInfo.request.url?.host`
 *      체크와 정책 대칭. `onPostMessage` 의 `sourceOrigin` / `isMainFrame` 로 추가 검증.
 *
 * 2차: `@JavascriptInterface postMessage` (legacy) — `WEB_MESSAGE_LISTENER` 미지원 환경에서만 사용.
 *      `addJavascriptInterface` 가 모든 frame 에 같은 객체를 노출하므로 *iframe bypass 가능* — 따라서
 *      이 path 는 차선. `currentHost` (top-level URL host) 만 본다.
 *
 * `WebViewClient` 콜백 (main thread) 에서 `setCurrentHost()` 로 mirror — `@Volatile` 로 thread-safe.
 * `@JavascriptInterface.postMessage` 는 background thread 에서 호출되므로 `webView.url` 직접 접근 불안전.
 */
class NativeBridge(
    private val onMessage: (BridgeMessage) -> Unit,
) : WebViewCompat.WebMessageListener {
    private val json = Json { ignoreUnknownKeys = true }

    @Volatile
    private var currentHost: String? = null

    // `WebViewClient` 콜백이 갱신. JS 에서는 호출 불가 (`@JavascriptInterface` 어노테이션 없음).
    // legacy `addJavascriptInterface` path 의 host guard 용도.
    fun setCurrentHost(host: String?) {
        currentHost = host
    }

    /** 1차 — `WebViewCompat.addWebMessageListener` 콜백. allowed origin rule 로 frame 단위 차단. */
    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        // allowed origin rule (LoungeScreen 측 register) 가 이미 lounge.naver.com 만 통과시키지만
        // 명시적으로 sourceOrigin host 한 번 더 검증 — defense-in-depth + 회귀 가드.
        if (!isLoungeHost(sourceOrigin.host)) return
        val payload = message.data ?: return
        dispatch(payload)
    }

    /** 2차 — legacy `addJavascriptInterface` fallback. */
    @JavascriptInterface
    fun postMessage(payload: String) {
        if (!isLoungeHost(currentHost)) return
        dispatch(payload)
    }

    private fun dispatch(payload: String) {
        try {
            val root: JsonObject = json.parseToJsonElement(payload).jsonObject
            val type = root["type"]?.jsonPrimitive?.contentOrNull ?: return
            val payloadObj = root["payload"] as? JsonObject ?: JsonObject(emptyMap())

            val message =
                when (type) {
                    "BLOCK_USER" ->
                        BridgeMessage.BlockUser(
                            personaId = payloadObj["personaId"]?.jsonPrimitive?.contentOrNull,
                            nickname = payloadObj["nickname"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        )

                    "PERSONA_MAP_UPDATE" -> {
                        val cacheObj = payloadObj["personaCache"] as? JsonObject
                        val cache =
                            cacheObj?.entries?.associate { (k, v) ->
                                k to (v.jsonPrimitive.contentOrNull.orEmpty())
                            } ?: emptyMap()
                        BridgeMessage.PersonaMapUpdate(personaCache = cache)
                    }

                    "PAGE_CHANGED" ->
                        BridgeMessage.PageChanged(
                            path = payloadObj["path"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        )

                    else -> return
                }
            onMessage(message)
        } catch (_: Throwable) {
            // 잘못된 메시지는 무시
        }
    }

    companion object {
        const val NAME = "QuietLounge"

        // `lounge.naver.com.evil.com` prefix 함정 차단을 위해 *exact match* 만 허용.
        // iOS `QuietLoungeCore.isLoungeHost` 와 정책 대칭.
        fun isLoungeHost(host: String?): Boolean = host == "lounge.naver.com"
    }
}

sealed interface BridgeMessage {
    data class BlockUser(
        val personaId: String?,
        val nickname: String,
    ) : BridgeMessage

    data class PersonaMapUpdate(
        val personaCache: Map<String, String>,
    ) : BridgeMessage

    data class PageChanged(
        val path: String,
    ) : BridgeMessage
}
