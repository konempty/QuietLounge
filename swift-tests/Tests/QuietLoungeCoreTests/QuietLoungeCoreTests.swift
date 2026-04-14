import XCTest
@testable import QuietLoungeCore

final class DateParsingTests: XCTestCase {
    private lazy var ref = QuietLoungeCore.parseDate("2026-04-01T00:00:00Z")!

    func test_UTC_Z_포맷() {
        XCTAssertEqual(QuietLoungeCore.parseDate("2026-04-01T00:00:00Z"), ref)
    }

    func test_콜론_있는_tz() {
        XCTAssertEqual(QuietLoungeCore.parseDate("2026-04-01T09:00:00+09:00"), ref)
    }

    func test_콜론_없는_tz_0900() {
        XCTAssertEqual(QuietLoungeCore.parseDate("2026-04-01T09:00:00+0900"), ref)
    }

    func test_콜론_없는_tz_상대_시차() {
        let minus5 = QuietLoungeCore.parseDate("2026-04-01T00:00:00-0500")!
        XCTAssertEqual(minus5.timeIntervalSince(ref), 5 * 3600)
    }

    func test_fractional_seconds() {
        let withFrac = QuietLoungeCore.parseDate("2026-04-01T00:00:00.123Z")!
        XCTAssertEqual(withFrac.timeIntervalSince(ref), 0.123, accuracy: 0.001)
    }

    func test_nil_empty_문자열() {
        XCTAssertNil(QuietLoungeCore.parseDate(nil))
        XCTAssertNil(QuietLoungeCore.parseDate(""))
    }

    func test_잘못된_문자열() {
        XCTAssertNil(QuietLoungeCore.parseDate("hello"))
        XCTAssertNil(QuietLoungeCore.parseDate("abc"))
    }

    func test_시간_순서_보존() {
        let older = QuietLoungeCore.parseDate("2026-04-01T00:00:00Z")!
        let newer = QuietLoungeCore.parseDate("2026-04-05T00:00:00Z")!
        XCTAssertLessThan(older, newer)
    }

    // tz 보정 + fractional seconds 경로 (줄 28-29 커버)
    func test_tz_0900_with_fractional() {
        let t = QuietLoungeCore.parseDate("2026-04-01T09:00:00.500+0900")
        XCTAssertNotNil(t)
        XCTAssertEqual(t!.timeIntervalSince(ref), 0.5, accuracy: 0.001)
    }

    // tz 보정 이후에도 실패하는 입력 (줄 31 이후 return nil)
    func test_tz_보정_후에도_실패하는_입력() {
        // 형식은 맞지 않지만 tz 패턴만 매칭되는 케이스
        XCTAssertNil(QuietLoungeCore.parseDate("garbage+0900"))
        XCTAssertNil(QuietLoungeCore.parseDate("not-a-date+1234"))
    }

    // 음수 tz 오프셋 + fractional
    func test_negative_tz_with_fractional() {
        let t = QuietLoungeCore.parseDate("2026-04-01T00:00:00.250-0500")
        XCTAssertNotNil(t)
        XCTAssertEqual(t!.timeIntervalSince(ref), 5 * 3600 + 0.25, accuracy: 0.001)
    }

    // 공백만 있는 문자열 — 빈값처럼 nil (비어있진 않지만 포맷 실패)
    func test_공백_문자열() {
        XCTAssertNil(QuietLoungeCore.parseDate("   "))
    }
}

final class KeywordMatchingTests: XCTestCase {
    func test_정확한_매칭() {
        XCTAssertEqual(QuietLoungeCore.findMatchedKeyword(title: "공지사항", keywords: ["공지"]), "공지")
    }

    func test_대소문자_무시() {
        XCTAssertEqual(
            QuietLoungeCore.findMatchedKeyword(title: "HELLO World", keywords: ["hello"]),
            "hello"
        )
    }

    func test_매칭_없음() {
        XCTAssertNil(QuietLoungeCore.findMatchedKeyword(title: "foo", keywords: ["bar"]))
    }

    func test_빈_키워드_리스트() {
        XCTAssertNil(QuietLoungeCore.findMatchedKeyword(title: "any", keywords: []))
    }

