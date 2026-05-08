// @ts-nocheck
// QuietLounge — Content Script (Chrome Extension)
//
// 이 파일은 esbuild 가 IIFE 로 번들해 chrome-extension/content-scripts/main.js 산출물을 만든다.
// 산출물 측은 manifest.json 의 content_scripts 가 직접 가리키는 ISOLATED world 스크립트.
//
// Tier 1 공유 함수 (selectors / storage-keys / pages / cleanbot / block-check / style) 는
// shared/web/core 에서 import. 나머지 ~900 LOC 는 후속 PR 에서 chunk 별로 옮길 예정.

import { STORAGE_KEY, FILTER_MODE_KEY, DONT_SHOW_FILTER_HINT_KEY } from '../core/storage-keys';
import { isActivePage } from '../core/pages';
import { isBlocked as sharedIsBlocked } from '../core/block-check';
import { runFilterPass } from '../core/filter-engine';
import { injectBlockButtons, findPersonaId as sharedFindPersonaId } from '../core/inject-buttons';
import {
  injectProfileStats as sharedInjectProfileStats,
  resetProfileStatsCache as sharedResetProfileStatsCache,
  fetchAndStoreMyStats as sharedFetchAndStoreMyStats,
  isProfilePage as sharedIsProfilePage,
} from '../core/profile-stats';
import type { InjectButtonsAdapter, ProfileStatsAdapter } from '../platform/adapter';
// applyStyle 직접 import 제거 — runFilterPass 가 내부에서 사용. 다른 entry 도 동일.

