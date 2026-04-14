package kr.konempty.quietlounge.ui.settings

import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockedUser
import kr.konempty.quietlounge.data.NicknameOnlyBlock
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsViewModelTest {
    @Test
    fun `settingsBlockStatsFrom — 빈 데이터`() {
        val s = settingsBlockStatsFrom(BlockListData())
        assertEquals(0, s.total)
        assertEquals(0, s.byPersona)
        assertEquals(0, s.byNickname)
    }

    @Test
    fun `settingsBlockStatsFrom — persona 만`() {
        val data =
            BlockListData(
                blockedUsers =
                    mapOf(
                        "p1" to BlockedUser("p1", "a", emptyList(), "2026-01-01", ""),
                        "p2" to BlockedUser("p2", "b", emptyList(), "2026-01-01", ""),
                    ),
            )
        val s = settingsBlockStatsFrom(data)
        assertEquals(2, s.total)
        assertEquals(2, s.byPersona)
        assertEquals(0, s.byNickname)
    }

    @Test
    fun `settingsBlockStatsFrom — nickname 만`() {
        val data =
            BlockListData(
                nicknameOnlyBlocks =
                    listOf(
                        NicknameOnlyBlock("a", "2026-01-01", ""),
                        NicknameOnlyBlock("b", "2026-01-01", ""),
                        NicknameOnlyBlock("c", "2026-01-01", ""),
                    ),
            )
        val s = settingsBlockStatsFrom(data)
        assertEquals(3, s.total)
        assertEquals(0, s.byPersona)
        assertEquals(3, s.byNickname)
    }

    @Test
    fun `settingsBlockStatsFrom — 혼합`() {
        val data =
            BlockListData(
                blockedUsers =
                    mapOf("p1" to BlockedUser("p1", "a", emptyList(), "2026-01-01", "")),
                nicknameOnlyBlocks =
                    listOf(
                        NicknameOnlyBlock("n1", "2026-01-01", ""),
                        NicknameOnlyBlock("n2", "2026-01-01", ""),
                    ),
            )
        val s = settingsBlockStatsFrom(data)
        assertEquals(3, s.total)
        assertEquals(1, s.byPersona)
        assertEquals(2, s.byNickname)
    }
}
