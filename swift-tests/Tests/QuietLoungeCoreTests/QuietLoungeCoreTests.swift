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

// MARK: - pickMaxIsoDate

final class PickMaxIsoDateTests: XCTestCase {
    func test_빈_배열() {
        XCTAssertNil(QuietLoungeCore.pickMaxIsoDate([]))
    }

    func test_빈_문자열만() {
        XCTAssertNil(QuietLoungeCore.pickMaxIsoDate(["", ""]))
    }

    func test_단일_값() {
        XCTAssertEqual(
            QuietLoungeCore.pickMaxIsoDate(["2026-04-01T00:00:00Z"]),
            "2026-04-01T00:00:00Z"
        )
    }

    func test_UTC_여러_값_중_최대() {
        let result = QuietLoungeCore.pickMaxIsoDate([
            "2026-04-01T00:00:00Z",
            "2026-04-05T12:00:00Z",
            "2026-04-03T00:00:00Z"
        ])
        XCTAssertEqual(result, "2026-04-05T12:00:00Z")
    }

    func test_포맷_혼재_타임존_달라도_timestamp_기준_정확() {
        // UTC +09:00 의 00:00 = UTC 의 전날 15:00. 사전순은 후자가 뒤지만 실제 시각은 같음.
        // 약간 섞인 포맷에서 실제 최신 글을 선택해야 함.
        let result = QuietLoungeCore.pickMaxIsoDate([
            "2026-04-01T00:00:00+09:00",  // = 2026-03-31T15:00:00Z (더 이른 시각)
            "2026-04-01T00:00:00Z"         // 더 나중 시각
        ])
        XCTAssertEqual(result, "2026-04-01T00:00:00Z")
    }

    func test_fractional_seconds_가_있는_값이_최대() {
        let result = QuietLoungeCore.pickMaxIsoDate([
            "2026-04-01T00:00:00Z",
            "2026-04-01T00:00:00.500Z"
        ])
        XCTAssertEqual(result, "2026-04-01T00:00:00.500Z")
    }

    func test_파싱_실패한_값은_후보에서_제외() {
        let result = QuietLoungeCore.pickMaxIsoDate([
            "garbage",
            "2026-04-01T00:00:00Z",
            "also-garbage"
        ])
        XCTAssertEqual(result, "2026-04-01T00:00:00Z")
    }

    func test_모두_파싱_실패면_nil() {
        XCTAssertNil(QuietLoungeCore.pickMaxIsoDate(["abc", "xyz"]))
    }

    // 의도된 계약: 두 입력이 **같은 timestamp** 를 가리키면 먼저 들어온 표현을 유지한다.
    // 구현상 `pickMaxIsoDate` 는 strict `>` 로 비교하기 때문에, 동일 시각에서는 later 값이
    // 현재 best 를 밀어내지 않는다. 이는 "lastChecked 전진 시 불필요한 업데이트 방지" 효과가 있음.
    // 누가 `>=` 로 바꾸면 이 테스트가 깨지면서 계약 변경을 알림.
    func test_동일_시각이면_먼저_들어온_표현_유지() {
        let result = QuietLoungeCore.pickMaxIsoDate([
            "2026-04-01T09:00:00+09:00",
            "2026-04-01T00:00:00Z"
        ])
        XCTAssertEqual(result, "2026-04-01T09:00:00+09:00")
    }
}

// MARK: - computeFlowLayout (KeywordTagFlowView 의 플로우 레이아웃 math)

final class FlowLayoutTests: XCTestCase {
    private func sizes(_ widths: [Double], height: Double = 20) -> [(width: Double, height: Double)] {
        widths.map { ($0, height) }
    }

    func test_빈_배열은_높이_0() {
        let result = QuietLoungeCore.computeFlowLayout(itemSizes: [], maxWidth: 100)
        XCTAssertEqual(result.totalHeight, 0)
        XCTAssertTrue(result.frames.isEmpty)
    }

    func test_maxWidth_0_이하면_빈_결과() {
        let result = QuietLoungeCore.computeFlowLayout(itemSizes: sizes([20, 30]), maxWidth: 0)
        XCTAssertEqual(result.totalHeight, 0)
        XCTAssertTrue(result.frames.isEmpty)
    }

    func test_단일_아이템은_한_줄() {
        let result = QuietLoungeCore.computeFlowLayout(itemSizes: sizes([50]), maxWidth: 100)
        XCTAssertEqual(result.totalHeight, 20)
        XCTAssertEqual(result.frames.count, 1)
        XCTAssertEqual(result.frames[0].x, 0)
        XCTAssertEqual(result.frames[0].y, 0)
    }

    func test_같은_줄_내_아이템은_hSpacing_만큼_떨어짐() {
        let result = QuietLoungeCore.computeFlowLayout(
            itemSizes: sizes([30, 30]), maxWidth: 100, hSpacing: 4
        )
        XCTAssertEqual(result.frames.count, 2)
        XCTAssertEqual(result.frames[0].x, 0)
        XCTAssertEqual(result.frames[1].x, 30 + 4) // 첫 아이템 끝 + spacing
        XCTAssertEqual(result.frames[1].y, 0)      // 같은 줄
        XCTAssertEqual(result.totalHeight, 20)
    }

