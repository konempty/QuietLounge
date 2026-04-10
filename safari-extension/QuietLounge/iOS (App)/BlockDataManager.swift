import Foundation

extension Notification.Name {
    static let blockDataChanged = Notification.Name("QLBlockDataChanged")
    static let filterModeChanged = Notification.Name("QLFilterModeChanged")
    static let navigateToPost = Notification.Name("QLNavigateToPost")
}

enum AppGroup {
    static let identifier = "group.kr.konempty.quietlounge"
    static let darwinNotification: CFString = "kr.konempty.quietlounge.dataChanged" as CFString
    static let darwinFilterModeNotification: CFString = "kr.konempty.quietlounge.filterModeChanged" as CFString
    static let darwinKeywordAlertsNotification: CFString = "kr.konempty.quietlounge.keywordAlertsChanged" as CFString
}

class BlockDataManager {
    static let shared = BlockDataManager()
    private let storageKey = "quiet_lounge_data"
    private let filterModeKey = "quiet_lounge_filter_mode"
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

    func updatePersonaCache(personaId: String, nickname: String) {
        var data = load()
        var cache = data["personaCache"] as? [String: [String: String]] ?? [:]
        cache[personaId] = ["nickname": nickname, "lastSeen": ISO8601DateFormatter().string(from: Date())]
        data["personaCache"] = cache
        save(data)
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
