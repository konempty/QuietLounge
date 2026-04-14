package kr.konempty.quietlounge.data

import android.webkit.CookieManager
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kr.konempty.quietlounge.network.LoungeApi

/**
 * 내 활동 통계 조회 — personaId + 총 글/댓글 + 이번달 카운트.
 *
 * 1단계: /user-api/v1/members/me/personas → personaId
 * 2단계: /user-api/v1/personas/{personaId} → totalPostCount, totalCommentCount, createTime
 * 3단계: 이번달 작성글/댓글은 /activities/{posts|comments} 페이지네이션으로 카운트
 *
 * 파싱 로직은 MyStatsParser (Context 무관) 에 위임 — 네트워크 제외 모든 분기가 단위 테스트됨.
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
        val meJson = LoungeApi.get("${LoungeApi.base()}/user-api/v1/members/me/personas", cookies)
        val personaId = MyStatsParser.parsePersonaId(meJson)
        if (personaId.isNullOrBlank()) {
            onUpdate(null)
            return
        }

        val statsJson = LoungeApi.get("${LoungeApi.base()}/user-api/v1/personas/$personaId", cookies)
        val stats =
            MyStatsParser.parseStats(statsJson) ?: run {
                onUpdate(null)
                return
            }

        val base =
            MyStats(
                nickname = stats.nickname,
                totalPosts = stats.totalPosts,
                totalComments = stats.totalComments,
                monthlyPosts = null,
                monthlyComments = null,
            )
        onUpdate(base)

        val monthStart = MyStatsParser.startOfMonthMillis(System.currentTimeMillis())
        if (MyStatsParser.isCreatedThisMonth(stats.createTime, monthStart)) {
            onUpdate(
                base.copy(
                    monthlyPosts = stats.totalPosts,
                    monthlyComments = stats.totalComments,
                ),
            )
            return
        }

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
            val actJson = LoungeApi.get(actUrl, cookies) ?: break
            val ids = MyStatsParser.extractActivityIds(actJson, isComments)
            if (ids.isEmpty()) break

            val detailUrl =
                if (isComments) {
                    "${LoungeApi.base()}/content-api/v1/comments?" +
                        ids.joinToString("&") { "commentNoList=$it" }
                } else {
                    "${LoungeApi.base()}/content-api/v1/posts?" +
                        ids.joinToString("&") { "postIds=$it" }
                }
            val detailJson = LoungeApi.get(detailUrl, cookies) ?: break

            val page =
                if (isComments) {
                    MyStatsParser.countCommentsInMonth(detailJson, monthStartMillis)
                } else {
                    MyStatsParser.countPostsInMonth(detailJson, monthStartMillis)
                }
            count += page.countInMonth
            if (!page.hasThisMonth) break

            val cursorInfo = MyStatsParser.parseCursor(actJson)
            if (!cursorInfo.hasNext || cursorInfo.endCursor.isEmpty()) break
            cursor = cursorInfo.endCursor
        }
        return count
    }
}
