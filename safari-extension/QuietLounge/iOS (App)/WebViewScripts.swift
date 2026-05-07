import Foundation

enum WebViewScripts {

    /// 빌드된 산출물 (Resources/webview-scripts/after.js) 의 placeholder 토큰.
    /// shared/web/entries/ios-after.ts 와 일치해야 한다 — Android Kotlin 과도 동일한 규약.
    ///
    /// 두 토큰 모두 **bare identifier 형태로 매칭** — 산출물의 따옴표 종류 (single vs double)
    /// 와 무관하게 동작해야 한다. esbuild 가 string literal 을 double-quote 로 출력하므로
    /// `"'__QL_FILTER_MODE_PLACEHOLDER__'"` (single quote 포함) 으로 검색하면 매치 실패하는 회귀.
    /// 따옴표는 산출물 측에 그대로 두고 안쪽 토큰만 치환해 단순 식별자로 들어가게 한다.
    static let blockDataPlaceholder = "__QL_BLOCK_DATA_PLACEHOLDER__"
    static let filterModePlaceholder = "__QL_FILTER_MODE_PLACEHOLDER__"

    /// fetch monkey-patch — 페이지 로드 전 주입.
    /// (이 PR 에서는 String literal 그대로 유지 — 후속 PR 에서 Bundle 의 before.js 로 옮길 예정.)
    static let beforeScript: String = """
    (function() {
      'use strict';
      if (window.__QL_BEFORE_INSTALLED) return;
      window.__QL_BEFORE_INSTALLED = true;

      window.__QL = { personaMap: {}, personaCache: {} };

      var origFetch = window.fetch;
      window.fetch = async function() {
        var resp = await origFetch.apply(this, arguments);
        var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url || '');
        try {
          if (url.indexOf('api.lounge.naver.com') !== -1) {
            var data = await resp.clone().json();
            extractMappings(data);
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge) {
              window.webkit.messageHandlers.qlBridge.postMessage(JSON.stringify({
                type: 'PERSONA_MAP_UPDATE',
                payload: { personaMap: window.__QL.personaMap, personaCache: window.__QL.personaCache }
              }));
            }
          }
        } catch(e) {}
        return resp;
      };

      function extractMappings(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(extractMappings); return; }
        if (typeof obj.postId === 'string' && typeof obj.personaId === 'string')
          window.__QL.personaMap[obj.postId] = obj.personaId;
        if (typeof obj.personaId === 'string' && typeof obj.nickname === 'string')
          window.__QL.personaCache[obj.personaId] = obj.nickname;
        Object.values(obj).forEach(extractMappings);
      }

      document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('script').forEach(function(s) {
          var t = s.textContent;
          if (!t) return;
          // 인접 패턴: ("postId":"x","personaId":"y")
          var regex1 = /\\\\"postId\\\\":\\\\"([^"\\\\]+)\\\\",\\\\"personaId\\\\":\\\\"([^"\\\\]+)\\\\"/g;
          var m;
          while ((m = regex1.exec(t)) !== null) { window.__QL.personaMap[m[1]] = m[2]; }
          // 비인접 패턴 — postId 와 가장 가까운 personaId 매칭 (200자 이내 후행)
          var postIds = [], pIds = [];
          var regex2 = /\\\\"postId\\\\":\\\\"([^"\\\\]+)\\\\"/g;
          var regex3 = /\\\\"personaId\\\\":\\\\"([^"\\\\]+)\\\\"/g;
          while ((m = regex2.exec(t)) !== null) postIds.push({ id: m[1], idx: m.index });
          while ((m = regex3.exec(t)) !== null) pIds.push({ id: m[1], idx: m.index });
          postIds.forEach(function(pm) {
            if (window.__QL.personaMap[pm.id]) return;
            var closest = null, dist = Infinity;
            pIds.forEach(function(pi) {
              var d = pi.idx - pm.idx;
              if (d > 0 && d < dist && d < 200) { dist = d; closest = pi.id; }
            });
            if (closest) window.__QL.personaMap[pm.id] = closest;
          });
          var regex4 = /\\\\"personaId\\\\":\\\\"([^"\\\\]+)\\\\",\\\\"nickname\\\\":\\\\"([^"\\\\]+)\\\\"/g;
          while ((m = regex4.exec(t)) !== null) { window.__QL.personaCache[m[1]] = m[2]; }
        });
        document.querySelectorAll('a[href^="/profiles/"]').forEach(function(link) {
          var pid = link.getAttribute('href').replace('/profiles/', '');
          var nick = link.textContent.trim();
          if (pid && nick && pid.length >= 6) window.__QL.personaCache[pid] = nick;
        });
        // /posts/{postId} 상세 페이지에서 작성자 personaId 가 인터셉터/regex 로 안 잡혔으면 DOM 으로 fallback
        var urlMatch = window.location.pathname.match(/^\\/posts\\/([^/]+)/);
        if (urlMatch && !window.__QL.personaMap[urlMatch[1]]) {
          var authorLink = document.querySelector('[data-slot="profile-name"] a[href^="/profiles/"]');
          if (authorLink) {
            var authorPid = authorLink.getAttribute('href').replace('/profiles/', '');
            if (authorPid) window.__QL.personaMap[urlMatch[1]] = authorPid;
          }
        }
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge) {
          window.webkit.messageHandlers.qlBridge.postMessage(JSON.stringify({
            type: 'PERSONA_MAP_UPDATE',
            payload: { personaMap: window.__QL.personaMap, personaCache: window.__QL.personaCache }
          }));
        }
      });
    })();
    true;
    """

