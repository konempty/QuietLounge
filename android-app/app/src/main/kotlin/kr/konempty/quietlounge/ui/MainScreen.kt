package kr.konempty.quietlounge.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kr.konempty.quietlounge.R
import kr.konempty.quietlounge.ui.blocklist.BlockListScreen
import kr.konempty.quietlounge.ui.lounge.LoungeScreen
import kr.konempty.quietlounge.ui.settings.SettingsScreen

private enum class TopDestination(
    val labelRes: Int,
    val icon: ImageVector,
) {
    Lounge(R.string.tab_lounge, Icons.Outlined.Public),
    BlockList(R.string.tab_blocklist, Icons.Outlined.Block),
    Settings(R.string.tab_settings, Icons.Outlined.Settings),
}

@Composable
fun MainScreen(
    pendingPostId: String?,
    onPendingPostIdConsumed: () -> Unit,
) {
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    // 알림 클릭 → 라운지 탭으로 전환
    LaunchedEffect(pendingPostId) {
        if (pendingPostId != null) selectedTab = 0
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                TopDestination.entries.forEachIndexed { index, dest ->
                    NavigationBarItem(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        icon = { Icon(dest.icon, contentDescription = null) },
                        label = { Text(stringResource(dest.labelRes)) },
                    )
                }
            }
        },
    ) { padding ->
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding),
        ) {
            // LoungeScreen — 항상 composition 에 유지 (WebView 파괴 방지)
            // 선택되지 않았을 때는 0dp 로 축소하여 터치 차단 + 렌더링 최소화
            LoungeScreen(
                modifier = if (selectedTab == 0) Modifier.fillMaxSize() else Modifier.size(0.dp),
                pendingPostId = pendingPostId,
                onPendingPostIdConsumed = onPendingPostIdConsumed,
            )

            // 나머지 탭은 선택 시에만 compose (파괴/재생성 OK)
            when (selectedTab) {
                1 -> BlockListScreen(modifier = Modifier.fillMaxSize())
                2 -> SettingsScreen(modifier = Modifier.fillMaxSize(), isVisible = true)
            }
        }
    }
}
