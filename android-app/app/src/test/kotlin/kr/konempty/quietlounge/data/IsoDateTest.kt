package kr.konempty.quietlounge.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IsoDateTest {
    // 기준 시각: "2026-04-01T00:00:00Z" 를 파싱한 millis. 다른 포맷들이 이것과 동일한지 비교.
    private val refMillis = IsoDate.parseMillis("2026-04-01T00:00:00Z")

    @Test
    fun `기준 UTC Z 파싱 성공`() {
        assertNotNull(refMillis)
        assertTrue(refMillis!! > 0)
    }

    @Test
    fun `tz 오프셋 콜론 있음 — 같은 순간 같은 millis`() {
        assertEquals(refMillis, IsoDate.parseMillis("2026-04-01T09:00:00+09:00"))
    }

    @Test
    fun `fractional seconds 포함`() {
        val withFrac = IsoDate.parseMillis("2026-04-01T00:00:00.123Z")
        assertEquals(refMillis!! + 123, withFrac)
    }

    @Test
    fun `콜론 없는 tz 포맷 +0900 — 같은 순간`() {
        assertEquals(refMillis, IsoDate.parseMillis("2026-04-01T09:00:00+0900"))
    }

    @Test
    fun `콜론 없는 tz 포맷 -0500 — 상대 시차 검증`() {
        val t = IsoDate.parseMillis("2026-04-01T00:00:00-0500")
        assertEquals(refMillis!! + 5 * 3600_000L, t)
    }

    @Test
    fun `yyyy-MM-dd HH mm ss 공백 구분 — UTC 가정`() {
        assertEquals(refMillis, IsoDate.parseMillis("2026-04-01 00:00:00"))
    }

    @Test
    fun `fractional + tz 모두 있는 형식 — 파싱 성공`() {
        val t = IsoDate.parseMillis("2026-04-01T00:00:00.999+0900")
        assertNotNull(t)
    }

    @Test
    fun `epoch millis 문자열 직접`() {
        assertEquals(refMillis, IsoDate.parseMillis(refMillis.toString()))
    }

    @Test
    fun `빈 문자열 — null`() {
        assertNull(IsoDate.parseMillis(""))
        assertNull(IsoDate.parseMillis("   "))
    }

    @Test
    fun `null 입력 — null`() {
        assertNull(IsoDate.parseMillis(null))
    }

    @Test
    fun `완전히 잘못된 문자열 — null`() {
        assertNull(IsoDate.parseMillis("hello world"))
        assertNull(IsoDate.parseMillis("abc"))
    }

    @Test
    fun `시간 순서 보존 — 옛 시간 lt 새 시간`() {
        val older = IsoDate.parseMillis("2026-04-01T00:00:00Z")!!
        val newer = IsoDate.parseMillis("2026-04-05T00:00:00Z")!!
        assertTrue(older < newer)
    }

    @Test
    fun `tz 가 다른 문자열이어도 실제 순간이 같으면 같은 millis`() {
        val utc = IsoDate.parseMillis("2026-04-01T00:00:00Z")
        val kstColon = IsoDate.parseMillis("2026-04-01T09:00:00+09:00")
        val kstNoColon = IsoDate.parseMillis("2026-04-01T09:00:00+0900")
        assertEquals(utc, kstColon)
        assertEquals(utc, kstNoColon)
    }
}