    /// 필터링 + 차단 버튼 + 프로필 통계 — 페이지 로드 후 주입.
    /// Bundle 의 webview-scripts/after.js (esbuild 산출물) 를 읽고 placeholder 두 개를 치환.
    static func afterScript(blockData: [String: Any], filterMode: String) -> String {
        renderTemplate(loadAfterTemplate(), blockData: blockData, filterMode: filterMode)
    }

    /// 순수 placeholder 치환 — Bundle I/O 와 분리해 unit test 가능.
    /// `__QL_BLOCK_DATA_PLACEHOLDER__` 와 `__QL_FILTER_MODE_PLACEHOLDER__` 두 bare token 을 치환.
    /// 따옴표는 산출물 측에 그대로 두고 식별자만 치환하는 패턴 — Android Kotlin 과 동일 규약.
    static func renderTemplate(
        _ template: String,
        blockData: [String: Any],
        filterMode: String
    ) -> String {
        return template
            .replacingOccurrences(of: blockDataPlaceholder, with: serializeBlockData(blockData))
            .replacingOccurrences(of: filterModePlaceholder, with: filterMode)
    }

    /// blockData 직렬화 실패 시 `"{}"` 로 fallback. `try?` 만으론 `JSONSerialization` 이 던지는
    /// `NSInvalidArgumentException` (Date 등 비호환 타입) 을 못 잡아 앱이 크래시할 수 있어
    /// `isValidJSONObject` 로 사전 검증한다.
    private static func serializeBlockData(_ blockData: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(blockData),
              let data = try? JSONSerialization.data(withJSONObject: blockData),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }

    private static var afterTemplateCache: String?

    /// `Bundle.main.url(forResource:withExtension:subdirectory:)` 로 산출물 1 회 read 후 캐시.
    /// Copy Bundle Resources 에 webview-scripts blue folder 가 등록되지 않은 경우 nil 반환 →
    /// `preconditionFailure` 로 즉시 크래시 (릴리즈 빌드 포함).
    ///
    /// 이전에는 `assertionFailure` + `return ""` 였지만, `assertionFailure` 는 release config 에서
    /// no-op 이라 빈 WKUserScript 가 등록되어 iOS native 의 차단/블러/버튼 주입이 통째로 죽어도
    /// 크래시 없이 silent 사망하는 회귀 (P2 리뷰 피드백). 또 xcodebuild 자체는 이 함수를 실행하지
    /// 않으므로 CI 가 리소스 누락을 자동 검출 못함 — Swift unit test (afterScript 가 정상 헤더와
    /// `window.__QL_BLOCK_DATA` 를 포함하는지) 와 fail-fast 로 두 겹 가드.
    private static func loadAfterTemplate() -> String {
        if let cached = afterTemplateCache { return cached }
        guard let url = Bundle.main.url(
            forResource: "after",
            withExtension: "js",
            subdirectory: "webview-scripts"
        ),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else {
            preconditionFailure(
                "QuietLounge: Resources/webview-scripts/after.js 를 Bundle 에서 로드 실패. " +
                "pbxproj 의 iOS App target Copy Bundle Resources 에 webview-scripts blue folder 가 " +
                "등록되어 있는지, `pnpm build` 가 실행되어 산출물이 생성되었는지 확인."
            )
        }
        afterTemplateCache = text
        return text
    }

    /// 차단 목록 업데이트 push
    static func blockListUpdateScript(blockData: [String: Any]) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: blockData))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__QL_BLOCK_DATA = \(json); if(window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate(); true;"
    }
}
