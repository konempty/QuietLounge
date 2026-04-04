import Foundation

extension Notification.Name {
    static let blockDataChanged = Notification.Name("QLBlockDataChanged")
    static let filterModeChanged = Notification.Name("QLFilterModeChanged")
    static let navigateToPost = Notification.Name("QLNavigateToPost")
}

class BlockDataManager {
    static let shared = BlockDataManager()
    private let storageKey = "quiet_lounge_data"
    private let filterModeKey = "quiet_lounge_filter_mode"
    private let defaults = UserDefaults.standard

    var filterMode: String {
        get { defaults.string(forKey: filterModeKey) ?? "hide" }
        set { defaults.set(newValue, forKey: filterModeKey) }
    }

    var totalBlockedCount: Int {
        let data = load()
        let users = (data["blockedUsers"] as? [String: Any])?.count ?? 0
        let nicks = (data["nicknameOnlyBlocks"] as? [[String: Any]])?.count ?? 0
        return users + nicks
    }

    func load() -> [String: Any] {
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
