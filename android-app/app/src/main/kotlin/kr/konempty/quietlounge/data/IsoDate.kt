package kr.konempty.quietlounge.data

import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * 다중 포맷 ISO 날짜 → epoch millis 파싱.
 *
 * Naver API 가 `+09:00`, `+0900`, fractional seconds 여부 등 다양한 포맷을 사용하므로
 * 관대하게 파싱한다. JavaScript 의 `new Date(str)` 과 유사한 역할.
 *
 * 지원 포맷:
 *   1) 표준 ISO 8601 (`2026-04-01T00:00:00+09:00`, `...Z`)
 *   2) 콜론 없는 tz (`+0900`)
 *   3) tz/fractional 제거 후 `yyyy-MM-dd HH:mm:ss` (UTC 가정)
 *   4) epoch millis 숫자 문자열
 */
object IsoDate {
    fun parseMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        try {
            return OffsetDateTime.parse(iso).toInstant().toEpochMilli()
        } catch (_: Throwable) {
            // fallback
        }

        if (iso.matches(Regex(".*[+-]\\d{4}$"))) {
            try {
                val fixed = iso.replaceRange(iso.length - 2, iso.length - 2, ":")
                return OffsetDateTime.parse(fixed).toInstant().toEpochMilli()
            } catch (_: Throwable) {
                // fallback
            }
        }

        try {
            var s = iso.replace(Regex("[+-]\\d{2}:?\\d{2}$"), "")
            s = s.replace("Z", "")
            s = s.replace("T", " ")
            s = s.substringBefore(".")
            s = s.trim()
            val dt = LocalDateTime.parse(s, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
            return dt.toInstant(ZoneOffset.UTC).toEpochMilli()
        } catch (_: Throwable) {
            // fallback
        }

        return iso.toLongOrNull()
    }
}
