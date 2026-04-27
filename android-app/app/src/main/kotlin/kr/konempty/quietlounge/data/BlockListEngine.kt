package kr.konempty.quietlounge.data

import java.time.Instant

/**
 * shared/block-list.ts 의 BlockList 클래스 Kotlin 포팅.
 *
 * Repository 가 이 엔진을 wrap 하여 DataStore 영속화/Flow 노출을 담당한다.
 */
class BlockListEngine(
    initial: BlockListData = BlockListData(),
) {
    private var data: BlockListData = initial

    fun snapshot(): BlockListData = data

    fun replace(newData: BlockListData) {
        data = newData
    }

    private fun nowIso(): String = Instant.now().toString()

    /** personaId 로 차단. nicknameOnlyBlocks 에 동일 닉네임이 있으면 승격(제거)한다. */
    fun blockByPersonaId(
        personaId: String,
        nickname: String,
    ): BlockListData {
        val existing = data.blockedUsers[personaId]

        val updated =
            BlockedUser(
                personaId = personaId,
                nickname = nickname,
                blockedAt = existing?.blockedAt ?: nowIso(),
            )

        data =
            data.copy(
                blockedUsers = data.blockedUsers + (personaId to updated),
                nicknameOnlyBlocks = data.nicknameOnlyBlocks.filterNot { it.nickname == nickname },
            )
        return data
    }

    /** 닉네임만 차단. 이미 차단되어 있으면 no-op. */
    fun blockByNickname(nickname: String): BlockListData {
        val alreadyByPersona = data.blockedUsers.values.any { it.nickname == nickname }
        if (alreadyByPersona) return data
        if (data.nicknameOnlyBlocks.any { it.nickname == nickname }) return data

        data =
            data.copy(
                nicknameOnlyBlocks =
                    data.nicknameOnlyBlocks +
                        NicknameOnlyBlock(
                            nickname = nickname,
                            blockedAt = nowIso(),
                        ),
            )
        return data
    }

    fun unblock(personaId: String): BlockListData {
        data = data.copy(blockedUsers = data.blockedUsers - personaId)
        return data
    }

    fun unblockByNickname(nickname: String): BlockListData {
        data =
            data.copy(
                nicknameOnlyBlocks = data.nicknameOnlyBlocks.filterNot { it.nickname == nickname },
            )
        return data
    }

    /**
     * personaCache 갱신 + 닉네임 차단 → personaId 차단 자동 승격 (현재/이전 닉네임 모두 매칭).
     * 차단된 유저의 닉네임이 바뀐 경우 nickname 만 갱신 (옛 닉네임 추적은 더 이상 안 함).
     */
    fun updatePersonaCache(
        personaId: String,
        nickname: String,
    ): BlockListData {
        val cached = data.personaCache[personaId]
        val nicknameChanged = cached != null && cached.nickname != nickname

        data =
            data.copy(
                personaCache =
                    data.personaCache + (
                        personaId to PersonaCacheEntry(nickname = nickname, lastSeen = nowIso())
                    ),
            )

        val previousNickname = if (nicknameChanged) cached.nickname else null
        val nicknameBlock =
            data.nicknameOnlyBlocks.firstOrNull { block ->
                block.nickname == nickname || block.nickname == previousNickname
            }
        if (nicknameBlock != null) {
            data =
                data.copy(
                    nicknameOnlyBlocks = data.nicknameOnlyBlocks.filterNot { it === nicknameBlock },
                )
            blockByPersonaId(personaId, nickname)
            return data
        }

        if (nicknameChanged) {
            val user = data.blockedUsers[personaId]
            if (user != null && user.nickname != nickname) {
                data = data.copy(blockedUsers = data.blockedUsers + (personaId to user.copy(nickname = nickname)))
            }
        }

        return data
    }

    fun clear(): BlockListData {
        data = BlockListData()
        return data
    }
}
