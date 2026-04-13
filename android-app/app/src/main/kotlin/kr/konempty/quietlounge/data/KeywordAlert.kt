package kr.konempty.quietlounge.data

import kotlinx.serialization.Serializable

/**
 * 키워드 알림 설정 항목.
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
