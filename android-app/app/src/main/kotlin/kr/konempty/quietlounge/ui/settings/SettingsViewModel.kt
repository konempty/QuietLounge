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
import kr.konempty.quietlounge.data.BlockListRepository
import kr.konempty.quietlounge.data.FilterMode
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
    private val myStatsRepo = MyStatsRepository()

    init {
        viewModelScope.launch { blockRepo.load() }
    }

    val blockStats: StateFlow<SettingsBlockStats> =
        blockRepo.data
            .map { data ->
                SettingsBlockStats(
                    total = data.blockedUsers.size + data.nicknameOnlyBlocks.size,
                    byPersona = data.blockedUsers.size,
                    byNickname = data.nicknameOnlyBlocks.size,
                )
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsBlockStats())

    val filterMode: StateFlow<FilterMode> =
        blockRepo.filterMode
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FilterMode.Hide)

    private val _myStats = MutableStateFlow(MyStatsUiState())
    val myStats: StateFlow<MyStatsUiState> = _myStats.asStateFlow()

    fun toggleFilterMode() {
        viewModelScope.launch {
            val current = filterMode.value
            blockRepo.setFilterMode(if (current == FilterMode.Hide) FilterMode.Blur else FilterMode.Hide)
        }
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

    fun exportJson(): String = blockRepo.exportJson()

    fun importJson(
        raw: String,
        onResult: (Throwable?) -> Unit,
    ) {
        viewModelScope.launch {
            try {
                blockRepo.importJson(raw)
                onResult(null)
            } catch (t: Throwable) {
                onResult(t)
            }
        }
    }
}
