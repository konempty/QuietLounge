package kr.konempty.quietlounge.notification

import android.annotation.SuppressLint
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kr.konempty.quietlounge.data.KeywordAlert
import kr.konempty.quietlounge.data.KeywordAlertRepository
import kr.konempty.quietlounge.network.LoungeApi

/**
 * 키워드 알림 폴링 — 포그라운드에서 주기적으로 새 글 확인 + 매칭 시 알림 발송.
 *
 * 앱 라이프사이클(MainActivity onResume/onPause)과 연동돼 포그라운드일 때만 동작한다.
 * - alerts/interval 가 변경되면 자동으로 타이머 재시작
 * - 활성 alert 가 0개면 타이머 중지
 */
class KeywordAlertScheduler(
    private val context: Context,
) {
    private val repo = KeywordAlertRepository.get(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var collectorJob: Job? = null
    private var loopJob: Job? = null

    /**
     * MainActivity onResume 에서 호출. 이미 실행중이면 no-op.
     */
    fun start() {
        if (collectorJob?.isActive == true) return
        collectorJob =
            scope.launch {
                // alerts + interval combine 으로 둘 중 하나가 바뀔 때마다 loop 재시작
                combine(repo.alertsFlow, repo.intervalFlow) { alerts, interval ->
                    Pair(alerts, interval)
                }.collectLatest { (alerts, interval) ->
                    restartLoop(alerts, interval)
                }
            }
    }

    /** MainActivity onPause/onStop 에서 호출. 타이머 정지. */
    fun stop() {
        loopJob?.cancel()
        loopJob = null
        collectorJob?.cancel()
        collectorJob = null
    }

    private fun restartLoop(
        alerts: List<KeywordAlert>,
        interval: Int,
    ) {
        loopJob?.cancel()
        if (alerts.none { it.enabled }) return
        loopJob =
            scope.launch {
                // 시작 즉시 1회 + 이후 주기적으로
                try {
                    checkOnce()
                } catch (_: Throwable) {
                }
                while (isActive) {
                    delay(interval.coerceAtLeast(1) * 60_000L)
                    try {
                        checkOnce()
                    } catch (_: Throwable) {
                    }
                }
            }
    }

    private suspend fun checkOnce() {
        val alerts = repo.getAlerts().filter { it.enabled }
        if (alerts.isEmpty()) return
        val lastChecked = repo.getLastChecked().toMutableMap()

        val byChannel = alerts.groupBy { it.channelId }
        for ((channelId, channelAlerts) in byChannel) {
            val recentIds = fetchRecentPostIds(channelId)
            if (recentIds.isEmpty()) continue

            val details = fetchPostDetails(recentIds)
            if (details.isEmpty()) continue

            val result =
                KeywordAlertEngine.processChannel(
                    details = details,
                    alerts = channelAlerts,
                    lastChecked = lastChecked[channelId],
                )
            for (match in result.matches) {
                NotificationHelper.showKeywordMatch(
                    context = context,
                    postId = match.postId,
                    channelName = match.channelName,
                    matchedKeyword = match.matchedKeyword,
                    title = match.title,
                )
            }
            // 매칭 여부와 상관없이 lastChecked 를 가장 최신 글 시점으로 전진 —
            // postId 기반 추적의 "기준 글이 삭제되면 전체를 새 글로 간주" 문제 해결
            result.newLastChecked?.let { lastChecked[channelId] = it }
        }
        repo.setLastChecked(lastChecked)
    }

    private suspend fun fetchRecentPostIds(channelId: String): List<String> {
        val url = "${LoungeApi.base()}/discovery-api/v1/feed/channels/$channelId/recent?limit=50"
        val root = LoungeApi.get(url)?.jsonObject ?: return emptyList()
        val items = (root["data"] as? JsonObject)?.get("items") as? JsonArray ?: return emptyList()
        return items.mapNotNull { node ->
            (node as? JsonObject)?.get("postId")?.jsonPrimitive?.contentOrNull
        }
    }

    private suspend fun fetchPostDetails(postIds: List<String>): List<KeywordAlertEngine.PostDetail> {
        if (postIds.isEmpty()) return emptyList()
        val results = mutableListOf<KeywordAlertEngine.PostDetail>()
        postIds.chunked(50).forEach { batch ->
            val params = batch.joinToString("&") { "postIds=$it" }
            val url = "${LoungeApi.base()}/content-api/v1/posts?$params"
            val root = LoungeApi.get(url)?.jsonObject ?: return@forEach
            val arr = root["data"] as? JsonArray ?: return@forEach
            for (node in arr) {
                val obj = node as? JsonObject ?: continue
                val pid = obj["postId"]?.jsonPrimitive?.contentOrNull ?: continue
                val title = obj["title"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val createTime = obj["createTime"]?.jsonPrimitive?.contentOrNull.orEmpty()
                results.add(KeywordAlertEngine.PostDetail(pid, title, createTime))
            }
        }
        return results
    }

    companion object {
        // applicationContext 만 저장 — 실제 leak 없음. StaticFieldLeak 설명은 BlockListRepository 참조.
        @SuppressLint("StaticFieldLeak")
        @Volatile
        private var INSTANCE: KeywordAlertScheduler? = null

        fun get(context: Context): KeywordAlertScheduler {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: KeywordAlertScheduler(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
}
