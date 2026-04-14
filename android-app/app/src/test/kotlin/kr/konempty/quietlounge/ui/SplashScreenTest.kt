package kr.konempty.quietlounge.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SplashScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `Q 로고와 앱 이름이 표시된다`() {
        compose.setContent { SplashScreen() }
        compose.onNodeWithText("Q").assertIsDisplayed()
        compose.onNodeWithText("QuietLounge").assertIsDisplayed()
    }
}
