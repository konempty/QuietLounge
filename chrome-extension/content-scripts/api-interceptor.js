// QuietLounge — API Interceptor (MAIN world, document_start)
// CSP 우회를 위해 manifest.json에서 world: "MAIN"으로 실행
// fetch monkey-patch로 피드 API 응답에서 postId → personaId 매핑 수집

(function () {
  'use strict';

  // 매핑 저장소 (page world 전역)
  const personaMap = {}; // postId → personaId
  const personaCache = {}; // personaId → nickname

  // content script(ISOLATED world)로 데이터 전달
  function notifyContentScript() {
    window.postMessage(
      {
        type: 'QUIET_LOUNGE_API_DATA',
        personaMap: personaMap,
        personaCache: personaCache,
      },
      '*',
    );
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
      if (url.includes('api.lounge.naver.com')) {
        const cloned = response.clone();
        const data = await cloned.json();
        extractMappings(data);
        notifyContentScript();
        console.log(
          `[QuietLounge:MAIN] API 인터셉트 — ${Object.keys(personaMap).length}개 포스트 매핑`,
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

      // 패턴 1: postId, personaId가 인접한 경우 (피드 API 응답)
      // "postId":"xxx","personaId":"yyy" 또는 escaped 버전
      const adjacentPattern =
        /\\?"postId\\?":\\?"([^"\\]+)\\?",\\?"personaId\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(adjacentPattern)) {
        personaMap[m[1]] = m[2];
        found++;
      }

      // 패턴 2: postId, personaId가 인접하지 않은 경우 (글 상세 하이드레이션)
      // Next.js RSC에서 \"postId\":\"xxx\"\n\"personaId\":\"yyy\" 형태로 별도 줄에 올 수 있음
      const separatePostIds = [...text.matchAll(/\\?"postId\\?":\\?"([^"\\]+)\\?"/g)];
      const separatePersonaIds = [...text.matchAll(/\\?"personaId\\?":\\?"([^"\\]+)\\?"/g)];

      // 인접 패턴으로 매칭된 것 외에 나머지를 위치 기반으로 매칭
      if (separatePostIds.length > 0 && separatePersonaIds.length > 0) {
        for (const postMatch of separatePostIds) {
          if (personaMap[postMatch[1]]) continue; // 이미 매칭됨

          // 이 postId 뒤에 가장 가까운 personaId를 찾음
          let closestPersona = null;
          let closestDist = Infinity;
          for (const personaMatch of separatePersonaIds) {
            const dist = personaMatch.index - postMatch.index;
            if (dist > 0 && dist < closestDist && dist < 200) {
              closestDist = dist;
              closestPersona = personaMatch[1];
            }
          }
          if (closestPersona) {
            personaMap[postMatch[1]] = closestPersona;
            found++;
          }
        }
      }

      // personaId → nickname
      const personaPattern =
        /\\?"personaId\\?":\\?"([^"\\]+)\\?",\\?"nickname\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(personaPattern)) {
        personaCache[m[1]] = m[2];
      }
    });

    // DOM에서 프로필 링크 파싱 (글 상세 페이지)
    // <a href="/profiles/{personaId}">닉네임</a>
    const profileLinks = document.querySelectorAll('a[href^="/profiles/"]');
    profileLinks.forEach((link) => {
      const pid = link.getAttribute('href')?.replace('/profiles/', '');
      const nickname = link.textContent?.trim();
      if (pid && nickname && pid.length >= 6) {
        personaCache[pid] = nickname;
      }
    });

    // 현재 URL이 /posts/{postId}이고 personaMap에 없으면, DOM에서 작성자 personaId 추출
    const urlMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
    if (urlMatch) {
      const currentPostId = urlMatch[1];
      if (!personaMap[currentPostId]) {
        // 글 상세 페이지의 첫 번째 프로필 링크가 작성자
        const authorLink = document.querySelector(
          '[data-slot="profile-name"] a[href^="/profiles/"]',
        );
        if (authorLink) {
          const authorPid = authorLink.getAttribute('href')?.replace('/profiles/', '');
          if (authorPid) {
            personaMap[currentPostId] = authorPid;
            found++;
          }
        }
      }
    }

    if (found > 0 || profileLinks.length > 0) {
      notifyContentScript();
      console.log(
        `[QuietLounge:MAIN] 하이드레이션 파싱 — ${Object.keys(personaMap).length}개 포스트, ${Object.keys(personaCache).length}개 페르소나`,
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
