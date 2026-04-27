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
            config.text = "\(nickname)  [ID]"
            config.secondaryText = pid
            config.secondaryTextProperties.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
            config.secondaryTextProperties.color = .secondaryLabel
        } else {
            let block = nicknameBlocked[indexPath.row - personaBlocked.count]
            let nickname = block["nickname"] as? String ?? ""
            config.text = "\(nickname)  [닉네임]"
            config.secondaryText = "닉네임만 확보"
            config.secondaryTextProperties.color = .secondaryLabel
        }
        cell.contentConfiguration = config
        return cell
    }

    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let total = personaBlocked.count + nicknameBlocked.count
        if total == 0 { return nil }

        let action = UIContextualAction(style: .destructive, title: "해제") { [weak self] _, _, completion in
            guard let self = self else { return }
            if indexPath.row < self.personaBlocked.count {
                let pid = self.personaBlocked[indexPath.row]["personaId"] as? String ?? ""
                BlockDataManager.shared.unblock(personaId: pid)
            } else {
                let nick = self.nicknameBlocked[indexPath.row - self.personaBlocked.count]["nickname"] as? String ?? ""
                BlockDataManager.shared.unblockByNickname(nickname: nick)
            }
            completion(true)
        }
        return UISwipeActionsConfiguration(actions: [action])
    }
}
