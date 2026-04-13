package kr.konempty.quietlounge.data

import kotlinx.serialization.Serializable

// shared/types.ts 의 Kotlin 포팅

@Serializable
data class BlockedUser(
    val personaId: String,
    val nickname: String,
    val previousNicknames: List<String> = emptyList(),
    val blockedAt: String,
    val reason: String = "",
)

@Serializable
data class NicknameOnlyBlock(
    val nickname: String,
    val blockedAt: String,
    val reason: String = "",
)

@Serializable
data class PersonaCacheEntry(
    val nickname: String,
    val lastSeen: String,
)

@Serializable
data class BlockListData(
    val version: Int = 2,
    val blockedUsers: Map<String, BlockedUser> = emptyMap(),
    val nicknameOnlyBlocks: List<NicknameOnlyBlock> = emptyList(),
    val personaCache: Map<String, PersonaCacheEntry> = emptyMap(),
)

enum class FilterMode(
    val value: String,
) {
    Hide("hide"),
    Blur("blur"),
    ;

    companion object {
        fun fromValue(value: String?): FilterMode =
            when (value) {
                "blur" -> Blur
                else -> Hide
            }
    }
}
