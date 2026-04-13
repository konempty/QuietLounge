// QuietLounge — before.js (document_start)
// fetch monkey-patch 로 API 응답에서 postId → personaId 매핑을 수집해
// window.__QL 에 저장하고 네이티브 브릿지(window.QuietLounge.postMessage)로 push.
//
// react-native-webview 의 ReactNativeWebView.postMessage 대신 Android WebView 의
// JavascriptInterface 인 window.QuietLounge.postMessage(string) 을 사용.

(function () {
  'use strict';
  if (window.__QL_BEFORE_INSTALLED) return;
  window.__QL_BEFORE_INSTALLED = true;

  window.__QL = {
    personaMap: {}, // postId → personaId
    personaCache: {}, // personaId → nickname
  };

  function postNative(payload) {
    try {
      if (window.QuietLounge && typeof window.QuietLounge.postMessage === 'function') {
        window.QuietLounge.postMessage(JSON.stringify(payload));
      }
    } catch (e) {
      // 무시
    }
  }

  function pushPersonaMap() {
    postNative({
      type: 'PERSONA_MAP_UPDATE',
      payload: {
        personaMap: window.__QL.personaMap,
        personaCache: window.__QL.personaCache,
      },
    });
  }

  function extractMappings(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(extractMappings);
      return;
    }
    if (typeof obj.postId === 'string' && typeof obj.personaId === 'string') {
      window.__QL.personaMap[obj.postId] = obj.personaId;
    }
    if (typeof obj.personaId === 'string' && typeof obj.nickname === 'string') {
      window.__QL.personaCache[obj.personaId] = obj.nickname;
    }
    Object.values(obj).forEach(extractMappings);
  }

  // fetch monkey-patch
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    try {
      if (url.includes('api.lounge.naver.com')) {
        const data = await resp.clone().json();
        extractMappings(data);
        pushPersonaMap();
      }
    } catch (e) {
      // 무시
    }
    return resp;
  };

  // 하이드레이션 스크립트 파싱
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('script').forEach(function (s) {
      const t = s.textContent;
      if (!t) return;

      // 인접 패턴 ("postId":"x","personaId":"y")
      const regex1 = /\\"postId\\":\\"([^"\\]+)\\",\\"personaId\\":\\"([^"\\]+)\\"/g;
      let m;
      while ((m = regex1.exec(t)) !== null) {
        window.__QL.personaMap[m[1]] = m[2];
      }

      // 비인접 패턴 — postId 위치와 가장 가까운 personaId 매칭
      const postIds = [];
      const pIds = [];
      const regex2 = /\\"postId\\":\\"([^"\\]+)\\"/g;
      const regex3 = /\\"personaId\\":\\"([^"\\]+)\\"/g;
      while ((m = regex2.exec(t)) !== null) postIds.push({ id: m[1], idx: m.index });
      while ((m = regex3.exec(t)) !== null) pIds.push({ id: m[1], idx: m.index });

      postIds.forEach(function (pm) {
        if (window.__QL.personaMap[pm.id]) return;
        let closest = null;
        let dist = Infinity;
        pIds.forEach(function (pi) {
          const d = pi.idx - pm.idx;
          if (d > 0 && d < dist && d < 200) {
            dist = d;
            closest = pi.id;
          }
        });
        if (closest) window.__QL.personaMap[pm.id] = closest;
      });

      const regex4 = /\\"personaId\\":\\"([^"\\]+)\\",\\"nickname\\":\\"([^"\\]+)\\"/g;
      while ((m = regex4.exec(t)) !== null) {
        window.__QL.personaCache[m[1]] = m[2];
      }
    });

    // DOM 프로필 링크에서 personaId-닉네임 추출
    document.querySelectorAll('a[href^="/profiles/"]').forEach(function (link) {
      const pid = link.getAttribute('href')?.replace('/profiles/', '');
      const nick = link.textContent?.trim();
      if (pid && nick && pid.length >= 6) {
        window.__QL.personaCache[pid] = nick;
      }
    });

    // /posts/{postId} URL 이면 작성자 personaId DOM 추출
    const urlMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
    if (urlMatch && !window.__QL.personaMap[urlMatch[1]]) {
      const authorLink = document.querySelector(
        '[data-slot="profile-name"] a[href^="/profiles/"]',
      );
      if (authorLink) {
        const authorPid = authorLink.getAttribute('href')?.replace('/profiles/', '');
        if (authorPid) window.__QL.personaMap[urlMatch[1]] = authorPid;
      }
    }

    pushPersonaMap();
  });
})();
true;
