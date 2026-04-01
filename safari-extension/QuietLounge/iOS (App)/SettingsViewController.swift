import UIKit
internal import UniformTypeIdentifiers

class SettingsViewController: UITableViewController {

    private var stats: [String: Any]? = nil
    private var monthlyPosts: Int? = nil
    private var monthlyComments: Int? = nil
    private var isLoadingStats = false
    private var personaId: String? = nil

    // 그리드 내부 라벨 참조 (갱신 시 라벨만 업데이트)
    private var totalPostsLabel: UILabel?
    private var totalCommentsLabel: UILabel?
    private var monthlyPostsLabel: UILabel?
    private var monthlyCommentsLabel: UILabel?

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
        if stats == nil && !isLoadingStats {
            loadStats()
        } else {
            tableView.reloadData()
        }
    }

    @objc private func reloadData() {
        tableView.reloadData()
    }

    // MARK: - Stats

    private func loadStats() {
        isLoadingStats = true

        Task {
            do {
                let meUrl = URL(string: "https://api.lounge.naver.com/user-api/v1/members/me/personas")!
                let (meData, _) = try await URLSession.shared.data(from: meUrl)
                guard let meJson = try JSONSerialization.jsonObject(with: meData) as? [String: Any],
                      let meDataArr = meJson["data"] as? [[String: Any]],
                      let me = meDataArr.first,
                      let pid = me["personaId"] as? String else {
                    await MainActor.run { self.clearStats() }
                    return
                }

                let statsUrl = URL(string: "https://api.lounge.naver.com/user-api/v1/personas/\(pid)")!
                let (statsData, _) = try await URLSession.shared.data(from: statsUrl)
                guard let statsJson = try JSONSerialization.jsonObject(with: statsData) as? [String: Any],
                      let sData = statsJson["data"] as? [String: Any] else {
                    await MainActor.run { self.clearStats() }
                    return
                }

                await MainActor.run {
                    self.personaId = pid
                    self.stats = sData
                    self.isLoadingStats = false
                    self.updateStatsLabels()
                }

                // 이번달 통계 비동기 로드
                let now = Date()
                let cal = Calendar.current
                let monthStart = cal.date(from: cal.dateComponents([.year, .month], from: now))!

                let createTimeStr = sData["createTime"] as? String
                let createdThisMonth = createTimeStr.flatMap { parseDate($0) }.map { $0 >= monthStart } ?? false

                if createdThisMonth {
                    let tp = sData["totalPostCount"] as? Int ?? 0
                    let tc = sData["totalCommentCount"] as? Int ?? 0
                    await MainActor.run {
                        self.monthlyPosts = tp
                        self.monthlyComments = tc
                        self.updateStatsLabels()
                    }
                } else {
                    async let mp = fetchMonthlyCount(personaId: pid, type: "posts", monthStart: monthStart)
                    async let mc = fetchMonthlyCount(personaId: pid, type: "comments", monthStart: monthStart)

                    let postsCount = await mp
                    await MainActor.run {
                        self.monthlyPosts = postsCount
                        self.updateStatsLabels()
                    }

                    let commentsCount = await mc
                    await MainActor.run {
                        self.monthlyComments = commentsCount
                        self.updateStatsLabels()
                    }
                }
            } catch {
                await MainActor.run { self.clearStats() }
            }
        }
    }

    private func fetchMonthlyCount(personaId: String, type: String, monthStart: Date) async -> Int {
        var count = 0
        var cursor = ""
        let isComments = type == "comments"

        for _ in 0..<50 {
            var urlStr = "https://api.lounge.naver.com/user-api/v1/personas/\(personaId)/activities/\(type)?limit=100"
            if !cursor.isEmpty { urlStr += "&cursor=\(cursor)" }

            guard let url = URL(string: urlStr),
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let dataObj = json["data"] as? [String: Any],
                  let items = dataObj["items"] as? [[String: Any]],
                  !items.isEmpty else { break }

            let detailUrlStr: String
            if isComments {
                let ids = items.compactMap { $0["commentId"] as? String }
                detailUrlStr = "https://api.lounge.naver.com/content-api/v1/comments?" + ids.map { "commentNoList=\($0)" }.joined(separator: "&")
            } else {
                let ids = items.compactMap { $0["postId"] as? String }
                detailUrlStr = "https://api.lounge.naver.com/content-api/v1/posts?" + ids.map { "postIds=\($0)" }.joined(separator: "&")
            }

            guard let detailUrl = URL(string: detailUrlStr),
                  let (detailData, _) = try? await URLSession.shared.data(from: detailUrl),
                  let detailJson = try? JSONSerialization.jsonObject(with: detailData) as? [String: Any] else { break }

            var hasThisMonth = false

            if isComments {
                if let dObj = detailJson["data"] as? [String: Any],
                   let rawStr = dObj["rawResponse"] as? String,
                   let rawData = rawStr.data(using: .utf8),
                   let raw = try? JSONSerialization.jsonObject(with: rawData) as? [String: Any],
                   let result = raw["result"] as? [String: Any],
                   let commentList = result["commentList"] as? [[String: Any]] {
                    for comment in commentList {
                        if let dateStr = comment["regTimeGmt"] as? String,
                           let date = parseDate(dateStr), date >= monthStart {
                            count += 1
                            hasThisMonth = true
                        }
                    }
                }
            } else {
                if let details = detailJson["data"] as? [[String: Any]] {
                    for item in details {
                        if let dateStr = item["createTime"] as? String,
                           let date = parseDate(dateStr), date >= monthStart {
                            count += 1
                            hasThisMonth = true
                        }
                    }
                }
            }

            if !hasThisMonth { break }

            let cursorInfo = dataObj["cursorInfo"] as? [String: Any]
            let hasNext = cursorInfo?["hasNext"] as? Bool ?? false
            if !hasNext { break }
            cursor = cursorInfo?["endCursor"] as? String ?? ""
            if cursor.isEmpty { break }
        }

        return count
    }

    private func parseDate(_ str: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: str) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: str)
    }

    private func clearStats() {
        stats = nil
        monthlyPosts = nil
        monthlyComments = nil
        isLoadingStats = false
        totalPostsLabel = nil
        totalCommentsLabel = nil
        monthlyPostsLabel = nil
        monthlyCommentsLabel = nil
        tableView.reloadRows(at: [IndexPath(row: 0, section: 1)], with: .none)
    }

    // MARK: - Stats Grid

    private func updateStatsLabels() {
        if let s = stats {
            let tp = s["totalPostCount"] as? Int ?? 0
            let tc = s["totalCommentCount"] as? Int ?? 0
            totalPostsLabel?.text = "\(tp)"
            totalCommentsLabel?.text = "\(tc)"
            monthlyPostsLabel?.text = monthlyPosts.map { "\($0)" } ?? "..."
            monthlyCommentsLabel?.text = monthlyComments.map { "\($0)" } ?? "..."

            // 그리드가 아직 없으면 (최초 로딩) 셀 갱신
            if totalPostsLabel == nil {
                tableView.reloadRows(at: [IndexPath(row: 0, section: 1)], with: .none)
            }
        } else {
            tableView.reloadRows(at: [IndexPath(row: 0, section: 1)], with: .none)
        }
    }

    private func makeStatsGrid() -> UIView {
        let s = stats!
        let totalPosts = s["totalPostCount"] as? Int ?? 0
        let totalComments = s["totalCommentCount"] as? Int ?? 0

        let (box1, lbl1) = makeStatBox(value: "\(totalPosts)", label: "총 작성글")
        let (box2, lbl2) = makeStatBox(value: "\(totalComments)", label: "총 댓글")
        let (box3, lbl3) = makeStatBox(value: monthlyPosts.map { "\($0)" } ?? "...", label: "이번달 작성글")
        let (box4, lbl4) = makeStatBox(value: monthlyComments.map { "\($0)" } ?? "...", label: "이번달 댓글")

        totalPostsLabel = lbl1
        totalCommentsLabel = lbl2
        monthlyPostsLabel = lbl3
        monthlyCommentsLabel = lbl4

        let row1 = UIStackView(arrangedSubviews: [box1, box2])
        row1.distribution = .fillEqually
        row1.spacing = 8

        let row2 = UIStackView(arrangedSubviews: [box3, box4])
        row2.distribution = .fillEqually
        row2.spacing = 8

        let grid = UIStackView(arrangedSubviews: [row1, row2])
        grid.axis = .vertical
        grid.spacing = 8

        return grid
    }

    private func makeStatBox(value: String, label: String) -> (UIView, UILabel) {
        let box = UIView()
        box.backgroundColor = .tertiarySystemGroupedBackground
        box.layer.cornerRadius = 10

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false

        let vl = UILabel()
        vl.text = value
        vl.font = .systemFont(ofSize: 22, weight: .bold)
        vl.textColor = .label
        stack.addArrangedSubview(vl)

        let ll = UILabel()
        ll.text = label
        ll.font = .systemFont(ofSize: 11)
        ll.textColor = .secondaryLabel
        stack.addArrangedSubview(ll)

        box.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: box.centerXAnchor),
            stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -12),
        ])

        return (box, vl)
    }

    // MARK: - Block Stats Row

    private func makeBlockStatsRow() -> UIView {
        let data = BlockDataManager.shared.load()
        let personaCount = (data["blockedUsers"] as? [String: Any])?.count ?? 0
        let nicknameCount = (data["nicknameOnlyBlocks"] as? [[String: Any]])?.count ?? 0
        let totalCount = personaCount + nicknameCount

        func makeBox(value: Int, label: String) -> UIView {
            let box = UIView()
            box.backgroundColor = .tertiarySystemGroupedBackground
            box.layer.cornerRadius = 8

            let stack = UIStackView()
            stack.axis = .vertical
            stack.alignment = .center
            stack.spacing = 2
            stack.translatesAutoresizingMaskIntoConstraints = false

            let vl = UILabel()
            vl.text = "\(value)"
            vl.font = .systemFont(ofSize: 20, weight: .bold)
            vl.textColor = .label
            stack.addArrangedSubview(vl)

            let ll = UILabel()
            ll.text = label
            ll.font = .systemFont(ofSize: 11)
            ll.textColor = .secondaryLabel
            stack.addArrangedSubview(ll)

            box.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.centerXAnchor.constraint(equalTo: box.centerXAnchor),
                stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 10),
                stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -10),
            ])

            return box
        }

        let row = UIStackView(arrangedSubviews: [
            makeBox(value: totalCount, label: "총 차단 유저"),
            makeBox(value: personaCount, label: "ID 확보된 유저"),
            makeBox(value: nicknameCount, label: "닉네임만 확보"),
        ])
        row.distribution = .fillEqually
        row.spacing = 8

        return row
    }

    // MARK: - Table View

    override func numberOfSections(in tableView: UITableView) -> Int { 5 }

    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        guard section == 1 else { return nil }

        let header = UIView()

        let label = UILabel()
        label.text = "내 활동 통계"
        label.font = .preferredFont(forTextStyle: .footnote)
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false

        let btn = UIButton(type: .system)
        btn.setTitle("↻", for: .normal)
        btn.titleLabel?.font = .systemFont(ofSize: 16)
        btn.tintColor = .secondaryLabel
        btn.layer.borderWidth = 1
        btn.layer.borderColor = UIColor.separator.cgColor
        btn.layer.cornerRadius = 6
        btn.translatesAutoresizingMaskIntoConstraints = false
        btn.addTarget(self, action: #selector(refreshStats), for: .touchUpInside)

        header.addSubview(label)
        header.addSubview(btn)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 20),
            label.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -8),
            btn.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -20),
            btn.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -4),
            btn.widthAnchor.constraint(equalToConstant: 28),
            btn.heightAnchor.constraint(equalToConstant: 28),
        ])

        return header
    }

    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        section == 1 ? 44 : UITableView.automaticDimension
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch section {
        case 0: return nil // no header for block stats
        case 1: return nil // custom header
        case 2: return "필터 모드"
        case 3: return "데이터 관리"
        case 4: return "후원"
        default: return nil
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch section {
        case 0: return 1 // block stats
        case 1: return 1 // my stats
        case 2: return 1
        case 3: return 3
        case 4: return 2
        default: return 0
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
        cell.accessoryType = .none
        cell.selectionStyle = .none
        cell.accessoryView = nil
        cell.backgroundColor = .secondarySystemGroupedBackground
        cell.contentView.subviews.filter { $0.tag == 999 }.forEach { $0.removeFromSuperview() }

        switch indexPath.section {
        case 0: // 차단 통계
            cell.contentConfiguration = nil
            cell.backgroundColor = .clear
            let row = makeBlockStatsRow()
            row.tag = 999
            row.translatesAutoresizingMaskIntoConstraints = false
            cell.contentView.addSubview(row)
            NSLayoutConstraint.activate([
                row.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 8),
                row.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -8),
                row.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 8),
                row.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -8),
            ])
            return cell

        case 1: // 활동 통계
            cell.contentConfiguration = nil
            cell.backgroundColor = .clear
            if isLoadingStats {
                let spinner = UIActivityIndicatorView(style: .medium)
                spinner.startAnimating()
                spinner.tag = 999
                spinner.translatesAutoresizingMaskIntoConstraints = false
                cell.contentView.addSubview(spinner)
                NSLayoutConstraint.activate([
                    spinner.centerXAnchor.constraint(equalTo: cell.contentView.centerXAnchor),
                    spinner.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 20),
                    spinner.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -20),
                ])
            } else if stats != nil {
                let grid = makeStatsGrid()
                grid.tag = 999
                grid.translatesAutoresizingMaskIntoConstraints = false
                cell.contentView.addSubview(grid)
                NSLayoutConstraint.activate([
                    grid.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 8),
                    grid.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -8),
                    grid.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 8),
                    grid.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -8),
                ])
            } else {
                var config = cell.defaultContentConfiguration()
                config.text = "라운지에 로그인하면 통계가 표시됩니다"
                config.textProperties.color = .secondaryLabel
                config.textProperties.font = .systemFont(ofSize: 13)
                config.textProperties.alignment = .center
                cell.contentConfiguration = config
            }
            return cell

        case 2: // 필터 모드
            var config = cell.defaultContentConfiguration()
            config.text = "흐림 처리"
            config.secondaryText = BlockDataManager.shared.filterMode == "blur"
                ? "차단된 글을 흐리게 표시합니다"
                : "차단된 글을 완전히 숨깁니다"
            let toggle = UISwitch()
            toggle.isOn = BlockDataManager.shared.filterMode == "blur"
            toggle.onTintColor = UIColor(red: 31/255, green: 175/255, blue: 99/255, alpha: 1)
            toggle.addTarget(self, action: #selector(filterModeToggled(_:)), for: .valueChanged)
            cell.accessoryView = toggle
            cell.contentConfiguration = config

        case 3: // 데이터 관리
            var config = cell.defaultContentConfiguration()
            let titles = ["차단 목록 내보내기", "차단 목록 가져오기", "전체 삭제"]
            config.text = titles[indexPath.row]
            if indexPath.row == 2 {
                config.textProperties.color = .systemRed
            }
            cell.selectionStyle = .default
            cell.contentConfiguration = config

        case 4: // 후원
            var config = cell.defaultContentConfiguration()
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
            cell.contentConfiguration = config

        default: break
        }

        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)

        if indexPath.section == 4 && indexPath.row == 1 {
            if let url = URL(string: "https://qr.kakaopay.com/FG31jvTdV") {
                UIApplication.shared.open(url)
            }
            return
        }

        guard indexPath.section == 3 else { return }

        switch indexPath.row {
        case 0: exportJSON()
        case 1: importJSON()
        case 2: clearAll()
        default: break
        }
    }

    override func tableView(_ tableView: UITableView, viewForFooterInSection section: Int) -> UIView? {
        guard section == 4 else { return nil }
        let label = UILabel()
        label.text = "v1.0.0"
        label.font = .systemFont(ofSize: 11)
        label.textColor = .tertiaryLabel
        label.textAlignment = .center
        return label
    }

    override func tableView(_ tableView: UITableView, heightForFooterInSection section: Int) -> CGFloat {
        section == 4 ? 30 : UITableView.automaticDimension
    }

    // MARK: - Actions

    @objc private func refreshStats() {
        loadStats()
    }

    @objc private func filterModeToggled(_ sender: UISwitch) {
        BlockDataManager.shared.filterMode = sender.isOn ? "blur" : "hide"
        NotificationCenter.default.post(name: .filterModeChanged, object: nil)
        tableView.reloadRows(at: [IndexPath(row: 0, section: 2)], with: .none)
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
