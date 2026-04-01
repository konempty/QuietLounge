import UIKit
internal import UniformTypeIdentifiers

class SettingsViewController: UITableViewController {

    private var stats: [String: Any]? = nil
    private var isLoadingStats = false

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "설정"
        tableView = UITableView(frame: .zero, style: .insetGrouped)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")

        NotificationCenter.default.addObserver(self, selector: #selector(reloadData), name: .blockDataChanged, object: nil)
        loadStats()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        tableView.reloadData()
    }

    @objc private func reloadData() {
        tableView.reloadData()
    }

    // MARK: - Stats

    private func loadStats() {
        isLoadingStats = true
        tableView.reloadData()

        Task {
            do {
                let meUrl = URL(string: "https://api.lounge.naver.com/user-api/v1/members/me/personas")!
                let (meData, _) = try await URLSession.shared.data(from: meUrl)
                guard let meJson = try JSONSerialization.jsonObject(with: meData) as? [String: Any],
                      let meDataArr = meJson["data"] as? [[String: Any]],
                      let me = meDataArr.first,
                      let personaId = me["personaId"] as? String else {
                    await MainActor.run { isLoadingStats = false; tableView.reloadData() }
                    return
                }

                let statsUrl = URL(string: "https://api.lounge.naver.com/user-api/v1/personas/\(personaId)")!
                let (statsData, _) = try await URLSession.shared.data(from: statsUrl)
                guard let statsJson = try JSONSerialization.jsonObject(with: statsData) as? [String: Any],
                      let sData = statsJson["data"] as? [String: Any] else {
                    await MainActor.run { isLoadingStats = false; tableView.reloadData() }
                    return
                }

                await MainActor.run {
                    self.stats = sData
                    self.isLoadingStats = false
                    self.tableView.reloadData()
                }
            } catch {
                await MainActor.run { isLoadingStats = false; tableView.reloadData() }
            }
        }
    }

    // MARK: - Table View

