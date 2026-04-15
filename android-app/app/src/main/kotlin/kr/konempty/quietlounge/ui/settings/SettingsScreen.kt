package kr.konempty.quietlounge.ui.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.konempty.quietlounge.BuildConfig
import kr.konempty.quietlounge.data.FilterMode
import kr.konempty.quietlounge.ui.theme.QlDanger
import kr.konempty.quietlounge.ui.theme.QlPrimary
import kr.konempty.quietlounge.ui.theme.QlSupport
import kr.konempty.quietlounge.ui.theme.QlSupportDark
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    isVisible: Boolean = false,
    viewModel: SettingsViewModel = viewModel(),
) {
    val ctx = LocalContext.current
    val blockStats by viewModel.blockStats.collectAsStateWithLifecycle()
    val filterMode by viewModel.filterMode.collectAsStateWithLifecycle()
    val myStats by viewModel.myStats.collectAsStateWithLifecycle()

    var pendingClearAll by remember { mutableStateOf(false) }
    var infoMessage by remember { mutableStateOf<String?>(null) }

    // 탭이 보일 때마다 stats 갱신 (로그인/로그아웃 반영)
    LaunchedEffect(isVisible) {
        if (isVisible && !myStats.loading) {
            viewModel.refreshMyStats()
        }
    }

    // 가져오기 — SAF (READ)
    val importLauncher =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenDocument(),
        ) { uri ->
            uri ?: return@rememberLauncherForActivityResult
            try {
                val text =
                    ctx.contentResolver
                        .openInputStream(uri)
                        ?.bufferedReader()
                        ?.use { it.readText() }
                        ?: error("파일을 읽을 수 없습니다.")
                viewModel.importJson(text) { err ->
                    infoMessage = if (err == null) "데이터를 가져왔습니다." else "가져오기 실패: ${err.message}"
                }
            } catch (t: Throwable) {
                infoMessage = "가져오기 실패: ${t.message}"
            }
        }

    // 내보내기 — 캐시 디렉토리에 JSON 저장 후 ACTION_SEND 로 공유
    val exportShare: () -> Unit = {
        viewModel.exportJson { json ->
            try {
                val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
                val cacheDir = File(ctx.cacheDir, "exports").apply { mkdirs() }
                val file =
                    File(cacheDir, "quietlounge_backup_$date.json").apply { writeText(json) }
                val uri =
                    FileProvider.getUriForFile(
                        ctx,
                        "${ctx.packageName}.fileprovider",
                        file,
                    )
                val intent =
                    Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                ctx.startActivity(Intent.createChooser(intent, "QuietLounge 데이터 내보내기"))
            } catch (t: Throwable) {
                infoMessage = "내보내기 실패: ${t.message}"
            }
        }
    }

    Column(
        modifier =
            modifier
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
    ) {
        // ── 차단 통계 ──
        Section(title = null) {
            BlockStatsRow(stats = blockStats)
        }

        // ── 내 활동 통계 ──
        Section(title = "내 활동 통계", trailing = {
            IconButton(onClick = { viewModel.refreshMyStats() }) {
                if (myStats.loading) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                } else {
                    Icon(Icons.Outlined.Refresh, contentDescription = "갱신")
                }
            }
        }) {
            MyStatsBlock(myStats)
        }

        // ── 필터 모드 ──
        Section(title = "필터 모드") {
            FilterModeRow(filterMode, onToggle = { viewModel.toggleFilterMode() })
        }

        // ── 키워드 알림 (Step 5에서 채워짐) ──
        Section(title = "키워드 알림") {
            KeywordAlertsSection()
        }

        // ── 데이터 관리 ──
        Section(title = "데이터 관리") {
            CardButton(
                title = "데이터 내보내기",
                desc = "JSON 파일로 백업",
                onClick = exportShare,
            )
            Spacer(Modifier.height(8.dp))
            CardButton(
                title = "데이터 가져오기",
                desc = "JSON 파일에서 복원",
                onClick = { importLauncher.launch(arrayOf("application/json", "*/*")) },
            )
            Spacer(Modifier.height(8.dp))
            CardButton(
                title = "전체 삭제",
                titleColor = QlDanger,
                desc = "모든 차단 목록 초기화",
                onClick = {
                    if (blockStats.total == 0) {
                        infoMessage = "차단된 유저가 없습니다."
                    } else {
                        pendingClearAll = true
                    }
                },
            )
        }

        // ── 후원 ──
        Section(title = "후원") {
            Text(
                text = "QuietLounge는 무료이며, 개발·운영 비용은 모두 개발자가 부담하고 있습니다. 응원하시고 싶으시다면 커피 한 잔으로 응원해 주세요!",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 20.sp,
            )
            Spacer(Modifier.height(10.dp))
            // iOS SettingsViewController:588 와 동일하게 다크/라이트 분기 (라이트=짙은 갈색, 다크=베이지)
            val supportBg = if (isSystemInDarkTheme()) QlSupportDark else QlSupport
            val supportTextColor = if (isSystemInDarkTheme()) Color.Black else Color.White
            CardButton(
                title = "☕ 개발자에게 커피 한 잔 사주기",
                titleColor = supportTextColor,
                background = supportBg,
                centerTitle = true,
                onClick = {
                    runCatching {
                        ctx.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://qr.kakaopay.com/FG31jvTdV")),
                        )
                    }
                },
            )
        }

        Spacer(Modifier.height(16.dp))
        Text(
            text = "v${BuildConfig.VERSION_NAME}",
            modifier =
                Modifier
                    .fillMaxWidth(),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
            fontSize = 11.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }

    if (pendingClearAll) {
        AlertDialog(
            onDismissRequest = { pendingClearAll = false },
            title = { Text("전체 삭제") },
            text = {
                Text("${blockStats.total}명의 차단을 모두 해제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.clearAll()
                    pendingClearAll = false
                }) {
                    Text("전체 삭제", color = QlDanger)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingClearAll = false }) { Text("취소") }
            },
        )
    }

    infoMessage?.let { msg ->
        AlertDialog(
            onDismissRequest = { infoMessage = null },
            title = { Text("알림") },
            text = { Text(msg) },
            confirmButton = {
                TextButton(onClick = { infoMessage = null }) { Text("확인") }
            },
        )
    }
}

