package kr.konempty.quietlounge.notification

import kr.konempty.quietlounge.data.IsoDate
import kr.konempty.quietlounge.data.KeywordAlert

/**
 * 키워드 알림 채널별 매칭 순수 로직 — Swift `QuietLoungeCore.processChannel` 와 동일한 시맨틱.
 *
 * Android/Context 의존성이 없어 단위 테스트로 커버 가능.
 */
object KeywordAlertEngine {
    data class PostDetail(
        val postId: String,
        val title: String,
        val createTime: String,
    )

    data class Match(
        val postId: String,
        val title: String,
        val channelName: String,
        val matchedKeyword: String,
    )

    data class ChannelResult(
        val matches: List<Match>,
        val newLastChecked: String?,
    )

    /**
     * 단일 채널에 대한 키워드 매칭.
     * @param details API 에서 가져온 글 상세 (오름/내림차순 무관)
     * @param alerts 이 채널에 속한 활성 alert (이미 enabled 만 필터됨)
     * @param lastChecked 이전 체크 기준 ISO timestamp. null/빈 문자열이면 전체 새 글로 간주
     * @return 매칭 목록 + 다음 체크 기준이 될 newLastChecked (createTime max)
     */
    fun processChannel(
        details: List<PostDetail>,
        alerts: List<KeywordAlert>,
        lastChecked: String?,
    ): ChannelResult {
        val lastTs = IsoDate.parseMillis(lastChecked) ?: 0L
        val matches = mutableListOf<Match>()

        for (post in details) {
            val ts = IsoDate.parseMillis(post.createTime) ?: continue
            if (ts <= lastTs) continue
            for (alert in alerts) {
                val matched =
                    alert.keywords.firstOrNull { kw ->
                        post.title.contains(kw, ignoreCase = true)
                    } ?: continue
                matches +=
                    Match(
                        postId = post.postId,
                        title = post.title,
                        channelName = alert.channelName,
                        matchedKeyword = matched,
                    )
            }
        }

        val maxCreateTime =
            details
                .mapNotNull { it.createTime.ifBlank { null } }
                .maxByOrNull { IsoDate.parseMillis(it) ?: Long.MIN_VALUE }
        return ChannelResult(matches = matches, newLastChecked = maxCreateTime ?: lastChecked)
    }
}