    func test_maxWidth_초과_시_다음_줄로_wrap() {
        // 30 + 4 + 30 + 4 + 30 = 98 (fit), 98 + 4 + 30 = 132 (over 100) → wrap
        let result = QuietLoungeCore.computeFlowLayout(
            itemSizes: sizes([30, 30, 30, 30]), maxWidth: 100, hSpacing: 4, vSpacing: 4
        )
        XCTAssertEqual(result.frames.count, 4)
        // 첫 줄: 3개 (0, 34, 68)
        XCTAssertEqual(result.frames[0].x, 0)
        XCTAssertEqual(result.frames[0].y, 0)
        XCTAssertEqual(result.frames[1].x, 34)
        XCTAssertEqual(result.frames[1].y, 0)
        XCTAssertEqual(result.frames[2].x, 68)
        XCTAssertEqual(result.frames[2].y, 0)
        // 둘째 줄: 1개
        XCTAssertEqual(result.frames[3].x, 0)
        XCTAssertEqual(result.frames[3].y, 24) // 20 + 4 vSpacing
        // 총 높이 = 둘째 줄 y + 줄 높이
        XCTAssertEqual(result.totalHeight, 44)
    }

    func test_단일_아이템이_maxWidth_초과해도_같은_줄에_배치() {
        // 첫 아이템이 maxWidth 보다 커도 wrap 하지 않음 (x > 0 조건 때문에)
        let result = QuietLoungeCore.computeFlowLayout(itemSizes: sizes([200]), maxWidth: 100)
        XCTAssertEqual(result.frames.count, 1)
        XCTAssertEqual(result.frames[0].x, 0)
        XCTAssertEqual(result.frames[0].y, 0)
    }

    func test_줄별_lineHeight_가_달라도_올바르게_누적() {
        let result = QuietLoungeCore.computeFlowLayout(
            itemSizes: [(50, 20), (50, 30)], // 100 = 50 + 4 + 50 → fit (단, hSpacing 빼면)
            maxWidth: 200,
            hSpacing: 4,
            vSpacing: 4
        )
        // 둘 다 한 줄: 첫 줄 높이 = max(20, 30) = 30
        XCTAssertEqual(result.totalHeight, 30)
    }

    func test_여러_줄_lineHeight_따로_계산() {
        let result = QuietLoungeCore.computeFlowLayout(
            itemSizes: [(60, 20), (60, 30), (60, 25)], // 60 + 4 + 60 = 124 (over 100) → 첫 줄 1개
            maxWidth: 100,
            hSpacing: 4,
            vSpacing: 4
        )
        XCTAssertEqual(result.frames.count, 3)
        // 첫 줄: [0]
        XCTAssertEqual(result.frames[0].y, 0)
        // 둘째 줄: [1] — y = 20 (첫 줄 높이) + 4 (vSpacing)
        XCTAssertEqual(result.frames[1].y, 24)
        // 셋째 줄: [2] — y = 24 + 30 + 4 = 58
        XCTAssertEqual(result.frames[2].y, 58)
        // 총 높이 = 58 + 25 = 83
        XCTAssertEqual(result.totalHeight, 83)
    }

    func test_딱_맞는_경우_wrap_안_함() {
        // 30 + 4 + 30 = 64 ≤ 100 → 같은 줄
        let result = QuietLoungeCore.computeFlowLayout(
            itemSizes: sizes([30, 30]), maxWidth: 64, hSpacing: 4
        )
        XCTAssertEqual(result.frames.count, 2)
        XCTAssertEqual(result.frames[1].y, 0) // 같은 줄
    }

    func test_경계값_초과_1px_차이로_wrap() {
        // maxWidth = 63 → 30 + 4 + 30 = 64 > 63 → wrap
        let result = QuietLoungeCore.computeFlowLayout(
            itemSizes: sizes([30, 30]), maxWidth: 63, hSpacing: 4, vSpacing: 4
        )
        XCTAssertEqual(result.frames[1].y, 24) // 다음 줄
    }
}

// MARK: - applyPersonaCacheUpdate

final class PersonaCachePromotionTests: XCTestCase {
    private let fixedDate = Date(timeIntervalSince1970: 1_700_000_000)
    private lazy var fixedIso = ISO8601DateFormatter().string(from: fixedDate)

    private func emptyData() -> [String: Any] {
        [
            "version": 2,
            "blockedUsers": [String: [String: Any]](),
            "nicknameOnlyBlocks": [[String: Any]](),
            "personaCache": [String: [String: String]]()
        ]
    }

