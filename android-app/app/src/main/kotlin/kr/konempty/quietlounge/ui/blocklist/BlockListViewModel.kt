package kr.konempty.quietlounge.ui.blocklist

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockListRepository
import kr.konempty.quietlounge.data.BlockedUser
import kr.konempty.quietlounge.data.NicknameOnlyBlock

data class BlockListUiState(
    val byPersona: List<BlockedUser> = emptyList(),
    val byNickname: List<NicknameOnlyBlock> = emptyList(),
) {
    val total: Int get() = byPersona.size + byNickname.size
}

class BlockListViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val repo = BlockListRepository.get(application)

    init {
        viewModelScope.launch { repo.load() }
    }

    val uiState: StateFlow<BlockListUiState> =
        repo.data
            .map { data -> data.toUiState() }
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = BlockListUiState(),
            )

    fun unblockByPersonaId(personaId: String) {
        viewModelScope.launch { repo.unblockByPersonaId(personaId) }
    }

    fun unblockByNickname(nickname: String) {
        viewModelScope.launch { repo.unblockByNickname(nickname) }
    }

    private fun BlockListData.toUiState(): BlockListUiState {
        val sortedByPersona = blockedUsers.values.sortedByDescending { it.blockedAt }
        val sortedByNickname = nicknameOnlyBlocks.sortedByDescending { it.blockedAt }
        return BlockListUiState(byPersona = sortedByPersona, byNickname = sortedByNickname)
    }
}
