// QuietLounge — API Interceptor (MAIN world, document_start)
// CSP 우회를 위해 manifest.json에서 world: "MAIN"으로 실행
// fetch monkey-patch로 피드 API 응답에서 postId → personaId 매핑 수집

(function () {
  'use strict';

  // 매핑 저장소 (page world 전역)
  const personaMap = {};  // postId → personaId
  const personaCache = {}; // personaId → nickname

  // content script(ISOLATED world)로 데이터 전달
  function notifyContentScript() {
    window.postMessage({
      type: 'QUIET_LOUNGE_API_DATA',
      personaMap: personaMap,
      personaCache: personaCache,
    }, '*');
  }

  // 재귀적으로 API 응답에서 매핑 추출
  function extractMappings(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(extractMappings);
      return;
    }

    if (typeof obj.postId === 'string' && typeof obj.personaId === 'string') {
      personaMap[obj.postId] = obj.personaId;
    }
    if (typeof obj.personaId === 'string' && typeof obj.nickname === 'string') {
      personaCache[obj.personaId] = obj.nickname;
    }

    Object.values(obj).forEach(extractMappings);
  }

  // fetch monkey-patch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    try {
      if (url.includes('api.lounge.naver.com') && url.includes('/feed/')) {
        const cloned = response.clone();
        const data = await cloned.json();
        extractMappings(data);
        notifyContentScript();
        console.log(
          `[QuietLounge:MAIN] API 인터셉트 — ${Object.keys(personaMap).length}개 포스트 매핑`
        );
      }
    } catch {
      // 파싱 실패 무시
    }

    return response;
  };

  // 하이드레이션 스크립트 파싱 (DOM 준비 후)
  function parseHydrationData() {
    const scripts = document.querySelectorAll('script');
    let found = 0;

    scripts.forEach((script) => {
      const text = script.textContent;
      if (!text || text.length < 20) return;

      // postId → personaId (일반 JSON + escaped JSON 모두 대응)
      const postPattern = /\\?"postId\\?":\\?"([^"\\]+)\\?",\\?"personaId\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(postPattern)) {
        personaMap[m[1]] = m[2];
        found++;
      }

      // personaId가 postId보다 먼저 나오는 경우도 대응
      // (channelId 등 다른 필드가 사이에 끼어있는 경우)
      const reversePattern = /\\?"personaId\\?":\\?"([^"\\]+)\\?"[^}]*\\?"postId\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(reversePattern)) {
        personaMap[m[2]] = m[1];
        found++;
      }

      // personaId → nickname
      const personaPattern = /\\?"personaId\\?":\\?"([^"\\]+)\\?",\\?"nickname\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(personaPattern)) {
        personaCache[m[1]] = m[2];
      }
    });

    if (found > 0) {
      notifyContentScript();
      console.log(
        `[QuietLounge:MAIN] 하이드레이션 파싱 — ${Object.keys(personaMap).length}개 포스트, ${Object.keys(personaCache).length}개 페르소나`
      );
    }
  }

  // content script에서 매핑 데이터 요청 시 응답
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'QUIET_LOUNGE_REQUEST_DATA') {
      notifyContentScript();
    }
  });

  // DOM 준비 시 하이드레이션 파싱
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', parseHydrationData);
  } else {
    parseHydrationData();
  }

  console.log('[QuietLounge:MAIN] API 인터셉터 설치 완료 (document_start)');
})();
