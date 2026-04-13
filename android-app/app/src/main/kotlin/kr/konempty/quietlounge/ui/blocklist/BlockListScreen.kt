package kr.konempty.quietlounge.ui.blocklist

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.konempty.quietlounge.data.BlockedUser
import kr.konempty.quietlounge.data.NicknameOnlyBlock
import kr.konempty.quietlounge.ui.theme.QlDanger
import kr.konempty.quietlounge.ui.theme.QlPrimary

private sealed interface BlockRow {
    val nickname: String
    val blockedAt: String

    data class Persona(
        val user: BlockedUser,
    ) : BlockRow {
        override val nickname get() = user.nickname
        override val blockedAt get() = user.blockedAt
    }

    data class Nickname(
        val block: NicknameOnlyBlock,
    ) : BlockRow {
        override val nickname get() = block.nickname
        override val blockedAt get() = block.blockedAt
    }
}

@Composable
fun BlockListScreen(
    modifier: Modifier = Modifier,
    viewModel: BlockListViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var pendingUnblock by remember { mutableStateOf<BlockRow?>(null) }

    val rows: List<BlockRow> =
        remember(state) {
            buildList {
                addAll(state.byPersona.map { BlockRow.Persona(it) })
                addAll(state.byNickname.map { BlockRow.Nickname(it) })
            }
        }

    Column(
        modifier = modifier.background(MaterialTheme.colorScheme.background),
    ) {
        BlockListHeader(state.total, state.byPersona.size, state.byNickname.size)
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)

        if (rows.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "차단된 유저가 없습니다",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(items = rows, key = { row ->
                    when (row) {
                        is BlockRow.Persona -> "p:${row.user.personaId}"
                        is BlockRow.Nickname -> "n:${row.block.nickname}"
                    }
                }) { row ->
                    BlockRowItem(row = row, onUnblockClick = { pendingUnblock = row })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }

    pendingUnblock?.let { row ->
        AlertDialog(
            onDismissRequest = { pendingUnblock = null },
            title = { Text("차단 해제") },
            text = { Text("\"${row.nickname}\" 유저의 차단을 해제하시겠습니까?") },
            confirmButton = {
                TextButton(onClick = {
                    when (row) {
                        is BlockRow.Persona -> viewModel.unblockByPersonaId(row.user.personaId)
                        is BlockRow.Nickname -> viewModel.unblockByNickname(row.block.nickname)
                    }
                    pendingUnblock = null
                }) {
                    Text("해제")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingUnblock = null }) {
                    Text("취소")
                }
            },
        )
    }
}

@Composable
private fun BlockListHeader(
    total: Int,
    personaCount: Int,
    nicknameCount: Int,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(16.dp),
    ) {
        Text(
            text = "총 ${total}명 차단 중",
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "personaId $personaCount / 닉네임 $nicknameCount",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun BlockRowItem(
    row: BlockRow,
    onUnblockClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = row.nickname,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.width(8.dp))
                BlockBadge(isPersona = row is BlockRow.Persona)
            }
            if (row is BlockRow.Persona) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = row.user.personaId,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (row.user.previousNicknames.isNotEmpty()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = "이전: ${row.user.previousNicknames.joinToString(", ")}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = formatBlockedAt(row.blockedAt),
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            )
        }

        OutlinedButton(
            onClick = onUnblockClick,
            shape = RoundedCornerShape(6.dp),
        ) {
            Text(text = "해제", color = QlDanger, fontSize = 13.sp)
        }
    }
}

@Composable
private fun BlockBadge(isPersona: Boolean) {
    val bg = if (isPersona) QlPrimary else Color(0xFFE67E22)
    val label = if (isPersona) "ID" else "닉네임"
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(bg)
                .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = label,
            color = Color.White,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

private fun formatBlockedAt(iso: String): String {
    return try {
        // ISO 8601 → "yyyy.MM.dd"
        val date = java.time.OffsetDateTime.parse(iso)
        "%04d.%02d.%02d".format(date.year, date.monthValue, date.dayOfMonth)
    } catch (_: Throwable) {
        iso.take(10)
    }
}
