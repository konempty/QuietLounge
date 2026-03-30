import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        let window = UIWindow(windowScene: windowScene)

        // 스플래시 먼저 표시
        let splashVC = SplashViewController()
        window.rootViewController = splashVC
        window.makeKeyAndVisible()
        self.window = window

        // 2초 후 메인 탭바로 전환
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            let tabBar = self.createTabBar()

            UIView.transition(with: window, duration: 0.5, options: .transitionCrossDissolve) {
                window.rootViewController = tabBar
            }
        }
    }

    private func createTabBar() -> UITabBarController {
        let webVC = WebViewController()
        webVC.tabBarItem = UITabBarItem(title: "라운지", image: UIImage(systemName: "globe"), tag: 0)

        let blockListVC = BlockListViewController()
        blockListVC.tabBarItem = UITabBarItem(title: "차단 목록", image: UIImage(systemName: "person.crop.circle.badge.xmark"), tag: 1)
        let blockListNav = UINavigationController(rootViewController: blockListVC)

        let settingsVC = SettingsViewController()
        settingsVC.tabBarItem = UITabBarItem(title: "설정", image: UIImage(systemName: "gearshape"), tag: 2)
        let settingsNav = UINavigationController(rootViewController: settingsVC)

        let tabBar = UITabBarController()
        tabBar.viewControllers = [webVC, blockListNav, settingsNav]
        tabBar.tabBar.tintColor = UIColor(red: 31/255, green: 175/255, blue: 99/255, alpha: 1)
        return tabBar
    }
}
