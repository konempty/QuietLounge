import Foundation

extension Notification.Name {
    static let blockDataChanged = Notification.Name("QLBlockDataChanged")
    static let filterModeChanged = Notification.Name("QLFilterModeChanged")
    static let navigateToPost = Notification.Name("QLNavigateToPost")
    static let webViewToolbarChanged = Notification.Name("QLWebViewToolbarChanged")
    static let switchToSettingsTab = Notification.Name("QLSwitchToSettingsTab")
}

enum AppGroup {
    static let identifier = "group.kr.konempty.quietlounge"
    static let darwinNotification: CFString = "kr.konempty.quietlounge.dataChanged" as CFString
    static let darwinFilterModeNotification: CFString = "kr.konempty.quietlounge.filterModeChanged" as CFString
    static let darwinKeywordAlertsNotification: CFString = "kr.konempty.quietlounge.keywordAlertsChanged" as CFString
    static let darwinWebViewToolbarNotification: CFString = "kr.konempty.quietlounge.webViewToolbarChanged" as CFString
}

class BlockDataManager {
    static let shared = BlockDataManager()
    private let storageKey = "quiet_lounge_data"
    private let filterModeKey = "quiet_lounge_filter_mode"
    private let webViewToolbarKey = "quiet_lounge_webview_toolbar"
    private let dontShowToolbarHintKey = "quiet_lounge_dont_show_toolbar_hint"
    private let dontShowFilterHintKey = "quiet_lounge_dont_show_filter_hint"
    private let migrationKey = "quiet_lounge_migrated_to_group"
    private let defaults: UserDefaults

    init() {
        self.defaults = UserDefaults(suiteName: AppGroup.identifier) ?? .standard
        migrateFromStandardIfNeeded()
        registerDarwinObserver()
    }

    private func migrateFromStandardIfNeeded() {
        guard defaults !== UserDefaults.standard else { return }
        if defaults.bool(forKey: migrationKey) { return }
        let standard = UserDefaults.standard
        for key in [storageKey, filterModeKey] {
            if defaults.object(forKey: key) == nil,
               let value = standard.object(forKey: key) {
                defaults.set(value, forKey: key)
            }
        }
        defaults.set(true, forKey: migrationKey)
    }

