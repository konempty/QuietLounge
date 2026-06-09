import UIKit

class BlockListViewController: UIViewController, UITableViewDataSource, UITableViewDelegate {

    private let tableView = UITableView(frame: .zero, style: .insetGrouped)
    private var personaBlocked: [[String: Any]] = []
    private var nicknameBlocked: [[String: Any]] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "차단 목록"
        view.backgroundColor = .systemBackground

        tableView.dataSource = self
        tableView.delegate = self
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")

        view.addSubview(tableView)
        tableView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        NotificationCenter.default.addObserver(self, selector: #selector(reload), name: .blockDataChanged, object: nil)
        // 백그라운드 → 포그라운드 복귀 시 강제 재로드
        // (앱 suspended 상태에서 외부 프로세스가 데이터를 바꿨을 경우 Darwin notification이 드롭됨)
        NotificationCenter.default.addObserver(self, selector: #selector(reload), name: UIScene.didActivateNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(reload), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // viewWillAppear 시점엔 view.window 가 아직 nil 일 수 있으므로 가드 우회 — 항상 갱신.
        refreshFromStorage()
    }

    @objc private func reload() {
        // 알림 콜백 경로 (.blockDataChanged / scene·app activate 등) 에선 가드 사용.
        // 비활성 탭일 땐 view 가 hierarchy 에서 빠진 상태 (MainTabViewController 가 removeFromSuperview 함) 라
        // reloadData 가 "UITableViewAlertForLayoutOutsideViewHierarchy" 경고를 발생시킴.
        // 비활성이라도 viewWillAppear 가 다음 탭 전환 때 어차피 갱신하므로 skip 안전.
        guard isViewLoaded, view.window != nil else { return }
        refreshFromStorage()
    }

    private func refreshFromStorage() {
        let data = BlockDataManager.shared.load()
        let users = data["blockedUsers"] as? [String: [String: Any]] ?? [:]
        personaBlocked = users.values.sorted {
            ($0["blockedAt"] as? String ?? "") > ($1["blockedAt"] as? String ?? "")
        }
        let nicks = data["nicknameOnlyBlocks"] as? [[String: Any]] ?? []
        nicknameBlocked = nicks.sorted {
            ($0["blockedAt"] as? String ?? "") > ($1["blockedAt"] as? String ?? "")
        }
        tableView.reloadData()
    }

    func numberOfSections(in tableView: UITableView) -> Int { 1 }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        let count = personaBlocked.count + nicknameBlocked.count
        return count == 0 ? 1 : count
    }

    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        let total = personaBlocked.count + nicknameBlocked.count
        return "총 \(total)명 차단 중 (ID \(personaBlocked.count) / 닉네임 \(nicknameBlocked.count))"
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.selectionStyle = .none
        cell.accessoryView = nil

        var config = cell.defaultContentConfiguration()
        let total = personaBlocked.count + nicknameBlocked.count
        if total == 0 {
            config.text = "차단된 유저가 없습니다"
            config.textProperties.color = .secondaryLabel
            config.textProperties.alignment = .center
            cell.contentConfiguration = config
            return cell
        }

        if indexPath.row < personaBlocked.count {
            let user = personaBlocked[indexPath.row]
            let nickname = user["nickname"] as? String ?? ""
            let pid = user["personaId"] as? String ?? ""
            let scope = (user["blockComments"] as? Bool == true) ? "글+댓글" : "글만"
            config.text = "\(nickname)  [ID]"
            config.secondaryText = "\(pid) · \(scope)"
            config.secondaryTextProperties.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
            config.secondaryTextProperties.color = .secondaryLabel
        } else {
            let block = nicknameBlocked[indexPath.row - personaBlocked.count]
            let nickname = block["nickname"] as? String ?? ""
            let scope = (block["blockComments"] as? Bool == true) ? "글+댓글" : "글만"
            config.text = "\(nickname)  [닉네임]"
            config.secondaryText = "닉네임만 확보 · \(scope)"
            config.secondaryTextProperties.color = .secondaryLabel
        }
        cell.contentConfiguration = config

