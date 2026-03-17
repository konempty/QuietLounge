// ==UserScript==
// @name         QuietLounge (Tampermonkey 테스트)
// @namespace    quiet-lounge
// @version      1.0.0
// @description  네이버 라운지 유저 차단 도구 (테스트용)
// @author       QuietLounge
// @match        https://lounge.naver.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── URL 체크: /posts/** 또는 /channels/** 에서만 동작 ──
  function isActivePage() {
    const path = window.location.pathname;
    return path.startsWith('/posts') || path.startsWith('/channels');
  }

  // ── 셀렉터 ──
  const SEL = {
    scrollContainer: '.infinite-scroll-component',
    postLink: 'a[href^="/posts/"]',
    postContainer: 'div.relative[tabindex]',
    nickname: '[data-slot="profile-name-label"] span.truncate',
    profileName: '[data-slot="profile-name"]',
    separator: '[data-slot="separator"]',
    card: '[data-slot="card"]',
    cardItem: '[data-slot="carousel-item"]',
  };

  // ── 차단 데이터 ──
  function createEmpty() {
    return { version: 2, blockedUsers: {}, nicknameOnlyBlocks: [], personaCache: {} };
  }

  let data = createEmpty();
  try {
    const raw = GM_getValue('quiet_lounge_data', null);
    if (raw) data = JSON.parse(raw);
  } catch { /* ignore */ }

  function save() {
    GM_setValue('quiet_lounge_data', JSON.stringify(data));
  }

  function isBlocked(personaId, nickname) {
    if (personaId && data.blockedUsers[personaId]) return true;
    if (nickname) {
      if (Object.values(data.blockedUsers).some((u) => u.nickname === nickname)) return true;
      if (data.nicknameOnlyBlocks.some((b) => b.nickname === nickname)) return true;
    }
    return false;
  }

  function blockUser(personaId, nickname) {
    if (personaId) {
      data.blockedUsers[personaId] = {
        personaId,
        nickname,
        previousNicknames: [],
        blockedAt: new Date().toISOString(),
        reason: '',
      };
      data.nicknameOnlyBlocks = data.nicknameOnlyBlocks.filter((b) => b.nickname !== nickname);
    } else {
      if (!data.nicknameOnlyBlocks.some((b) => b.nickname === nickname)) {
        data.nicknameOnlyBlocks.push({
          nickname,
          blockedAt: new Date().toISOString(),
          reason: '',
        });
      }
    }
    save();
  }

  // ── personaId 수집 ──
  const personaMap = new Map(); // postId → personaId
  const personaCache = new Map(); // personaId → nickname

  function parseInitialData() {
    document.querySelectorAll('script').forEach((s) => {
      const t = s.textContent;
      if (!t) return;

      // 인접 패턴
      for (const m of t.matchAll(
        /\\?"postId\\?":\\?"([^"\\]+)\\?",\\?"personaId\\?":\\?"([^"\\]+)\\?"/g
      )) {
        personaMap.set(m[1], m[2]);
      }

      // 비인접 패턴 (글 상세 하이드레이션 — postId, personaId가 별도 줄)
      const postIds = [...t.matchAll(/\\?"postId\\?":\\?"([^"\\]+)\\?"/g)];
      const pIds = [...t.matchAll(/\\?"personaId\\?":\\?"([^"\\]+)\\?"/g)];
      for (const pm of postIds) {
        if (personaMap.has(pm[1])) continue;
        let closest = null, dist = Infinity;
        for (const pi of pIds) {
          const d = pi.index - pm.index;
          if (d > 0 && d < dist && d < 200) { dist = d; closest = pi[1]; }
        }
        if (closest) personaMap.set(pm[1], closest);
      }

      for (const m of t.matchAll(
        /\\?"personaId\\?":\\?"([^"\\]+)\\?",\\?"nickname\\?":\\?"([^"\\]+)\\?"/g
      )) {
        personaCache.set(m[1], m[2]);
      }
    });

    // DOM 프로필 링크에서 personaId 추출 (글 상세 페이지)
    document.querySelectorAll('a[href^="/profiles/"]').forEach((link) => {
      const pid = link.getAttribute('href')?.replace('/profiles/', '');
      const nick = link.textContent?.trim();
      if (pid && nick && pid.length >= 6) personaCache.set(pid, nick);
    });

    // /posts/{postId} URL이면 작성자 personaId를 DOM에서 추출
    const urlMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
    if (urlMatch && !personaMap.has(urlMatch[1])) {
      const authorLink = document.querySelector(
        '[data-slot="profile-name"] a[href^="/profiles/"]'
      );
      if (authorLink) {
        const authorPid = authorLink.getAttribute('href')?.replace('/profiles/', '');
        if (authorPid) personaMap.set(urlMatch[1], authorPid);
      }
    }

    console.log(`[QL] 초기: ${personaMap.size} posts, ${personaCache.size} personas`);
  }

  // fetch monkey-patch (Tampermonkey는 page world 직접 접근 가능)
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    try {
      if (url.includes('api.lounge.naver.com') && url.includes('/feed/')) {
        const d = await resp.clone().json();
        extractMappings(d);
      }
    } catch { /* ignore */ }
    return resp;
  };

  function extractMappings(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(extractMappings);
      return;
    }
    if (typeof obj.postId === 'string' && typeof obj.personaId === 'string')
      personaMap.set(obj.postId, obj.personaId);
    if (typeof obj.personaId === 'string' && typeof obj.nickname === 'string')
      personaCache.set(obj.personaId, obj.nickname);
    Object.values(obj).forEach(extractMappings);
  }

  // ── 필터링 ──
  let blockedCount = 0;

  function filterAll() {
    if (!isActivePage()) return;

    blockedCount = 0;

    document.querySelectorAll(SEL.postLink).forEach((link) => {
      const postId = link.getAttribute('href')?.replace('/posts/', '');
      const nickname = link.querySelector(SEL.nickname)?.textContent?.trim();
      const pid = postId ? personaMap.get(postId) : undefined;

      const container =
        link.closest(SEL.postContainer) || link.parentElement?.parentElement;
      if (!container) return;

      if (isBlocked(pid, nickname)) {
        blockedCount++;
        container.style.display = 'none';
        const sep = container.parentElement?.nextElementSibling;
        if (sep?.getAttribute?.('data-slot') === 'separator')
          sep.style.display = 'none';
      } else {
        container.style.display = '';
        const sep = container.parentElement?.nextElementSibling;
        if (sep?.getAttribute?.('data-slot') === 'separator')
          sep.style.display = '';
      }
    });

    document.querySelectorAll(SEL.card).forEach((card) => {
      const nickname = card.querySelector(SEL.nickname)?.textContent?.trim();
      if (nickname && isBlocked(undefined, nickname)) {
        blockedCount++;
        const item = card.closest(SEL.cardItem);
        if (item) item.style.display = 'none';
      }
    });
  }

  // ── 차단 버튼 inject ──
  function injectButtons() {
    if (!isActivePage()) return;

    document.querySelectorAll(SEL.profileName).forEach((el) => {
      if (el.querySelector('.ql-btn')) return;

      const btn = document.createElement('button');
      btn.className = 'ql-btn';
      btn.textContent = '\u2715';
      btn.title = '이 유저 차단';
      btn.style.cssText =
        'margin-left:4px;cursor:pointer;opacity:0.3;font-size:11px;border:none;background:none;padding:0 2px;color:inherit;transition:opacity 0.15s;';
      btn.onmouseenter = () => (btn.style.opacity = '0.8');
      btn.onmouseleave = () => (btn.style.opacity = '0.3');
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const nickname = el
          .querySelector('[data-slot="profile-name-label"] span.truncate')
          ?.textContent?.trim();
        if (!nickname) return;

        let pid;

        // 방법 1: 프로필 링크에서 personaId 직접 추출 (글 상세 페이지)
        const profileLink =
          el.querySelector('a[href^="/profiles/"]') ||
          el.closest('[data-slot="profile-name"]')?.querySelector('a[href^="/profiles/"]');
        if (profileLink) {
          pid = profileLink.getAttribute('href')?.replace('/profiles/', '');
        }

        // 방법 2: 피드 목록 — postLink에서 postId → personaMap 조회
        if (!pid) {
          const postLink =
            el.closest('a[href^="/posts/"]') ||
            el.closest('div.relative[tabindex]')?.querySelector('a[href^="/posts/"]');
          if (postLink) {
            const postId = postLink.getAttribute('href')?.replace('/posts/', '');
            if (postId) pid = personaMap.get(postId);
          }
        }

        // 방법 3: 글 상세 페이지 — URL에서 postId → personaMap
        if (!pid) {
          const pathMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
          if (pathMatch) pid = personaMap.get(pathMatch[1]);
        }

        console.log(`[QL] 차단 시도: nickname="${nickname}", personaId="${pid}"`);

        if (confirm(`"${nickname}" 유저를 차단하시겠습니까?`)) {
          blockUser(pid, nickname);
          filterAll();
          injectButtons();
        }
      };
      el.appendChild(btn);
    });
  }

  // ── SPA 네비게이션 감지 ──
  let lastPath = window.location.pathname;

  function watchNavigation() {
    window.addEventListener('popstate', onNavigate);

    const origPush = history.pushState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      onNavigate();
    };
    const origReplace = history.replaceState;
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      onNavigate();
    };
  }

  function onNavigate() {
    const newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;

    if (isActivePage()) {
      setTimeout(() => {
        filterAll();
        injectButtons();
      }, 500);
    }
  }

  // ── 초기화 ──
  parseInitialData();
  watchNavigation();

  if (isActivePage()) {
    filterAll();
    injectButtons();
  }

  let timer;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (isActivePage()) {
        filterAll();
        injectButtons();
      }
    }, 200);
  };
  const target = document.querySelector(SEL.scrollContainer) || document.body;
  new MutationObserver(debounced).observe(target, {
    childList: true,
    subtree: true,
  });

  console.log(
    `[QL] 초기화 완료 — 차단 ${Object.keys(data.blockedUsers).length + data.nicknameOnlyBlocks.length}명`
  );
})();
