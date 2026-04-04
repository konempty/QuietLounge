import UIKit
import WebKit
import Network

class WebViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!
    private var offlineView: UIView!
    private let monitor = NWPathMonitor()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.systemBackground

        setupOfflineView()
        setupWebView()

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
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        webView.load(URLRequest(url: URL(string: "https://lounge.naver.com")!))

        NotificationCenter.default.addObserver(self, selector: #selector(blockDataChanged), name: .blockDataChanged, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(filterModeChanged), name: .filterModeChanged, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(navigateToPost(_:)), name: .navigateToPost, object: nil)
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
        NSLayoutConstraint.activate([
            offlineView.topAnchor.constraint(equalTo: view.topAnchor),
            offlineView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
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