        // 4 플랫폼 통일된 unblock UX — 항상 보이는 "해제" 버튼 + 클릭 시 confirm popup.
        // 이전에는 swipe-to-action 으로 숨겨져 있어 다른 플랫폼과 일관성이 없고 발견성이 낮았다.
        cell.accessoryView = makeUnblockButton(for: indexPath)

        return cell
    }

    /// 해제 대상 — confirm 시점에 캡처해 alert 가 떠있는 동안 데이터가 바뀌어도 (다른 프로세스/
    /// Safari ext / 탭 전환 후 reload 등) 처음 사용자가 본 유저를 정확히 해제한다.
    /// indexPath 로 수행 직전 재조회하면 같은 row 에 다른 유저가 들어온 케이스를 못 막아
    /// "A 해제하시겠습니까?" → 실제 B 해제가 발생할 수 있다 (P1 리뷰 피드백).
    private enum UnblockTarget {
        case persona(personaId: String, nickname: String)
        case nicknameOnly(nickname: String)

        var displayName: String {
            switch self {
            case .persona(_, let nickname): return nickname
            case .nicknameOnly(let nickname): return nickname
            }
        }
    }

    private func unblockTarget(at indexPath: IndexPath) -> UnblockTarget? {
        if indexPath.row < personaBlocked.count {
            let user = personaBlocked[indexPath.row]
            let pid = user["personaId"] as? String ?? ""
            let nickname = user["nickname"] as? String ?? ""
            guard !pid.isEmpty else { return nil }
            return .persona(personaId: pid, nickname: nickname)
        }
        let nickIdx = indexPath.row - personaBlocked.count
        guard nickIdx < nicknameBlocked.count else { return nil }
        let nickname = nicknameBlocked[nickIdx]["nickname"] as? String ?? ""
        guard !nickname.isEmpty else { return nil }
        return .nicknameOnly(nickname: nickname)
    }

    private func makeUnblockButton(for indexPath: IndexPath) -> UIButton {
        // accessoryView 는 Auto Layout 을 적용하지 않아 intrinsicContentSize 만으론 frame 이
        // 잡히지 않는다 ("해제" 텍스트만 잘못된 위치에 보이는 회귀). Configuration 으로 스타일을
        // 정의하고 sizeToFit() 으로 frame 을 명시적으로 계산해 cell trailing 에 정확히 붙인다.
        var cfg = UIButton.Configuration.bordered()
        cfg.title = "해제"
        cfg.baseForegroundColor = .systemRed
        cfg.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
        cfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var out = incoming
            out.font = .systemFont(ofSize: 14, weight: .semibold)
            return out
        }
        let btn = UIButton(configuration: cfg)
        btn.tag = indexPath.row
        btn.sizeToFit()
        btn.addAction(UIAction { [weak self] _ in
            self?.confirmUnblock(at: indexPath)
        }, for: .touchUpInside)
        return btn
    }

    private func confirmUnblock(at indexPath: IndexPath) {
        guard let target = unblockTarget(at: indexPath) else { return }

        let alert = UIAlertController(
            title: "차단 해제",
            message: "\"\(target.displayName)\" 유저의 차단을 해제하시겠습니까?",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "해제", style: .destructive) { [weak self] _ in
            // confirm 시점에 캡처한 target 을 그대로 사용 — alert 동안 데이터가 바뀌어도
            // 사용자가 본 그 유저를 해제. indexPath 로 재조회하지 않는다.
            self?.performUnblock(target: target)
        })
        present(alert, animated: true)
    }

    private func performUnblock(target: UnblockTarget) {
        switch target {
        case .persona(let personaId, _):
            BlockDataManager.shared.unblock(personaId: personaId)
        case .nicknameOnly(let nickname):
            BlockDataManager.shared.unblockByNickname(nickname: nickname)
        }
    }
}
