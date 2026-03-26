import type { BlockListData, FilterMode } from '@shared/types';

/**
 * fetch monkey-patch — injectedJavaScriptBeforeContentLoaded에 사용
 * API 인터셉트로 postId → personaId 매핑 수집
 */
export function buildBeforeScript(): string {
  return `
(function() {
  'use strict';
  if (window.__QL_BEFORE_INSTALLED) return;
  window.__QL_BEFORE_INSTALLED = true;

  // 전역 저장소
  window.__QL = {
    personaMap: {},    // postId → personaId
    personaCache: {},  // personaId → nickname
  };

  // fetch monkey-patch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const resp = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    try {
      if (url.includes('api.lounge.naver.com')) {
        const data = await resp.clone().json();
        extractMappings(data);
        // RN에 매핑 전송
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PERSONA_MAP_UPDATE',
            payload: {
              personaMap: window.__QL.personaMap,
              personaCache: window.__QL.personaCache,
            }
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

  // 하이드레이션 스크립트 파싱 (DOMContentLoaded 후)
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('script').forEach(function(s) {
      var t = s.textContent;
      if (!t) return;

      // 인접 패턴
      var regex1 = /\\\\"postId\\\\":\\\\"([^"\\\\]+)\\\\",\\\\"personaId\\\\":\\\\"([^"\\\\]+)\\\\"/g;
      var m;
      while ((m = regex1.exec(t)) !== null) {
        window.__QL.personaMap[m[1]] = m[2];
      }

      // 비인접 패턴
      var postIds = [];
      var pIds = [];
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
      while ((m = regex4.exec(t)) !== null) {
        window.__QL.personaCache[m[1]] = m[2];
      }
    });

    // DOM 프로필 링크에서 personaId 추출
    document.querySelectorAll('a[href^="/profiles/"]').forEach(function(link) {
      var pid = link.getAttribute('href')?.replace('/profiles/', '');
      var nick = link.textContent?.trim();
      if (pid && nick && pid.length >= 6) window.__QL.personaCache[pid] = nick;
    });

    // /posts/{postId} URL이면 작성자 personaId를 DOM에서 추출
    var urlMatch = window.location.pathname.match(/^\\/posts\\/([^/]+)/);
    if (urlMatch && !window.__QL.personaMap[urlMatch[1]]) {
      var authorLink = document.querySelector('[data-slot="profile-name"] a[href^="/profiles/"]');
      if (authorLink) {
        var authorPid = authorLink.getAttribute('href')?.replace('/profiles/', '');
        if (authorPid) window.__QL.personaMap[urlMatch[1]] = authorPid;
      }
    }

    // RN에 매핑 전송
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'PERSONA_MAP_UPDATE',
        payload: {
          personaMap: window.__QL.personaMap,
          personaCache: window.__QL.personaCache,
        }
      }));
    }

  });
})();
true;`;
}

/**
 * 필터링 + 차단 버튼 — injectedJavaScript에 사용
 * blockData와 filterMode를 주입받아 동작
 */
