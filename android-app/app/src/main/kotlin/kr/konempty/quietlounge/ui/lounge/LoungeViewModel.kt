package kr.konempty.quietlounge.ui.lounge

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockListRepository
import kr.konempty.quietlounge.data.FilterMode

class LoungeViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val repo = BlockListRepository.get(application)

    init {
        viewModelScope.launch { repo.load() }
    }

    val blockData: StateFlow<BlockListData> =
        repo.data
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BlockListData())

    val filterMode: StateFlow<FilterMode> =
        repo.filterMode
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FilterMode.Hide)

    fun blockUser(
        personaId: String?,
        nickname: String,
    ) {
        viewModelScope.launch { repo.blockUser(personaId, nickname) }
    }

    fun updatePersonaCache(
        personaId: String,
        nickname: String,
    ) {
        viewModelScope.launch { repo.updatePersonaCache(personaId, nickname) }
    }
}
