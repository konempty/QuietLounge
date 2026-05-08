// fetch monkey-patch + DOM hydration parser 로 라운지 페이지의 postId → personaId / personaId →
// nickname 매핑을 수집해 native bridge 로 push. document_start (iOS WKUserScript .atDocumentStart /
// Android WebViewClient.onPageStarted) 시점에 inject 되어 *fetch 가 page script 보다 먼저* 가로채야
// 누락이 없다.
//
// 4 entry 중 iOS / Android 두 곳에서만 사용 — Chrome / Safari ext 은 별도 api-interceptor.js 가
// MAIN world 에서 같은 일을 함 (PR #6 영역).
//
// adapter.pushPersonaMap 만 platform-specific (iOS = webkit messageHandlers / Android = JavascriptInterface).
// 나머지 fetch 패치 / regex / DOM fallback 은 100% 동일.

import type { PersonaExtractorAdapter } from '../platform/adapter';

interface QlNamespace {
  personaMap: Record<string, string>;
  personaCache: Record<string, string>;
}

declare global {
  interface Window {
    __QL_BEFORE_INSTALLED?: boolean;
    __QL?: QlNamespace;
  }
}

/**
 * obj 트리를 재귀 순회해 postId+personaId 쌍 / personaId+nickname 쌍을 추출.
 * 라운지 API 응답이 다양한 깊이로 중첩된 객체 형태이므로 평면화해서 두 매핑을 동시에 채움.
 */
export function extractMappings(obj: unknown, ql: QlNamespace): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v) => extractMappings(v, ql));
    return;
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.postId === 'string' && typeof o.personaId === 'string') {
    ql.personaMap[o.postId] = o.personaId;
  }
  if (typeof o.personaId === 'string' && typeof o.nickname === 'string') {
    ql.personaCache[o.personaId] = o.nickname;
  }
  Object.values(o).forEach((v) => extractMappings(v, ql));
}

/**
 * SSR hydration script 안의 escaped JSON 에서 postId/personaId/nickname 추출.
 *
 * - 인접 패턴 (`"postId":"x","personaId":"y"`) 은 한 번에 매칭.
 * - 비인접 패턴은 postId 위치 기준 200 자 이내의 *가장 가까운* 후행 personaId 와 매칭 (이미 매핑된
 *   postId 는 건너뜀) — JSON 의 다른 객체에서 우연히 가까운 personaId 가 잘못 잡히는 케이스를 줄임.
 */
function parseHydrationScripts(ql: QlNamespace): void {
  document.querySelectorAll('script').forEach((s) => {
    const t = s.textContent;
    if (!t) return;

    // 인접 패턴.
    const regex1 = /\\"postId\\":\\"([^"\\]+)\\",\\"personaId\\":\\"([^"\\]+)\\"/g;
    let m: RegExpExecArray | null;
    while ((m = regex1.exec(t)) !== null) {
      ql.personaMap[m[1]] = m[2];
    }

    // 비인접 패턴 — postId 위치와 가장 가까운 후행 personaId.
    const postIds: { id: string; idx: number }[] = [];
    const pIds: { id: string; idx: number }[] = [];
    const regex2 = /\\"postId\\":\\"([^"\\]+)\\"/g;
    const regex3 = /\\"personaId\\":\\"([^"\\]+)\\"/g;
    while ((m = regex2.exec(t)) !== null) postIds.push({ id: m[1], idx: m.index });
    while ((m = regex3.exec(t)) !== null) pIds.push({ id: m[1], idx: m.index });

    postIds.forEach((pm) => {
      if (ql.personaMap[pm.id]) return;
      let closest: string | null = null;
      let dist = Infinity;
      pIds.forEach((pi) => {
        const d = pi.idx - pm.idx;
        if (d > 0 && d < dist && d < 200) {
          dist = d;
          closest = pi.id;
        }
      });
      if (closest) ql.personaMap[pm.id] = closest;
    });

    const regex4 = /\\"personaId\\":\\"([^"\\]+)\\",\\"nickname\\":\\"([^"\\]+)\\"/g;
    while ((m = regex4.exec(t)) !== null) {
      ql.personaCache[m[1]] = m[2];
    }
  });
}

/** DOM 의 `a[href^="/profiles/"]` 에서 personaId-닉네임 추출. */
function extractFromProfileLinks(ql: QlNamespace): void {
  document.querySelectorAll('a[href^="/profiles/"]').forEach((link) => {
    const pid = link.getAttribute('href')?.replace('/profiles/', '');
    const nick = link.textContent?.trim();
    // pid 가 너무 짧으면 잘못된 fragment (예: hash) 일 가능성 — 6자 이상만 신뢰.
    if (pid && nick && pid.length >= 6) {
      ql.personaCache[pid] = nick;
    }
  });
}

/**
 * `/posts/{postId}` 상세 페이지에서 작성자 personaId 가 fetch / regex 로 안 잡혔을 때 DOM fallback —
 * `[data-slot="profile-name"] a[href^="/profiles/"]` 의 href 에서 personaId 추출.
 */
function extractAuthorFromDetailPage(ql: QlNamespace): void {
  const urlMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
  if (!urlMatch || ql.personaMap[urlMatch[1]]) return;
  const authorLink = document.querySelector('[data-slot="profile-name"] a[href^="/profiles/"]');
  if (!authorLink) return;
  const authorPid = authorLink.getAttribute('href')?.replace('/profiles/', '');
  if (authorPid) ql.personaMap[urlMatch[1]] = authorPid;
}

/** entry 진입점 — fetch 패치 + DOMContentLoaded handler 등록. 한 페이지당 1 회만 install. */
export function setupPersonaExtractor(adapter: PersonaExtractorAdapter): void {
  if (window.__QL_BEFORE_INSTALLED) return;
  window.__QL_BEFORE_INSTALLED = true;

  const ql: QlNamespace = { personaMap: {}, personaCache: {} };
  window.__QL = ql;

  function pushAll(): void {
    adapter.pushPersonaMap({
      personaMap: ql.personaMap,
      personaCache: ql.personaCache,
    });
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const resp = await origFetch.apply(this, args);
    const first = args[0];
    const url =
      typeof first === 'string'
        ? first
        : first instanceof URL
          ? first.toString()
          : (first as Request | undefined)?.url || '';
    try {
      if (url.includes('api.lounge.naver.com')) {
        const data = await resp.clone().json();
        extractMappings(data, ql);
        pushAll();
      }
    } catch {
      // JSON parse / 네트워크 오류는 무시 — page 동작에 영향 주지 않도록.
    }
    return resp;
  };

  document.addEventListener('DOMContentLoaded', () => {
    parseHydrationScripts(ql);
    extractFromProfileLinks(ql);
    extractAuthorFromDetailPage(ql);
    pushAll();
  });
}

// 테스트 전용 — `__QL_BEFORE_INSTALLED` 가드를 우회하기 위해 reset.
export function __resetForTests(): void {
  if (typeof window !== 'undefined') {
    delete window.__QL_BEFORE_INSTALLED;
    delete window.__QL;
  }
}
