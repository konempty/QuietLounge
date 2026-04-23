import UIKit

/// QuietLounge iOS 앱 공통 색상 팔레트.
/// 앱 아이콘 브랜드 컬러를 primary 로 쓰고, 각 ViewController 에서 이 상수를 참조해 색상 일관성을 유지한다.
enum AppColors {
    /// 앱 아이콘 브랜드 컬러 — 라이트 모드 `#4A6CF7`, 다크 모드 `#7791F9` (시인성 보정).
    /// 다크 배경에서 원본 색이 어둡게 보여 글자 가독성이 떨어지는 문제를 UITraitCollection 기반으로 해결.
    static let primary = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 106/255, green: 134/255, blue: 248/255, alpha: 1)
            : UIColor(red: 74/255, green: 108/255, blue: 247/255, alpha: 1)
    }

    /// primary 의 15% 투명도 — 태그 배경처럼 부드러운 강조에 사용. 모드별 동일하게 밝기 보정.
    static let primaryTint15 = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 106/255, green: 134/255, blue: 248/255, alpha: 0.15)
            : UIColor(red: 74/255, green: 108/255, blue: 247/255, alpha: 0.15)
    }
}
