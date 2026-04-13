package kr.konempty.quietlounge.data

import android.webkit.CookieManager
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kr.konempty.quietlounge.network.LoungeApi
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Calendar

/**
 * 내 활동 통계 조회 — personaId + 총 글/댓글 + 이번달 카운트.
 *
 * 1단계: /user-api/v1/members/me/personas → personaId
 * 2단계: /user-api/v1/personas/{personaId} → totalPostCount, totalCommentCount, createTime
 * 3단계: 이번달 작성글/댓글은 /activities/{posts|comments} 페이지네이션으로 카운트
 *
 * 쿠키는 WebView CookieManager 와 동일 세션을 공유한다.
 */
class MyStatsRepository {
    /**
     * monthlyPosts / monthlyComments — null 이면 아직 로딩중.
     */
    data class MyStats(
        val nickname: String,
        val totalPosts: Int,
        val totalComments: Int,
        val monthlyPosts: Int? = null,
        val monthlyComments: Int? = null,
    )

    private fun loungeCookieHeader(): String? {
        val cookies = CookieManager.getInstance().getCookie("https://api.lounge.naver.com")
        return cookies?.takeIf { it.isNotBlank() }
    }

    /**
     * 총 통계만 먼저 emit, 이후 monthly 카운트가 끝나면 한 번 더 emit.
     * @param onUpdate 진행 단계마다 호출 (UI 가 즉시 반영하도록)
     */
    suspend fun loadMyStats(onUpdate: suspend (MyStats?) -> Unit) {
        val cookies = loungeCookieHeader()
        // 1단계: me
        val meJson =
            LoungeApi
                .get("${LoungeApi.base()}/user-api/v1/members/me/personas", cookies)
                ?.jsonObject ?: run {
                onUpdate(null)
                return
            }

        val meData =
            when (val raw = meJson["data"]) {
                is JsonArray -> raw.firstOrNull() as? JsonObject
                is JsonObject -> raw
                else -> null
            }
        val personaId = meData?.get("personaId")?.jsonPrimitive?.contentOrNull
        if (personaId.isNullOrBlank()) {
            onUpdate(null)
            return
        }

        // 2단계: persona stats
        val statsJson =
            LoungeApi
                .get("${LoungeApi.base()}/user-api/v1/personas/$personaId", cookies)
                ?.jsonObject ?: run {
                onUpdate(null)
                return
            }
        val data =
            statsJson["data"] as? JsonObject ?: run {
                onUpdate(null)
                return
            }

        val totalPosts = data["totalPostCount"]?.jsonPrimitive?.intOrNull ?: 0
        val totalComments = data["totalCommentCount"]?.jsonPrimitive?.intOrNull ?: 0
        val nickname = data["nickname"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val createTime = data["createTime"]?.jsonPrimitive?.contentOrNull

        val base =
            MyStats(
                nickname = nickname,
                totalPosts = totalPosts,
                totalComments = totalComments,
                monthlyPosts = null,
                monthlyComments = null,
            )
        onUpdate(base)

        // 3단계: 이번달 카운트 (이번달에 가입한 계정이면 totalCount 를 그대로 쓴다)
        val monthStart = startOfThisMonth()
        val createdThisMonth =
            createTime?.let {
                try {
                    OffsetDateTime.parse(it).toInstant().toEpochMilli() >= monthStart
                } catch (_: Throwable) {
                    false
                }
            } ?: false

        if (createdThisMonth) {
            onUpdate(base.copy(monthlyPosts = totalPosts, monthlyComments = totalComments))
            return
        }

        // posts / comments 병렬 조회
        var current = base
        coroutineScope {
            launch {
                val count = fetchMonthlyCount(personaId, "posts", monthStart, cookies)
                current = current.copy(monthlyPosts = count)
                onUpdate(current)
            }
            launch {
                val count = fetchMonthlyCount(personaId, "comments", monthStart, cookies)
                current = current.copy(monthlyComments = count)
                onUpdate(current)
            }
        }
    }

    private suspend fun fetchMonthlyCount(
        personaId: String,
        type: String,
        monthStartMillis: Long,
        cookies: String?,
    ): Int {
        var count = 0
        var cursor = ""
        val isComments = type == "comments"

        for (page in 0 until 50) {
            val actUrl =
                buildString {
                    append("${LoungeApi.base()}/user-api/v1/personas/$personaId/activities/$type?limit=100")
                    if (cursor.isNotEmpty()) append("&cursor=$cursor")
                }
            val actJson = LoungeApi.get(actUrl, cookies)?.jsonObject ?: break
            val actData = actJson["data"] as? JsonObject ?: break
            val items = actData["items"] as? JsonArray ?: break
            if (items.isEmpty()) break

            val ids =
                items.mapNotNull { item ->
                    val obj = item as? JsonObject ?: return@mapNotNull null
                    if (isComments) {
                        obj["commentId"]?.jsonPrimitive?.contentOrNull
                    } else {
                        obj["postId"]?.jsonPrimitive?.contentOrNull
                    }
                }
            if (ids.isEmpty()) break

            val detailUrl =
                if (isComments) {
                    "${LoungeApi.base()}/content-api/v1/comments?" +
                        ids.joinToString("&") { "commentNoList=$it" }
                } else {
                    "${LoungeApi.base()}/content-api/v1/posts?" +
                        ids.joinToString("&") { "postIds=$it" }
                }
            val detailJson = LoungeApi.get(detailUrl, cookies)?.jsonObject ?: break

            var hasThisMonth = false
            if (isComments) {
                val raw =
                    (detailJson["data"] as? JsonObject)
                        ?.get("rawResponse")
                        ?.jsonPrimitive
                        ?.contentOrNull
                if (!raw.isNullOrEmpty()) {
                    runCatching {
                        val parsed = LoungeApi.json.parseToJsonElement(raw).jsonObject
                        val commentList =
                            (parsed["result"] as? JsonObject)
                                ?.get("commentList") as? JsonArray ?: JsonArray(emptyList())
                        for (entry in commentList) {
                            val obj = entry as? JsonObject ?: continue
                            val regDate = obj["regTimeGmt"]?.jsonPrimitive?.contentOrNull
                            val ts = parseIsoMillis(regDate)
                            if (ts != null && ts >= monthStartMillis) {
                                count++
                                hasThisMonth = true
                            }
                        }
                    }
                }
            } else {
                val details = detailJson["data"] as? JsonArray ?: JsonArray(emptyList())
                for (entry in details) {
                    val obj = entry as? JsonObject ?: continue
                    val dateStr = obj["createTime"]?.jsonPrimitive?.contentOrNull
                    val ts = parseIsoMillis(dateStr)
                    if (ts != null && ts >= monthStartMillis) {
                        count++
                        hasThisMonth = true
                    }
                }
            }

            if (!hasThisMonth) break
            val cursorInfo = actData["cursorInfo"] as? JsonObject ?: break
            val hasNext =
                cursorInfo["hasNext"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull()
                    ?: false
            if (!hasNext) break
            cursor = cursorInfo["endCursor"]?.jsonPrimitive?.contentOrNull.orEmpty()
            if (cursor.isEmpty()) break
        }
        return count
    }

    private fun parseIsoMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        // 1) 표준 ISO 8601 (OffsetDateTime — "+09:00" 콜론 있는 tz)
        try {
            return OffsetDateTime.parse(iso).toInstant().toEpochMilli()
        } catch (_: Throwable) {
            // fallback
        }
        // 2) 콜론 없는 tz 포맷 ("+0900") — Naver API 가 가끔 사용
        //    "+0900" → "+09:00" 로 변환해서 재시도
        if (iso.matches(Regex(".*[+-]\\d{4}$"))) {
            try {
                val fixed = iso.replaceRange(iso.length - 2, iso.length - 2, ":")
                return OffsetDateTime.parse(fixed).toInstant().toEpochMilli()
            } catch (_: Throwable) {
                // fallback
            }
        }
        // 3) 관대한 fallback — tz/fractional 제거 후 날짜+시간만 파싱 (UTC 가정)
        try {
            var s = iso.replace(Regex("[+-]\\d{2}:?\\d{2}$"), "")
            s = s.replace("Z", "")
            s = s.replace("T", " ")
            s = s.substringBefore(".")
            s = s.trim()
            val dt = LocalDateTime.parse(s, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
            return dt.toInstant(ZoneOffset.UTC).toEpochMilli()
        } catch (_: Throwable) {
            // fallback
        }
        // 4) epoch millis 직접 (숫자 문자열인 경우)
        return iso.toLongOrNull()
    }

    private fun startOfThisMonth(): Long {
        val cal =
            Calendar.getInstance().apply {
                set(Calendar.DAY_OF_MONTH, 1)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
        return cal.timeInMillis
    }
}
