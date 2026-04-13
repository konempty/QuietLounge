package kr.konempty.quietlounge.data

import kotlinx.serialization.Serializable

/**
 * mobile-app/hooks/useKeywordAlerts.ts 의 KeywordAlert 인터페이스 포팅.
 */
@Serializable
data class KeywordAlert(
    val id: String,
    val channelId: String,
    val channelName: String,
    val keywords: List<String>,
    val enabled: Boolean = true,
    val createdAt: String,
)
