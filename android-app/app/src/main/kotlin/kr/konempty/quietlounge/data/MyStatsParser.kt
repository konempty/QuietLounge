package kr.konempty.quietlounge.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Calendar

/**
 * MyStatsRepository 가 API 응답을 해석하는 순수 로직 — Context/네트워크 의존성 없음.
 *
 * API 스펙 변화/필드 누락/형식 변경에 대비한 회귀 테스트가 핵심.
 */
object MyStatsParser {
    data class Stats(
        val nickname: String,
        val totalPosts: Int,
        val totalComments: Int,
        val createTime: String?,
    )

    data class Cursor(
        val hasNext: Boolean,
        val endCursor: String,
    )

    /** /members/me/personas 응답에서 personaId 추출. data 가 array/object 모두 지원. */
    fun parsePersonaId(meJson: JsonElement?): String? {
        val root = (meJson as? JsonObject) ?: return null
        val meData =
            when (val raw = root["data"]) {
                is JsonArray -> raw.firstOrNull() as? JsonObject
                is JsonObject -> raw
                else -> null
            }
        return meData
            ?.get("personaId")
            ?.jsonPrimitive
            ?.contentOrNull
            ?.takeIf { it.isNotBlank() }
    }

    /** /personas/{id} 응답에서 닉네임 / 총 포스트 / 총 댓글 / 가입 시점 추출. */
    fun parseStats(statsJson: JsonElement?): Stats? {
        val root = (statsJson as? JsonObject) ?: return null
        val data = root["data"] as? JsonObject ?: return null
        return Stats(
            nickname = data["nickname"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            totalPosts = data["totalPostCount"]?.jsonPrimitive?.intOrNull ?: 0,
            totalComments = data["totalCommentCount"]?.jsonPrimitive?.intOrNull ?: 0,
            createTime = data["createTime"]?.jsonPrimitive?.contentOrNull,
        )
    }

    /** 계정 가입이 이번달 이내인지. createTime 파싱 실패면 false. */
    fun isCreatedThisMonth(
        createTime: String?,
        monthStartMillis: Long,
    ): Boolean {
        val millis = IsoDate.parseMillis(createTime) ?: return false
        return millis >= monthStartMillis
    }

    /** activities/{type} 응답에서 commentId/postId 추출. */
    fun extractActivityIds(
        actJson: JsonElement?,
        isComments: Boolean,
    ): List<String> {
        val root = (actJson as? JsonObject) ?: return emptyList()
        val actData = root["data"] as? JsonObject ?: return emptyList()
        val items = actData["items"] as? JsonArray ?: return emptyList()
        val key = if (isComments) "commentId" else "postId"
        return items.mapNotNull {
            (it as? JsonObject)?.get(key)?.jsonPrimitive?.contentOrNull
        }
    }

    /** activities 응답의 cursorInfo 파싱. 없으면 hasNext=false. */
    fun parseCursor(actJson: JsonElement?): Cursor {
        val root = (actJson as? JsonObject) ?: return Cursor(false, "")
        val actData = root["data"] as? JsonObject ?: return Cursor(false, "")
        val cursorInfo = actData["cursorInfo"] as? JsonObject ?: return Cursor(false, "")
        val hasNext =
            cursorInfo["hasNext"]
                ?.jsonPrimitive
                ?.contentOrNull
                ?.toBooleanStrictOrNull() ?: false
        val endCursor = cursorInfo["endCursor"]?.jsonPrimitive?.contentOrNull.orEmpty()
        return Cursor(hasNext = hasNext, endCursor = endCursor)
    }

    data class PageCount(
        val countInMonth: Int,
        val hasThisMonth: Boolean,
    )

    /** /content-api/v1/posts 응답에서 이번달 이상 작성된 글 수 계산. */
    fun countPostsInMonth(
        detailJson: JsonElement?,
        monthStartMillis: Long,
    ): PageCount {
        val root = (detailJson as? JsonObject) ?: return PageCount(0, false)
        val details = root["data"] as? JsonArray ?: return PageCount(0, false)
        var count = 0
        var hasThisMonth = false
        for (entry in details) {
            val obj = entry as? JsonObject ?: continue
            val dateStr = obj["createTime"]?.jsonPrimitive?.contentOrNull
            val ts = IsoDate.parseMillis(dateStr) ?: continue
            if (ts >= monthStartMillis) {
                count++
                hasThisMonth = true
            }
        }
        return PageCount(count, hasThisMonth)
    }

    /** /content-api/v1/comments 응답의 rawResponse(JSON string) 을 파싱해 이번달 댓글 수 계산. */
    fun countCommentsInMonth(
        detailJson: JsonElement?,
        monthStartMillis: Long,
    ): PageCount {
        val root = (detailJson as? JsonObject) ?: return PageCount(0, false)
        val data = root["data"] as? JsonObject ?: return PageCount(0, false)
        val raw = data["rawResponse"]?.jsonPrimitive?.contentOrNull
        if (raw.isNullOrEmpty()) return PageCount(0, false)

        var count = 0
        var hasThisMonth = false
        runCatching {
            val parsed =
                kotlinx.serialization.json.Json
                    .parseToJsonElement(raw)
                    .jsonObject
            val commentList =
                (parsed["result"] as? JsonObject)?.get("commentList") as? JsonArray
                    ?: JsonArray(emptyList())
            for (entry in commentList) {
                val obj = entry as? JsonObject ?: continue
                val regDate = obj["regTimeGmt"]?.jsonPrimitive?.contentOrNull
                val ts = IsoDate.parseMillis(regDate) ?: continue
                if (ts >= monthStartMillis) {
                    count++
                    hasThisMonth = true
                }
            }
        }
        return PageCount(count, hasThisMonth)
    }

    /** 주어진 시점 기준 이번달 시작 millis (UTC). */
    fun startOfMonthMillis(nowMillis: Long): Long {
        val cal =
            Calendar.getInstance().apply {
                timeInMillis = nowMillis
                set(Calendar.DAY_OF_MONTH, 1)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
        return cal.timeInMillis
    }
}