(function () {
  'use strict';

  // QuietLounge 브랜드 컬러 — 다크 모드에선 어두운 배경 위 시인성을 위해 한 톤 밝게 사용.
  const QL_PRIMARY =
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? '#6A86F8'
      : '#4A6CF7';

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
  let filterMode = 'hide'; // 'hide' or 'blur'
  let dontShowFilterHint = false;

  async function loadBlockData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [STORAGE_KEY, FILTER_MODE_KEY, DONT_SHOW_FILTER_HINT_KEY],
        (result) => {
          if (result[STORAGE_KEY]) {
            try {
              blockData = JSON.parse(result[STORAGE_KEY]);
            } catch {
              blockData = createEmptyData();
            }
          }
          if (result[FILTER_MODE_KEY]) {
            filterMode = result[FILTER_MODE_KEY];
          }
          dontShowFilterHint = !!result[DONT_SHOW_FILTER_HINT_KEY];
          resolve();
        },
      );
    });
  }

  async function saveBlockData() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(blockData) }, resolve);
    });
  }

  // closure 캡쳐된 blockData 를 shared isBlocked 에 위임 — 4 플랫폼 동일 시맨틱.
  function isBlocked(personaId, nickname) {
    return sharedIsBlocked(blockData, personaId, nickname);
  }

  async function blockUser(personaId, nickname) {
    if (personaId) {
      const existing = blockData.blockedUsers[personaId];
      blockData.blockedUsers[personaId] = {
        personaId,
        nickname,
        blockedAt: existing?.blockedAt ?? new Date().toISOString(),
      };
      blockData.nicknameOnlyBlocks = blockData.nicknameOnlyBlocks.filter(
        (b) => b.nickname !== nickname,
      );
    } else {
      if (isBlocked(undefined, nickname)) return;
      blockData.nicknameOnlyBlocks.push({
        nickname,
        blockedAt: new Date().toISOString(),
      });
    }
    await saveBlockData();
  }

  // ── 차단 직후 "흐림 처리 모드 안내" Hint 다이얼로그 ──
  // 사용자가 매 차단마다 안내를 받게 됨 (HIDE 모드 + "다시 보지 않기" 미선택 한정).
  // browser confirm() 으로는 "다시 보지 않기" UX 가 안 되므로 커스텀 DOM modal.
  function qlFilterHintDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;' +
        'display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText =
        'background:#1a1a1a;color:#e0e0e0;border-radius:14px;padding:20px;' +
        'max-width:340px;width:90%;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
        'box-shadow:0 4px 24px rgba(0,0,0,0.4);';

      const title = document.createElement('p');
      title.textContent = '팁: 흐림 처리 모드';
      title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 10px;';

      const msg = document.createElement('p');
      msg.textContent =
        '차단된 글을 완전히 숨기는 대신 흐리게만 처리할 수도 있어요. 익스텐션 팝업의 \'흐림 처리\' 토글에서 켤 수 있습니다.';
      msg.style.cssText = 'font-size:14px;margin:0 0 18px;line-height:1.5;color:#bbb;';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;';

      const dontBtn = document.createElement('button');
      dontBtn.textContent = '다시 보지 않기';
      dontBtn.style.cssText =
        'flex:1;padding:10px;border:1px solid #444;background:transparent;color:#aaa;' +
        'border-radius:8px;font-size:13px;cursor:pointer;';

      const okBtn = document.createElement('button');
      okBtn.textContent = '확인';
      okBtn.style.cssText =
        'flex:1;padding:10px;border:none;background:#4A6CF7;color:#fff;' +
        'border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      dontBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        close('dontShow');
      });
      okBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        close('confirm');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close('confirm');
      });

      btnRow.appendChild(dontBtn);
      btnRow.appendChild(okBtn);
      dialog.appendChild(title);
      dialog.appendChild(msg);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  /**
   * 차단 직후 호출 — HIDE 모드 + 안내 안 끔이면 hint 표시.
   * pure logic 은 iOS QuietLoungeCore.shouldShowFilterModeHint /
   * Android WebViewToolbarLogic.shouldShowFilterModeHint 와 동일 시맨틱.
   */
  async function maybeShowFilterModeHint() {
    if (filterMode === 'blur') return;
    if (dontShowFilterHint) return;
    const result = await qlFilterHintDialog();
    if (result === 'dontShow') {
      dontShowFilterHint = true;
      await new Promise((resolve) => {
        chrome.storage.local.set({ [DONT_SHOW_FILTER_HINT_KEY]: true }, resolve);
      });
    }
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
          blockedAt: block.blockedAt,
        };
        changed = true;
      }
      if (blockData.blockedUsers[pid] && blockData.blockedUsers[pid].nickname !== nickname) {
        // 닉네임 갱신만 — 옛 닉네임 추적은 더 이상 안 함.
        blockData.blockedUsers[pid].nickname = nickname;
        changed = true;
      }
    }
    if (changed) await saveBlockData();
  }

  // ── 필터 엔진 ──
  // 핵심 로직은 shared/web/core/filter-engine.ts 의 runFilterPass — 4 플랫폼 동일.
  // Chrome 만 차단 카운트를 badge 로 노출하므로 entry 가 후처리.
  function filterAll() {
    // /posts/** 또는 /channels/** 에서만 동작
    if (!isActivePage()) return;
    const totalBlocked = runFilterPass({
      blockData,
      filterMode,
      personaIdForPost: (id) => personaMap.get(id),
    });
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: totalBlocked });
  }

  // ── UI Injector (차단 버튼) ──
  // 핵심 로직 (path A / path B / cleanbot 가드 / DOM 위치 결정) 은 shared injectBlockButtons 가
  // 처리. Chrome 측 책임은 (a) 버튼 DOM 만들기 (b) 차단 클릭 시 confirm + blockUser + filterAll +
  // maybeShowFilterModeHint 흐름.
  const injectButtonsAdapter: InjectButtonsAdapter = {
    buttonClassName: 'quiet-lounge-btn',
    pathBMissingPidStrategy: 'show-error',

    createButton() {
      const btn = document.createElement('button');
      btn.className = 'quiet-lounge-btn';
      btn.textContent = '✕';
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
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);

      return btn;
    },

    async onBlockClick(personaId, nickname) {
      if (!confirm(`"${nickname}" 유저를 차단하시겠습니까?`)) return;
      await blockUser(personaId, nickname);
      filterAll();
      runInjectBlockButtons();
      await maybeShowFilterModeHint();
    },

    async onMissingPersonaId() {
      alert('personaId를 찾을 수 없습니다. 글 상세 페이지에서 차단해주세요.');
    },
  };

  function runInjectBlockButtons() {
    injectBlockButtons(injectButtonsAdapter, {
      findPersonaId: (container) => sharedFindPersonaId(container, (id) => personaMap.get(id)),
      nicknameForPersonaId: (pid) => personaCache.get(pid)?.nickname,
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

    // 페이지 전환 시 프로필 통계 캐시 리셋
    sharedResetProfileStatsCache();

    if (isActivePage()) {
      setTimeout(() => {
        filterAll();
        runInjectBlockButtons();
      }, 500);
    }
    if (sharedIsProfilePage()) {
      setTimeout(() => sharedInjectProfileStats(profileStatsAdapter), 500);
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
    if (changes[FILTER_MODE_KEY]) {
      filterMode = changes[FILTER_MODE_KEY].newValue || 'hide';
      filterAll();
    }
    if (changes[DONT_SHOW_FILTER_HINT_KEY]) {
      dontShowFilterHint = !!changes[DONT_SHOW_FILTER_HINT_KEY].newValue;
    }
  });

  // ── 프로필 통계 (shared/web/core/profile-stats 로 이전. 어댑터만 entry 에 둠) ──
  const profileStatsAdapter: ProfileStatsAdapter = {
    qlPrimaryColor: QL_PRIMARY,
    saveOwnerPersonaId(personaId) {
      chrome.storage.local.set({ quiet_lounge_my_persona_id: personaId });
    },
    saveMyStats(stats) {
      chrome.storage.local.set({ quiet_lounge_my_stats: JSON.stringify(stats) });
    },
    removeMyStats() {
      chrome.storage.local.remove('quiet_lounge_my_stats');
    },
  };


  // 팝업 갱신 버튼 요청 수신
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'REFRESH_MY_STATS') {
      sharedFetchAndStoreMyStats(profileStatsAdapter);
    }
  });

  // ── 초기화 ──
  async function init() {
    await loadBlockData();

    // 내 통계 자동 갱신 (라운지 접속 시마다)
    sharedFetchAndStoreMyStats(profileStatsAdapter);

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
      runInjectBlockButtons();
    }
    sharedInjectProfileStats(profileStatsAdapter);

    // MutationObserver는 항상 설치 (SPA 전환 후 DOM 변경 대응).
    // SEL.scrollContainer 는 SPA 전환 시 detach 되어 observer 가 끊길 수 있어 document.body 사용.
    const debouncedUpdate = debounce(() => {
      if (isActivePage()) {
        filterAll();
        runInjectBlockButtons();
      }
      sharedInjectProfileStats(profileStatsAdapter);
    }, 200);

    const observer = new MutationObserver(debouncedUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
