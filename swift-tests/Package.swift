// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "QuietLoungeCore",
    platforms: [
        .macOS(.v12),
        .iOS(.v14)
    ],
    products: [
        .library(name: "QuietLoungeCore", targets: ["QuietLoungeCore"])
    ],
    targets: [
        // iOS (App) / QuietLoungeCore.swift 를 직접 포함해서 테스트.
        // 실제 앱 코드와 동일 소스를 쓰므로 드리프트 없음.
        .target(
            name: "QuietLoungeCore",
            path: "Sources/QuietLoungeCore"
        ),
        .testTarget(
            name: "QuietLoungeCoreTests",
            dependencies: ["QuietLoungeCore"],
            path: "Tests/QuietLoungeCoreTests"
        )
    ]
)
