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

    // checkAlerts inter-run overlap 방지용 — 동일 인스턴스에서 동시에 두 실행이 시작되지 않게 막는다.
    // 이전 실행이 아직 끝나지 않았는데 timer 가 다시 fire 하거나 restartTimer 가 호출되면,
    // 늦게 끝난 오래된 실행이 더 최신 실행의 lastChecked 를 과거 값으로 덮어쓸 수 있음.
    private let checkLock = NSLock()
    private var checkInFlight = false

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
            // 외부 백업 등으로 들어온 비정상 값도 저장 시점에 1~60 으로 clamp.
            let clamped = min(60, max(1, newValue))
            defaults.set(clamped, forKey: intervalKey)
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
        // inter-run overlap 차단: 이전 실행이 아직 끝나지 않았으면 이번 호출은 그냥 스킵.
        // (대기 큐를 두면 timer 가 빠르게 fire 될 때 task 가 누적되므로 skip 이 더 안전.)
        checkLock.lock()
        if checkInFlight {
            checkLock.unlock()
            return
        }
        checkInFlight = true
        checkLock.unlock()

        lastCheckTime = Date()
        let enabledAlerts = alerts.filter { ($0["enabled"] as? Bool) == true }
        guard !enabledAlerts.isEmpty else {
            releaseCheckLock()
            return
        }

        var channelAlerts: [String: [[String: Any]]] = [:]
        for alert in enabledAlerts {
            guard let channelId = alert["channelId"] as? String else { continue }
            channelAlerts[channelId, default: []].append(alert)
        }

        // 시작 시점의 lastChecked 스냅샷 — 모든 채널 Task 가 각자 읽은 값을 기준으로 처리.
        let startingChecked = lastChecked

        // withTaskGroup 으로 채널별 결과를 모두 수집한 뒤 **한 번만** lastChecked 에 머지 저장.
        // 이전 구현은 각 Task 가 공유 `checked` 를 개별 갱신 + self.lastChecked 에 덮어써서
        // 늦게 끝난 Task 가 먼저 끝난 채널의 갱신을 유실시키는 race 가 있었음.
        Task { [weak self] in
            guard let self = self else { return }
            defer { self.releaseCheckLock() }
            await withTaskGroup(of: (String, String?).self) { group in
                for (channelId, alertsForChannel) in channelAlerts {
                    group.addTask {
                        await self.processChannel(
                            channelId: channelId,
                            alertsForChannel: alertsForChannel,
                            lastCheckedForChannel: startingChecked[channelId]
                        )
                    }
                }
                var merged = startingChecked
                for await (channelId, newLast) in group {
                    if let v = newLast { merged[channelId] = v }
                }
                self.lastChecked = merged
            }
        }
    }

    private func releaseCheckLock() {
        checkLock.lock()
        checkInFlight = false
        checkLock.unlock()
    }

    /// 테스트 / 디버깅용 — 현재 실행 중인지 확인.
    var isCheckInFlight: Bool {
        checkLock.lock()
        defer { checkLock.unlock() }
        return checkInFlight
    }

    /// 채널 1 개 처리 — recent glob → detail → 알림 발송 → 새 lastChecked 반환.
    /// Returns: (channelId, newLastCheckedIso) — newLastCheckedIso 가 nil 이면 해당 채널은 전진 생략.
    private func processChannel(
        channelId: String,
        alertsForChannel: [[String: Any]],
        lastCheckedForChannel: String?
    ) async -> (String, String?) {
        do {
            let recentIds = try await fetchRecentPostIds(channelId: channelId)
            guard !recentIds.isEmpty else { return (channelId, nil) }

            let details = try await fetchPostTitles(postIds: recentIds)
            guard !details.isEmpty else { return (channelId, nil) }

            let lastTs = lastCheckedForChannel.flatMap { Self.isoToDate($0) } ?? .distantPast

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
                        await sendNotification(
                            channelName: channelName,
                            keyword: kw,
                            title: title,
                            postId: postId
                        )
                    }
                }
            }

            // 매칭 여부 무관하게 lastChecked 를 가장 최신 글 시점으로 전진.
            // 문자열 사전순이 아닌 파싱된 Date 기준 max — ISO 포맷 혼재 시에도 정확.
            let candidates = details.compactMap { $0["createTime"] as? String }
            let maxCreate = QuietLoungeCore.pickMaxIsoDate(candidates)
            return (channelId, maxCreate)
        } catch {
            // 네트워크 에러 — 이번 채널은 전진하지 않음
            return (channelId, nil)
        }
    }

    // MARK: - API

    // ISO 파싱/max 유틸은 QuietLoungeCore 에 통합 — 이전에 있던 isoToDate, pickMaxIsoDate 제거.
    private static func isoToDate(_ iso: String) -> Date? {
        QuietLoungeCore.parseDate(iso)
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

    /// 백업 스키마 공통 계약:
    /// - `keywordAlerts` 는 길이와 무관하게 항상 포함 (빈 배열 = cleared state).
    /// - `alertInterval` 은 기본값(5) 이 아닐 때만 포함 — Chrome/Android 와 동일.
    /// 반환 nil 의미: 이 매니저가 백업에 실을 게 하나도 없을 때 (현재는 거의 발생 안 함).
    func exportData() -> [String: Any]? {
        var result: [String: Any] = ["keywordAlerts": alerts]
        let intv = interval
        if intv != 5 { result["alertInterval"] = intv }
        return result
    }

    func importData(_ data: [String: Any]) {
        // keywordAlerts 필드가 존재하면 길이와 무관하게 반영 (빈 배열 = 전체 해제 의도).
        // 필드 자체가 없을 때만 기존 알림 유지.
        if let imported = data["keywordAlerts"] as? [[String: Any]] {
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