    private func registerDarwinObserver() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            center, observer,
            { _, _, _, _, _ in
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .blockDataChanged, object: nil)
                }
            },
            AppGroup.darwinNotification, nil, .deliverImmediately
        )
        CFNotificationCenterAddObserver(
            center, observer,
            { _, _, _, _, _ in
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .filterModeChanged, object: nil)
                }
            },
            AppGroup.darwinFilterModeNotification, nil, .deliverImmediately
        )
        CFNotificationCenterAddObserver(
            center, observer,
            { _, _, _, _, _ in
                DispatchQueue.main.async {
                    NotificationCenter.default.post(name: .webViewToolbarChanged, object: nil)
                }
            },
            AppGroup.darwinWebViewToolbarNotification, nil, .deliverImmediately
        )
    }

    private func postDarwin(_ name: CFString) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name), nil, nil, true
        )
    }

    var filterMode: String {
        get {
            // 다른 프로세스(사파리 익스텐션)가 쓴 값이 캐시에 반영 안 됐을 수 있으므로 강제 동기화
            defaults.synchronize()
            return defaults.string(forKey: filterModeKey) ?? "hide"
        }
        set {
            defaults.set(newValue, forKey: filterModeKey)
            postDarwin(AppGroup.darwinFilterModeNotification)
        }
    }

    /// WebView 하단 네비게이션 툴바 표시 여부 — 기본 `false`.
    /// iOS 는 엣지 스와이프만으로도 탐색 가능하지만 보이는 버튼을 원하는 유저를 위해 opt-in.
    var showWebViewToolbar: Bool {
        get {
            defaults.synchronize()
            return defaults.bool(forKey: webViewToolbarKey)
        }
        set {
            defaults.set(newValue, forKey: webViewToolbarKey)
            postDarwin(AppGroup.darwinWebViewToolbarNotification)
        }
    }

    /// 사용자가 "툴바 안내 팝업 다시 보지 않기" 를 선택했는지. 기본 `false`.
    /// 다른 프로세스가 변경하지 않으므로 Darwin notification 은 불필요.
    var dontShowToolbarHint: Bool {
        get { defaults.bool(forKey: dontShowToolbarHintKey) }
        set { defaults.set(newValue, forKey: dontShowToolbarHintKey) }
    }

    /// 사용자가 "차단 직후 흐림 처리 안내 다시 보지 않기" 를 선택했는지. 기본 `false`.
    var dontShowFilterHint: Bool {
        get { defaults.bool(forKey: dontShowFilterHintKey) }
        set { defaults.set(newValue, forKey: dontShowFilterHintKey) }
    }

    var totalBlockedCount: Int {
        let data = load()
        let users = (data["blockedUsers"] as? [String: Any])?.count ?? 0
        let nicks = (data["nicknameOnlyBlocks"] as? [[String: Any]])?.count ?? 0
        return users + nicks
    }

    func load() -> [String: Any] {
        // 다른 프로세스(사파리 익스텐션)가 쓴 값이 캐시에 반영 안 됐을 수 있으므로 강제 동기화
        defaults.synchronize()
        guard let raw = defaults.string(forKey: storageKey),
              let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return createEmpty()
        }
        return json
    }

    func save(_ data: [String: Any]) {
        if let jsonData = try? JSONSerialization.data(withJSONObject: data),
           let str = String(data: jsonData, encoding: .utf8) {
            defaults.set(str, forKey: storageKey)
        }
        NotificationCenter.default.post(name: .blockDataChanged, object: nil)
        postDarwin(AppGroup.darwinNotification)
    }

    func blockUser(personaId: String?, nickname: String) {
        var data = load()
        var users = data["blockedUsers"] as? [String: [String: Any]] ?? [:]
        var nicks = data["nicknameOnlyBlocks"] as? [[String: Any]] ?? []

        if let pid = personaId {
            let existing = users[pid]
            var prevNicknames = existing?["previousNicknames"] as? [String] ?? []
            if let ex = existing, let exNick = ex["nickname"] as? String, exNick != nickname {
                prevNicknames.append(exNick)
            }
            users[pid] = [
                "personaId": pid,
                "nickname": nickname,
                "previousNicknames": prevNicknames,
                "blockedAt": existing?["blockedAt"] ?? ISO8601DateFormatter().string(from: Date()),
                "reason": existing?["reason"] ?? ""
            ]
            nicks.removeAll { ($0["nickname"] as? String) == nickname }
        } else {
            let alreadyByPersona = users.values.contains { ($0["nickname"] as? String) == nickname }
            let alreadyByNick = nicks.contains { ($0["nickname"] as? String) == nickname }
            if !alreadyByPersona && !alreadyByNick {
                nicks.append([
                    "nickname": nickname,
                    "blockedAt": ISO8601DateFormatter().string(from: Date()),
                    "reason": ""
                ])
            }
        }

        data["blockedUsers"] = users
        data["nicknameOnlyBlocks"] = nicks
        save(data)
    }

    func unblock(personaId: String) {
        var data = load()
        var users = data["blockedUsers"] as? [String: [String: Any]] ?? [:]
        users.removeValue(forKey: personaId)
        data["blockedUsers"] = users
        save(data)
    }

    func unblockByNickname(nickname: String) {
        var data = load()
        var nicks = data["nicknameOnlyBlocks"] as? [[String: Any]] ?? []
        nicks.removeAll { ($0["nickname"] as? String) == nickname }
        data["nicknameOnlyBlocks"] = nicks
        save(data)
    }

    /// personaCache 갱신 + shared/block-list.ts 의 승격·닉네임 변경 추적 규칙 적용.
    /// 순수 로직은 `QuietLoungeCore.applyPersonaCacheUpdate` 에 위임 — swift-tests 가 그 함수를 검증하고
    /// 실제 프로덕션 코드가 동일 함수를 호출하므로 테스트와 앱 동작 사이 drift 발생 여지 없음.
    func updatePersonaCache(personaId: String, nickname: String) {
        let updated = QuietLoungeCore.applyPersonaCacheUpdate(
            to: load(),
            personaId: personaId,
            nickname: nickname
        )
        save(updated)
    }

    func clearAll() {
        save(createEmpty())
    }

    func exportJSON() -> String {
        var data = load()
        data.removeValue(forKey: "personaCache")
        if let jsonData = try? JSONSerialization.data(withJSONObject: data, options: .prettyPrinted) {
            return String(data: jsonData, encoding: .utf8) ?? "{}"
        }
        return "{}"
    }

    func importJSON(_ json: String) throws {
        guard let jsonData = json.data(using: .utf8),
              let parsed = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              (parsed["version"] as? Int) == 2 else {
            throw NSError(domain: "QL", code: 1, userInfo: [NSLocalizedDescriptionKey: "지원하지 않는 형식입니다."])
        }
        var importData = parsed
        let existing = load()
        importData["personaCache"] = existing["personaCache"] ?? [String: Any]()
        save(importData)
    }

    private func createEmpty() -> [String: Any] {
        return [
            "version": 2,
            "blockedUsers": [String: Any](),
            "nicknameOnlyBlocks": [[String: Any]](),
            "personaCache": [String: Any]()
        ]
    }
}
