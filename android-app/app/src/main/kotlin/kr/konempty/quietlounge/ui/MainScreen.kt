package kr.konempty.quietlounge.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.konempty.quietlounge.R
import kr.konempty.quietlounge.ui.blocklist.BlockListScreen
import kr.konempty.quietlounge.ui.lounge.LoungeScreen
import kr.konempty.quietlounge.ui.lounge.LoungeViewModel
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

    // LoungeScreen 과 동일 ViewModel 인스턴스 — Activity 스코프 viewModel() 호출은
    // 같은 ViewModelStoreOwner 안에서 항상 같은 인스턴스를 반환한다.
    val loungeVm: LoungeViewModel = viewModel()
    val showToolbarHint by loungeVm.showToolbarHint.collectAsStateWithLifecycle()

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

    // 앱 시작 시 1회 — 툴바 안내 팝업.
    // "다시 보지 않기" 를 선택하지 않았다면 매 앱 실행마다 띄운다 (사용자 명시 요청).
    if (showToolbarHint) {
        AlertDialog(
            onDismissRequest = { loungeVm.dismissToolbarHint() },
            title = { Text("웹뷰 툴바를 켤 수 있어요") },
            text = {
                Text(
                    "라운지 웹뷰 하단에 뒤/앞/홈/새로고침 버튼을 표시할 수 있습니다.\n" +
                        "필요하면 설정 > 표시 설정에서 켜보세요.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    loungeVm.dismissToolbarHint()
                    selectedTab = 2
                }) {
                    Text("설정 열기")
                }
            },
            dismissButton = {
                TextButton(onClick = { loungeVm.setDontShowToolbarHint() }) {
                    Text("다시 보지 않기")
                }
            },
        )
    }
}
