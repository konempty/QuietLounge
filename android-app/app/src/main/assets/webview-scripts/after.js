// QuietLounge — after.js (document_idle)
// 필터링 + 차단 버튼 inject + 프로필 통계 + SPA 네비게이션 감시.
// __QL_BLOCK_DATA_PLACEHOLDER__ / __QL_FILTER_MODE_PLACEHOLDER__ 는
// LoungeWebViewBridge 가 String.replace 로 주입 (각각 JSON 객체와 'hide'|'blur').
// 네이티브 통신은 window.QuietLounge.postMessage(JSON string).

(function () {
  'use strict';
  if (window.__QL_AFTER_INSTALLED) {
    window.__QL_BLOCK_DATA = __QL_BLOCK_DATA_PLACEHOLDER__;
    window.__QL_FILTER_MODE = '__QL_FILTER_MODE_PLACEHOLDER__';
    if (window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate();
    return;
  }
  window.__QL_AFTER_INSTALLED = true;

  window.__QL_BLOCK_DATA = __QL_BLOCK_DATA_PLACEHOLDER__;
  window.__QL_FILTER_MODE = '__QL_FILTER_MODE_PLACEHOLDER__';

  function postNative(payload) {
    try {
      if (window.QuietLounge && typeof window.QuietLounge.postMessage === 'function') {
        window.QuietLounge.postMessage(JSON.stringify(payload));
      }
    } catch (e) {
      // 무시
    }
  }

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

  function isActivePage() {
    const path = window.location.pathname;
    return path === '/' || path.startsWith('/posts') || path.startsWith('/channels');
  }

  function isBlockButtonPage() {
    const path = window.location.pathname;
    return path.startsWith('/posts') || path.startsWith('/channels');
  }

  function isBlocked(personaId, nickname) {
    const d = window.__QL_BLOCK_DATA;
    if (!d) return false;
    if (personaId && d.blockedUsers && d.blockedUsers[personaId]) return true;
    if (nickname) {
      const users = d.blockedUsers || {};
      for (const key in users) {
        if (users[key].nickname === nickname) return true;
      }
      const nbs = d.nicknameOnlyBlocks || [];
      for (let i = 0; i < nbs.length; i++) {
        if (nbs[i].nickname === nickname) return true;
      }
    }
    return false;
  }

  function applyStyle(el, blocked) {
    if (!el) return;
    const mode = window.__QL_FILTER_MODE || 'hide';
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

  function filterAll() {
    if (!isActivePage()) return;
    const ql = window.__QL || { personaMap: {} };

    document.querySelectorAll(SEL.postLink).forEach(function (link) {
      const postId = link.getAttribute('href')?.replace('/posts/', '');
      const nickname = link.querySelector(SEL.nickname)?.textContent?.trim();
      const pid = postId ? ql.personaMap[postId] : undefined;
      const container = link.closest(SEL.postContainer) || link.parentElement?.parentElement;
      if (!container) return;

      const blocked = isBlocked(pid, nickname);
      applyStyle(container, blocked);

      const sep = container.parentElement?.nextElementSibling;
      if (sep?.getAttribute?.('data-slot') === 'separator') {
        applyStyle(sep, blocked);
      }
    });

    document.querySelectorAll(SEL.card).forEach(function (card) {
      const nickname = card.querySelector(SEL.nickname)?.textContent?.trim();
      if (nickname && isBlocked(undefined, nickname)) {
        const item = card.closest(SEL.cardItem);
        if (item) applyStyle(item, true);
      }
    });
  }

  function createBlockBtn(onClickHandler) {
    const btn = document.createElement('button');
    btn.className = 'ql-btn';
    btn.textContent = '\u2715';
    btn.title = 'block';
    btn.style.cssText =
      'margin-left:6px;cursor:pointer;opacity:0.5;font-size:16px;border:none;' +
      'background:rgba(200,50,50,0.12);padding:4px 8px;color:#e74c3c;border-radius:4px;' +
      'transition:opacity 0.15s;line-height:1;min-width:28px;min-height:28px;' +
      'display:inline-flex;align-items:center;justify-content:center;';
    btn.ontouchstart = function () {
      btn.style.opacity = '1';
      btn.style.background = 'rgba(200,50,50,0.25)';
    };
    btn.ontouchend = function () {
      btn.style.opacity = '0.5';
      btn.style.background = 'rgba(200,50,50,0.12)';
    };
    btn.onclick = onClickHandler;
    return btn;
  }

  function findPersonaId(container) {
    const ql = window.__QL || { personaMap: {} };
    let pid;

    const profileLink = container.querySelector('a[href^="/profiles/"]');
    if (profileLink) {
      pid = profileLink.getAttribute('href')?.replace('/profiles/', '');
    }

    if (!pid) {
      const postLink =
        container.closest('a[href^="/posts/"]') ||
        container.querySelector('a[href^="/posts/"]') ||
        container.closest('.relative[tabindex]')?.querySelector('a[href^="/posts/"]');
      if (postLink) {
        const postId = postLink.getAttribute('href')?.replace('/posts/', '');
        if (postId) pid = ql.personaMap[postId];
      }
    }

    if (!pid) {
      const pathMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
      if (pathMatch) pid = ql.personaMap[pathMatch[1]];
    }

    return pid;
  }

  function sendBlockMessage(pid, nickname) {
    postNative({
      type: 'BLOCK_USER',
      payload: { personaId: pid || null, nickname: nickname },
    });
  }

  function injectButtons() {
    if (!isBlockButtonPage()) return;

    document.querySelectorAll(SEL.profileName).forEach(function (el) {
      if (el.querySelector('.ql-btn')) return;

      const btn = createBlockBtn(function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const nickname = el
          .querySelector('[data-slot="profile-name-label"] span.truncate')
          ?.textContent?.trim();
        if (!nickname) return;

        const pid = findPersonaId(el);
        sendBlockMessage(pid, nickname);
      });
      el.appendChild(btn);
    });

    document.querySelectorAll(SEL.postContainer).forEach(function (container) {
      if (container.querySelector('.ql-btn')) return;
      if (container.querySelector(SEL.profileName)) return;

      const postLink =
        container.querySelector(SEL.postLink) || container.closest(SEL.postLink);
      if (!postLink) return;

      const btn = createBlockBtn(function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pid = findPersonaId(container);
        const ql = window.__QL || { personaCache: {} };
        const nickname = pid ? ql.personaCache[pid] : null;
        if (!pid) return;
        sendBlockMessage(pid, nickname || 'Unknown');
      });

      const firstRow = container.querySelector('a > div');
      if (firstRow) {
        firstRow.appendChild(btn);
      } else {
        container.appendChild(btn);
      }
    });
  }

  // 네이티브에서 호출
  window.__QL_onBlockListUpdate = function () {
    filterAll();
    injectButtons();
  };

  window.__QL_setFilterMode = function (mode) {
    window.__QL_FILTER_MODE = mode;
    filterAll();
  };

  // SPA 네비게이션 감지
  let lastPath = window.location.pathname;

  function onNavigateBase() {
    const newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;

    postNative({ type: 'PAGE_CHANGED', payload: { path: newPath } });

    if (isActivePage()) {
      setTimeout(function () {
        filterAll();
        injectButtons();
      }, 500);
    }
  }

  let onNavigate = onNavigateBase;

  window.addEventListener('popstate', function () {
    onNavigate();
  });
  const origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    onNavigate();
  };
  const origReplace = history.replaceState;
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    onNavigate();
  };

  if (isActivePage()) {
    filterAll();
    injectButtons();
  }

  let mutationTimer;
  const debounced = function () {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(function () {
      if (isActivePage()) {
        filterAll();
        injectButtons();
      }
    }, 200);
  };
  const target = document.querySelector(SEL.scrollContainer) || document.body;
  new MutationObserver(debounced).observe(target, { childList: true, subtree: true });

  // ── 프로필 통계 ──
  let profileStatsCache = {
    personaId: null,
    stats: null,
    monthlyPosts: null,
    monthlyComments: null,
  };
  let profileStatsRafId = null;
  let profileStatsObserver2 = null;

  function isProfilePage() {
    return window.location.pathname.startsWith('/profiles/');
  }

  function getProfilePersonaId() {
    const match = window.location.pathname.match(/^\/profiles\/([^/?]+)/);
    return match ? match[1] : null;
  }

  function buildProfileStatsHtml() {
    const stats = profileStatsCache.stats;
    const totalPosts = stats.totalPostCount || 0;
    const totalComments = stats.totalCommentCount || 0;
    const mp = profileStatsCache.monthlyPosts;
    const mc = profileStatsCache.monthlyComments;
    const spinner =
      '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);' +
      'border-top-color:#1FAF63;border-radius:50%;animation:ql-spin 0.8s linear infinite;vertical-align:middle;"></span>';
    const monthlyPostsText = mp !== null ? mp : spinner;
    const monthlyCommentsText = mc !== null ? mc : spinner;

    return (
      '<div style="font-weight:600;font-size:14px;margin-bottom:10px;color:#1FAF63;">활동 통계</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
      '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">' +
      '<div style="font-size:20px;font-weight:700;">' +
      totalPosts +
      '</div>' +
      '<div style="font-size:11px;opacity:0.7;margin-top:2px;">총 작성글</div></div>' +
      '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">' +
      '<div style="font-size:20px;font-weight:700;">' +
      totalComments +
      '</div>' +
      '<div style="font-size:11px;opacity:0.7;margin-top:2px;">총 댓글</div></div>' +
      '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">' +
      '<div style="font-size:20px;font-weight:700;">' +
      monthlyPostsText +
      '</div>' +
      '<div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 작성글</div></div>' +
      '<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">' +
      '<div style="font-size:20px;font-weight:700;">' +
      monthlyCommentsText +
      '</div>' +
      '<div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 댓글</div></div></div>'
    );
  }

  function insertProfileStatsBox() {
    if (document.getElementById('ql-profile-stats')) return;
    const tabsEl = document.querySelector('[data-slot="tabs"]');
    if (!tabsEl) return;
    const box = document.createElement('div');
    box.id = 'ql-profile-stats';
    box.style.cssText =
      'margin:12px 20px 0;padding:14px 16px;background:rgba(31,175,99,0.08);' +
      'border:1px solid rgba(31,175,99,0.2);border-radius:10px;font-size:13px;' +
      'color:var(--color-neutral-foreground-default,#e0e0e0);';
    box.innerHTML = buildProfileStatsHtml();
    tabsEl.before(box);
  }

  if (!document.getElementById('ql-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'ql-spinner-style';
    style.textContent = '@keyframes ql-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  function profileDebounce(fn, delay) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, delay);
    };
  }

  function startProfileStatsGuard() {
    stopProfileStatsGuard();
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
        profileStatsRafId = null;
        profileStatsObserver2 = new MutationObserver(
          profileDebounce(function () {
            if (isProfilePage() && profileStatsCache.stats) insertProfileStatsBox();
          }, 100),
        );
        profileStatsObserver2.observe(document.body, { childList: true, subtree: true });
      }
    }
    profileStatsRafId = requestAnimationFrame(tick);
  }

  function stopProfileStatsGuard() {
    if (profileStatsRafId) {
      cancelAnimationFrame(profileStatsRafId);
      profileStatsRafId = null;
    }
    if (profileStatsObserver2) {
      profileStatsObserver2.disconnect();
      profileStatsObserver2 = null;
    }
  }

  function fetchMonthlyCount(personaId, type, monthStart) {
    let count = 0;
    let cursor = '';
    const isComments = type === 'comments';

    function fetchPage(page) {
      if (page >= 50) return Promise.resolve(count);
      const actUrl =
        'https://api.lounge.naver.com/user-api/v1/personas/' +
        personaId +
        '/activities/' +
        type +
        '?limit=100' +
        (cursor ? '&cursor=' + cursor : '');
      return fetch(actUrl, { credentials: 'include' })
        .then(function (resp) {
          if (!resp.ok) return count;
          return resp.json().then(function (json) {
            const items = json.data && json.data.items ? json.data.items : [];
            if (items.length === 0) return count;

            let detailUrl;
            let params;
            if (isComments) {
              const commentIds = items.map(function (item) {
                return item.commentId;
              });
              params = commentIds
                .map(function (id) {
                  return 'commentNoList=' + id;
                })
                .join('&');
              detailUrl = 'https://api.lounge.naver.com/content-api/v1/comments?' + params;
            } else {
              const postIds = items.map(function (item) {
                return item.postId;
              });
              params = postIds
                .map(function (id) {
                  return 'postIds=' + id;
                })
                .join('&');
              detailUrl = 'https://api.lounge.naver.com/content-api/v1/posts?' + params;
            }

            return fetch(detailUrl, { credentials: 'include' }).then(function (dResp) {
              if (!dResp.ok) return count;
              return dResp.json().then(function (dJson) {
                let hasThisMonth = false;

                if (isComments) {
                  const raw = dJson.data && dJson.data.rawResponse ? dJson.data.rawResponse : null;
                  const parsed = raw ? JSON.parse(raw) : null;
                  const commentList =
                    parsed && parsed.result ? parsed.result.commentList || [] : [];
                  for (let i = 0; i < commentList.length; i++) {
                    const regDate = commentList[i].regTimeGmt || '';
                    if (regDate && new Date(regDate) >= monthStart) {
                      count++;
                      hasThisMonth = true;
                    }
                  }
                } else {
                  const details = Array.isArray(dJson.data) ? dJson.data : [];
                  for (let j = 0; j < details.length; j++) {
                    const dateStr = details[j].createTime || '';
                    if (dateStr && new Date(dateStr) >= monthStart) {
                      count++;
                      hasThisMonth = true;
                    }
                  }
                }

                if (!hasThisMonth) return count;
                if (!json.data.cursorInfo || !json.data.cursorInfo.hasNext) return count;
                cursor = json.data.cursorInfo.endCursor || '';
                if (!cursor) return count;
                return fetchPage(page + 1);
              });
            });
          });
        })
        .catch(function () {
          return count;
        });
    }
    return fetchPage(0);
  }

  function injectProfileStats() {
    if (!isProfilePage()) return;
    const personaId = getProfilePersonaId();
    if (!personaId) return;

    if (profileStatsCache.personaId === personaId && profileStatsCache.stats) {
      startProfileStatsGuard();
      return;
    }

    fetch('https://api.lounge.naver.com/user-api/v1/personas/' + personaId, {
      credentials: 'include',
    })
      .then(function (resp) {
        return resp.ok ? resp.json() : null;
      })
      .then(function (json) {
        if (!json || !json.data) return;
        const stats = json.data;
        profileStatsCache = {
          personaId: personaId,
          stats: stats,
          monthlyPosts: null,
          monthlyComments: null,
        };

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const createTime = stats.createTime ? new Date(stats.createTime) : null;
        const createdThisMonth = createTime && createTime >= monthStart;

        if (createdThisMonth) {
          profileStatsCache.monthlyPosts = stats.totalPostCount || 0;
          profileStatsCache.monthlyComments = stats.totalCommentCount || 0;
        } else {
          fetchMonthlyCount(personaId, 'posts', monthStart).then(function (c) {
            profileStatsCache.monthlyPosts = c;
            const el = document.getElementById('ql-profile-stats');
            if (el) el.innerHTML = buildProfileStatsHtml();
          });
          fetchMonthlyCount(personaId, 'comments', monthStart).then(function (c) {
            profileStatsCache.monthlyComments = c;
            const el = document.getElementById('ql-profile-stats');
            if (el) el.innerHTML = buildProfileStatsHtml();
          });
        }

        startProfileStatsGuard();
      });
  }

  // 네비게이션 시 프로필 캐시 리셋
  const origOnNavigate = onNavigate;
  onNavigate = function () {
    profileStatsCache = {
      personaId: null,
      stats: null,
      monthlyPosts: null,
      monthlyComments: null,
    };
    stopProfileStatsGuard();
    origOnNavigate();
    if (isProfilePage()) setTimeout(injectProfileStats, 500);
  };

  if (isProfilePage()) injectProfileStats();
})();
true;