    func test_캐시만_갱신_차단_없음() {
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: emptyData(), personaId: "p1", nickname: "foo", now: fixedDate
        )
        let cache = out["personaCache"] as? [String: [String: String]]
        XCTAssertEqual(cache?["p1"]?["nickname"], "foo")
        XCTAssertTrue((out["blockedUsers"] as? [String: Any])?.isEmpty ?? true)
    }

    func test_현재_닉네임이_nicknameOnly에_있으면_승격() {
        var data = emptyData()
        data["nicknameOnlyBlocks"] = [["nickname": "auto", "blockedAt": fixedIso, "reason": "사유"]]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "auto", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        XCTAssertEqual(users?["p1"]?["nickname"] as? String, "auto")
        XCTAssertEqual(users?["p1"]?["reason"] as? String, "사유")
        XCTAssertTrue((out["nicknameOnlyBlocks"] as? [[String: Any]])?.isEmpty ?? false)
    }

    func test_이전_닉네임_기준_승격_시_oldname_엔트리도_제거() {
        var data = emptyData()
        data["personaCache"] = ["p1": ["nickname": "oldname", "lastSeen": fixedIso]]
        data["nicknameOnlyBlocks"] = [["nickname": "oldname", "blockedAt": fixedIso, "reason": ""]]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "newname", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        XCTAssertEqual(users?["p1"]?["nickname"] as? String, "newname")
        // oldname 엔트리가 반드시 제거되어야 함 — 다른 사용자 오탐 방지
        XCTAssertTrue((out["nicknameOnlyBlocks"] as? [[String: Any]])?.isEmpty ?? false)
    }

    func test_이미_차단된_유저_닉네임_변경_시_previousNicknames_추적() {
        var data = emptyData()
        data["personaCache"] = ["p1": ["nickname": "first", "lastSeen": fixedIso]]
        data["blockedUsers"] = [
            "p1": [
                "personaId": "p1",
                "nickname": "first",
                "previousNicknames": [String](),
                "blockedAt": fixedIso,
                "reason": ""
            ]
        ]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "second", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        XCTAssertEqual(users?["p1"]?["nickname"] as? String, "second")
        XCTAssertEqual(users?["p1"]?["previousNicknames"] as? [String], ["first"])
    }

    func test_같은_닉네임_재호출은_변경_없음() {
        var data = emptyData()
        data["personaCache"] = ["p1": ["nickname": "same", "lastSeen": fixedIso]]
        data["blockedUsers"] = [
            "p1": [
                "personaId": "p1",
                "nickname": "same",
                "previousNicknames": [String](),
                "blockedAt": fixedIso,
                "reason": ""
            ]
        ]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "same", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        XCTAssertEqual((users?["p1"]?["previousNicknames"] as? [String])?.count, 0)
    }

    func test_차단_안_된_유저의_닉네임_변경은_blockedUsers_변경_없음() {
        var data = emptyData()
        data["personaCache"] = ["p1": ["nickname": "first", "lastSeen": fixedIso]]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "second", now: fixedDate
        )
        XCTAssertTrue((out["blockedUsers"] as? [String: Any])?.isEmpty ?? true)
        let cache = out["personaCache"] as? [String: [String: String]]
        XCTAssertEqual(cache?["p1"]?["nickname"], "second")
    }

    func test_승격_시_기존_reason_이_있으면_유지() {
        var data = emptyData()
        data["blockedUsers"] = [
            "p1": [
                "personaId": "p1",
                "nickname": "keep",
                "previousNicknames": [String](),
                "blockedAt": fixedIso,
                "reason": "기존사유"
            ]
        ]
        data["nicknameOnlyBlocks"] = [["nickname": "keep", "blockedAt": fixedIso, "reason": "새사유"]]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "keep", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        // 기존 blockedUsers reason 이 우선
        XCTAssertEqual(users?["p1"]?["reason"] as? String, "기존사유")
    }

    func test_승격_시_기존_blockedAt_유지() {
        var data = emptyData()
        data["blockedUsers"] = [
            "p1": [
                "personaId": "p1",
                "nickname": "old",
                "previousNicknames": [String](),
                "blockedAt": "2026-01-01T00:00:00Z",
                "reason": ""
            ]
        ]
        data["nicknameOnlyBlocks"] = [[
            "nickname": "old",
            "blockedAt": fixedIso,
            "reason": ""
        ]]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "old", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        XCTAssertEqual(users?["p1"]?["blockedAt"] as? String, "2026-01-01T00:00:00Z")
    }

    func test_이전_닉네임_기준_승격_시_기존_previousNicknames_보존하고_추가() {
        var data = emptyData()
        data["personaCache"] = ["p1": ["nickname": "oldname", "lastSeen": fixedIso]]
        data["blockedUsers"] = [
            "p1": [
                "personaId": "p1",
                "nickname": "very-old",
                "previousNicknames": ["ancient"],
                "blockedAt": fixedIso,
                "reason": ""
            ]
        ]
        data["nicknameOnlyBlocks"] = [[
            "nickname": "oldname",
            "blockedAt": fixedIso,
            "reason": ""
        ]]
        let out = QuietLoungeCore.applyPersonaCacheUpdate(
            to: data, personaId: "p1", nickname: "newname", now: fixedDate
        )
        let users = out["blockedUsers"] as? [String: [String: Any]]
        XCTAssertEqual(users?["p1"]?["nickname"] as? String, "newname")
        XCTAssertEqual(
            users?["p1"]?["previousNicknames"] as? [String],
            ["ancient", "very-old"]
        )
    }
}