    func test_첫_매칭_반환() {
        let result = QuietLoungeCore.findMatchedKeyword(
            title: "긴급 공지 이벤트",
            keywords: ["긴급", "공지", "이벤트"]
        )
        XCTAssertEqual(result, "긴급")
    }

    func test_부분_매칭() {
        XCTAssertEqual(
            QuietLoungeCore.findMatchedKeyword(title: "새해 공지사항 2026", keywords: ["공지"]),
            "공지"
        )
    }
}

final class ProcessChannelTests: XCTestCase {
    private let keywords = ["공지", "긴급"]

    private func detail(_ postId: String, _ title: String, _ createTime: String) -> QuietLoungeCore.PostDetail {
        QuietLoungeCore.PostDetail(postId: postId, title: title, createTime: createTime)
    }

    func test_매칭되는_글만_반환() {
        let details = [
            detail("a", "새해 공지사항", "2026-04-01T00:00:00Z"),
            detail("b", "긴급 점검", "2026-04-02T00:00:00Z"),
            detail("c", "평범한 글", "2026-04-03T00:00:00Z")
        ]
        let res = QuietLoungeCore.processChannel(details: details, keywords: keywords, lastChecked: nil)
        XCTAssertEqual(res.matches.count, 2)
    }

    func test_lastChecked_이후_글만() {
        let details = [
            detail("old", "공지 오래됨", "2026-03-01T00:00:00Z"),
            detail("new", "공지 새글", "2026-05-01T00:00:00Z")
        ]
        let res = QuietLoungeCore.processChannel(
            details: details,
            keywords: keywords,
            lastChecked: "2026-04-01T00:00:00Z"
        )
        XCTAssertEqual(res.matches.count, 1)
        XCTAssertEqual(res.matches.first?.postId, "new")
    }

    func test_lastChecked_와_같은_시간은_제외() {
        let details = [
            detail("eq", "공지", "2026-04-01T00:00:00Z"),
            detail("lt", "공지", "2026-05-01T00:00:00Z")
        ]
        let res = QuietLoungeCore.processChannel(
            details: details,
            keywords: keywords,
            lastChecked: "2026-04-01T00:00:00Z"
        )
        XCTAssertEqual(res.matches.map { $0.postId }, ["lt"])
    }

    func test_매칭_없어도_lastChecked_전진() {
        let details = [
            detail("a", "평범", "2026-04-01T00:00:00Z"),
            detail("b", "평범", "2026-04-05T00:00:00Z")
        ]
        let res = QuietLoungeCore.processChannel(details: details, keywords: keywords, lastChecked: nil)
        XCTAssertEqual(res.matches.count, 0)
        XCTAssertEqual(res.newLastChecked, "2026-04-05T00:00:00Z")
    }

    func test_응답_순서_무관_max_선택() {
        let asc = [
            detail("a", "평범", "2026-04-01T00:00:00Z"),
            detail("b", "평범", "2026-04-05T00:00:00Z")
        ]
        let desc = asc.reversed().map { $0 }
        let ascRes = QuietLoungeCore.processChannel(details: asc, keywords: keywords, lastChecked: nil)
        let descRes = QuietLoungeCore.processChannel(details: desc, keywords: keywords, lastChecked: nil)
        XCTAssertEqual(ascRes.newLastChecked, descRes.newLastChecked)
    }

    func test_빈_details_lastChecked_유지() {
        let res = QuietLoungeCore.processChannel(
            details: [],
            keywords: keywords,
            lastChecked: "2026-04-01T00:00:00Z"
        )
        XCTAssertEqual(res.newLastChecked, "2026-04-01T00:00:00Z")
    }

    func test_createTime_빈값은_전진에_기여_안함() {
        let details = [
            detail("a", "공지", ""),
            detail("b", "공지", "2026-04-05T00:00:00Z")
        ]
        let res = QuietLoungeCore.processChannel(details: details, keywords: keywords, lastChecked: nil)
        XCTAssertEqual(res.newLastChecked, "2026-04-05T00:00:00Z")
    }
}
