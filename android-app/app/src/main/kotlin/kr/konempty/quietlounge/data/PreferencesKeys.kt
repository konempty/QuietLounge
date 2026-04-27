package kr.konempty.quietlounge.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore

private const val DATASTORE_NAME = "quiet_lounge"

val Context.qlDataStore: DataStore<Preferences> by preferencesDataStore(name = DATASTORE_NAME)

object PreferencesKeys {
    val BLOCK_LIST_DATA = stringPreferencesKey("quiet_lounge_data")
    val FILTER_MODE = stringPreferencesKey("quiet_lounge_filter_mode")
    val KEYWORD_ALERTS = stringPreferencesKey("quiet_lounge_keyword_alerts")
    val ALERT_INTERVAL = intPreferencesKey("quiet_lounge_alert_interval")
    val ALERT_LAST_CHECKED = stringPreferencesKey("quiet_lounge_alert_last_checked")
    val SHOW_WEBVIEW_TOOLBAR = booleanPreferencesKey("quiet_lounge_show_webview_toolbar")
    val DONT_SHOW_TOOLBAR_HINT = booleanPreferencesKey("quiet_lounge_dont_show_toolbar_hint")
}
