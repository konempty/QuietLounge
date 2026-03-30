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
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        NotificationCenter.default.addObserver(self, selector: #selector(reload), name: .blockDataChanged, object: nil)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    @objc private func reload() {
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
        let total = personaBlocked.count + nicknameBlocked.count
        if total == 0 {
            let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
            cell.textLabel?.text = "차단된 유저가 없습니다"
            cell.textLabel?.textColor = .secondaryLabel
            cell.textLabel?.textAlignment = .center
            cell.selectionStyle = .none
            return cell
        }

        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.selectionStyle = .none

        var config = cell.defaultContentConfiguration()
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