export function buildAfterScript(blockData: BlockListData, filterMode: FilterMode): string {
  const blockDataJSON = JSON.stringify(blockData);

  return `
(function() {
  'use strict';
  if (window.__QL_AFTER_INSTALLED) {
    // 이미 설치됨 — 데이터만 갱신
    window.__QL_BLOCK_DATA = ${blockDataJSON};
    window.__QL_FILTER_MODE = '${filterMode}';
    if (window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate();
    return;
  }
  window.__QL_AFTER_INSTALLED = true;

  window.__QL_BLOCK_DATA = ${blockDataJSON};
  window.__QL_FILTER_MODE = '${filterMode}';

  var SEL = {
    scrollContainer: '.infinite-scroll-component',
    postLink: 'a[href^="/posts/"]',
    postContainer: 'div.relative[tabindex]',
    nickname: '[data-slot="profile-name-label"] span.truncate',
    profileName: '[data-slot="profile-name"]',
    separator: '[data-slot="separator"]',
    card: '[data-slot="card"]',
    cardItem: '[data-slot="carousel-item"]',
  };

  function isActivePage() {
    var path = window.location.pathname;
    return path === '/' || path.startsWith('/posts') || path.startsWith('/channels');
  }

  function isBlockButtonPage() {
    var path = window.location.pathname;
    return path.startsWith('/posts') || path.startsWith('/channels');
  }

  function isBlocked(personaId, nickname) {
    var d = window.__QL_BLOCK_DATA;
    if (!d) return false;
    if (personaId && d.blockedUsers && d.blockedUsers[personaId]) return true;
    if (nickname) {
      var users = d.blockedUsers || {};
      for (var key in users) {
        if (users[key].nickname === nickname) return true;
      }
      var nbs = d.nicknameOnlyBlocks || [];
      for (var i = 0; i < nbs.length; i++) {
        if (nbs[i].nickname === nickname) return true;
      }
    }
    return false;
  }

  function applyStyle(el, blocked) {
    if (!el) return;
    var mode = window.__QL_FILTER_MODE || 'hide';
    if (blocked) {
      if (mode === 'blur') {
        el.style.filter = 'blur(5px)';
        el.style.opacity = '0.3';
        el.style.pointerEvents = 'none';
        el.style.display = '';
      } else {
        el.style.display = 'none';
        el.style.filter = '';
        el.style.opacity = '';
        el.style.pointerEvents = '';
      }
    } else {
      el.style.display = '';
      el.style.filter = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    }
  }

  var blockedCount = 0;

  function filterAll() {
    if (!isActivePage()) return;
    blockedCount = 0;
    var ql = window.__QL || { personaMap: {} };

    document.querySelectorAll(SEL.postLink).forEach(function(link) {
      var postId = link.getAttribute('href')?.replace('/posts/', '');
      var nickname = link.querySelector(SEL.nickname)?.textContent?.trim();
      var pid = postId ? ql.personaMap[postId] : undefined;

      var container = link.closest(SEL.postContainer) || link.parentElement?.parentElement;
      if (!container) return;

      var blocked = isBlocked(pid, nickname);
      if (blocked) blockedCount++;
      applyStyle(container, blocked);

      var sep = container.parentElement?.nextElementSibling;
      if (sep?.getAttribute?.('data-slot') === 'separator') {
        applyStyle(sep, blocked);
      }
    });

    document.querySelectorAll(SEL.card).forEach(function(card) {
      var nickname = card.querySelector(SEL.nickname)?.textContent?.trim();
      if (nickname && isBlocked(undefined, nickname)) {
        blockedCount++;
        var item = card.closest(SEL.cardItem);
        if (item) applyStyle(item, true);
      }
    });
  }

  function createBlockBtn(onClickHandler) {
    var btn = document.createElement('button');
    btn.className = 'ql-btn';
    btn.textContent = '\\u2715';
    btn.title = '이 유저 차단';
    btn.style.cssText = 'margin-left:6px;cursor:pointer;opacity:0.5;font-size:16px;border:none;background:rgba(200,50,50,0.12);padding:4px 8px;color:#e74c3c;border-radius:4px;transition:opacity 0.15s;line-height:1;min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center;';
    btn.ontouchstart = function() { btn.style.opacity = '1'; btn.style.background = 'rgba(200,50,50,0.25)'; };
    btn.ontouchend = function() { btn.style.opacity = '0.5'; btn.style.background = 'rgba(200,50,50,0.12)'; };
    btn.onclick = onClickHandler;
    return btn;
  }

  function findPersonaId(container) {
    var ql = window.__QL || { personaMap: {} };
    var pid;

    // 방법 1: 프로필 링크에서 personaId 직접 추출
    var profileLink = container.querySelector('a[href^="/profiles/"]');
    if (profileLink) {
      pid = profileLink.getAttribute('href')?.replace('/profiles/', '');
    }

    // 방법 2: postLink에서 postId → personaMap 조회
    if (!pid) {
      var postLink = container.closest('a[href^="/posts/"]') ||
        container.querySelector('a[href^="/posts/"]') ||
        container.closest('div.relative[tabindex]')?.querySelector('a[href^="/posts/"]');
      if (postLink) {
        var postId = postLink.getAttribute('href')?.replace('/posts/', '');
        if (postId) pid = ql.personaMap[postId];
      }
    }

    // 방법 3: URL에서 postId → personaMap
    if (!pid) {
      var pathMatch = window.location.pathname.match(/^\\/posts\\/([^/]+)/);
      if (pathMatch) pid = ql.personaMap[pathMatch[1]];
    }

    return pid;
  }

  function sendBlockMessage(pid, nickname) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'BLOCK_USER',
        payload: { personaId: pid || null, nickname: nickname }
      }));
    }
  }

  function injectButtons() {
    if (!isBlockButtonPage()) return;

    // 방법 A: data-slot="profile-name"이 있는 게시글 (피드, 글 상세)
    document.querySelectorAll(SEL.profileName).forEach(function(el) {
      if (el.querySelector('.ql-btn')) return;

      var btn = createBlockBtn(function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var nickname = el.querySelector('[data-slot="profile-name-label"] span.truncate')?.textContent?.trim();
        if (!nickname) return;

        var pid = findPersonaId(el);
        sendBlockMessage(pid, nickname);
      });
      el.appendChild(btn);
    });

    // 방법 B: data-slot="profile-name"이 없는 게시글 (주간 베스트 등)
    // postContainer 안에 postLink가 있지만 profile-name이 없는 경우
    document.querySelectorAll(SEL.postContainer).forEach(function(container) {
      if (container.querySelector('.ql-btn')) return;
      if (container.querySelector(SEL.profileName)) return; // 방법 A에서 처리됨

      var postLink = container.querySelector(SEL.postLink) ||
        container.closest(SEL.postLink);
      if (!postLink) return;

      var btn = createBlockBtn(function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var pid = findPersonaId(container);
        var ql = window.__QL || { personaCache: {} };
        var nickname = pid ? ql.personaCache[pid] : null;

        if (!pid) {
          return;
        }

        sendBlockMessage(pid, nickname || 'Unknown');
      });

      // 컨테이너의 첫 번째 자식 행에 버튼 추가
      var firstRow = container.querySelector('a > div');
      if (firstRow) {
        firstRow.appendChild(btn);
      } else {
        container.appendChild(btn);
      }
    });
  }

  // RN에서 호출할 수 있는 함수들
  window.__QL_onBlockListUpdate = function() {
    filterAll();
    injectButtons();
  };

  window.__QL_setFilterMode = function(mode) {
    window.__QL_FILTER_MODE = mode;
    filterAll();
  };

  // SPA 네비게이션 감지
  var lastPath = window.location.pathname;

  function onNavigate() {
    var newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'PAGE_CHANGED',
        payload: { path: newPath }
      }));
    }

    if (isActivePage()) {
      setTimeout(function() {
        filterAll();
        injectButtons();
      }, 500);
    }
  }

  window.addEventListener('popstate', onNavigate);
  var origPush = history.pushState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    onNavigate();
  };
  var origReplace = history.replaceState;
  history.replaceState = function() {
    origReplace.apply(this, arguments);
    onNavigate();
  };

  // 초기 실행
  if (isActivePage()) {
    filterAll();
    injectButtons();
  }

  // MutationObserver
  var timer;
  var debounced = function() {
    clearTimeout(timer);
    timer = setTimeout(function() {
      if (isActivePage()) {
        filterAll();
        injectButtons();
      }
    }, 200);
  };
  var target = document.querySelector(SEL.scrollContainer) || document.body;
  new MutationObserver(debounced).observe(target, { childList: true, subtree: true });

})();
true;`;
}

/**
 * 차단 목록 업데이트를 WebView에 push하는 스크립트
 */
export function buildBlockListUpdateScript(blockData: BlockListData): string {
  return `
    window.__QL_BLOCK_DATA = ${JSON.stringify(blockData)};
    if (window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate();
    true;
  `;
}

/**
 * 필터 모드 변경 스크립트
 */
export function buildFilterModeScript(mode: FilterMode): string {
  return `
    if (window.__QL_setFilterMode) window.__QL_setFilterMode('${mode}');
    true;
  `;
}
