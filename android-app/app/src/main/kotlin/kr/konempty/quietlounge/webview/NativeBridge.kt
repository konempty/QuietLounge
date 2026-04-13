package kr.konempty.quietlounge.webview

import android.webkit.JavascriptInterface
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
 */
class NativeBridge(
    private val onMessage: (BridgeMessage) -> Unit,
) {
    private val json = Json { ignoreUnknownKeys = true }

    @JavascriptInterface
    fun postMessage(payload: String) {
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
