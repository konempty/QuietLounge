//
//  AppDelegate.swift
//  iOS (App)
//
//  Created by jayden.bin on 2026. 3. 30..
//

import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        // 포그라운드 타이머 시작
        KeywordAlertManager.shared.restartTimer()

        // 포그라운드 복귀 시 즉시 체크 + 타이머 재시작
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            KeywordAlertManager.shared.restartTimer()
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            KeywordAlertManager.shared.stopTimer()
        }

        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    // MARK: - 포그라운드에서 알림 표시

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    // MARK: - 알림 클릭 시 해당 글로 이동

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let postId = response.notification.request.content.userInfo["postId"] as? String
        if let postId = postId {
            NotificationCenter.default.post(
                name: .navigateToPost,
                object: nil,
                userInfo: ["postId": postId]
            )
        }
        completionHandler()
    }
}
