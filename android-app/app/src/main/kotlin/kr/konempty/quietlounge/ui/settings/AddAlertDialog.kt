package kr.konempty.quietlounge.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kr.konempty.quietlounge.ui.theme.QlPrimary

private enum class Step { Category, Channel, Keywords }

@Composable
fun AddAlertDialog(
    onDismiss: () -> Unit,
    onSave: (channelId: String, channelName: String, keywords: List<String>) -> Unit,
    viewModel: KeywordAlertsViewModel = viewModel(),
) {
    var step by remember { mutableStateOf(Step.Category) }
    var search by remember { mutableStateOf("") }
    var selectedChannel by remember { mutableStateOf<ChannelItem?>(null) }
    var keywords by remember { mutableStateOf(listOf<String>()) }
    var keywordInput by remember { mutableStateOf("") }

    val categories by viewModel.categories.collectAsStateWithLifecycle()
    val channels by viewModel.channels.collectAsStateWithLifecycle()
    val loading by viewModel.modalLoading.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.loadCategories() }

    Dialog(
        onDismissRequest = {
            viewModel.resetModal()
            onDismiss()
        },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier =
                Modifier
                    .fillMaxWidth(0.92f)
                    .heightIn(max = 600.dp),
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                // Header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text =
                            when (step) {
                                Step.Category -> "카테고리 선택"
                                Step.Channel -> "채널 선택"
                                Step.Keywords -> "키워드 입력"
                            },
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = {
                        viewModel.resetModal()
                        onDismiss()
                    }) {
                        Text("✕", fontSize = 20.sp)
                    }
                }

                Spacer(Modifier.height(8.dp))

                when (step) {
                    Step.Category -> {
                        SearchField(value = search, onChange = { search = it })
                        Spacer(Modifier.height(8.dp))
                        if (loading) {
                            LoadingBox()
                        } else {
                            SelectableList(
                                items = categories.filter { it.name.contains(search, ignoreCase = true) },
                                label = { it.name },
                                onClick = { item ->
                                    search = ""
                                    viewModel.loadChannels(item.categoryId)
                                    step = Step.Channel
                                },
                            )
                        }
                    }

                    Step.Channel -> {
                        TextButton(onClick = {
                            search = ""
                            step = Step.Category
                        }) {
                            Text("← 카테고리 선택")
                        }
                        SearchField(value = search, onChange = { search = it })
                        Spacer(Modifier.height(8.dp))
                        if (loading) {
                            LoadingBox()
                        } else {
                            SelectableList(
                                items = channels.filter { it.name.contains(search, ignoreCase = true) },
                                label = { it.name },
                                onClick = { item ->
                                    selectedChannel = item
                                    keywords = emptyList()
                                    step = Step.Keywords
                                },
                            )
                        }
                    }

                    Step.Keywords -> {
                        TextButton(onClick = { step = Step.Channel }) {
                            Text("← 채널 선택")
                        }
                        Text(
                            text = selectedChannel?.name.orEmpty(),
                            color = QlPrimary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = keywordInput,
                                onValueChange = { keywordInput = it },
                                modifier = Modifier.weight(1f),
                                placeholder = { Text("키워드 입력 후 Enter", fontSize = 13.sp) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions =
                                    KeyboardActions(onDone = {
                                        val k = keywordInput.trim()
                                        if (k.isNotEmpty() && k !in keywords) {
                                            keywords = keywords + k
                                        }
                                        keywordInput = ""
                                    }),
                            )
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = {
                                val k = keywordInput.trim()
                                if (k.isNotEmpty() && k !in keywords) {
                                    keywords = keywords + k
                                }
                                keywordInput = ""
                            }) {
                                Text("추가")
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        if (keywords.isNotEmpty()) {
                            KeywordTagFlow(keywords) { idx ->
                                keywords = keywords.toMutableList().also { it.removeAt(idx) }
                            }
                            Spacer(Modifier.height(12.dp))
                        }
                        Button(
                            onClick = {
                                val ch = selectedChannel ?: return@Button
                                if (keywords.isEmpty()) return@Button
                                onSave(ch.finalChannelId, ch.name, keywords)
                                viewModel.resetModal()
                            },
                            enabled = keywords.isNotEmpty() && selectedChannel != null,
                            colors = ButtonDefaults.buttonColors(containerColor = QlPrimary),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("알림 등록")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchField(
    value: String,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("검색...") },
        singleLine = true,
    )
}

@Composable
private fun LoadingBox() {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(280.dp),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = QlPrimary)
    }
}

@Composable
private fun <T : Any> SelectableList(
    items: List<T>,
    label: (T) -> String,
    onClick: (T) -> Unit,
) {
    if (items.isEmpty()) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(160.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "결과가 없습니다",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
            )
        }
        return
    }
    LazyColumn(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(max = 360.dp),
    ) {
        items(items) { item ->
            Text(
                text = label(item),
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onBackground,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { onClick(item) }
                        .padding(vertical = 12.dp, horizontal = 8.dp),
            )
        }
    }
}

@Composable
private fun KeywordTagFlow(
    keywords: List<String>,
    onRemove: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // 간단한 한 줄 wrap — 단순 구현 (FlowRow 미사용)
        Column {
            val rows = keywords.chunked(3)
            rows.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    row.forEachIndexed { i, kw ->
                        val absIdx = rows.indexOf(row) * 3 + i
                        Text(
                            text = "$kw  ✕",
                            color = QlPrimary,
                            fontSize = 12.sp,
                            modifier =
                                Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0x261FAF63))
                                    .clickable { onRemove(absIdx) }
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}
