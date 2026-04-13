package kr.konempty.quietlounge.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors =
    lightColorScheme(
        primary = QlPrimary,
        onPrimary = QlLightCard,
        background = QlLightBackground,
        onBackground = QlLightText,
        surface = QlLightCard,
        onSurface = QlLightText,
        surfaceVariant = QlLightCard,
        onSurfaceVariant = QlLightTextSecondary,
        outline = QlLightBorder,
        error = QlDanger,
    )

private val DarkColors =
    darkColorScheme(
        primary = QlPrimary,
        onPrimary = QlDarkCard,
        background = QlDarkBackground,
        onBackground = QlDarkText,
        surface = QlDarkCard,
        onSurface = QlDarkText,
        surfaceVariant = QlDarkCard,
        onSurfaceVariant = QlDarkTextSecondary,
        outline = QlDarkBorder,
        error = QlDanger,
    )

@Composable
fun QuietLoungeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = QlTypography,
        content = content,
    )
}
