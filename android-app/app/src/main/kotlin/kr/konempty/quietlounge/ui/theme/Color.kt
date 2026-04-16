package kr.konempty.quietlounge.ui.theme

import androidx.compose.ui.graphics.Color

// ──────────────────────────────────────────────────────────────────────────────
// QuietLounge 브랜드 컬러 — 다크/라이트 무관, 항상 동일
// ──────────────────────────────────────────────────────────────────────────────
val QlPrimary = Color(0xFF1FAF63) // iOS UIColor(red:31, green:175, blue:99)
val QlDanger = Color(0xFFE74C3C)
val QlSupport = Color(0xFF6F4E37) // 라이트 모드 후원 버튼
val QlSupportDark = Color(0xFFD2AA78) // 다크 모드 후원 버튼 (iOS SettingsViewController:590)

// 스플래시 — iOS SplashViewController.brandColor 와 동일 (rgb 74,108,247)
val QlSplashBrand = Color(0xFF4A6CF7)

// ──────────────────────────────────────────────────────────────────────────────
// Light — iOS 시스템 그룹드 컬러 매칭
//   systemGroupedBackground          → background  (#F2F2F7)
//   secondarySystemGroupedBackground → surface     (#FFFFFF)
//   label                            → onBackground (#000)
//   secondaryLabel                   → onSurfaceVariant (~#8E8E93)
//   separator                        → outline      (#C6C6C8)
// ──────────────────────────────────────────────────────────────────────────────
val QlLightBackground = Color(0xFFF2F2F7)
val QlLightCard = Color(0xFFFFFFFF)
val QlLightText = Color(0xFF000000)
val QlLightTextSecondary = Color(0xFF8E8E93)
val QlLightBorder = Color(0xFFC6C6C8)

// ──────────────────────────────────────────────────────────────────────────────
// Dark — iOS 시스템 다크 컬러 매칭
//   systemGroupedBackground          → background  (#000000)
//   secondarySystemGroupedBackground → surface     (#1C1C1E)
//   label                            → onBackground (#FFF)
//   secondaryLabel                   → onSurfaceVariant (~#8E8E93)
//   separator                        → outline      (#38383A)
// ──────────────────────────────────────────────────────────────────────────────
val QlDarkBackground = Color(0xFF000000)
val QlDarkCard = Color(0xFF1C1C1E)
val QlDarkText = Color(0xFFFFFFFF)
val QlDarkTextSecondary = Color(0xFF8E8E93)
val QlDarkBorder = Color(0xFF38383A)
