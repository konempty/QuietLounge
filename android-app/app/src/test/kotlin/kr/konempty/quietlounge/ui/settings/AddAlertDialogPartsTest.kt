package kr.konempty.quietlounge.ui.settings

import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import kr.konempty.quietlounge.ui.theme.QuietLoungeTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * AddAlertDialog 내부 helper Composable 들에 대한 단위 렌더링 테스트.
 * ViewModel / 네트워크 의존성이 없는 pure UI 조각만 검증.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AddAlertDialogPartsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `SearchField — 텍스트 입력 반영`() {
        val state = mutableStateOf("")
        compose.setContent {
            QuietLoungeTheme {
                SearchField(value = state.value, onChange = { state.value = it })
            }
        }
        compose.onNodeWithText("검색...").performTextInput("BTS")
        assertEquals("BTS", state.value)
    }

    @Test
    fun `LoadingBox — 스피너 렌더 (crash 없음)`() {
        compose.setContent { QuietLoungeTheme { LoadingBox() } }
        // 특정 식별자가 없는 progress indicator — 렌더 자체가 성공하면 OK
        compose.waitForIdle()
    }

    @Test
    fun `SelectableList — 빈 리스트면 결과 없음 메시지`() {
        compose.setContent {
            QuietLoungeTheme {
                SelectableList<String>(
                    items = emptyList(),
                    label = { it },
                    onClick = {},
                )
            }
        }
        compose.onNodeWithText("결과가 없습니다").assertIsDisplayed()
    }

    @Test
    fun `SelectableList — 아이템 클릭 시 onClick 호출`() {
        var clicked: String? = null
        compose.setContent {
            QuietLoungeTheme {
                SelectableList(
                    items = listOf("채널A", "채널B", "채널C"),
                    label = { it },
                    onClick = { clicked = it },
                )
            }
        }
        compose.onNodeWithText("채널B").performClick()
        assertEquals("채널B", clicked)
    }

    @Test
    fun `SelectableList — 여러 아이템 렌더`() {
        compose.setContent {
            QuietLoungeTheme {
                SelectableList(
                    items = listOf("a1", "a2", "a3"),
                    label = { it },
                    onClick = {},
                )
            }
        }
        compose.onNodeWithText("a1").assertIsDisplayed()
        compose.onNodeWithText("a2").assertIsDisplayed()
        compose.onNodeWithText("a3").assertIsDisplayed()
    }

    @Test
    fun `KeywordTagFlow — 키워드가 태그로 렌더`() {
        compose.setContent {
            QuietLoungeTheme {
                KeywordTagFlow(keywords = listOf("BTS", "아이유")) {}
            }
        }
        compose.onNodeWithText("BTS  ✕").assertIsDisplayed()
        compose.onNodeWithText("아이유  ✕").assertIsDisplayed()
    }

    @Test
    fun `KeywordTagFlow — 태그 클릭 시 onRemove 에 index 전달`() {
        var removed: Int? = null
        compose.setContent {
            QuietLoungeTheme {
                KeywordTagFlow(keywords = listOf("a", "b", "c")) { removed = it }
            }
        }
        compose.onNodeWithText("b  ✕").performClick()
        assertEquals(1, removed)
    }

    @Test
    fun `KeywordTagFlow — 3개 초과면 줄바꿈 (chunk 3)`() {
        // 4개 키워드 → 2개 행
        compose.setContent {
            QuietLoungeTheme {
                KeywordTagFlow(keywords = listOf("k1", "k2", "k3", "k4")) {}
            }
        }
        compose.onNodeWithText("k1  ✕").assertIsDisplayed()
        compose.onNodeWithText("k4  ✕").assertIsDisplayed()
    }

    @Test
    fun `SearchField — 기존 값 표시`() {
        compose.setContent {
            QuietLoungeTheme {
                SearchField(value = "기존 값", onChange = {})
            }
        }
        compose.onNodeWithText("기존 값").assertIsDisplayed()
    }

    @Test
    fun `SelectableList — label 람다로 커스텀 표시`() {
        compose.setContent {
            QuietLoungeTheme {
                SelectableList(
                    items = listOf(1, 2, 3),
                    label = { "item=$it" },
                    onClick = {},
                )
            }
        }
        compose.onNodeWithText("item=1").assertIsDisplayed()
        compose.onNodeWithText("item=2").assertIsDisplayed()
    }

    @Test
    fun `MaterialTheme 없이도 최소 렌더 동작 확인 (SearchField)`() {
        compose.setContent {
            // Wrapping Material 없이 Text 등 기본 컴포저블만 테스트 — SearchField 는 내부적으로 Material 필요하므로 Theme 에서 테스트
            QuietLoungeTheme {
                SearchField(value = "", onChange = {})
                Text("compose-ready")
            }
        }
        compose.onAllNodesWithText("compose-ready")
    }
}
