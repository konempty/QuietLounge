package kr.konempty.quietlounge.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.net.HttpURLConnection
import java.net.URL

/**
 * api.lounge.naver.com 호출 헬퍼.
 *
 * Retrofit/Ktor 도입은 의존성 추가 부담이 있어, 표준 HttpURLConnection 으로 처리한다.
 * 응답은 kotlinx.serialization 의 JsonElement 로 파싱해 호출처에서 필요한 필드만 추출.
 *
 * 인증 쿠키 — WebView 의 CookieManager 와 공유되도록 호출 시 쿠키 헤더를 직접 설정.
 */
object LoungeApi {
    private const val BASE_URL = "https://api.lounge.naver.com"
    private const val TIMEOUT_MS = 10_000

    val json: Json = Json { ignoreUnknownKeys = true }

    suspend fun get(
        url: String,
        cookieHeader: String? = null,
    ): JsonElement? =
        withContext(Dispatchers.IO) {
            var conn: HttpURLConnection? = null
            try {
                conn =
                    (URL(url).openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = TIMEOUT_MS
                        readTimeout = TIMEOUT_MS
                        if (!cookieHeader.isNullOrBlank()) {
                            setRequestProperty("Cookie", cookieHeader)
                        }
                        setRequestProperty(
                            "User-Agent",
                            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                                "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                        )
                        instanceFollowRedirects = true
                    }
                val code = conn.responseCode
                if (code !in 200..299) return@withContext null
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                json.parseToJsonElement(text)
            } catch (_: Throwable) {
                null
            } finally {
                conn?.disconnect()
            }
        }

    fun base(): String = BASE_URL
}
