package kr.konempty.quietlounge.ui.blocklist

import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockedUser
import kr.konempty.quietlounge.data.NicknameOnlyBlock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BlockListViewModelTest {
    @Test
    fun `toUiState — personaId 차단 내림차순 정렬`() {
        val data =
            BlockListData(
                blockedUsers =
                    mapOf(
                        "a" to BlockedUser("a", "n1", emptyList(), "2026-04-01T00:00:00Z", ""),
                        "b" to BlockedUser("b", "n2", emptyList(), "2026-04-05T00:00:00Z", ""),
                        "c" to BlockedUser("c", "n3", emptyList(), "2026-04-03T00:00:00Z", ""),
                    ),
            )
        val ui = blockListDataToUiState(data)
        assertEquals(listOf("b", "c", "a"), ui.byPersona.map { it.personaId })
    }

    @Test
    fun `toUiState — 닉네임 차단도 내림차순 정렬`() {
        val data =
            BlockListData(
                nicknameOnlyBlocks =
                    listOf(
                        NicknameOnlyBlock("n1", "2026-04-01T00:00:00Z", ""),
                        NicknameOnlyBlock("n2", "2026-04-05T00:00:00Z", ""),
                        NicknameOnlyBlock("n3", "2026-04-03T00:00:00Z", ""),
                    ),
            )
        val ui = blockListDataToUiState(data)
        assertEquals(listOf("n2", "n3", "n1"), ui.byNickname.map { it.nickname })
    }

    @Test
    fun `toUiState — 빈 데이터`() {
        val ui = blockListDataToUiState(BlockListData())
        assertTrue(ui.byPersona.isEmpty())
        assertTrue(ui.byNickname.isEmpty())
        assertEquals(0, ui.total)
    }

    @Test
    fun `BlockListUiState total — persona + nickname 합산`() {
        val ui =
            BlockListUiState(
                byPersona =
                    listOf(
                        BlockedUser("a", "n", emptyList(), "2026-01-01", ""),
                        BlockedUser("b", "n", emptyList(), "2026-01-01", ""),
                    ),
                byNickname = listOf(NicknameOnlyBlock("x", "2026-01-01", "")),
            )
        assertEquals(3, ui.total)
    }

    @Test
    fun `toUiState — 둘 다 있으면 둘 다 정렬`() {
        val data =
            BlockListData(
                blockedUsers =
                    mapOf(
                        "p1" to BlockedUser("p1", "a", emptyList(), "2026-04-02T00:00:00Z", ""),
                        "p2" to BlockedUser("p2", "b", emptyList(), "2026-04-10T00:00:00Z", ""),
                    ),
                nicknameOnlyBlocks =
                    listOf(
                        NicknameOnlyBlock("nn", "2026-04-03T00:00:00Z", ""),
                    ),
            )
        val ui = blockListDataToUiState(data)
        assertEquals("p2", ui.byPersona.first().personaId)
        assertEquals(3, ui.total)
    }
}
