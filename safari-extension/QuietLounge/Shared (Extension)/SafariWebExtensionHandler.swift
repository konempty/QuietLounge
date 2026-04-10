//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  Created by jayden.bin on 2026. 3. 30..
//

import SafariServices

private enum SharedStorage {
    static let appGroupId = "group.kr.konempty.quietlounge"
    static let darwinDataChanged: CFString = "kr.konempty.quietlounge.dataChanged" as CFString
    static let darwinFilterModeChanged: CFString = "kr.konempty.quietlounge.filterModeChanged" as CFString

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }
}

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let result = handleMessage(message as? [String: Any] ?? [:])

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: result]
        } else {
            response.userInfo = ["message": result]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func handleMessage(_ message: [String: Any]) -> [String: Any] {
        guard let defaults = SharedStorage.defaults else {
            return ["error": "app group unavailable"]
        }
        let type = message["type"] as? String ?? ""

        switch type {
        case "STORAGE_GET":
            let keys = extractKeys(message["keys"])
            var data: [String: Any] = [:]
            for key in keys {
                if let value = defaults.object(forKey: key) {
                    data[key] = value
                }
            }
            return ["data": data]

        case "STORAGE_SET":
            guard let items = message["items"] as? [String: Any] else {
                return ["ok": false, "error": "items missing"]
            }
            for (key, value) in items {
                defaults.set(value, forKey: key)
            }
            // 네이티브 앱에 변경 통지 (블록 데이터/필터 모드 분리)
            if items["quiet_lounge_data"] != nil {
                postDarwin(SharedStorage.darwinDataChanged)
            }
            if items["quiet_lounge_filter_mode"] != nil {
                postDarwin(SharedStorage.darwinFilterModeChanged)
            }
            return ["ok": true]

        case "STORAGE_REMOVE":
            let keys = extractKeys(message["keys"])
            for key in keys {
                defaults.removeObject(forKey: key)
            }
            if keys.contains("quiet_lounge_data") {
                postDarwin(SharedStorage.darwinDataChanged)
            }
            return ["ok": true]

        default:
            return ["echo": message]
        }
    }

    private func extractKeys(_ value: Any?) -> [String] {
        if let s = value as? String { return [s] }
        if let arr = value as? [String] { return arr }
        if let dict = value as? [String: Any] { return Array(dict.keys) }
        return []
    }

    private func postDarwin(_ name: CFString) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name), nil, nil, true
        )
    }

}
