// QuietLounge — Content Script (Chrome Extension)

(function () {
  'use strict';

  // ── URL 체크 ──
  function isActivePage() {
    const path = window.location.pathname;
    return path === '/' || path.startsWith('/posts') || path.startsWith('/channels');
  }

  // 홈/랭킹 페이지에서는 닉네임 자리에 채널명이 표시되므로 차단 버튼을 숨김
  // 필터링은 personaId 기반으로 정상 동작
  function isBlockButtonPage() {
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

  const STORAGE_KEY = 'quiet_lounge_data';

  // ── 유틸 ──
  function debounce(fn, delay) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  // ── 차단 목록 관리 ──
  function createEmptyData() {
    return {
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
    };
  }

  let blockData = createEmptyData();

  async function loadBlockData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (result[STORAGE_KEY]) {
          try {
            blockData = JSON.parse(result[STORAGE_KEY]);
          } catch {
            blockData = createEmptyData();
          }
        }
        resolve();
      });
    });
  }

  async function saveBlockData() {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { [STORAGE_KEY]: JSON.stringify(blockData) },
        resolve
      );
    });
  }

  function isBlockedByPersonaId(personaId) {
    return personaId in blockData.blockedUsers;
  }

  function isBlockedByNickname(nickname) {
    const byPersona = Object.values(blockData.blockedUsers).some(
      (u) => u.nickname === nickname
    );
    const byNickname = blockData.nicknameOnlyBlocks.some(
      (b) => b.nickname === nickname
    );
    return byPersona || byNickname;
  }

  async function blockUser(personaId, nickname, reason) {
    if (personaId) {
      const existing = blockData.blockedUsers[personaId];
      const previousNicknames = existing?.previousNicknames ?? [];
      if (existing && existing.nickname !== nickname) {
        previousNicknames.push(existing.nickname);
      }
      blockData.blockedUsers[personaId] = {
        personaId,
        nickname,
        previousNicknames,
        blockedAt: existing?.blockedAt ?? new Date().toISOString(),
        reason: reason || existing?.reason || '',
      };
      blockData.nicknameOnlyBlocks = blockData.nicknameOnlyBlocks.filter(
        (b) => b.nickname !== nickname
      );
    } else {
      if (isBlockedByNickname(nickname)) return;
      blockData.nicknameOnlyBlocks.push({
        nickname,
        blockedAt: new Date().toISOString(),
        reason: reason || '',
      });
    }
    await saveBlockData();
  }

  // ── API 인터셉터 (MAIN world에서 수신) ──
  // api-interceptor.js가 MAIN world에서 fetch를 patch하고,
  // postMessage로 personaMap/personaCache를 전달함
  const personaMap = new Map(); // postId → personaId
  const personaCache = new Map(); // personaId → { nickname }

  function installApiInterceptor() {
    // MAIN world(api-interceptor.js)에서 보내는 매핑 데이터 수신
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'QUIET_LOUNGE_API_DATA') return;

      const mapData = event.data.personaMap;
      const cacheData = event.data.personaCache;

      if (mapData && typeof mapData === 'object') {
        for (const [postId, personaId] of Object.entries(mapData)) {
          personaMap.set(postId, personaId);
        }
      }
      if (cacheData && typeof cacheData === 'object') {
        for (const [personaId, nickname] of Object.entries(cacheData)) {
          personaCache.set(personaId, { nickname });
        }
      }

      console.log(
        `[QuietLounge] 매핑 수신: ${personaMap.size}개 포스트, ${personaCache.size}개 페르소나`
      );

      filterAll();
      autoPromoteBlocks();
    });

    // MAIN world에 현재 수집된 데이터 요청 (이미 수집된 게 있을 수 있음)
    window.postMessage({ type: 'QUIET_LOUNGE_REQUEST_DATA' }, '*');
  }

  async function autoPromoteBlocks() {
    let changed = false;
    for (const [pid, { nickname }] of personaCache) {
      const idx = blockData.nicknameOnlyBlocks.findIndex(
        (b) => b.nickname === nickname
      );
      if (idx !== -1) {
        const block = blockData.nicknameOnlyBlocks.splice(idx, 1)[0];
        blockData.blockedUsers[pid] = {
          personaId: pid,
          nickname,
          previousNicknames: [],
          blockedAt: block.blockedAt,
          reason: block.reason,
        };
        changed = true;
      }
      if (
        blockData.blockedUsers[pid] &&
        blockData.blockedUsers[pid].nickname !== nickname
      ) {
        const user = blockData.blockedUsers[pid];
        user.previousNicknames.push(user.nickname);
        user.nickname = nickname;
        changed = true;
      }
    }
    if (changed) await saveBlockData();
  }

  // ── 필터 엔진 ──
  let totalBlocked = 0;

  function filterAll() {
    // /posts/** 또는 /channels/** 에서만 동작
    if (!isActivePage()) return;

    totalBlocked = 0;
    filterFeedPosts();
    filterCarouselCards();
    updateBadge();
  }

  function filterFeedPosts() {
    const postLinks = document.querySelectorAll(SEL.postLink);

    postLinks.forEach((link) => {
      const postId = link.getAttribute('href')?.replace('/posts/', '');
      const nicknameEl = link.querySelector(SEL.nickname);
      const nickname = nicknameEl?.textContent?.trim();

      if (!postId && !nickname) return;

      let isBlocked = false;
      if (postId) {
        const pid = personaMap.get(postId);
        if (pid) isBlocked = isBlockedByPersonaId(pid);
      }
      if (!isBlocked && nickname) {
        isBlocked = isBlockedByNickname(nickname);
      }

      const container =
        link.closest(SEL.postContainer) ||
        link.parentElement?.parentElement;
      if (!container) return;

      if (isBlocked) {
        totalBlocked++;
        container.style.display = 'none';
        const wrapper = container.parentElement;
        const separator = wrapper?.nextElementSibling;
        if (separator?.getAttribute?.('data-slot') === 'separator') {
          separator.style.display = 'none';
        }
      } else {
        container.style.display = '';
        const wrapper = container.parentElement;
        const separator = wrapper?.nextElementSibling;
        if (separator?.getAttribute?.('data-slot') === 'separator') {
          separator.style.display = '';
        }
      }
    });
  }

  function filterCarouselCards() {
    const cards = document.querySelectorAll(SEL.card);
    cards.forEach((card) => {
      const nickname = card
        .querySelector(SEL.nickname)
        ?.textContent?.trim();
      if (!nickname) return;

      const isBlocked = isBlockedByNickname(nickname);
      const item = card.closest(SEL.cardItem);
      if (!item) return;

      if (isBlocked) {
        totalBlocked++;
        item.style.display = 'none';
      } else {
        item.style.display = '';
      }
    });
  }

  function updateBadge() {
    chrome.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      count: totalBlocked,
    });
  }

  // ── UI Injector (차단 버튼) ──
  function injectBlockButtons() {
    // 홈(/)에서는 닉네임 자리에 채널명이 표시되므로 차단 버튼 미노출
    if (!isBlockButtonPage()) return;

    const profileNames = document.querySelectorAll(SEL.profileName);

    profileNames.forEach((el) => {
      if (el.querySelector('.quiet-lounge-btn')) return;

      const btn = document.createElement('button');
      btn.className = 'quiet-lounge-btn';
      btn.textContent = '\u2715';
      btn.title = '이 유저 차단';
      btn.style.cssText =
        'margin-left:6px;cursor:pointer;opacity:0.6;font-size:12px;border:1px solid rgba(255,80,80,0.3);background:rgba(255,80,80,0.08);padding:1px 5px;line-height:1.2;color:#ff5050;border-radius:4px;vertical-align:middle;transition:all 0.15s;position:relative;z-index:10;';

      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
        btn.style.background = 'rgba(255,80,80,0.2)';
        btn.style.borderColor = 'rgba(255,80,80,0.6)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.6';
        btn.style.background = 'rgba(255,80,80,0.08)';
        btn.style.borderColor = 'rgba(255,80,80,0.3)';
      });

      // mousedown/pointerdown 단계에서 이벤트 전파 차단
      // → 상위 <a> 태그의 클릭(페이지 이동)을 방지
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const nickname = el
          .querySelector('[data-slot="profile-name-label"] span.truncate')
          ?.textContent?.trim();
        if (!nickname) return;

        let pid;

        // 방법 1: 프로필 링크에서 personaId 직접 추출
        // 글 상세 페이지에서 작성자/댓글 프로필: <a href="/profiles/{personaId}">
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

        // 방법 3: 글 상세 페이지 — URL에서 postId 추출 → personaMap 조회
        if (!pid) {
          const pathMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
          if (pathMatch) {
            pid = personaMap.get(pathMatch[1]);
          }
        }

        console.log(`[QuietLounge] 차단 시도: nickname="${nickname}", personaId="${pid}", personaMap.size=${personaMap.size}`);

        if (confirm(`"${nickname}" 유저를 차단하시겠습니까?`)) {
          await blockUser(pid, nickname, '');
          filterAll();
          injectBlockButtons();
        }
      });

      el.appendChild(btn);
    });
  }

  // ── SPA 네비게이션 감지 ──
  // Next.js SPA이므로 URL 변경 시 재필터링 필요
  let lastPath = window.location.pathname;

  function watchNavigation() {
    // popstate (뒤로/앞으로)
    window.addEventListener('popstate', onNavigate);

    // pushState / replaceState 감시
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      origPushState.apply(this, args);
      onNavigate();
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      onNavigate();
    };
  }

  function onNavigate() {
    const newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;

    console.log(`[QuietLounge] 페이지 전환: ${newPath}`);

    if (isActivePage()) {
      // 약간의 딜레이 후 DOM이 준비되면 필터링
      setTimeout(() => {
        filterAll();
        injectBlockButtons();
      }, 500);
    }
  }

  // ── 스토리지 변경 감지 (popup에서 해제 시 반영) ──
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) {
      try {
        blockData = JSON.parse(changes[STORAGE_KEY].newValue);
      } catch {
        blockData = createEmptyData();
      }
      filterAll();
    }
  });

  // ── 초기화 ──
  async function init() {
    console.log('[QuietLounge] 초기화 시작');

    await loadBlockData();

    // API 인터셉터는 모든 페이지에서 설치 (personaId 수집은 어디서든)
    installApiInterceptor();

    // SPA 네비게이션 감시
    watchNavigation();

    // 현재 페이지가 활성 경로이면 필터링 시작
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  function start() {
    if (isActivePage()) {
      filterAll();
      injectBlockButtons();
    }

    // MutationObserver는 항상 설치 (SPA 전환 후 DOM 변경 대응)
    const target =
      document.querySelector(SEL.scrollContainer) || document.body;

    const debouncedUpdate = debounce(() => {
      if (isActivePage()) {
        filterAll();
        injectBlockButtons();
      }
    }, 200);

    const observer = new MutationObserver(debouncedUpdate);
    observer.observe(target, { childList: true, subtree: true });

    console.log('[QuietLounge] 초기화 완료');
  }

  init();
})();
