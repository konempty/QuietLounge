import Foundation

/// UIKit 의존성 없는 pure logic 모음 — Swift Package 테스트로 검증 가능.
///
/// 플랫폼 독립적인 유틸들을 이 파일에 모아두고,
/// swift-package-tests/ 의 Package.swift 가 이 파일을 소스에 포함해 테스트한다.
enum QuietLoungeCore {

    // MARK: - ISO 날짜 파싱

    /// 다중 포맷 ISO 8601 파싱.
    /// - 표준 ISO (`+09:00`, `Z`, fractional)
    /// - 콜론 없는 tz (`+0900`)
    /// 둘 다 실패 시 nil.
    static func parseDate(_ iso: String?) -> Date? {
        guard let iso = iso, !iso.isEmpty else { return nil }

        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: iso) { return d }

        // 콜론 없는 tz 보정: "+0900" → "+09:00"
        if let range = iso.range(of: #"[+-]\d{4}$"#, options: .regularExpression) {
            let tz = String(iso[range])
            let fixed = iso.replacingOccurrences(of: tz, with: String(tz.prefix(3) + ":" + tz.suffix(2)))
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let d = f.date(from: fixed) { return d }
            f.formatOptions = [.withInternetDateTime]
            if let d = f.date(from: fixed) { return d }
        }
        return nil
    }

    // MARK: - 키워드 매칭

    /// 글 제목에서 키워드를 찾아 반환. 대소문자 무시.
    /// 첫 번째 매칭만 반환 (다른 플랫폼과 동일 시맨틱).
    static func findMatchedKeyword(title: String, keywords: [String]) -> String? {
        for kw in keywords where title.range(of: kw, options: .caseInsensitive) != nil {
            return kw
        }
        return nil
    }

    // MARK: - lastChecked 전진 로직

    struct PostDetail {
        let postId: String
        let title: String
        let createTime: String
    }

    struct ChannelMatch {
        let postId: String
        let title: String
        let matched: String
    }

    struct ChannelProcessResult {
        let matches: [ChannelMatch]
        let newLastChecked: String?
    }

    /// 채널 키워드 체크 순수 로직.
    /// - details: content-api 응답 (오름차순/내림차순 무관)
    /// - keywords: 매칭할 키워드
    /// - lastChecked: 이전 체크 기준 ISO timestamp
    /// - 반환: 매칭 결과 + 다음 체크 기준이 될 newLastChecked (createTime max)
    static func processChannel(
        details: [PostDetail],
        keywords: [String],
        lastChecked: String?
    ) -> ChannelProcessResult {
        let lastTs = parseDate(lastChecked) ?? .distantPast
        var matches: [ChannelMatch] = []
        for p in details {
            guard let t = parseDate(p.createTime), t > lastTs else { continue }
            if let matched = findMatchedKeyword(title: p.title, keywords: keywords) {
                matches.append(ChannelMatch(postId: p.postId, title: p.title, matched: matched))
            }
        }
        // 문자열 사전순이 아닌 파싱된 timestamp 기준 max — ISO 포맷 혼재 시에도 정확.
        let maxCreate = pickMaxIsoDate(details.map { $0.createTime })
        return ChannelProcessResult(
            matches: matches,
            newLastChecked: maxCreate ?? lastChecked
        )
    }

    /// ISO 문자열 배열에서 파싱된 Date 기준 max 값을 반환.
    /// `.max()` 는 사전순 정렬이라 `+09:00` / `Z` / fractional seconds 가 섞이면 오답이 나올 수 있음.
    static func pickMaxIsoDate(_ candidates: [String]) -> String? {
        var best: (iso: String, date: Date)?
        for c in candidates where !c.isEmpty {
            guard let d = parseDate(c) else { continue }
            if best == nil || d > best!.date {
                best = (c, d)
            }
        }
        return best?.iso
    }

    // MARK: - 플로우 레이아웃 (키워드 태그 배치)

    /// 왼쪽 정렬 플로우 레이아웃 계산 — UITableView 의 heightForRowAt 에서 사용.
    /// UIKit 의존 없는 순수 함수로, 아이템 크기 배열과 최대 폭을 받아
    /// 각 아이템의 위치 배열과 전체 높이를 반환.
    /// - itemSizes: 각 아이템(태그)의 (width, height)
    /// - maxWidth: 한 줄의 최대 폭
    /// - hSpacing: 같은 줄 아이템 간 가로 간격
    /// - vSpacing: 줄 사이 세로 간격
    struct FlowFrame: Equatable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    struct FlowLayoutResult {
        let frames: [FlowFrame]
        let totalHeight: Double
    }

    static func computeFlowLayout(
        itemSizes: [(width: Double, height: Double)],
        maxWidth: Double,
        hSpacing: Double = 4,
        vSpacing: Double = 4
    ) -> FlowLayoutResult {
        guard maxWidth > 0, !itemSizes.isEmpty else { return FlowLayoutResult(frames: [], totalHeight: 0) }

        var frames: [FlowFrame] = []
        var x: Double = 0
        var y: Double = 0
        var lineHeight: Double = 0

        for size in itemSizes {
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += lineHeight + vSpacing
                lineHeight = 0
            }
            frames.append(FlowFrame(x: x, y: y, width: size.width, height: size.height))
            x += size.width + hSpacing
            lineHeight = max(lineHeight, size.height)
        }
        return FlowLayoutResult(frames: frames, totalHeight: y + lineHeight)
    }

    // MARK: - WebView 네비게이션 툴바 상태

    enum ReloadMode: String { case reload, stop }

    /// 상단 네비게이션 툴바의 버튼 상태.
    /// iOS 는 시스템 뒤로가기가 없고 엣지 스와이프만 제공되므로, 보이는 버튼으로 상태를 명시해야 한다.
    /// - `backEnabled` / `forwardEnabled`: WKWebView.canGoBack / canGoForward 패스스루 — 누를 수 있는지.
    /// - `homeEnabled`: 현재 URL 이 라운지 홈이 아니면 활성 (홈으로 가는 버튼).
    /// - `reloadMode`: 로딩 중이면 `.stop`, 아니면 `.reload` — 아이콘/액션이 토글된다.
    struct NavigationToolbarState: Equatable {
        let backEnabled: Bool
        let forwardEnabled: Bool
        let homeEnabled: Bool
        let reloadMode: ReloadMode
    }

    static func computeNavigationToolbarState(
        canGoBack: Bool,
        canGoForward: Bool,
        isLoading: Bool,
        currentUrl: URL?
    ) -> NavigationToolbarState {
        // URL 이 nil 이면 아직 로드 전 — 홈으로 "가는 중" 이므로 홈 버튼 비활성 처리.
        let atHome = currentUrl == nil || isLoungeHome(url: currentUrl)
        return NavigationToolbarState(
            backEnabled: canGoBack,
            forwardEnabled: canGoForward,
            homeEnabled: !atHome,
            reloadMode: isLoading ? .stop : .reload
        )
    }

    /// WebView URL 이 라운지 홈(`lounge.naver.com` + path 없음/루트)인지 판정.
    /// - 호스트가 `lounge.naver.com` 또는 그 서브도메인이 아니면 `false`.
    /// - path 가 빈 문자열 또는 `/` 일 때만 `true`. 그 외 `/posts/123`, `/channels/x` 등은 홈이 아님.
    static func isLoungeHome(url: URL?) -> Bool {
        guard let url = url,
              let host = url.host,
              host == "lounge.naver.com" || host.hasSuffix(".lounge.naver.com") else { return false }
        let path = url.path
        return path.isEmpty || path == "/"
    }

    // MARK: - 차단 데이터 승격 + 닉네임 변경 추적

    /// `personaCache` 갱신과 동시에 shared/block-list.ts 의 승격 규칙을 적용한다.
    /// - nicknameOnlyBlocks 에 현재/이전 닉네임이 있으면 blockedUsers 로 승격하고 해당 엔트리 제거
    /// - 이미 차단된 유저의 닉네임이 변경되면 previousNicknames 에 append
    /// `data` 는 BlockDataManager.load() 포맷 ([String: Any]) 을 그대로 사용.
    static func applyPersonaCacheUpdate(
        to data: [String: Any],
        personaId: String,
        nickname: String,
        now: Date = Date()
    ) -> [String: Any] {
        var result = data
        let nowIso = ISO8601DateFormatter().string(from: now)

        var cache = result["personaCache"] as? [String: [String: String]] ?? [:]
        let previousCachedNickname = cache[personaId]?["nickname"]
        let nicknameChanged = previousCachedNickname != nil && previousCachedNickname != nickname
        cache[personaId] = ["nickname": nickname, "lastSeen": nowIso]
        result["personaCache"] = cache

        var nicks = result["nicknameOnlyBlocks"] as? [[String: Any]] ?? []
        if let idx = nicks.firstIndex(where: { entry in
            let n = entry["nickname"] as? String
            return n == nickname || (nicknameChanged && n == previousCachedNickname)
        }) {
            let promoted = nicks.remove(at: idx)
            result["nicknameOnlyBlocks"] = nicks
            result = promoteBlock(
                data: result,
                personaId: personaId,
                nickname: nickname,
                reason: (promoted["reason"] as? String) ?? "",
                nowIso: nowIso
            )
            return result
        }

        if nicknameChanged,
           var users = result["blockedUsers"] as? [String: [String: Any]],
           var user = users[personaId],
           let currentNick = user["nickname"] as? String,
           currentNick != nickname {
            var prev = user["previousNicknames"] as? [String] ?? []
            prev.append(currentNick)
            user["previousNicknames"] = prev
            user["nickname"] = nickname
            users[personaId] = user
            result["blockedUsers"] = users
        }

        return result
    }

    private static func promoteBlock(
        data: [String: Any],
        personaId: String,
        nickname: String,
        reason: String,
        nowIso: String
    ) -> [String: Any] {
        var result = data
        var users = result["blockedUsers"] as? [String: [String: Any]] ?? [:]
        let existing = users[personaId]
        var prevNicknames = existing?["previousNicknames"] as? [String] ?? []
        if let ex = existing, let exNick = ex["nickname"] as? String, exNick != nickname {
            prevNicknames.append(exNick)
        }
        let existingReason = (existing?["reason"] as? String) ?? ""
        users[personaId] = [
            "personaId": personaId,
            "nickname": nickname,
            "previousNicknames": prevNicknames,
            "blockedAt": existing?["blockedAt"] ?? nowIso,
            "reason": existingReason.isEmpty ? reason : existingReason
        ]
        result["blockedUsers"] = users
        return result
    }
}
