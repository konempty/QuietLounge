package kr.konempty.quietlounge.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BlockListEngineTest {
    // ── blockByPersonaId ──────────────────────────────────────────

    @Test
    fun `새 유저 차단 — blockedUsers 에 추가`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "foo")
        val data = engine.snapshot()
        assertEquals(1, data.blockedUsers.size)
        assertEquals("foo", data.blockedUsers["p1"]?.nickname)
        assertTrue(data.blockedUsers["p1"]?.previousNicknames?.isEmpty() == true)
    }

    @Test
    fun `같은 personaId 재차단 시 닉네임 변경 이력 유지`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "first")
        engine.blockByPersonaId("p1", "second")
        val user = engine.snapshot().blockedUsers["p1"]!!
        assertEquals("second", user.nickname)
        assertTrue(user.previousNicknames.contains("first"))
    }

    @Test
    fun `같은 닉네임 재차단 — previousNicknames 비어있음`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "same")
        engine.blockByPersonaId("p1", "same")
        assertTrue(
            engine
                .snapshot()
                .blockedUsers["p1"]
                ?.previousNicknames
                ?.isEmpty() == true,
        )
    }

    @Test
    fun `blockedAt 은 최초 차단 시점 유지`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "a")
        val t1 = engine.snapshot().blockedUsers["p1"]!!.blockedAt
        Thread.sleep(5)
        engine.blockByPersonaId("p1", "a")
        assertEquals(t1, engine.snapshot().blockedUsers["p1"]!!.blockedAt)
    }

    @Test
    fun `reason — 최초값 보존`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "a", reason = "광고")
        engine.blockByPersonaId("p1", "a", reason = "")
        assertEquals("광고", engine.snapshot().blockedUsers["p1"]?.reason)
    }

    @Test
    fun `nicknameOnlyBlocks 에 있던 닉네임은 personaId 차단 시 승격`() {
        val engine = BlockListEngine()
        engine.blockByNickname("승격닉")
        engine.blockByPersonaId("p1", "승격닉")
        val data = engine.snapshot()
        assertEquals(1, data.blockedUsers.size)
        assertEquals(0, data.nicknameOnlyBlocks.size)
    }

    // ── blockByNickname ───────────────────────────────────────────

    @Test
    fun `blockByNickname 기본 동작`() {
        val engine = BlockListEngine()
        engine.blockByNickname("tester", "스팸")
        val data = engine.snapshot()
        assertEquals(1, data.nicknameOnlyBlocks.size)
        assertEquals("tester", data.nicknameOnlyBlocks[0].nickname)
        assertEquals("스팸", data.nicknameOnlyBlocks[0].reason)
    }

    @Test
    fun `이미 personaId 로 차단된 닉네임은 추가 안 됨`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "dup")
        engine.blockByNickname("dup")
        assertEquals(0, engine.snapshot().nicknameOnlyBlocks.size)
    }

    @Test
    fun `중복 닉네임 추가 안 됨`() {
        val engine = BlockListEngine()
        engine.blockByNickname("once")
        engine.blockByNickname("once")
        assertEquals(1, engine.snapshot().nicknameOnlyBlocks.size)
    }

    // ── unblock ───────────────────────────────────────────────────

    @Test
    fun `unblock 은 blockedUsers 에서 제거`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "a")
        engine.unblock("p1")
        assertTrue(engine.snapshot().blockedUsers.isEmpty())
    }

    @Test
    fun `존재하지 않는 personaId unblock — no-op`() {
        val engine = BlockListEngine()
        engine.unblock("nope")
        assertTrue(engine.snapshot().blockedUsers.isEmpty())
    }

    @Test
    fun `unblockByNickname — nicknameOnlyBlocks 에서 제거`() {
        val engine = BlockListEngine()
        engine.blockByNickname("a")
        engine.unblockByNickname("a")
        assertTrue(engine.snapshot().nicknameOnlyBlocks.isEmpty())
    }

    // ── updatePersonaCache + 자동 승격 ────────────────────────────

    @Test
    fun `updatePersonaCache — 캐시만 업데이트`() {
        val engine = BlockListEngine()
        engine.updatePersonaCache("p1", "foo")
        assertEquals("foo", engine.snapshot().personaCache["p1"]?.nickname)
    }

    @Test
    fun `nicknameOnlyBlocks 에 있는 닉네임이 cache 에 들어오면 자동 승격`() {
        val engine = BlockListEngine()
        engine.blockByNickname("auto", reason = "사유")
        engine.updatePersonaCache("p1", "auto")
        val data = engine.snapshot()
        assertNotNull(data.blockedUsers["p1"])
        assertEquals("사유", data.blockedUsers["p1"]?.reason)
        assertTrue(data.nicknameOnlyBlocks.isEmpty())
    }

    @Test
    fun `cache 에 기존 닉네임이 있고 차단된 상태에서 닉네임 변경 추적`() {
        val engine = BlockListEngine()
        engine.updatePersonaCache("p1", "first")
        engine.blockByPersonaId("p1", "first")
        engine.updatePersonaCache("p1", "second")
        val user = engine.snapshot().blockedUsers["p1"]!!
        assertEquals("second", user.nickname)
        assertTrue(user.previousNicknames.contains("first"))
    }

    @Test
    fun `차단 안 된 유저의 cache 갱신은 blockedUsers 변경 없음`() {
        val engine = BlockListEngine()
        engine.updatePersonaCache("p1", "hello")
        assertNull(engine.snapshot().blockedUsers["p1"])
    }

    // ── clear ─────────────────────────────────────────────────────

    @Test
    fun `clear — 모든 차단 데이터 초기화`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "a")
        engine.blockByNickname("b")
        engine.updatePersonaCache("p2", "c")
        engine.clear()
        val data = engine.snapshot()
        assertTrue(data.blockedUsers.isEmpty())
        assertTrue(data.nicknameOnlyBlocks.isEmpty())
        assertTrue(data.personaCache.isEmpty())
    }

    // ── replace / snapshot ────────────────────────────────────────

    @Test
    fun `replace 는 상태 교체`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "a")
        val replacement =
            BlockListData(
                version = 2,
                blockedUsers =
                    mapOf(
                        "p2" to
                            BlockedUser(
                                personaId = "p2",
                                nickname = "new",
                                previousNicknames = emptyList(),
                                blockedAt = "2026-01-01T00:00:00Z",
                                reason = "",
                            ),
                    ),
                nicknameOnlyBlocks = emptyList(),
                personaCache = emptyMap(),
            )
        engine.replace(replacement)
        assertNull(engine.snapshot().blockedUsers["p1"])
        assertNotNull(engine.snapshot().blockedUsers["p2"])
    }

    // ── 여러 유저 동시 관리 ───────────────────────────────────────

    @Test
    fun `복수 유저 — 각각 독립적으로 관리`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("p1", "a")
        engine.blockByPersonaId("p2", "b")
        engine.blockByPersonaId("p3", "c")
        engine.unblock("p2")
        val data = engine.snapshot()
        assertEquals(2, data.blockedUsers.size)
        assertNotNull(data.blockedUsers["p1"])
        assertNull(data.blockedUsers["p2"])
        assertNotNull(data.blockedUsers["p3"])
    }

    // ── 빈 문자열 / edge case ─────────────────────────────────────

    @Test
    fun `빈 닉네임은 nicknameOnlyBlocks 추가 안 함 — 동일 닉네임 체크로 막힘`() {
        val engine = BlockListEngine()
        engine.blockByNickname("")
        engine.blockByNickname("") // 중복이라 막힘
        assertEquals(1, engine.snapshot().nicknameOnlyBlocks.size)
        // 참고: 빈 닉네임 허용 여부는 상위 레이어가 결정. 엔진은 중복만 막음.
    }

    @Test
    fun `isBlocked 관련 헬퍼 — 복합 시나리오 검증`() {
        val engine = BlockListEngine()
        engine.blockByPersonaId("pid1", "n1")
        engine.blockByNickname("nonly")
        val data = engine.snapshot()
        // personaId 매칭
        assertTrue(data.blockedUsers.containsKey("pid1"))
        // blockedUsers 닉네임 매칭
        assertTrue(data.blockedUsers.values.any { it.nickname == "n1" })
        // nicknameOnlyBlocks 매칭
        assertTrue(data.nicknameOnlyBlocks.any { it.nickname == "nonly" })
        // 매칭 없음
        assertFalse(data.blockedUsers.containsKey("nope"))
    }
}
