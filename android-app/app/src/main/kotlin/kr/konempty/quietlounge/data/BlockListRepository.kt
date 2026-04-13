package kr.konempty.quietlounge.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * BlockList 영속화 + Flow 노출.
 *
 * mobile-app 의 useBlockListProvider 에 대응. Application 라이프타임의 단일 인스턴스로 사용.
 */
class BlockListRepository(
    private val context: Context,
) {
    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

    private val engine = BlockListEngine()

    private val _data = MutableStateFlow(BlockListData())
    val data: StateFlow<BlockListData> = _data.asStateFlow()

    val filterMode: Flow<FilterMode> =
        context.qlDataStore.data.map { prefs ->
            FilterMode.fromValue(prefs[PreferencesKeys.FILTER_MODE])
        }

    /** 최초 1회 호출 — DataStore 에서 읽어와 _data 에 반영. */
    suspend fun load() {
        val prefs = context.qlDataStore.data.first()
        val raw = prefs[PreferencesKeys.BLOCK_LIST_DATA]
        if (!raw.isNullOrBlank()) {
            try {
                val parsed = json.decodeFromString(BlockListData.serializer(), raw)
                engine.replace(parsed)
                _data.value = parsed
            } catch (_: SerializationException) {
                // 손상된 데이터면 무시 (빈 상태 유지)
            }
        }
    }

    private suspend fun persist(updated: BlockListData) {
        _data.value = updated
        context.qlDataStore.edit { prefs ->
            prefs[PreferencesKeys.BLOCK_LIST_DATA] =
                json.encodeToString(BlockListData.serializer(), updated)
        }
    }

    suspend fun setFilterMode(mode: FilterMode) {
        context.qlDataStore.edit { prefs ->
            prefs[PreferencesKeys.FILTER_MODE] = mode.value
        }
    }

    suspend fun blockUser(
        personaId: String?,
        nickname: String,
    ) {
        val updated =
            if (!personaId.isNullOrBlank()) {
                engine.blockByPersonaId(personaId, nickname)
            } else {
                engine.blockByNickname(nickname)
            }
        persist(updated)
    }

    suspend fun unblockByPersonaId(personaId: String) {
        persist(engine.unblock(personaId))
    }

    suspend fun unblockByNickname(nickname: String) {
        persist(engine.unblockByNickname(nickname))
    }

    suspend fun updatePersonaCache(
        personaId: String,
        nickname: String,
    ) {
        // 변경 사항이 있을 때만 persist (cache 는 자주 변하므로 매번 쓰기 부담 있음)
        val before = engine.snapshot()
        val after = engine.updatePersonaCache(personaId, nickname)
        if (before != after) {
            persist(after)
        }
    }

    suspend fun clearAll() {
        persist(engine.clear())
    }

    /** 가져오기/내보내기 */
    fun exportJson(): String {
        // personaCache 는 캐시이므로 export 시 제외
        val snapshot = engine.snapshot().copy(personaCache = emptyMap())
        return json.encodeToString(BlockListData.serializer(), snapshot)
    }

    suspend fun importJson(raw: String) {
        val parsed = json.decodeFromString(BlockListData.serializer(), raw)
        if (parsed.version != 2) error("Unsupported block list version: ${parsed.version}")
        // 기존 personaCache 는 유지
        val merged = parsed.copy(personaCache = engine.snapshot().personaCache)
        engine.replace(merged)
        persist(merged)
    }

    companion object {
        @Volatile
        private var INSTANCE: BlockListRepository? = null

        fun get(context: Context): BlockListRepository {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: BlockListRepository(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
}
