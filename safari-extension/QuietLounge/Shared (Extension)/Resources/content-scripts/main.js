// QuietLounge — Content Script (Chrome Extension)

(function () {
  const browser = globalThis.browser || globalThis.chrome;
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
    postContainer: '.relative[tabindex]',
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

  const FILTER_MODE_KEY = 'quiet_lounge_filter_mode';
  let blockData = createEmptyData();
  let filterMode = 'hide'; // 'hide' or 'blur'

  // Safari quota 버그 대응: 기존 키 삭제 후 저장
  async function safariSet(data) {
    try {
      await browser.storage.local.remove(Object.keys(data));
      await browser.storage.local.set(data);
    } catch {
      // 저장 실패 무시
    }
  }

  async function loadBlockData() {
    try {
      const result = await browser.storage.local.get([STORAGE_KEY, FILTER_MODE_KEY]);
      if (result[STORAGE_KEY]) {
        blockData = JSON.parse(result[STORAGE_KEY]);
      }
      if (result[FILTER_MODE_KEY]) {
        filterMode = result[FILTER_MODE_KEY];
      }
    } catch {
      blockData = createEmptyData();
    }
  }

  async function saveBlockData() {
    const toSave = {
      version: blockData.version || 2,
      blockedUsers: blockData.blockedUsers || {},
      nicknameOnlyBlocks: blockData.nicknameOnlyBlocks || [],
      personaCache: {},
    };
    await safariSet({ [STORAGE_KEY]: JSON.stringify(toSave) });
  }

  function isBlocked(personaId, nickname) {
    if (personaId && blockData.blockedUsers[personaId]) return true;
    if (nickname) {
      if (Object.values(blockData.blockedUsers).some((u) => u.nickname === nickname)) return true;
      if (blockData.nicknameOnlyBlocks.some((b) => b.nickname === nickname)) return true;
    }
    return false;
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
        (b) => b.nickname !== nickname,
      );
    } else {
      if (isBlocked(undefined, nickname)) return;
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

      filterAll();
      autoPromoteBlocks();
    });

    // MAIN world에 현재 수집된 데이터 요청 (이미 수집된 게 있을 수 있음)
    window.postMessage({ type: 'QUIET_LOUNGE_REQUEST_DATA' }, '*');
  }

  async function autoPromoteBlocks() {
    let changed = false;
    for (const [pid, { nickname }] of personaCache) {
      const idx = blockData.nicknameOnlyBlocks.findIndex((b) => b.nickname === nickname);
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
      if (blockData.blockedUsers[pid] && blockData.blockedUsers[pid].nickname !== nickname) {
        const user = blockData.blockedUsers[pid];
        user.previousNicknames.push(user.nickname);
        user.nickname = nickname;
        changed = true;
      }
    }
    if (changed) await saveBlockData();
  }

  // ── 스타일 적용 ──
  function applyBlockStyle(el) {
    if (!el) return;
    if (filterMode === 'blur') {
      el.style.display = '';
      el.style.filter = 'blur(5px)';
      el.style.opacity = '0.3';
      el.style.pointerEvents = 'none';
    } else {
      el.style.display = 'none';
      el.style.filter = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    }
  }

  function clearBlockStyle(el) {
    if (!el) return;
    el.style.display = '';
    el.style.filter = '';
    el.style.opacity = '';
    el.style.pointerEvents = '';
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

      const pid = postId ? personaMap.get(postId) : undefined;
      const blocked = isBlocked(pid, nickname);

      const container = link.closest(SEL.postContainer) || link.parentElement?.parentElement;
      if (!container) return;

      if (blocked) {
        totalBlocked++;
        applyBlockStyle(container);
        const wrapper = container.parentElement;
        const separator = wrapper?.nextElementSibling;
        if (separator?.getAttribute?.('data-slot') === 'separator') {
          applyBlockStyle(separator);
        }
      } else {
        clearBlockStyle(container);
        const wrapper = container.parentElement;
        const separator = wrapper?.nextElementSibling;
        if (separator?.getAttribute?.('data-slot') === 'separator') {
          clearBlockStyle(separator);
        }
      }
    });
  }

  function filterCarouselCards() {
    const cards = document.querySelectorAll(SEL.card);
    cards.forEach((card) => {
      const nickname = card.querySelector(SEL.nickname)?.textContent?.trim();
      if (!nickname) return;

      const blocked = isBlocked(undefined, nickname);
      const item = card.closest(SEL.cardItem);
      if (!item) return;

      if (blocked) {
        totalBlocked++;
        applyBlockStyle(item);
      } else {
        clearBlockStyle(item);
      }
    });
  }

  function updateBadge() {
    browser.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      count: totalBlocked,
    });
  }

  // ── UI Injector (차단 버튼) ──
  function findPersonaId(container) {
    let pid;

    // 방법 1: 프로필 링크에서 personaId 직접 추출
    const profileLink = container.querySelector('a[href^="/profiles/"]');
    if (profileLink) {
      pid = profileLink.getAttribute('href')?.replace('/profiles/', '');
    }

    // 방법 2: postLink에서 postId → personaMap 조회
    if (!pid) {
      const postLink =
        container.closest('a[href^="/posts/"]') ||
        container.querySelector('a[href^="/posts/"]') ||
        container.closest('.relative[tabindex]')?.querySelector('a[href^="/posts/"]');
      if (postLink) {
        const postId = postLink.getAttribute('href')?.replace('/posts/', '');
        if (postId) pid = personaMap.get(postId);
      }
    }

    // 방법 3: URL에서 postId → personaMap
    if (!pid) {
      const pathMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
      if (pathMatch) pid = personaMap.get(pathMatch[1]);
    }

    return pid;
  }

  // ── 커스텀 확인 다이얼로그 (iOS Safari에서 confirm() 억제 대응) ──
  function qlConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText = 'background:#1a1a1a;color:#e0e0e0;border-radius:14px;padding:20px;max-width:300px;width:90%;text-align:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.4);';

      const msg = document.createElement('p');
      msg.textContent = message;
      msg.style.cssText = 'font-size:15px;margin:0 0 18px;line-height:1.4;';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '취소';
      cancelBtn.style.cssText = 'flex:1;padding:10px;border:1px solid #444;background:transparent;color:#aaa;border-radius:8px;font-size:14px;cursor:pointer;';

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '차단';
      confirmBtn.style.cssText = 'flex:1;padding:10px;border:none;background:#e74c3c;color:#fff;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); close(false); });
      confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); close(true); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      dialog.appendChild(msg);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  function createBlockBtn() {
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

    btn.addEventListener(
      'mousedown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true,
    );
    btn.addEventListener(
      'pointerdown',
      (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true,
    );

    return btn;
  }

  // 살아있는 핸들러가 있는 버튼 추적 (bfcache 복원 시 WeakSet은 초기화됨)
  const liveButtons = new WeakSet();

  function injectBlockButtons() {
    if (!isBlockButtonPage()) return;

    // 방법 A: data-slot="profile-name"이 있는 게시글 (피드, 글 상세)
    document.querySelectorAll(SEL.profileName).forEach((el) => {
      const existing = el.querySelector('.quiet-lounge-btn');
      if (existing && liveButtons.has(existing)) return; // 핸들러 살아있음
      if (existing) existing.remove(); // bfcache로 복원된 죽은 버튼

      const btn = createBlockBtn();
      liveButtons.add(btn);
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const nickname = el
          .querySelector('[data-slot="profile-name-label"] span.truncate')
          ?.textContent?.trim();
        if (!nickname) return;

        const pid = findPersonaId(el);

        if (await qlConfirm(`"${nickname}" 유저를 차단하시겠습니까?`)) {
          await blockUser(pid, nickname, '');
          filterAll();
          injectBlockButtons();
        }
      });

      el.appendChild(btn);
    });

    // 방법 B: data-slot="profile-name"이 없는 게시글 (주간 베스트 등)
    document.querySelectorAll(SEL.postContainer).forEach((container) => {
      if (container.querySelector(SEL.profileName)) return; // 방법 A에서 처리됨

      const existing = container.querySelector('.quiet-lounge-btn');
      if (existing && liveButtons.has(existing)) return;
      if (existing) existing.remove();

      const postLink = container.querySelector(SEL.postLink) || container.closest(SEL.postLink);
      if (!postLink) return;

      const btn = createBlockBtn();
      liveButtons.add(btn);
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pid = findPersonaId(container);
        const nickname = pid ? personaCache.get(pid) : null;

        if (!pid) {
          await qlConfirm('personaId를 찾을 수 없습니다. 글 상세 페이지에서 차단해주세요.');
          return;
        }

        if (await qlConfirm(`"${nickname || pid}" 유저를 차단하시겠습니까?`)) {
          await blockUser(pid, nickname || '', '');
          filterAll();
          injectBlockButtons();
        }
      });

      const firstRow = container.querySelector('a > div');
      if (firstRow) {
        firstRow.appendChild(btn);
      } else {
        container.appendChild(btn);
      }
    });
  }

  // ── SPA 네비게이션 감지 ──
  // Next.js SPA이므로 URL 변경 시 재필터링 필요
  let lastPath = window.location.pathname;

  function watchNavigation() {
    // popstate (뒤로/앞으로)
    window.addEventListener('popstate', onNavigate);

    // bfcache 복원 감지 (iOS Safari)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        lastPath = '';
        onNavigate();
      }
    });

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

    // 페이지 전환 시 프로필 통계 캐시 리셋
    profileStatsCache = { personaId: null, stats: null, monthlyPosts: null, monthlyComments: null };
    stopProfileStatsGuard();

    if (isActivePage()) {
      setTimeout(() => {
        filterAll();
        injectBlockButtons();
      }, 500);
    }
    if (isProfilePage()) {
      setTimeout(() => injectProfileStats(), 500);
    }
  }

  // ── 스토리지 변경 감지 (popup에서 해제 시 반영) ──
  browser.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) {
      try {
        blockData = JSON.parse(changes[STORAGE_KEY].newValue);
      } catch {
        blockData = createEmptyData();
      }
      filterAll();
    }
    if (changes[FILTER_MODE_KEY]) {
      filterMode = changes[FILTER_MODE_KEY].newValue || 'hide';
      filterAll();
    }
  });

  // ── 프로필 통계 ──
  function isProfilePage() {
    return window.location.pathname.startsWith('/profiles/');
  }

  function getProfilePersonaId() {
    const match = window.location.pathname.match(/^\/profiles\/([^/?]+)/);
    return match ? match[1] : null;
  }

  async function fetchPersonaStats(personaId) {
    try {
      const resp = await fetch(`https://api.lounge.naver.com/user-api/v1/personas/${personaId}`, {
        credentials: 'include',
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      return json.data;
    } catch {
      return null;
    }
  }

  async function fetchMonthlyCount(personaId, type) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let count = 0;
    let cursor = '';
    const isComments = type === 'comments';

    for (let page = 0; page < 50; page++) {
      try {
        // 1단계: activities API로 ID 목록
        const actUrl = `https://api.lounge.naver.com/user-api/v1/personas/${personaId}/activities/${type}?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const actResp = await fetch(actUrl, { credentials: 'include' });
        if (!actResp.ok) break;
        const actJson = await actResp.json();
        const items = actJson.data?.items || [];
        if (items.length === 0) break;

        // 2단계: content API로 날짜 조회
        let hasThisMonth = false;

        if (isComments) {
          // 댓글: commentNoList 파라미터, rawResponse 안에 commentList
          const ids = items.map((item) => item.commentId);
          const params = ids.map((id) => `commentNoList=${id}`).join('&');
          const detailResp = await fetch(
            `https://api.lounge.naver.com/content-api/v1/comments?${params}`,
            { credentials: 'include' },
          );
          if (!detailResp.ok) break;
          const detailJson = await detailResp.json();
          const raw = detailJson.data?.rawResponse;
          const parsed = raw ? JSON.parse(raw) : null;
          const commentList = parsed?.result?.commentList || [];

          for (const comment of commentList) {
            const dateStr = comment.regTimeGmt || '';
            if (dateStr && new Date(dateStr) >= monthStart) {
              count++;
              hasThisMonth = true;
            }
          }
        } else {
          // 글: postIds 파라미터, data 배열
          const ids = items.map((item) => item.postId);
          const params = ids.map((id) => `postIds=${id}`).join('&');
          const detailResp = await fetch(
            `https://api.lounge.naver.com/content-api/v1/posts?${params}`,
            { credentials: 'include' },
          );
          if (!detailResp.ok) break;
          const detailJson = await detailResp.json();
          const details = Array.isArray(detailJson.data) ? detailJson.data : [];

          for (const item of details) {
            const dateStr = item.createTime || '';
            if (dateStr && new Date(dateStr) >= monthStart) {
              count++;
              hasThisMonth = true;
            }
          }
        }

        if (!hasThisMonth) break;
        if (!actJson.data?.cursorInfo?.hasNext) break;
        cursor = actJson.data?.cursorInfo?.endCursor || '';
        if (!cursor) break;
      } catch {
        break;
      }
    }
    return count;
  }

  // 프로필 통계 캐시 (SPA 리렌더링으로 DOM이 제거되어도 재삽입 시 API 재호출 방지)
  let profileStatsCache = {
    personaId: null,
    stats: null,
    monthlyPosts: null,
    monthlyComments: null,
  };

  let profileStatsRafId = null;

  function buildProfileStatsHtml() {
    const stats = profileStatsCache.stats;
    const totalPosts = stats.totalPostCount || 0;
    const totalComments = stats.totalCommentCount || 0;
    const mp = profileStatsCache.monthlyPosts;
    const mc = profileStatsCache.monthlyComments;
    const spinner =
      '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);border-top-color:#1FAF63;border-radius:50%;animation:ql-spin 0.8s linear infinite;vertical-align:middle;"></span>';
    const monthlyPostsText = mp !== null ? mp : spinner;
    const monthlyCommentsText = mc !== null ? mc : spinner;

    return `<div style="font-weight:600;font-size:14px;margin-bottom:10px;color:#1FAF63;">활동 통계</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">
<div style="font-size:20px;font-weight:700;">${totalPosts}</div>
<div style="font-size:11px;opacity:0.7;margin-top:2px;">총 작성글</div></div>
<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">
<div style="font-size:20px;font-weight:700;">${totalComments}</div>
<div style="font-size:11px;opacity:0.7;margin-top:2px;">총 댓글</div></div>
<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">
<div style="font-size:20px;font-weight:700;">${monthlyPostsText}</div>
<div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 작성글</div></div>
<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">
<div style="font-size:20px;font-weight:700;">${monthlyCommentsText}</div>
<div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 댓글</div></div></div>`;
  }

  // 스피너 애니메이션 CSS (1회만 주입)
  if (!document.getElementById('ql-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'ql-spinner-style';
    style.textContent = '@keyframes ql-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  function insertProfileStatsBox() {
    if (document.getElementById('ql-profile-stats')) return;
    const tabsEl = document.querySelector('[data-slot="tabs"]');
    if (!tabsEl) return;
    const box = document.createElement('div');
    box.id = 'ql-profile-stats';
    box.style.cssText =
      'margin:12px 20px 0;padding:14px 16px;background:rgba(31,175,99,0.08);border:1px solid rgba(31,175,99,0.2);border-radius:10px;font-size:13px;color:var(--color-neutral-foreground-default,#e0e0e0);';
    box.innerHTML = buildProfileStatsHtml();
    tabsEl.before(box);
  }

  // 처음 3초간 rAF 폴링 (프로그레스 바 애니메이션 대응), 이후 debounced MutationObserver로 전환
  let profileStatsObserver = null;

  function startProfileStatsGuard() {
    stopProfileStatsGuard();

    // Phase 1: rAF 폴링 (3초간)
    const startTime = Date.now();
    function tick() {
      if (!isProfilePage() || !profileStatsCache.stats) {
        profileStatsRafId = null;
        return;
      }
      insertProfileStatsBox();

      if (Date.now() - startTime < 3000) {
        profileStatsRafId = requestAnimationFrame(tick);
      } else {
        // Phase 2: MutationObserver로 전환
        profileStatsRafId = null;
        profileStatsObserver = new MutationObserver(
          debounce(() => {
            if (isProfilePage() && profileStatsCache.stats) {
              insertProfileStatsBox();
            }
          }, 100),
        );
        profileStatsObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
    profileStatsRafId = requestAnimationFrame(tick);
  }

  function stopProfileStatsGuard() {
    if (profileStatsRafId) {
      cancelAnimationFrame(profileStatsRafId);
      profileStatsRafId = null;
    }
    if (profileStatsObserver) {
      profileStatsObserver.disconnect();
      profileStatsObserver = null;
    }
  }

  function injectProfileStats() {
    if (!isProfilePage()) return;

    const personaId = getProfilePersonaId();
    if (!personaId) return;

    // 캐시가 있으면 폴링 시작 (즉시 삽입 + 리렌더링 대응)
    if (profileStatsCache.personaId === personaId && profileStatsCache.stats) {
      startProfileStatsGuard();
      return;
    }

    // 캐시 없으면 API 호출 (초기 1회)
    fetchPersonaStats(personaId).then((stats) => {
      if (!stats) return;

      if (stats.isOwner) {
        safariSet({ quiet_lounge_my_persona_id: personaId });
      }

      profileStatsCache = { personaId, stats, monthlyPosts: null, monthlyComments: null };

      // 이번달 카운트 계산
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const createTime = stats.createTime ? new Date(stats.createTime) : null;
      const createdThisMonth = createTime && createTime >= monthStart;

      if (createdThisMonth) {
        profileStatsCache.monthlyPosts = stats.totalPostCount || 0;
        profileStatsCache.monthlyComments = stats.totalCommentCount || 0;
      } else {
        fetchMonthlyCount(personaId, 'posts').then((count) => {
          profileStatsCache.monthlyPosts = count;
          const el = document.getElementById('ql-profile-stats');
          if (el) el.innerHTML = buildProfileStatsHtml();
        });
        fetchMonthlyCount(personaId, 'comments').then((count) => {
          profileStatsCache.monthlyComments = count;
          const el = document.getElementById('ql-profile-stats');
          if (el) el.innerHTML = buildProfileStatsHtml();
        });
      }

      startProfileStatsGuard();
    });
  }

  // ── 내 통계 조회 → storage 저장 ──
  function saveMyStats(statsObj) {
    safariSet({
      quiet_lounge_my_stats: JSON.stringify(statsObj),
    });
  }

  async function fetchAndStoreMyStats() {
    try {
      // 1단계: me API로 personaId 확인
      const meResp = await fetch('https://api.lounge.naver.com/user-api/v1/members/me/personas', {
        credentials: 'include',
      });
      if (!meResp.ok) {
        browser.storage.local.remove('quiet_lounge_my_stats');
        return;
      }
      const meJson = await meResp.json();
      const meData = Array.isArray(meJson.data) ? meJson.data[0] : meJson.data;
      if (!meData?.personaId) return;

      const personaId = meData.personaId;
      safariSet({ quiet_lounge_my_persona_id: personaId });

      // 2단계: personas API로 총 글/댓글 수 조회
      let totalPosts = 0;
      let totalComments = 0;
      let nickname = meData.nickname || '';
      let createTime = meData.createTime ? new Date(meData.createTime) : null;

      try {
        const statsResp = await fetch(
          `https://api.lounge.naver.com/user-api/v1/personas/${personaId}`,
          { credentials: 'include' },
        );
        if (statsResp.ok) {
          const statsJson = await statsResp.json();
          const sData = statsJson.data;
          if (sData) {
            totalPosts = sData.totalPostCount || 0;
            totalComments = sData.totalCommentCount || 0;
            nickname = sData.nickname || nickname;
            createTime = sData.createTime ? new Date(sData.createTime) : createTime;
          }
        }
      } catch {
        // personas API 실패 시 activities API로 총 수 조회
        try {
          const postsResp = await fetch(
            `https://api.lounge.naver.com/user-api/v1/personas/${personaId}/activities/posts?limit=1`,
            { credentials: 'include' },
          );
          if (postsResp.ok) {
            const pJson = await postsResp.json();
            totalPosts = pJson.data?.totalPostCount || 0;
          }
          const commentsResp = await fetch(
            `https://api.lounge.naver.com/user-api/v1/personas/${personaId}/activities/comments?limit=1`,
            { credentials: 'include' },
          );
          if (commentsResp.ok) {
            const cJson = await commentsResp.json();
            totalComments = cJson.data?.totalCommentCount || cJson.data?.totalCount || 0;
          }
        } catch {
          // 둘 다 실패
        }
      }

      const now = new Date();

      // 총 수를 먼저 저장 (팝업에 바로 반영)
      const stats = {
        personaId,
        nickname,
        totalPosts,
        totalComments,
        monthlyPosts: '...',
        monthlyComments: '...',
        updatedAt: now.toISOString(),
      };
      saveMyStats(stats);

      // 이번달 카운트 계산
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const createdThisMonth = createTime && createTime >= monthStart;

      if (createdThisMonth) {
        stats.monthlyPosts = totalPosts;
        stats.monthlyComments = totalComments;
        saveMyStats(stats);
      } else {
        // 각각 독립적으로 로드하여 먼저 완료되는 것부터 반영
        fetchMonthlyCount(personaId, 'posts')
          .then((count) => {
            stats.monthlyPosts = count;
          })
          .catch(() => {
            stats.monthlyPosts = '?';
          })
          .finally(() => saveMyStats(stats));
        fetchMonthlyCount(personaId, 'comments')
          .then((count) => {
            stats.monthlyComments = count;
          })
          .catch(() => {
            stats.monthlyComments = '?';
          })
          .finally(() => saveMyStats(stats));
      }
    } catch {
      // 조회 실패 무시
    }
  }

  // 팝업 갱신 버튼 요청 수신
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'REFRESH_MY_STATS') {
      fetchAndStoreMyStats();
    }
  });

  // iOS Safari 대응: storage.onChanged가 동작하지 않으므로 폴링으로 변경 감지
  let lastBlockDataHash = JSON.stringify(blockData);
  let pollTimer = null;

  function startBlockDataPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const result = await browser.storage.local.get([STORAGE_KEY, 'quiet_lounge_refresh_stats']);

        // 차단 목록 변경 감지
        const raw = result[STORAGE_KEY] || '';
        if (raw && raw !== lastBlockDataHash) {
          lastBlockDataHash = raw;
          blockData = JSON.parse(raw);
          if (isActivePage()) filterAll();
        }

        // 통계 갱신 요청 감지
        if (result.quiet_lounge_refresh_stats) {
          await browser.storage.local.remove('quiet_lounge_refresh_stats');
          fetchAndStoreMyStats();
        }
      } catch {
        // 조회 실패 무시
      }
    }, 3000);
  }

  function stopBlockDataPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startBlockDataPolling();
    else stopBlockDataPolling();
  });

  if (document.visibilityState === 'visible') startBlockDataPolling();

  // ── 초기화 ──
  async function init() {
    await loadBlockData();

    // 내 통계 자동 갱신 (라운지 접속 시마다)
    fetchAndStoreMyStats();

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
    injectProfileStats();

    // MutationObserver는 항상 설치 (SPA 전환 후 DOM 변경 대응)
    const target = document.querySelector(SEL.scrollContainer) || document.body;

    const debouncedUpdate = debounce(() => {
      if (isActivePage()) {
        filterAll();
        injectBlockButtons();
      }
      injectProfileStats();
    }, 200);

    const observer = new MutationObserver(debouncedUpdate);
    observer.observe(target, { childList: true, subtree: true });
  }

  init();
})();
