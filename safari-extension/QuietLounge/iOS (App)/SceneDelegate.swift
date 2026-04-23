import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        let window = UIWindow(windowScene: windowScene)

        let splashVC = SplashViewController()
        window.rootViewController = splashVC
        window.makeKeyAndVisible()
        self.window = window

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            let mainVC = MainTabViewController()

            UIView.transition(with: window, duration: 0.5, options: .transitionCrossDissolve) {
                window.rootViewController = mainVC
            }
        }
    }
}

// MARK: - 커스텀 탭 컨테이너

class MainTabViewController: UIViewController {

    private var viewControllers: [UIViewController] = []
    private var currentIndex = 0
    private let containerView = UIView()
    private var buttons: [UIButton] = []
    private let accentColor = AppColors.primary

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let webVC = WebViewController()
        let blockListVC = UINavigationController(rootViewController: BlockListViewController())
        let settingsVC = UINavigationController(rootViewController: SettingsViewController())
        viewControllers = [webVC, blockListVC, settingsVC]

        setupContainerView()
        setupButtonBar()
        showViewController(at: 0)

        NotificationCenter.default.addObserver(self, selector: #selector(handleNavigateToPost), name: .navigateToPost, object: nil)
    }

    @objc private func handleNavigateToPost() {
        showViewController(at: 0)
    }

    private func setupContainerView() {
        containerView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(containerView)
    }

    private func setupButtonBar() {
        let items: [(String, String)] = [
            ("globe", "라운지"),
            ("person.crop.circle.badge.xmark", "차단 목록"),
            ("gearshape", "설정")
        ]

        let separator = UIView()
        separator.backgroundColor = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(separator)

        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(stack)

        for (i, item) in items.enumerated() {
            let btn = UIButton(type: .system)
            var config = UIButton.Configuration.plain()
            config.image = UIImage(systemName: item.0, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18))
            config.title = item.1
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attr in
                var attr = attr
                attr.font = UIFont.systemFont(ofSize: 11)
                return attr
            }
            config.imagePlacement = .top
            config.imagePadding = 4
            btn.configuration = config
            btn.tag = i
            btn.tintColor = i == 0 ? accentColor : .secondaryLabel
            btn.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
            stack.addArrangedSubview(btn)
            buttons.append(btn)
        }

        NSLayoutConstraint.activate([
            separator.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            separator.bottomAnchor.constraint(equalTo: bar.topAnchor),
            separator.heightAnchor.constraint(equalToConstant: 0.5),

            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            stack.topAnchor.constraint(equalTo: bar.topAnchor),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            stack.heightAnchor.constraint(equalToConstant: 56),
            stack.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -8),

            containerView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            containerView.bottomAnchor.constraint(equalTo: separator.topAnchor)
        ])
    }

    @objc private func tabTapped(_ sender: UIButton) {
        showViewController(at: sender.tag)
    }

    private func showViewController(at index: Int) {
        let oldVC = viewControllers[currentIndex]
        oldVC.willMove(toParent: nil)
        oldVC.view.removeFromSuperview()
        oldVC.removeFromParent()

        currentIndex = index
        let newVC = viewControllers[index]
        addChild(newVC)
        newVC.view.frame = containerView.bounds
        newVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        containerView.addSubview(newVC.view)
        newVC.didMove(toParent: self)

        for (i, btn) in buttons.enumerated() {
            btn.tintColor = i == index ? accentColor : .secondaryLabel
        }
    }
}
