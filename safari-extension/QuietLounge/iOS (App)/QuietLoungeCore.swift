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
        let maxCreate = details.compactMap { $0.createTime.isEmpty ? nil : $0.createTime }.max()
        return ChannelProcessResult(
            matches: matches,
            newLastChecked: maxCreate ?? lastChecked
        )
    }
}
