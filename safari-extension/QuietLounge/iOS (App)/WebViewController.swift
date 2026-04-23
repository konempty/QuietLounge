import UIKit
import WebKit
import Network

class WebViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!
    private var offlineView: UIView!
    private let monitor = NWPathMonitor()

    // 하단 네비게이션 툴바 — iOS Safari 처럼 아래에 배치.
    // 엣지 스와이프만으로도 탐색 가능하므로 opt-in 설정 (기본 off). BlockDataManager.showWebViewToolbar 로 제어.
    private let toolbar = UIView()
    private let backButton = UIButton(type: .system)
    private let forwardButton = UIButton(type: .system)
    private let homeButton = UIButton(type: .system)
    private let reloadButton = UIButton(type: .system)
    private var toolbarHeightConstraint: NSLayoutConstraint?
    private static let toolbarHeight: CGFloat = 44
    private var canGoBackObs: NSKeyValueObservation?
    private var canGoForwardObs: NSKeyValueObservation?
    private var isLoadingObs: NSKeyValueObservation?
    private var urlObs: NSKeyValueObservation?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.systemBackground

        setupToolbar()
        setupWebView()
        setupOfflineView()
        updateToolbarState()
        updateToolbarVisibility()

        NotificationCenter.default.addObserver(
            self, selector: #selector(webViewToolbarSettingChanged),
            name: .webViewToolbarChanged, object: nil
        )

        // 네트워크 상태 감시
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                if path.status == .satisfied {
                    self?.showWebView()
                } else {
                    self?.showOfflineView()
                }
            }
        }
        monitor.start(queue: DispatchQueue.global())
    }

    @objc private func webViewToolbarSettingChanged() {
        updateToolbarVisibility()
    }

    private func updateToolbarVisibility() {
        let show = BlockDataManager.shared.showWebViewToolbar
        toolbar.isHidden = !show
        toolbarHeightConstraint?.constant = show ? Self.toolbarHeight : 0
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "qlBridge")

        let beforeScript = WKUserScript(
            source: WebViewScripts.beforeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(beforeScript)

        let afterScript = WKUserScript(
            source: WebViewScripts.afterScript(blockData: BlockDataManager.shared.load(), filterMode: BlockDataManager.shared.filterMode),
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(afterScript)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.decelerationRate = .normal
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        // 하단은 툴바가 차지하므로 webView 는 toolbar 위까지
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: toolbar.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        // canGoBack/Forward/isLoading/url 변화 → 툴바 상태 갱신
        canGoBackObs = webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
            self?.updateToolbarState()
        }
        canGoForwardObs = webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in
            self?.updateToolbarState()
        }
        isLoadingObs = webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
            self?.updateToolbarState()
        }
        urlObs = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            self?.updateToolbarState()
        }

        webView.load(URLRequest(url: URL(string: "https://lounge.naver.com")!))

        NotificationCenter.default.addObserver(self, selector: #selector(blockDataChanged), name: .blockDataChanged, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(filterModeChanged), name: .filterModeChanged, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(navigateToPost(_:)), name: .navigateToPost, object: nil)
    }

    private func setupToolbar() {
        toolbar.backgroundColor = .secondarySystemBackground
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        toolbar.clipsToBounds = true  // height=0 일 때 내용이 밖으로 삐져나오지 않도록
        view.addSubview(toolbar)

        let separator = UIView()
        separator.backgroundColor = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(separator)

        func configure(_ button: UIButton, systemImage: String, action: Selector) {
            button.setImage(
                UIImage(systemName: systemImage, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)),
                for: .normal
            )
            button.tintColor = .label
            button.translatesAutoresizingMaskIntoConstraints = false
            button.addTarget(self, action: action, for: .touchUpInside)
        }
        configure(backButton, systemImage: "chevron.left", action: #selector(backTapped))
        configure(forwardButton, systemImage: "chevron.right", action: #selector(forwardTapped))
        configure(homeButton, systemImage: "house", action: #selector(homeTapped))
        configure(reloadButton, systemImage: "arrow.clockwise", action: #selector(reloadTapped))

        backButton.accessibilityLabel = "뒤로 가기"
        forwardButton.accessibilityLabel = "앞으로 가기"
        homeButton.accessibilityLabel = "홈으로"
        reloadButton.accessibilityLabel = "새로 고침"

        let stack = UIStackView(arrangedSubviews: [backButton, forwardButton, homeButton, reloadButton])
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(stack)

        // 높이 제약은 priority 999 — 뷰가 레이아웃되기 전 초기 상태에서 컨테이너 높이가 0 일 때
        // `UIView-Encapsulated-Layout-Height == 0` 와 충돌하지 않도록 required 보다 낮게.
        let heightConstraint = toolbar.heightAnchor.constraint(equalToConstant: Self.toolbarHeight)
        heightConstraint.priority = UILayoutPriority(999)
        toolbarHeightConstraint = heightConstraint

        NSLayoutConstraint.activate([
            toolbar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            heightConstraint,

            stack.topAnchor.constraint(equalTo: toolbar.topAnchor),
            stack.bottomAnchor.constraint(equalTo: toolbar.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor),

            separator.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor),
            separator.topAnchor.constraint(equalTo: toolbar.topAnchor),  // 하단 배치 시 상단 구분선
            separator.heightAnchor.constraint(equalToConstant: 0.5)
        ])
    }

    private func updateToolbarState() {
        let state = QuietLoungeCore.computeNavigationToolbarState(
            canGoBack: webView?.canGoBack ?? false,
            canGoForward: webView?.canGoForward ?? false,
            isLoading: webView?.isLoading ?? false,
            currentUrl: webView?.url
        )
        backButton.isEnabled = state.backEnabled
        forwardButton.isEnabled = state.forwardEnabled
        homeButton.isEnabled = state.homeEnabled
        let reloadIcon = state.reloadMode == .stop ? "xmark" : "arrow.clockwise"
        reloadButton.setImage(
            UIImage(systemName: reloadIcon, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)),
            for: .normal
        )
        reloadButton.accessibilityLabel = state.reloadMode == .stop ? "로드 중지" : "새로 고침"

        let dim: CGFloat = 0.3
        backButton.alpha = state.backEnabled ? 1.0 : dim
        forwardButton.alpha = state.forwardEnabled ? 1.0 : dim
        homeButton.alpha = state.homeEnabled ? 1.0 : dim
    }

    @objc private func backTapped() {
        if webView.canGoBack { webView.goBack() }
    }

    @objc private func forwardTapped() {
        if webView.canGoForward { webView.goForward() }
    }

    @objc private func homeTapped() {
        webView.load(URLRequest(url: URL(string: "https://lounge.naver.com")!))
    }

    @objc private func reloadTapped() {
        if webView.isLoading { webView.stopLoading() } else { webView.reload() }
    }

    private func setupOfflineView() {
        offlineView = UIView()
        offlineView.backgroundColor = UIColor.systemBackground
        offlineView.isHidden = true

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        let icon = UIImageView(image: UIImage(systemName: "wifi.slash"))
        icon.tintColor = .secondaryLabel
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 48).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 48).isActive = true

        let titleLabel = UILabel()
        titleLabel.text = "인터넷에 연결할 수 없습니다"
        titleLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        titleLabel.textColor = .label

        let descLabel = UILabel()
        descLabel.text = "네트워크 연결 상태를 확인해주세요"
        descLabel.font = .systemFont(ofSize: 14)
        descLabel.textColor = .secondaryLabel

        let retryButton = UIButton(type: .system)
        retryButton.setTitle("다시 시도", for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        retryButton.tintColor = UIColor(red: 31/255, green: 175/255, blue: 99/255, alpha: 1)
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        stack.addArrangedSubview(icon)
        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(descLabel)
        stack.addArrangedSubview(retryButton)

        offlineView.addSubview(stack)

        view.addSubview(offlineView)
        offlineView.translatesAutoresizingMaskIntoConstraints = false
        // 툴바는 하단에 있으므로 offlineView 는 그 위 영역만 덮는다 — 오프라인 상태에서도 새로고침/홈 버튼 접근 가능
        NSLayoutConstraint.activate([
            offlineView.topAnchor.constraint(equalTo: view.topAnchor),
            offlineView.bottomAnchor.constraint(equalTo: toolbar.topAnchor),
            offlineView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offlineView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.centerXAnchor.constraint(equalTo: offlineView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: offlineView.centerYAnchor)
        ])
    }

    private func showOfflineView() {
        offlineView.isHidden = false
        webView?.isHidden = true
    }

    private func showWebView() {
        offlineView.isHidden = true
        webView?.isHidden = false
        // 페이지가 아직 로드되지 않았으면 로드
        if webView.url == nil {
            webView.load(URLRequest(url: URL(string: "https://lounge.naver.com")!))
        }
    }

    @objc private func retryTapped() {
        webView.load(URLRequest(url: URL(string: "https://lounge.naver.com")!))
        showWebView()
    }

    // WKNavigationDelegate — 페이지 로드 실패 시
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        if nsError.code == NSURLErrorNotConnectedToInternet || nsError.code == NSURLErrorTimedOut {
            showOfflineView()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        if nsError.code == NSURLErrorNotConnectedToInternet || nsError.code == NSURLErrorTimedOut || nsError.code == NSURLErrorCannotFindHost {
            showOfflineView()
        }
    }

    @objc private func blockDataChanged() {
        let data = BlockDataManager.shared.load()
        let js = WebViewScripts.blockListUpdateScript(blockData: data)
        webView.evaluateJavaScript(js)
    }

    @objc private func filterModeChanged() {
        let mode = BlockDataManager.shared.filterMode
        webView.evaluateJavaScript("if(window.__QL_setFilterMode) window.__QL_setFilterMode('\(mode)'); true;")
    }

    @objc private func navigateToPost(_ notification: Notification) {
        guard let postId = notification.userInfo?["postId"] as? String else { return }
        let url = "https://lounge.naver.com/posts/\(postId)"
        webView.evaluateJavaScript("window.location.href = '\(url)'; true;")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "BLOCK_USER":
            guard let payload = json["payload"] as? [String: Any],
                  let nickname = payload["nickname"] as? String else { return }
            let personaId = payload["personaId"] as? String

            let alert = UIAlertController(title: "유저 차단", message: "\"\(nickname)\" 유저를 차단하시겠습니까?", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "취소", style: .cancel))
            alert.addAction(UIAlertAction(title: "차단", style: .destructive) { _ in
                BlockDataManager.shared.blockUser(personaId: personaId, nickname: nickname)
            })
            present(alert, animated: true)

        case "PERSONA_MAP_UPDATE":
            guard let payload = json["payload"] as? [String: Any],
                  let cache = payload["personaCache"] as? [String: String] else { return }
            for (pid, nick) in cache {
                BlockDataManager.shared.updatePersonaCache(personaId: pid, nickname: nick)
            }

        default:
            break
        }
    }

    deinit {
        monitor.cancel()
    }
}