@Composable
private fun Section(
    title: String?,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.padding(top = 24.dp, start = 16.dp, end = 16.dp)) {
        if (title != null) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = title.uppercase(),
                    color = QlPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.5.sp,
                    modifier = Modifier.weight(1f),
                )
                if (trailing != null) trailing()
            }
            Spacer(Modifier.height(12.dp))
        }
        content()
    }
}

@Composable
private fun BlockStatsRow(stats: SettingsBlockStats) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BlockStatBox(value = stats.total, label = "총 차단 유저", modifier = Modifier.weight(1f))
        BlockStatBox(value = stats.byPersona, label = "ID 확보된 유저", modifier = Modifier.weight(1f))
        BlockStatBox(value = stats.byNickname, label = "닉네임만 확보", modifier = Modifier.weight(1f))
    }
}

@Composable
private fun BlockStatBox(
    value: Int,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value.toString(),
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MyStatsBlock(state: MyStatsUiState) {
    val stats = state.stats
    if (stats == null) {
        Text(
            text = if (state.loading) "로딩 중..." else "라운지에 로그인하면 통계가 표시됩니다",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 16.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        return
    }
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MyStatBox("총 작성글", stats.totalPosts.toString(), Modifier.weight(1f))
            MyStatBox("총 댓글", stats.totalComments.toString(), Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MyStatBoxOrSpinner(
                "이번달 작성글",
                stats.monthlyPosts,
                Modifier.weight(1f),
            )
            MyStatBoxOrSpinner(
                "이번달 댓글",
                stats.monthlyComments,
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun MyStatBox(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = label,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MyStatBoxOrSpinner(
    label: String,
    value: Int?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (value == null) {
            CircularProgressIndicator(
                modifier = Modifier.size(22.dp),
                strokeWidth = 2.dp,
                color = QlPrimary,
            )
        } else {
            Text(
                text = value.toString(),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = label,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun FilterModeRow(
    mode: FilterMode,
    onToggle: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "흐림 처리",
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text =
                    if (mode == FilterMode.Blur) {
                        "차단된 글을 흐리게 표시합니다"
                    } else {
                        "차단된 글을 완전히 숨깁니다"
                    },
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(
            checked = mode == FilterMode.Blur,
            onCheckedChange = { onToggle() },
            colors =
                SwitchDefaults.colors(
                    checkedTrackColor = QlPrimary,
                    checkedThumbColor = Color.White,
                    uncheckedTrackColor = MaterialTheme.colorScheme.outline,
                    uncheckedThumbColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    uncheckedBorderColor = MaterialTheme.colorScheme.outline,
                ),
        )
    }
}

@Composable
private fun CardButton(
    title: String,
    desc: String? = null,
    titleColor: Color = MaterialTheme.colorScheme.onBackground,
    background: Color = MaterialTheme.colorScheme.surface,
    centerTitle: Boolean = false,
    onClick: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(background)
                .clickable { onClick() }
                .padding(16.dp),
        horizontalAlignment = if (centerTitle) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        Text(
            text = title,
            fontSize = 15.sp,
            fontWeight = if (centerTitle) FontWeight.SemiBold else FontWeight.Medium,
            color = titleColor,
        )
        if (desc != null) {
            Text(
                text = desc,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun KeywordAlertsSection(viewModel: KeywordAlertsViewModel = viewModel()) {
    val ctx = LocalContext.current
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showAddDialog by remember { mutableStateOf(false) }

    Column {
        // 추가 버튼
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
            contentAlignment = Alignment.CenterEnd,
        ) {
            CardButton(
                title = "+ 추가",
                titleColor = Color.White,
                background = QlPrimary,
                centerTitle = true,
                onClick = { showAddDialog = true },
            )
        }

        // 확인 주기
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "확인 주기",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                if (state.intervalMinutes < 3) {
                    Text(
                        text = "주기가 짧으면 네트워크 사용량이 늘어날 수 있습니다",
                        color = Color(0xFFE6A23C),
                        fontSize = 11.sp,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                IntervalButton(
                    label = "−",
                    onClick = { viewModel.setInterval(state.intervalMinutes - 1) },
                )
                Text(
                    text = "${state.intervalMinutes}분",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier =
                        Modifier
                            .padding(horizontal = 8.dp),
                )
                IntervalButton(
                    label = "+",
                    onClick = { viewModel.setInterval(state.intervalMinutes + 1) },
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        if (state.alerts.isEmpty()) {
            Text(
                text = "등록된 키워드 알림이 없습니다",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        } else {
            state.alerts.forEach { alert ->
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 6.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = alert.channelName,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            alert.keywords.forEach { kw ->
                                Text(
                                    text = kw,
                                    color = QlPrimary,
                                    fontSize = 12.sp,
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(Color(0x261FAF63))
                                            .padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                    Switch(
                        checked = alert.enabled,
                        onCheckedChange = { viewModel.toggleAlert(alert.id, it) },
                        colors =
                            SwitchDefaults.colors(
                                checkedTrackColor = QlPrimary,
                                checkedThumbColor = Color.White,
                            ),
                    )
                    TextButton(onClick = { viewModel.removeAlert(alert.id) }) {
                        Text("✕", color = QlDanger, fontSize = 18.sp)
                    }
                }
            }
        }

        Text(
            text = "앱 사용 중에는 설정한 주기마다 키워드를 확인합니다. 앱을 닫았다가 다시 열면 그동안의 새 글을 확인하여 알림을 한번에 보내드립니다.",
            fontSize = 12.sp,
            lineHeight = 18.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp, start = 4.dp),
        )
    }

    // 알림 권한 요청 (Android 13+)
    val notifPermLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                Toast.makeText(ctx, "알림 권한이 필요합니다. 설정에서 허용해 주세요.", Toast.LENGTH_LONG).show()
            }
        }

    if (showAddDialog) {
        AddAlertDialog(
            onDismiss = { showAddDialog = false },
            onSave = { channelId, channelName, keywords ->
                requestNotifPermIfNeeded(ctx, notifPermLauncher)
                viewModel.addAlert(channelId, channelName, keywords)
                showAddDialog = false
            },
            viewModel = viewModel,
        )
    }
}

@Composable
private fun IntervalButton(
    label: String,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.background)
                .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

private fun requestNotifPermIfNeeded(
    ctx: Context,
    launcher: ActivityResultLauncher<String>,
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val perm = Manifest.permission.POST_NOTIFICATIONS
        if (ContextCompat.checkSelfPermission(ctx, perm) != PackageManager.PERMISSION_GRANTED) {
            launcher.launch(perm)
        }
    }
}
