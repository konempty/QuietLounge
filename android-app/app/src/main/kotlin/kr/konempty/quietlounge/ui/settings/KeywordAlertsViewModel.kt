package kr.konempty.quietlounge.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kr.konempty.quietlounge.data.KeywordAlert
import kr.konempty.quietlounge.data.KeywordAlertRepository
import kr.konempty.quietlounge.network.LoungeApi

data class KeywordAlertsUiState(
    val alerts: List<KeywordAlert> = emptyList(),
    val intervalMinutes: Int = 5,
)

data class CategoryItem(
    val categoryId: Int,
    val name: String,
)

data class ChannelItem(
    val finalChannelId: String,
    val name: String,
)

class KeywordAlertsViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val repo = KeywordAlertRepository.get(application)

    val uiState: StateFlow<KeywordAlertsUiState> =
        combine(repo.alertsFlow, repo.intervalFlow) { alerts, interval ->
            KeywordAlertsUiState(alerts = alerts, intervalMinutes = interval)
        }.stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            KeywordAlertsUiState(),
        )

    fun addAlert(
        channelId: String,
        channelName: String,
        keywords: List<String>,
    ) {
        viewModelScope.launch { repo.addAlert(channelId, channelName, keywords) }
    }

    fun removeAlert(id: String) {
        viewModelScope.launch { repo.removeAlert(id) }
    }

    fun toggleAlert(
        id: String,
        enabled: Boolean,
    ) {
        viewModelScope.launch { repo.toggleAlert(id, enabled) }
    }

    fun setInterval(value: Int) {
        viewModelScope.launch { repo.setInterval(value) }
    }

    // ── 카테고리/채널 조회 (모달용) ──
    private val _categories = MutableStateFlow<List<CategoryItem>>(emptyList())
    val categories: StateFlow<List<CategoryItem>> = _categories.asStateFlow()

    private val _channels = MutableStateFlow<List<ChannelItem>>(emptyList())
    val channels: StateFlow<List<ChannelItem>> = _channels.asStateFlow()

    private val _modalLoading = MutableStateFlow(false)
    val modalLoading: StateFlow<Boolean> = _modalLoading.asStateFlow()

    fun loadCategories() {
        if (_categories.value.isNotEmpty()) return
        viewModelScope.launch {
            _modalLoading.value = true
            val root = LoungeApi.get("${LoungeApi.base()}/content-api/v1/categories?depth=2")
            _categories.value = parseCategories(root?.jsonObject)
            _modalLoading.value = false
        }
    }

    fun loadChannels(categoryId: Int) {
        viewModelScope.launch {
            _modalLoading.value = true
            _channels.value = emptyList()
            val all = mutableListOf<ChannelItem>()
            var page = 1
            val size = 50
            while (true) {
                val url =
                    "${LoungeApi.base()}/content-api/v1/channels?categoryId=$categoryId&page=$page&size=$size"
                val root = LoungeApi.get(url)?.jsonObject ?: break
                val data = root["data"] as? JsonObject
                val items = data?.get("items") as? JsonArray ?: break
                all += parseChannelsPage(items)
                val total = parseTotalElements(data)
                if (page * size >= total) break
                page++
            }
            _channels.value = all
            _modalLoading.value = false
        }
    }

    fun resetModal() {
        _channels.value = emptyList()
        _modalLoading.value = false
    }
}

// ── 네트워크 응답 파싱 순수 헬퍼 (단위 테스트 대상) ─────────

internal fun parseCategories(root: JsonObject?): List<CategoryItem> {
    val items = (root?.get("data") as? JsonObject)?.get("items") as? JsonArray ?: return emptyList()
    return items.mapNotNull { node ->
        val obj = node as? JsonObject ?: return@mapNotNull null
        val id = obj["categoryId"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
        val name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
        CategoryItem(id, name)
    }
}

internal fun parseChannelsPage(items: JsonArray): List<ChannelItem> {
    val out = mutableListOf<ChannelItem>()
    for (node in items) {
        val obj = node as? JsonObject ?: continue
        val id = obj["finalChannelId"]?.jsonPrimitive?.contentOrNull ?: continue
        val name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
        out.add(ChannelItem(id, name))
    }
    return out
}

internal fun parseTotalElements(data: JsonObject?): Int {
    val pageInfo = data?.get("page") as? JsonObject
    return pageInfo?.get("totalElements")?.jsonPrimitive?.intOrNull ?: 0
}