    override func numberOfSections(in tableView: UITableView) -> Int { 5 }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch section {
        case 0: return "내 활동 통계"
        case 1: return "필터 모드"
        case 2: return "데이터 관리"
        case 3: return "후원"
        case 4: return "정보"
        default: return nil
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch section {
        case 0: return isLoadingStats ? 1 : (stats != nil ? 4 : 1)
        case 1: return 1
        case 2: return 3
        case 3: return 2
        case 4: return 2
        default: return 0
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.accessoryType = .none
        cell.selectionStyle = .none
        cell.accessoryView = nil
        var config = cell.defaultContentConfiguration()

        switch indexPath.section {
        case 0: // 통계
            if isLoadingStats {
                config.text = "로딩 중..."
                config.textProperties.color = .secondaryLabel
            } else if let s = stats {
                let labels = ["총 작성글", "총 댓글", "이번달 작성글", "이번달 댓글"]
                let values = [
                    s["totalPostCount"] as? Int ?? 0,
                    s["totalCommentCount"] as? Int ?? 0,
                    s["totalPostCount"] as? Int ?? 0, // TODO: monthly count
                    s["totalCommentCount"] as? Int ?? 0,
                ]
                config.text = labels[indexPath.row]
                config.secondaryText = "\(values[indexPath.row])"
                config.prefersSideBySideTextAndSecondaryText = true
            } else {
                config.text = "라운지에 로그인하면 통계가 표시됩니다"
                config.textProperties.color = .secondaryLabel
            }

        case 1: // 필터 모드
            config.text = "흐림 처리"
            config.secondaryText = BlockDataManager.shared.filterMode == "blur"
                ? "차단된 글을 흐리게 표시합니다"
                : "차단된 글을 완전히 숨깁니다"
            let toggle = UISwitch()
            toggle.isOn = BlockDataManager.shared.filterMode == "blur"
            toggle.onTintColor = UIColor(red: 31/255, green: 175/255, blue: 99/255, alpha: 1)
            toggle.addTarget(self, action: #selector(filterModeToggled(_:)), for: .valueChanged)
            cell.accessoryView = toggle

        case 2: // 데이터 관리
            let titles = ["차단 목록 내보내기", "차단 목록 가져오기", "전체 삭제"]
            config.text = titles[indexPath.row]
            if indexPath.row == 2 {
                config.textProperties.color = .systemRed
            }
            cell.selectionStyle = .default

        case 3: // 후원
            if indexPath.row == 0 {
                config.text = "QuietLounge는 무료이며, 개발·운영 비용은 모두 개발자가 부담하고 있습니다.\n응원하시고 싶으시다면 커피 한 잔으로 응원해 주세요!"
                config.textProperties.color = .secondaryLabel
                config.textProperties.font = .systemFont(ofSize: 13)
                config.textProperties.numberOfLines = 0
            } else {
                config.text = "☕ 개발자에게 커피 한 잔 사주기"
                config.textProperties.color = UIColor { trait in
                    trait.userInterfaceStyle == .dark
                        ? UIColor(red: 210/255, green: 170/255, blue: 120/255, alpha: 1)
                        : UIColor(red: 111/255, green: 78/255, blue: 55/255, alpha: 1)
                }
                cell.accessoryType = .disclosureIndicator
                cell.selectionStyle = .default
            }

        case 4: // 정보
            if indexPath.row == 0 {
                config.text = "버전"
                config.secondaryText = "1.0.0"
                config.prefersSideBySideTextAndSecondaryText = true
            } else {
                let total = BlockDataManager.shared.totalBlockedCount
                config.text = "차단 수"
                config.secondaryText = "\(total)명"
                config.prefersSideBySideTextAndSecondaryText = true
            }

        default: break
        }

        cell.contentConfiguration = config
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)

        if indexPath.section == 3 && indexPath.row == 1 {
            if let url = URL(string: "https://qr.kakaopay.com/FG31jvTdV") {
                UIApplication.shared.open(url)
            }
            return
        }

        guard indexPath.section == 2 else { return }

        switch indexPath.row {
        case 0: exportJSON()
        case 1: importJSON()
        case 2: clearAll()
        default: break
        }
    }

    // MARK: - Actions

    @objc private func filterModeToggled(_ sender: UISwitch) {
        BlockDataManager.shared.filterMode = sender.isOn ? "blur" : "hide"
        NotificationCenter.default.post(name: .filterModeChanged, object: nil)
        tableView.reloadRows(at: [IndexPath(row: 0, section: 1)], with: .none)
    }

    private func exportJSON() {
        let json = BlockDataManager.shared.exportJSON()
        let fileName = "quietlounge_backup_\(ISO8601DateFormatter().string(from: Date()).prefix(10)).json"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? json.write(to: tempURL, atomically: true, encoding: .utf8)

        let activity = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
        present(activity, animated: true)
    }

    private func importJSON() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json])
        picker.delegate = self
        present(picker, animated: true)
    }

    private func clearAll() {
        let total = BlockDataManager.shared.totalBlockedCount
        guard total > 0 else {
            showAlert(title: "알림", message: "차단된 유저가 없습니다.")
            return
        }
        let alert = UIAlertController(title: "전체 삭제", message: "\(total)명의 차단을 모두 해제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel))
        alert.addAction(UIAlertAction(title: "전체 삭제", style: .destructive) { _ in
            BlockDataManager.shared.clearAll()
        })
        present(alert, animated: true)
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default))
        present(alert, animated: true)
    }
}

extension SettingsViewController: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let json = try String(contentsOf: url, encoding: .utf8)
            try BlockDataManager.shared.importJSON(json)
            showAlert(title: "완료", message: "차단 목록을 가져왔습니다.")
        } catch {
            showAlert(title: "오류", message: error.localizedDescription)
        }
    }
}
