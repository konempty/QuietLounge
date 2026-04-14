import Foundation
import UserNotifications

class KeywordAlertManager {
    static let shared = KeywordAlertManager()

    private let alertsKey = "quiet_lounge_keyword_alerts"
    private let intervalKey = "quiet_lounge_alert_interval"
    private let lastCheckedKey = "quiet_lounge_alert_last_checked"
    private let migrationKey = "quiet_lounge_keyword_alerts_migrated"
    private let defaults: UserDefaults

    private var timer: Timer?
    private var lastCheckTime: Date?

    init() {
        self.defaults = UserDefaults(suiteName: AppGroup.identifier) ?? .standard
        migrateFromStandardIfNeeded()
        registerDarwinObserver()
    }

    /// 사파리 익스텐션 팝업이 keyword alerts를 바꿨을 때 알림 받아 타이머 재시작.
    private func registerDarwinObserver() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            center, observer,
            { _, _, _, _, _ in
                DispatchQueue.main.async {
                    KeywordAlertManager.shared.restartTimer()
                    NotificationCenter.default.post(name: .keywordAlertsChanged, object: nil)
                }
            },
            AppGroup.darwinKeywordAlertsNotification, nil, .deliverImmediately
        )
    }

    private func migrateFromStandardIfNeeded() {
        guard defaults !== UserDefaults.standard else { return }
        if defaults.bool(forKey: migrationKey) { return }
        let standard = UserDefaults.standard
        for key in [alertsKey, intervalKey, lastCheckedKey] {
            if defaults.object(forKey: key) == nil,
               let value = standard.object(forKey: key) {
                defaults.set(value, forKey: key)
            }
        }
        defaults.set(true, forKey: migrationKey)
    }

    var alerts: [[String: Any]] {
        get {
            // 사파리 익스텐션이 쓴 값이 캐시에 반영 안 됐을 수 있으므로 강제 동기화
            defaults.synchronize()
            guard let raw = defaults.string(forKey: alertsKey),
                  let data = raw.data(using: .utf8),
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                return []
            }
            return arr
        }
        set {
            if let data = try? JSONSerialization.data(withJSONObject: newValue),
               let str = String(data: data, encoding: .utf8) {
                defaults.set(str, forKey: alertsKey)
            }
            NotificationCenter.default.post(name: .keywordAlertsChanged, object: nil)
            postDarwin(AppGroup.darwinKeywordAlertsNotification)
        }
    }

    var interval: Int {
        get {
            defaults.synchronize()
            return defaults.integer(forKey: intervalKey).clamped(to: 1...60, default: 5)
        }
        set {
            defaults.set(newValue, forKey: intervalKey)
            postDarwin(AppGroup.darwinKeywordAlertsNotification)
        }
    }

    private func postDarwin(_ name: CFString) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name), nil, nil, true
        )
    }

    private var lastChecked: [String: String] {
        get {
            guard let raw = defaults.string(forKey: lastCheckedKey),
                  let data = raw.data(using: .utf8),
                  let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
                return [:]
            }
            return dict
        }
        set {
            if let data = try? JSONSerialization.data(withJSONObject: newValue),
               let str = String(data: data, encoding: .utf8) {
                defaults.set(str, forKey: lastCheckedKey)
            }
        }
    }

    // MARK: - CRUD

    func addAlert(channelId: String, channelName: String, keywords: [String]) {
        var list = alerts
        let entry: [String: Any] = [
            "id": "\(Int(Date().timeIntervalSince1970))\(Int.random(in: 1000...9999))",
            "channelId": channelId,
            "channelName": channelName,
            "keywords": keywords,
            "enabled": true,
            "createdAt": ISO8601DateFormatter().string(from: Date())
        ]
        list.append(entry)
        alerts = list
    }

    func removeAlert(at index: Int) {
        var list = alerts
        guard index < list.count else { return }
        list.remove(at: index)
        alerts = list
    }

    func toggleAlert(at index: Int, enabled: Bool) {
        var list = alerts
        guard index < list.count else { return }
        list[index]["enabled"] = enabled
        alerts = list
    }

    // MARK: - Timer

    func startTimer() {
        stopTimer()
        let minGap: TimeInterval = 30
        if lastCheckTime == nil || Date().timeIntervalSince(lastCheckTime!) >= minGap {
            checkAlerts()
        }
        let mins = Double(interval)
        timer = Timer.scheduledTimer(withTimeInterval: mins * 60, repeats: true) { [weak self] _ in
            self?.checkAlerts()
        }
    }

    func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    func restartTimer() {
        let enabled = alerts.contains { ($0["enabled"] as? Bool) == true }
        if enabled {
            startTimer()
        } else {
            stopTimer()
        }
    }

    // MARK: - Check

    func checkAlerts() {
        lastCheckTime = Date()
        let enabledAlerts = alerts.filter { ($0["enabled"] as? Bool) == true }
        guard !enabledAlerts.isEmpty else { return }

        var channelAlerts: [String: [[String: Any]]] = [:]
        for alert in enabledAlerts {
            guard let channelId = alert["channelId"] as? String else { continue }
            channelAlerts[channelId, default: []].append(alert)
        }

        var checked = lastChecked

        for (channelId, alertsForChannel) in channelAlerts {
            Task {
                do {
                    let recentIds = try await self.fetchRecentPostIds(channelId: channelId)
                    guard !recentIds.isEmpty else { return }

                    let details = try await self.fetchPostTitles(postIds: recentIds)
                    guard !details.isEmpty else { return }

                    // lastChecked 는 ISO timestamp 문자열 — 그보다 나중 글만 새 글로 간주
                    let lastTs = checked[channelId].flatMap { Self.isoToDate($0) } ?? .distantPast

                    for post in details {
                        guard let title = post["title"] as? String,
                              let postId = post["postId"] as? String,
                              let createStr = post["createTime"] as? String,
                              let createDate = Self.isoToDate(createStr),
                              createDate > lastTs else { continue }
                        for alert in alertsForChannel {
                            let keywords = alert["keywords"] as? [String] ?? []
                            let channelName = alert["channelName"] as? String ?? ""
                            for kw in keywords where title.localizedCaseInsensitiveContains(kw) {
                                await self.sendNotification(channelName: channelName, keyword: kw, title: title, postId: postId)
                            }
                        }
                    }

                    // 매칭 여부 무관하게 lastChecked 를 가장 최신 글 시점으로 전진 —
                    // postId 기반 추적의 "기준 글이 삭제되면 전체를 새 글로 간주" 문제 해결
                    let maxCreate = details.compactMap { $0["createTime"] as? String }.max()
                    if let m = maxCreate {
                        checked[channelId] = m
                        self.lastChecked = checked
                    }
                } catch {
                    // 네트워크 에러 무시
                }
            }
        }
    }

    // MARK: - API

    private static func isoToDate(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    private func fetchRecentPostIds(channelId: String) async throws -> [String] {
        let url = URL(string: "https://api.lounge.naver.com/discovery-api/v1/feed/channels/\(channelId)/recent?limit=50")!
        let (data, _) = try await URLSession.shared.data(from: url)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any],
              let items = dataObj["items"] as? [[String: Any]] else { return [] }
        return items.compactMap { $0["postId"] as? String }
    }

    private func fetchPostTitles(postIds: [String]) async throws -> [[String: Any]] {
        guard !postIds.isEmpty else { return [] }

        var results: [[String: Any]] = []
        for chunk in postIds.chunked(into: 50) {
            let params = chunk.map { "postIds=\($0)" }.joined(separator: "&")
            let url = URL(string: "https://api.lounge.naver.com/content-api/v1/posts?\(params)")!
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let posts = json["data"] as? [[String: Any]] else { continue }
            results.append(contentsOf: posts)
        }
        return results
    }

    // MARK: - Notification

    func requestNotificationPermission(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    private func sendNotification(channelName: String, keyword: String, title: String, postId: String) async {
        let content = UNMutableNotificationContent()
        content.title = "[\(channelName)] 키워드 알림"
        content.body = "\"\(keyword)\" — \(title)"
        content.sound = .default
        content.userInfo = ["postId": postId, "keyword": keyword]

        // identifier는 ASCII만 사용 — 일부 OS 버전에서 non-ASCII identifier 알림이 silently dropped됨
        let kwHex = keyword.utf8.map { String(format: "%02x", $0) }.joined()
        let identifier = "ql_kw_\(postId)_\(kwHex)"

        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    // MARK: - Export/Import

    func exportData() -> [String: Any]? {
        let list = alerts
        guard !list.isEmpty else { return nil }
        var result: [String: Any] = ["keywordAlerts": list]
        let intv = interval
        if intv != 5 { result["alertInterval"] = intv }
        return result
    }

    func importData(_ data: [String: Any]) {
        if let imported = data["keywordAlerts"] as? [[String: Any]], !imported.isEmpty {
            alerts = imported
        }
        if let intv = data["alertInterval"] as? Int {
            interval = intv
        }
        restartTimer()
    }
}

// MARK: - Helpers

extension Notification.Name {
    static let keywordAlertsChanged = Notification.Name("QLKeywordAlertsChanged")
}

private extension Int {
    func clamped(to range: ClosedRange<Int>, default defaultValue: Int) -> Int {
        self == 0 ? defaultValue : Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
