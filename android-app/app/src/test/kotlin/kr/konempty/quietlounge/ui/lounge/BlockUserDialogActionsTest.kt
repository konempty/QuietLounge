package kr.konempty.quietlounge.ui.lounge

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import kr.konempty.quietlounge.ui.theme.QuietLoungeTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BlockUserDialogActionsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `차단 선택지는 오른쪽 정렬 세로 목록이 아니라 같은 폭 가로 버튼으로 배치`() {
        compose.setContent {
            QuietLoungeTheme {
                Box(Modifier.width(320.dp)) {
                    BlockUserDialogActions(
                        onBlockPostsOnly = {},
                        onBlockPostsAndComments = {},
                        onCancel = {},
                    )
                }
            }
        }

        compose.onNodeWithTag("block-user-dialog-actions").assertWidthIsEqualTo(320.dp)
        compose.onNodeWithTag("block-user-posts-only").assertWidthIsEqualTo(156.dp)
        compose.onNodeWithTag("block-user-posts-comments").assertWidthIsEqualTo(156.dp)
    }

    @Test
    fun `AlertDialog action 슬롯에서도 선택지가 오른쪽에 몰리지 않는다`() {
        compose.setContent {
            QuietLoungeTheme {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("유저 차단") },
                    text = { Text("\"닉네임\" 유저를 어떻게 차단할까요?") },
                    confirmButton = {
                        BlockUserDialogActions(
                            onBlockPostsOnly = {},
                            onBlockPostsAndComments = {},
                            onCancel = {},
                        )
                    },
                )
            }
        }

        val actions = compose.onNodeWithTag("block-user-dialog-actions").getUnclippedBoundsInRoot()
        val postsOnly = compose.onNodeWithTag("block-user-posts-only").getUnclippedBoundsInRoot()
        val postsAndComments =
            compose.onNodeWithTag("block-user-posts-comments").getUnclippedBoundsInRoot()

        assertTrue((actions.right - actions.left).value >= 240f)
        assertEquals(actions.left.value, postsOnly.left.value, 0.5f)
        assertEquals(
            (postsOnly.right - postsOnly.left).value,
            (postsAndComments.right - postsAndComments.left).value,
            0.5f,
        )
    }

    @Test
    fun `차단 선택지 클릭 콜백 연결`() {
        var selected = ""
        compose.setContent {
            QuietLoungeTheme {
                BlockUserDialogActions(
                    onBlockPostsOnly = { selected = "posts" },
                    onBlockPostsAndComments = { selected = "posts-comments" },
                    onCancel = { selected = "cancel" },
                )
            }
        }

        compose.onNodeWithTag("block-user-posts-comments").performClick()
        assertEquals("posts-comments", selected)

        compose.onNodeWithTag("block-user-cancel").performClick()
        assertEquals("cancel", selected)
    }
}
