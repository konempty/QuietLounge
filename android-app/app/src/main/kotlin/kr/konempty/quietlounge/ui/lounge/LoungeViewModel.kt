package kr.konempty.quietlounge.ui.lounge

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockListRepository
import kr.konempty.quietlounge.data.FilterMode
import kr.konempty.quietlounge.webview.WebViewToolbarLogic

class LoungeViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val repo = BlockListRepository.get(application)

    /**
     * 앱 시작 시 단 한 번 평가되는 "툴바 안내 팝업" 표시 여부.
     * ViewModel 이 process 동안 살아있으므로 화면 회전 등에서 다시 트리거되지 않음.
     * "다시 보지 않기" 또는 "닫기" 액션으로 false 가 되며, 같은 process 안에선 다시 true 가 되지 않는다.
     */
    private val _showToolbarHint = MutableStateFlow(false)
    val showToolbarHint: StateFlow<Boolean> = _showToolbarHint.asStateFlow()

    /**
     * 유저 차단 직후 1회성으로 표시되는 "흐림 처리 안내" 트리거.
     * `blockUser()` 가 끝난 뒤 조건이 맞으면 true 로 세팅 → UI 가 dialog 노출 → dismiss 시 false 로 복귀.
     */
    private val _showFilterHint = MutableStateFlow(false)
    val showFilterHint: StateFlow<Boolean> = _showFilterHint.asStateFlow()

    init {
        viewModelScope.launch { repo.load() }
        viewModelScope.launch {
            // DataStore 의 실제 값 (Flow 의 첫 emission) 으로 평가 — 디폴트 false 가 잠깐 보이고
            // 그 후 true 로 바뀌어 깜빡이는 일을 방지.
            val showToolbar = repo.showWebViewToolbar.first()
            val dontShow = repo.dontShowToolbarHint.first()
            _showToolbarHint.value = WebViewToolbarLogic.shouldShowToolbarHint(showToolbar, dontShow)
        }
    }

    val blockData: StateFlow<BlockListData> =
        repo.data
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BlockListData())

    val filterMode: StateFlow<FilterMode> =
        repo.filterMode
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FilterMode.Hide)

    val showWebViewToolbar: StateFlow<Boolean> =
        repo.showWebViewToolbar
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    fun blockUser(
        personaId: String?,
        nickname: String,
    ) {
        viewModelScope.launch {
            repo.blockUser(personaId, nickname)
            // 차단이 영속화된 직후에 안내 노출 평가 — 매 차단마다.
            val isBlur = repo.filterMode.first() == FilterMode.Blur
            val dontShow = repo.dontShowFilterHint.first()
            if (WebViewToolbarLogic.shouldShowFilterModeHint(isBlur, dontShow)) {
                _showFilterHint.value = true
            }
        }
    }

    fun updatePersonaCache(
        personaId: String,
        nickname: String,
    ) {
        viewModelScope.launch { repo.updatePersonaCache(personaId, nickname) }
    }

    fun dismissToolbarHint() {
        _showToolbarHint.value = false
    }

    fun setDontShowToolbarHint() {
        viewModelScope.launch {
            repo.setDontShowToolbarHint(true)
            _showToolbarHint.value = false
        }
    }

    fun dismissFilterHint() {
        _showFilterHint.value = false
    }

    fun setDontShowFilterHint() {
        viewModelScope.launch {
            repo.setDontShowFilterHint(true)
            _showFilterHint.value = false
        }
    }
}
