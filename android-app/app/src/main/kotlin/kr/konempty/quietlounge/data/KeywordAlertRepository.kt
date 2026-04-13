package kr.konempty.quietlounge.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * mobile-app/hooks/useKeywordAlerts.ts 영속화 부분의 Kotlin 포팅.
 *
 * - alerts: List<KeywordAlert> JSON
 * - intervalMinutes: Int (1~60)
 * - lastChecked: Map<channelId, postId> JSON — 마지막 체크 시 최신 글의 postId
 */
class KeywordAlertRepository(
    private val context: Context,
) {
    private val json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

    val alertsFlow: Flow<List<KeywordAlert>> =
        context.qlDataStore.data.map { prefs ->
            val raw = prefs[PreferencesKeys.KEYWORD_ALERTS] ?: return@map emptyList()
            runCatching {
                json.decodeFromString(ListSerializer(KeywordAlert.serializer()), raw)
            }.getOrDefault(emptyList())
        }

    val intervalFlow: Flow<Int> =
        context.qlDataStore.data.map { prefs ->
            prefs[PreferencesKeys.ALERT_INTERVAL] ?: 5
        }

    suspend fun getAlerts(): List<KeywordAlert> = alertsFlow.first()

    suspend fun getInterval(): Int = intervalFlow.first()

    private suspend fun saveAlerts(list: List<KeywordAlert>) {
        context.qlDataStore.edit { prefs ->
            prefs[PreferencesKeys.KEYWORD_ALERTS] =
                json.encodeToString(ListSerializer(KeywordAlert.serializer()), list)
        }
    }

    suspend fun addAlert(
        channelId: String,
        channelName: String,
        keywords: List<String>,
    ) {
        val current = getAlerts()
        val entry =
            KeywordAlert(
                id = System.currentTimeMillis().toString(36) + (1..1_000_000).random().toString(36),
                channelId = channelId,
                channelName = channelName,
                keywords = keywords,
                enabled = true,
                createdAt =
                    java.time.Instant
                        .now()
                        .toString(),
            )
        saveAlerts(current + entry)
    }

    suspend fun removeAlert(id: String) {
        saveAlerts(getAlerts().filterNot { it.id == id })
    }

    suspend fun toggleAlert(
        id: String,
        enabled: Boolean,
    ) {
        saveAlerts(getAlerts().map { if (it.id == id) it.copy(enabled = enabled) else it })
    }

    suspend fun setInterval(minutes: Int) {
        val clamped = minutes.coerceIn(1, 60)
        context.qlDataStore.edit { prefs ->
            prefs[PreferencesKeys.ALERT_INTERVAL] = clamped
        }
    }

    suspend fun getLastChecked(): Map<String, String> {
        val raw =
            context.qlDataStore.data.first()[PreferencesKeys.ALERT_LAST_CHECKED]
                ?: return emptyMap()
        return runCatching {
            json.decodeFromString(
                MapSerializer(String.serializer(), String.serializer()),
                raw,
            )
        }.getOrDefault(emptyMap())
    }

    suspend fun setLastChecked(map: Map<String, String>) {
        context.qlDataStore.edit { prefs ->
            prefs[PreferencesKeys.ALERT_LAST_CHECKED] =
                json.encodeToString(
                    MapSerializer(String.serializer(), String.serializer()),
                    map,
                )
        }
    }

    companion object {
        @Volatile
        private var INSTANCE: KeywordAlertRepository? = null

        fun get(context: Context): KeywordAlertRepository {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: KeywordAlertRepository(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
}
