package kr.konempty.quietlounge.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class QuietLoungeThemeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `light 모드 — primary 는 QlPrimary`() {
        lateinit var captured: ColorScheme
        compose.setContent {
            QuietLoungeTheme(darkTheme = false) {
                captured = MaterialTheme.colorScheme
                Text("light-root")
            }
        }
        compose.onNodeWithText("light-root").assertIsDisplayed()
        assertEquals(QlPrimary, captured.primary)
        assertEquals(QlLightBackground, captured.background)
    }

    @Test
    fun `dark 모드 — dark 팔레트 적용`() {
        lateinit var captured: ColorScheme
        compose.setContent {
            QuietLoungeTheme(darkTheme = true) {
                captured = MaterialTheme.colorScheme
                Text("dark-root")
            }
        }
        compose.onNodeWithText("dark-root").assertIsDisplayed()
        assertEquals(QlDarkBackground, captured.background)
        assertNotEquals(QlLightBackground, captured.background)
        // 다크 모드에서는 시인성 보정된 QlPrimaryDark 가 primary 로 적용되어야 한다
        assertEquals(QlPrimaryDark, captured.primary)
        assertNotEquals(QlPrimary, captured.primary)
    }

    @Test
    fun `Typography 기본 설정 적용`() {
        lateinit var captured: Typography
        compose.setContent {
            QuietLoungeTheme {
                captured = MaterialTheme.typography
                Text("typo")
            }
        }
        compose.onNodeWithText("typo").assertIsDisplayed()
        assertEquals(QlTypography, captured)
    }

    @Test
    fun `중첩 Composition 에서도 Theme 이 정상 동작`() {
        compose.setContent {
            QuietLoungeTheme {
                CompositionLocalProvider {
                    Text("outer")
                    QuietLoungeTheme(darkTheme = true) {
                        Text("inner-dark")
                    }
                }
            }
        }
        compose.onNodeWithText("outer").assertIsDisplayed()
        compose.onNodeWithText("inner-dark").assertIsDisplayed()
    }
}
