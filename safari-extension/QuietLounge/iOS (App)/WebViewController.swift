import UIKit
import WebKit
import Network

class WebViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {

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

    // 당겨서 새로고침 — UIRefreshControl 은 WKWebView 스크롤 위임 및 네이버 페이지 자체 JS 와 충돌해
    // 드래그 중 reload 가 발화되는 문제가 있어 pan gesture 로 직접 구현.
    // `.ended/.cancelled` 상태일 때만 reload 를 호출하므로 반드시 손을 뗀 뒤에만 갱신됨.
    private let pullSpinner = UIActivityIndicatorView(style: .medium)
    private static let pullThreshold: CGFloat = 80
    private var pullRefreshArmed = false
    private var pullRefreshInProgress = false

    /// 앱 한 번 켤 때 안내 팝업을 1회만 띄우기 위한 플래그.
    /// `viewDidAppear` 이 라이프사이클상 여러 번 불릴 수 있어 (탭 전환 후 복귀 등) 가드 필요.
    private var hasShownToolbarHintThisLaunch = false

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

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        maybeShowToolbarHint()
    }

    @objc private func webViewToolbarSettingChanged() {
        updateToolbarVisibility()
    }

    /// 앱 시작 후 라운지 화면이 처음 표시될 때 1회 안내 팝업 노출.
    /// - 이미 툴바를 켰으면 안 띄움
    /// - "다시 보지 않기" 누른 사용자에겐 안 띄움
    /// - 그 외에는 매 launch 마다 한 번 (`hasShownToolbarHintThisLaunch` 가드)
    private func maybeShowToolbarHint() {
        guard !hasShownToolbarHintThisLaunch else { return }
        let manager = BlockDataManager.shared
        guard QuietLoungeCore.shouldShowToolbarHint(
            showWebViewToolbar: manager.showWebViewToolbar,
            dontShowToolbarHint: manager.dontShowToolbarHint
        ) else { return }
        hasShownToolbarHintThisLaunch = true

        let alert = UIAlertController(
            title: "웹뷰 툴바를 켤 수 있어요",
            message: "라운지 웹뷰 하단에 뒤/앞/홈/새로고침 버튼을 표시할 수 있습니다.\n필요하면 설정 > 표시 설정에서 켜보세요.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "설정 열기", style: .default) { _ in
            NotificationCenter.default.post(name: .switchToSettingsTab, object: nil)
        })
        alert.addAction(UIAlertAction(title: "다시 보지 않기", style: .destructive) { _ in
            BlockDataManager.shared.dontShowToolbarHint = true
        })
        alert.addAction(UIAlertAction(title: "닫기", style: .cancel))
        present(alert, animated: true)
    }

    /// 차단 직후 호출 — HIDE 모드 + 안내 안 끔이면 흐림 처리 모드 안내 alert 노출.
    private func maybeShowFilterModeHint() {
        let manager = BlockDataManager.shared
        let isBlur = manager.filterMode == "blur"
        guard QuietLoungeCore.shouldShowFilterModeHint(
            isBlurMode: isBlur,
            dontShowFilterHint: manager.dontShowFilterHint
        ) else { return }

        let alert = UIAlertController(
            title: "팁: 흐림 처리 모드",
            message: "차단된 글을 완전히 숨기는 대신 흐리게만 처리할 수도 있어요.\n설정 > 표시 설정 > '흐림 처리' 에서 켤 수 있습니다.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        alert.addAction(UIAlertAction(title: "다시 보지 않기", style: .destructive) { _ in
            BlockDataManager.shared.dontShowFilterHint = true
        })
        present(alert, animated: true)
    }

    private func updateToolbarVisibility() {
        let show = BlockDataManager.shared.showWebViewToolbar
        toolbar.isHidden = !show
        toolbarHeightConstraint?.constant = show ? Self.toolbarHeight : 0
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "qlBridge")

        // before/after WKUserScript 등록은 setup 시점 + 데이터 변경 시점에 모두 호출되므로 헬퍼로 분리.
        // (setup 시 webView 가 아직 없어 config.userContentController 를 직접 넘긴다.
        //  이후엔 webView.configuration.userContentController 가 같은 인스턴스라 헬퍼가 양쪽 다 동작.)
        registerUserScripts(on: config.userContentController)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        // WKWebView 는 WKUIDelegate 메서드를 구현하지 않으면 JS alert / confirm / prompt 가
        // silently 봉쇄된다. 라운지가 confirm 으로 사용자 확인을 받는 흐름이 있어 native
        // UIAlertController 로 매개해줘야 한다.
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.decelerationRate = .normal
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

        // 당겨서 새로고침 — pan gesture 로 감지. `.ended` 에서만 reload 호출해 반드시 손 뗀 뒤 갱신.
        webView.scrollView.panGestureRecognizer.addTarget(self, action: #selector(webScrollPanChanged(_:)))

        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        // 하단은 툴바가 차지하므로 webView 는 toolbar 위까지
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: toolbar.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        // 당겨서 새로고침 스피너 — 상단 safeArea 아래에 오버레이
        pullSpinner.color = AppColors.primary
        pullSpinner.tintColor = AppColors.primary  // 일부 iOS 버전에서 color 보다 tintColor 가 우선 적용되는 경우 대비
        pullSpinner.hidesWhenStopped = true
        pullSpinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pullSpinner)
        NSLayoutConstraint.activate([
            pullSpinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            pullSpinner.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12)
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

    @objc private func webScrollPanChanged(_ gesture: UIPanGestureRecognizer) {
        let scroll = webView.scrollView
        // adjustedContentInset 를 빼서 safeArea 보정 이후의 "시각적" top 기준 offset 계산
        let offset = scroll.contentOffset.y + scroll.adjustedContentInset.top

        switch gesture.state {
        case .began:
            pullRefreshArmed = false
        case .changed:
            // 이미 리프레시 진행 중이면 스피너 건드리지 않음
            guard !pullRefreshInProgress else { break }

            if offset < 0 {
                // 당기는 동안 스피너 표시 — 0.4 에서 시작해 1.0 까지 올라가 색상이 항상 선명히 보이도록
                let progress = min(1.0, -offset / Self.pullThreshold)
                pullSpinner.alpha = 0.4 + 0.6 * progress
                if !pullSpinner.isAnimating {
                    pullSpinner.startAnimating()
                }
                pullRefreshArmed = offset <= -Self.pullThreshold
            } else {
                // 다시 올라왔으면 스피너 숨기고 발사 대기 해제
                pullSpinner.stopAnimating()
                pullSpinner.alpha = 1.0
                pullRefreshArmed = false
            }
        case .ended, .cancelled, .failed:
            if pullRefreshArmed && !pullRefreshInProgress {
                pullRefreshArmed = false
                pullRefreshInProgress = true
                pullSpinner.alpha = 1.0
                // 이미 .changed 에서 startAnimating 됐지만 방어적으로 한번 더
                if !pullSpinner.isAnimating { pullSpinner.startAnimating() }
                webView.reload()
            } else if !pullRefreshInProgress {
                // threshold 미달로 놓은 경우 스피너 바로 숨김
                pullSpinner.stopAnimating()
                pullSpinner.alpha = 1.0
                pullRefreshArmed = false
            }
        default:
            break
        }
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
        retryButton.tintColor = AppColors.primary
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

    private func stopPullSpinner() {
        pullRefreshInProgress = false
        pullSpinner.stopAnimating()
        pullSpinner.alpha = 1.0
    }

    // WKNavigationDelegate — 페이지 로드 종료 시
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        stopPullSpinner()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        stopPullSpinner()
        let nsError = error as NSError
        if nsError.code == NSURLErrorNotConnectedToInternet || nsError.code == NSURLErrorTimedOut {
            showOfflineView()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        stopPullSpinner()
        let nsError = error as NSError
        if nsError.code == NSURLErrorNotConnectedToInternet || nsError.code == NSURLErrorTimedOut || nsError.code == NSURLErrorCannotFindHost {
            showOfflineView()
        }
    }

    @objc private func blockDataChanged() {
        let data = BlockDataManager.shared.load()
        let js = WebViewScripts.blockListUpdateScript(blockData: data)
        webView.evaluateJavaScript(js)
        // 다음 페이지 로드/새로고침에 stale blockData 가 다시 주입되지 않도록 WKUserScript 재등록.
        registerUserScripts(on: webView.configuration.userContentController)
    }

    @objc private func filterModeChanged() {
        let mode = BlockDataManager.shared.filterMode
        webView.evaluateJavaScript("if(window.__QL_setFilterMode) window.__QL_setFilterMode('\(mode)'); true;")
        // 다음 페이지 로드/새로고침에 stale filterMode 가 다시 주입되지 않도록 WKUserScript 재등록.
        // 라이브 setFilterMode 는 현재 페이지에만 적용되므로 새로고침 시 baked-in 값으로 회귀하는 회귀를
        // 차단. (이전 PR 에서 placeholder substitution 이 처음 정상 동작하면서 가시화된 staleness)
        registerUserScripts(on: webView.configuration.userContentController)
    }

    /// before/after WKUserScript 를 (재)등록한다.
    /// `WKUserScript` 의 source 는 immutable 이므로 blockData / filterMode 변경 시 새로 만들어 교체.
    /// `removeAllUserScripts()` 는 user script 만 제거하고 message handler (qlBridge) 는 그대로 둔다.
    private func registerUserScripts(on controller: WKUserContentController) {
        controller.removeAllUserScripts()

        let beforeScript = WKUserScript(
            source: WebViewScripts.beforeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        controller.addUserScript(beforeScript)

        let afterScript = WKUserScript(
            source: WebViewScripts.afterScript(
                blockData: BlockDataManager.shared.load(),
                filterMode: BlockDataManager.shared.filterMode
            ),
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        controller.addUserScript(afterScript)
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
            alert.addAction(UIAlertAction(title: "차단", style: .destructive) { [weak self] _ in
                BlockDataManager.shared.blockUser(personaId: personaId, nickname: nickname)
                // 첫 alert 가 dismiss 된 다음 tick 에 띄워야 "이미 present 중인 vc 위에 또 present" 경고가 안 남.
                DispatchQueue.main.async {
                    self?.maybeShowFilterModeHint()
                }
            })
            present(alert, animated: true)

        case "PERSONA_MAP_UPDATE":
            guard let payload = json["payload"] as? [String: Any],
                  let cache = payload["personaCache"] as? [String: String] else { return }
            // 단건 for-loop 호출은 매 항목마다 전체 데이터를 JSON 직렬화/역직렬화 + UserDefaults
            // 쓰기 + Darwin notification 발생 → Main thread 가 점유돼 다른 탭 토글 UI 가 먹통이 되는
            // 회귀 발생. 배치로 1 회만 save 한다.
            BlockDataManager.shared.updatePersonaCacheBatch(cache)

        default:
            break
        }
    }

    deinit {
        monitor.cancel()
    }

    // MARK: - WKUIDelegate (JS alert / confirm / prompt 매개)
    //
    // WKWebView 는 기본적으로 JavaScript 의 dialog 를 띄우지 않는다 — UIDelegate 메서드를
    // 구현하지 않으면 silent suppress. 라운지 페이지가 사용자 확인을 받는 confirm() 호출이
    // 그대로 무시되어 동작이 멈추는 회귀가 있어 UIAlertController 로 매개한다.
    //
    // 보안 노트: dialog message 를 그대로 사용자에게 노출하므로 라운지 측에서 임의의 텍스트를
    // 띄울 수 있다 (의도된 동작). 이는 일반 브라우저의 confirm() 과 동일한 신뢰 모델.
    //
    // present() 실패 가드 (P2 리뷰 피드백): 이 컨트롤러는 maybeShowToolbarHint / 차단 confirm /
    // filter-mode hint 등 자체 alert 를 다양한 경로에서 띄운다. 그 상태에서 JS dialog 가 들어오면
    // UIKit 이 "already presenting" 으로 silently 실패해 completionHandler 가 호출되지 않고 JS
    // 스레드가 hang 됨. presentJsDialog 가 (1) top-most presenter 를 찾아 시도하고 (2) 그래도 못 띄우면
    // fail-closed 로 안전한 default 를 즉시 호출 — JS hang 보다 dialog 미표시가 안전.

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
        presentJsDialog(alert, fallback: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        presentJsDialog(alert, fallback: { completionHandler(false) })
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { tf in tf.text = defaultText }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        presentJsDialog(alert, fallback: { completionHandler(nil) })
    }

    /// JS dialog 전용 present 헬퍼.
    ///
    /// 1. top-most presenter (modal stack 의 leaf, dismiss 중인 컨트롤러는 건너뜀) 를 찾아 present 시도.
    /// 2. top 이 다른 alert 를 이미 presenting 중이거나 transition 중이면 — 새 alert 를 띄울 수 없으므로
    ///    `fallback` 을 즉시 호출해 completionHandler 를 안전한 default (false / nil / no-op) 로 닫는다.
    ///
    /// JS 스레드 hang 보다 "이번 dialog 는 표시 못함" (= cancel 처리) 이 항상 안전. 라운지 측은 dialog
    /// 결과가 false 인 경우의 분기를 이미 갖고 있을 것이라는 가정 (일반 브라우저에서 dismiss 시 동작과 동일).
    private func presentJsDialog(_ alert: UIAlertController, fallback: @escaping () -> Void) {
        var top: UIViewController = self
        while let next = top.presentedViewController, !next.isBeingDismissed {
            top = next
        }
        if top.presentedViewController != nil || top.isBeingPresented || top.isBeingDismissed {
            fallback()
            return
        }
        top.present(alert, animated: true)
    }
}
