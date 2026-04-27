package kr.konempty.quietlounge.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockListRepository
import kr.konempty.quietlounge.data.FilterMode
import kr.konempty.quietlounge.data.KeywordAlert
import kr.konempty.quietlounge.data.KeywordAlertRepository
import kr.konempty.quietlounge.data.MyStatsRepository

data class SettingsBlockStats(
    val total: Int = 0,
    val byPersona: Int = 0,
    val byNickname: Int = 0,
)

data class MyStatsUiState(
    val stats: MyStatsRepository.MyStats? = null,
    val loading: Boolean = false,
    val attempted: Boolean = false,
)

class SettingsViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val blockRepo = BlockListRepository.get(application)
    private val alertRepo = KeywordAlertRepository.get(application)
    private val myStatsRepo = MyStatsRepository()

    init {
        viewModelScope.launch { blockRepo.load() }
    }

    val blockStats: StateFlow<SettingsBlockStats> =
        blockRepo.data
            .map { data -> settingsBlockStatsFrom(data) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsBlockStats())

    val filterMode: StateFlow<FilterMode> =
        blockRepo.filterMode
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FilterMode.Hide)

    val showWebViewToolbar: StateFlow<Boolean> =
        blockRepo.showWebViewToolbar
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    private val _myStats = MutableStateFlow(MyStatsUiState())
    val myStats: StateFlow<MyStatsUiState> = _myStats.asStateFlow()

    fun toggleFilterMode() {
        viewModelScope.launch {
            val current = filterMode.value
            blockRepo.setFilterMode(if (current == FilterMode.Hide) FilterMode.Blur else FilterMode.Hide)
        }
    }

    fun setShowWebViewToolbar(enabled: Boolean) {
        viewModelScope.launch { blockRepo.setShowWebViewToolbar(enabled) }
    }

    fun refreshMyStats() {
        if (_myStats.value.loading) return
        _myStats.value = _myStats.value.copy(loading = true, attempted = true)
        viewModelScope.launch {
            myStatsRepo.loadMyStats { stats ->
                _myStats.value = _myStats.value.copy(stats = stats)
            }
            _myStats.value = _myStats.value.copy(loading = false)
        }
    }

    fun clearAll() {
        viewModelScope.launch { blockRepo.clearAll() }
    }

    /**
     * 차단 목록 + 키워드 알림 설정까지 포함한 통합 백업.
     * Chrome/iOS 와 동일 스키마 — keywordAlerts(Array), alertInterval(Int) 필드 추가.
     */
    fun exportJson(onResult: (String) -> Unit) {
        viewModelScope.launch {
            val merged =
                mergeBackupJson(
                    blockListJson = blockRepo.exportJson(),
                    alerts = alertRepo.getAlerts(),
                    interval = alertRepo.getInterval(),
                )
            onResult(merged)
        }
    }

    fun importJson(
        raw: String,
        onResult: (Throwable?) -> Unit,
    ) {
        viewModelScope.launch {
            try {
                val (blockOnlyJson, extras) = splitBackupJson(raw)
                blockRepo.importJson(blockOnlyJson)

                // 필드가 존재하면 길이와 무관하게 반영 (빈 배열 = 전체 해제)
                extras.keywordAlerts?.let { alertRepo.replaceAllAlerts(it) }
                extras.alertInterval?.let { alertRepo.setInterval(it) }

                onResult(null)
            } catch (t: Throwable) {
                onResult(t)
            }
        }
    }
}

/** 백업 JSON 에서 분리한 키워드 알림 관련 extras. */
internal data class BackupExtras(
    val keywordAlerts: List<KeywordAlert>?,
    val alertInterval: Int?,
)

private val backupMergeJson =
    Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

/**
 * blockList JSON 에 keywordAlerts/alertInterval 필드를 추가한 통합 백업 JSON 생성.
 *
 * keywordAlerts 는 길이와 무관하게 항상 포함한다 — 빈 배열 역시 "알림 전부 해제" 라는
 * 유효한 사용자 상태. 필드를 생략하면 import 쪽에서 기존 알림을 그대로 유지하게 되어
 * cleared state 가 기기 간에 전파되지 않음.
 */
internal fun mergeBackupJson(
    blockListJson: String,
    alerts: List<KeywordAlert>,
    interval: Int,
): String {
    val base = backupMergeJson.parseToJsonElement(blockListJson).jsonObject
    val fields = base.toMutableMap()
    fields["keywordAlerts"] =
        backupMergeJson.encodeToJsonElement(
            ListSerializer(KeywordAlert.serializer()),
            alerts,
        )
    if (interval != 5) {
        fields["alertInterval"] = JsonPrimitive(interval)
    }
    return backupMergeJson.encodeToString(JsonObject.serializer(), JsonObject(fields))
}

/**
 * 통합 백업 JSON 에서 블록리스트 JSON 과 keywordAlerts/alertInterval 을 분리.
 * 필드가 존재하지 않으면 null — 호출부가 "기존 값 유지" 로 처리하도록.
 */
internal fun splitBackupJson(raw: String): Pair<String, BackupExtras> {
    val parsed = backupMergeJson.parseToJsonElement(raw).jsonObject
    val alertsElement = parsed["keywordAlerts"]
    val intervalElement = parsed["alertInterval"]

    val alerts =
        if (alertsElement is JsonArray) {
            backupMergeJson.decodeFromJsonElement(
                ListSerializer(KeywordAlert.serializer()),
                alertsElement,
            )
        } else {
            null
        }
    val interval = (intervalElement as? JsonPrimitive)?.intOrNull

    val blockOnly = JsonObject(parsed - "keywordAlerts" - "alertInterval")
    val blockJson = backupMergeJson.encodeToString(JsonObject.serializer(), blockOnly)
    return blockJson to BackupExtras(alerts, interval)
}

/** 단위 테스트에서 참조 가능한 pure 매핑. */
internal fun settingsBlockStatsFrom(data: BlockListData): SettingsBlockStats =
    SettingsBlockStats(
        total = data.blockedUsers.size + data.nicknameOnlyBlocks.size,
        byPersona = data.blockedUsers.size,
        byNickname = data.nicknameOnlyBlocks.size,
    )
