package kr.konempty.quietlounge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kr.konempty.quietlounge.ui.theme.QlSplashBrand

/**
 * iOS SplashViewController 와 동일한 디자인.
 *
 * - 배경: 보라 파란(#4A6CF7)
 * - 중앙 약간 위: 80x80 흰색 라운드 박스, 안에 "Q" (40sp Bold, brand color)
 * - 그 아래 16dp: "QuietLounge" (24sp Bold, 흰색)
 */
@Composable
fun SplashScreen() {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(QlSplashBrand),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.offset(y = (-30).dp),
        ) {
            Box(
                modifier =
                    Modifier
                        .size(80.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "Q",
                    color = QlSplashBrand,
                    fontSize = 40.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(
                text = "QuietLounge",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
