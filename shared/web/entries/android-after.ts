// @ts-nocheck
// QuietLounge — Android WebView after.js (document_idle 대체)
//
// 이 파일은 esbuild 가 IIFE 로 번들해 android-app/app/src/main/assets/webview-scripts/after.js 산출물을 만든다.
// 산출물은 Kotlin WebViewScripts.loadAfterTemplate 가 assets.open() 으로 읽고
// __QL_BLOCK_DATA_PLACEHOLDER__ / __QL_FILTER_MODE_PLACEHOLDER__ 를 치환한 뒤
// webView.evaluateJavascript() 로 주입.
//
// placeholder 는 esbuild 가 미정의 글로벌을 그대로 통과시키므로 산출물에 보존된다
// (tests/build/artifacts.test.js 가 회귀 가드).

import { SEL } from '../core/selectors';
import { isActivePage, isBlockButtonPage } from '../core/pages';
import { isCleanbotFiltered } from '../core/cleanbot';
import { runFilterPass } from '../core/filter-engine';
// isBlocked / applyStyle 은 runFilterPass 가 내부에서 사용. Android entry 는 다른 곳에서 직접 호출 안 함.
// __QL_BLOCK_DATA_PLACEHOLDER__ ambient 식별자는 placeholders.d.ts 가 선언 — `// @ts-nocheck`
// 가 entry 상단에 있어 명시 import 불필요. esbuild 는 미정의 글로벌을 그대로 통과시킨다.

(function () {
  'use strict';
  if (window.__QL_AFTER_INSTALLED) {
    window.__QL_BLOCK_DATA = __QL_BLOCK_DATA_PLACEHOLDER__;
    window.__QL_FILTER_MODE = '__QL_FILTER_MODE_PLACEHOLDER__';
    if (window.__QL_onBlockListUpdate) window.__QL_onBlockListUpdate();
    return;
  }
  window.__QL_AFTER_INSTALLED = true;

  // QuietLounge 브랜드 컬러 — 다크 모드에선 어두운 배경 위 시인성을 위해 한 톤 밝게 사용.
  const QL_PRIMARY =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '#6A86F8' : '#4A6CF7';

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

  function filterAll() {
    // 핵심 로직은 shared/web/core/filter-engine.ts. Android 는 badge 가 없어 카운트 무시.
    // native bridge 가 placeholder 로 직접 주입한 window.__QL_BLOCK_DATA / __QL_FILTER_MODE 사용.
    if (!isActivePage()) return;
    const ql = window.__QL || { personaMap: {} };
    runFilterPass({
      blockData: window.__QL_BLOCK_DATA,
      filterMode: window.__QL_FILTER_MODE || 'hide',
      personaIdForPost: function (id) { return ql.personaMap[id]; },
    });
  }

  function createBlockBtn(onClickHandler) {
    const btn = document.createElement('button');
    btn.className = 'ql-btn';
    btn.textContent = '✕';
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
      // 클린봇 검열 글 — 작성자 정보가 가려진 채 안내문만 있어 차단 의미 없음.
      if (isCleanbotFiltered(el.closest(SEL.postContainer) || el.closest(SEL.postLink))) return;

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
      if (isCleanbotFiltered(container)) return;

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
      `border-top-color:${QL_PRIMARY};border-radius:50%;animation:ql-spin 0.8s linear infinite;vertical-align:middle;"></span>`;
    const monthlyPostsText = mp !== null ? mp : spinner;
    const monthlyCommentsText = mc !== null ? mc : spinner;

    return (
      `<div style="font-weight:600;font-size:14px;margin-bottom:10px;color:${QL_PRIMARY};">활동 통계</div>` +
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
      'margin:12px 20px 0;padding:14px 16px;background:rgba(74,108,247,0.08);' +
      'border:1px solid rgba(74,108,247,0.2);border-radius:10px;font-size:13px;' +
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
