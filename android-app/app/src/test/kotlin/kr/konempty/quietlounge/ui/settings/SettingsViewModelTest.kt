package kr.konempty.quietlounge.ui.settings

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kr.konempty.quietlounge.data.BlockListData
import kr.konempty.quietlounge.data.BlockedUser
import kr.konempty.quietlounge.data.KeywordAlert
import kr.konempty.quietlounge.data.NicknameOnlyBlock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.experimental.runners.Enclosed
import org.junit.runner.RunWith

@RunWith(Enclosed::class)
class SettingsViewModelTest {
    class SettingsBlockStatsFromTests {
        @Test
        fun `빈 데이터`() {
            val s = settingsBlockStatsFrom(BlockListData())
            assertEquals(0, s.total)
            assertEquals(0, s.byPersona)
            assertEquals(0, s.byNickname)
        }

        @Test
        fun `persona 만`() {
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
        fun `nickname 만`() {
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
        fun `혼합`() {
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

    class MergeBackupJsonTests {
        @Test
        fun `alerts 있으면 keywordAlerts 필드 포함`() {
            val merged = mergeBackupJson(EMPTY_BLOCK_LIST_JSON, listOf(sampleAlert()), interval = 5)
            val parsed = Json.parseToJsonElement(merged).jsonObject
            assertNotNull(parsed["keywordAlerts"])
            assertEquals(1, parsed["keywordAlerts"]!!.jsonArray.size)
        }

        @Test
        fun `빈 alerts 도 항상 keywordAlerts 필드로 포함 (cleared state 전파)`() {
            val merged = mergeBackupJson(EMPTY_BLOCK_LIST_JSON, emptyList(), interval = 5)
            val parsed = Json.parseToJsonElement(merged).jsonObject
            // 필드가 반드시 존재해야 "다른 기기에서 알림 전부 해제" 가 전파됨.
            assertNotNull(parsed["keywordAlerts"])
            assertEquals(0, parsed["keywordAlerts"]!!.jsonArray.size)
        }

        @Test
        fun `interval 이 기본값 5 면 필드 생략`() {
            val merged = mergeBackupJson(EMPTY_BLOCK_LIST_JSON, emptyList(), interval = 5)
            val parsed = Json.parseToJsonElement(merged).jsonObject
            assertNull(parsed["alertInterval"])
        }

        @Test
        fun `interval 이 5 가 아니면 필드 포함`() {
            val merged = mergeBackupJson(EMPTY_BLOCK_LIST_JSON, emptyList(), interval = 10)
            val parsed = Json.parseToJsonElement(merged).jsonObject
            assertEquals(10, parsed["alertInterval"]!!.jsonPrimitive.content.toInt())
        }

        @Test
        fun `blockList 의 필드는 그대로 보존`() {
            val withData =
                """
                {"version":2,"blockedUsers":{"p1":{"personaId":"p1","nickname":"a",
                "previousNicknames":[],"blockedAt":"2026-01-01","reason":""}},
                "nicknameOnlyBlocks":[],"personaCache":{}}
                """.trimIndent().replace("\n", "")
            val merged = mergeBackupJson(withData, emptyList(), interval = 5)
            val parsed = Json.parseToJsonElement(merged).jsonObject
            assertNotNull(parsed["blockedUsers"]!!.jsonObject["p1"])
            assertEquals(2, parsed["version"]!!.jsonPrimitive.content.toInt())
        }
    }

    class SplitBackupJsonTests {
        @Test
        fun `keywordAlerts 필드 없으면 null`() {
            val (blockJson, extras) = splitBackupJson(EMPTY_BLOCK_LIST_JSON)
            assertNull(extras.keywordAlerts)
            assertNull(extras.alertInterval)
            assertNotNull(Json.parseToJsonElement(blockJson).jsonObject["version"])
        }

        @Test
        fun `빈 keywordAlerts 배열은 emptyList 로 반영 (전체 해제 의도)`() {
            val raw =
                """
                {"version":2,"blockedUsers":{},"nicknameOnlyBlocks":[],
                "personaCache":{},"keywordAlerts":[]}
                """.trimIndent().replace("\n", "")
            val (_, extras) = splitBackupJson(raw)
            assertNotNull(extras.keywordAlerts)
            assertTrue(extras.keywordAlerts!!.isEmpty())
        }

        @Test
        fun `keywordAlerts 배열을 파싱해서 반환`() {
            val merged = mergeBackupJson(EMPTY_BLOCK_LIST_JSON, listOf(sampleAlert("x")), interval = 5)
            val (_, extras) = splitBackupJson(merged)
            assertEquals(1, extras.keywordAlerts?.size)
            assertEquals("x", extras.keywordAlerts?.first()?.id)
        }

        @Test
        fun `alertInterval 파싱`() {
            val raw =
                """
                {"version":2,"blockedUsers":{},"nicknameOnlyBlocks":[],
                "personaCache":{},"alertInterval":7}
                """.trimIndent().replace("\n", "")
            val (_, extras) = splitBackupJson(raw)
            assertEquals(7, extras.alertInterval)
        }

        @Test
        fun `blockJson 에는 keywordAlerts 필드가 포함되지 않음`() {
            val raw =
                """
                {"version":2,"blockedUsers":{},"nicknameOnlyBlocks":[],
                "personaCache":{},"keywordAlerts":[],"alertInterval":3}
                """.trimIndent().replace("\n", "")
            val (blockJson, _) = splitBackupJson(raw)
            val parsed = Json.parseToJsonElement(blockJson).jsonObject
            assertFalse(parsed.containsKey("keywordAlerts"))
            assertFalse(parsed.containsKey("alertInterval"))
        }
    }

    class MergeSplitRoundTripTests {
        @Test
        fun `merge-split round trip`() {
            val alerts = listOf(sampleAlert("r1"), sampleAlert("r2"))
            val merged = mergeBackupJson(EMPTY_BLOCK_LIST_JSON, alerts, interval = 8)
            val (_, extras) = splitBackupJson(merged)
            assertEquals(2, extras.keywordAlerts?.size)
            assertEquals(8, extras.alertInterval)
        }
    }
}

// Enclosed 러너가 companion object 를 테스트 클래스로 오인하므로 file-top-level 로 분리.
private const val EMPTY_BLOCK_LIST_JSON =
    """{"version":2,"blockedUsers":{},"nicknameOnlyBlocks":[],"personaCache":{}}"""

private fun sampleAlert(id: String = "a1") =
    KeywordAlert(
        id = id,
        channelId = "c1",
        channelName = "채널1",
        keywords = listOf("키워드"),
        enabled = true,
        createdAt = "2026-04-01T00:00:00Z",
    )
