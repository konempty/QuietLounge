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

import { isActivePage } from '../core/pages';
import { runFilterPass } from '../core/filter-engine';
import { debounce } from '../core/utils';
import { injectBlockButtons, findPersonaId as sharedFindPersonaId } from '../core/inject-buttons';
import {
  injectProfileStats as sharedInjectProfileStats,
  resetProfileStatsCache as sharedResetProfileStatsCache,
  isProfilePage as sharedIsProfilePage,
} from '../core/profile-stats';
import type { InjectButtonsAdapter, ProfileStatsAdapter } from '../platform/adapter';
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
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? '#6A86F8'
      : '#4A6CF7';

  window.__QL_BLOCK_DATA = __QL_BLOCK_DATA_PLACEHOLDER__;
  window.__QL_FILTER_MODE = '__QL_FILTER_MODE_PLACEHOLDER__';

  // Bridge 가용성 — `WebViewCompat.addWebMessageListener` 가 등록되면 `window.QuietLounge` 노출.
  // `WEB_MESSAGE_LISTENER` 미지원 환경에서는 LoungeScreen 측 fail-closed 로 등록 자체 안 됨 (Codex 55 F1).
  // 이 경우 차단/키워드 알림 native handler 가 없으므로 *차단 버튼 자체 미주입* — silent fail UX 회귀 방지 (Codex 58 F1).
  function isBridgeAvailable() {
    return !!(window.QuietLounge && typeof window.QuietLounge.postMessage === 'function');
  }

  function postNative(payload) {
    try {
      if (isBridgeAvailable()) {
        window.QuietLounge.postMessage(JSON.stringify(payload));
      }
    } catch {
      // 무시
    }
  }

  function filterAll() {
    // 핵심 로직은 web/core/filter-engine.ts. Android 는 badge 가 없어 카운트 무시.
    // native bridge 가 placeholder 로 직접 주입한 window.__QL_BLOCK_DATA / __QL_FILTER_MODE 사용.
    if (!isActivePage()) return;
    const ql = window.__QL || { personaMap: {} };
    runFilterPass({
      blockData: window.__QL_BLOCK_DATA,
      filterMode: window.__QL_FILTER_MODE || 'hide',
      personaIdForPost: function (id) {
        return ql.personaMap[id];
      },
    });
  }

  function sendBlockMessage(pid, nickname) {
    postNative({
      type: 'BLOCK_USER',
      payload: { personaId: pid || null, nickname: nickname },
    });
  }

  // ── UI Injector (차단 버튼) ──
  // 핵심 path A / path B / cleanbot 가드는 web/core/inject-buttons.ts. Android 책임은
  // (a) ql-btn 외형 (b) sendBlockMessage 로 native bridge 호출 — confirm + 실제 차단은 native (Kotlin) 측.
  // path B 의 'skip' strategy: pid 미매핑 시 버튼 자체 미노출 — silent no-op 방지.
  const injectButtonsAdapter: InjectButtonsAdapter = {
    buttonClassName: 'ql-btn',
    pathBMissingPidStrategy: 'skip',

    createButton() {
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
      return btn;
    },

    onBlockClick(personaId, nickname) {
      // confirm + 실제 차단은 native (Kotlin) 측 — bridge 메시지만 보내면 끝.
      sendBlockMessage(personaId || null, nickname || 'Unknown');
    },
  };

  function injectButtons() {
    // bridge 미지원 환경에서는 버튼을 눌러도 native confirm/차단이 발화 안 됨 → 버튼 자체 미주입.
    // 필터링 (filterAll) 은 차단 목록만 있으면 작동하므로 유지 — 라운지 보기는 그대로.
    if (!isBridgeAvailable()) return;
    injectBlockButtons(injectButtonsAdapter, {
      findPersonaId: function (container) {
        const ql = window.__QL || { personaMap: {} };
        return sharedFindPersonaId(container, function (id) {
          return ql.personaMap[id];
        });
      },
      nicknameForPersonaId: function (pid) {
        const ql = window.__QL || { personaCache: {} };
        return ql.personaCache[pid];
      },
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

  // ── 프로필 통계 (web/core/profile-stats 로 이전. 어댑터만 entry 에 둠) ──
  // Android WebView 의 popup 은 Compose UI 라 saveOwnerPersonaId / saveMyStats / removeMyStats 미구현.
  // 색상만 어댑터로 전달.
  const profileStatsAdapter: ProfileStatsAdapter = { qlPrimaryColor: QL_PRIMARY };

  // SPA 네비게이션 감지 — iOS entry 와 동일 패턴 (단일 onNavigate 함수, base/wrapper 분리 없음).
  let lastPath = window.location.pathname;

  function onNavigate() {
    const newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;

    postNative({ type: 'PAGE_CHANGED', payload: { path: newPath } });
    sharedResetProfileStatsCache();

    if (isActivePage()) {
      setTimeout(function () {
        filterAll();
        injectButtons();
      }, 500);
    }
    if (sharedIsProfilePage()) {
      setTimeout(function () {
        sharedInjectProfileStats(profileStatsAdapter);
      }, 500);
    }
  }

  // bfcache `pageshow` 가드는 Chrome / Safari ext 만 추가 — Android WebView 는 일반적으로 bfcache
  // 적용이 약하고 native bridge 가 페이지 전환 시점을 직접 알리므로 의도적 제외.
  window.addEventListener('popstate', onNavigate);
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

  // SEL.scrollContainer 는 페이지마다 다르고 SPA 전환 시 detach 되는 element 라 observer 가
  // 끊겨 mutation 을 놓치는 timing 케이스가 발생 (Android 에서 글 상세 → 프로필 race 로 활동 통계 미노출).
  // document.body 는 SPA 라이프사이클 내내 살아있어 안전. 프로필 페이지에서 SPA layout 이 늦게 그려지는
  // 케이스용으로 매 mutation 마다 inject 재시도 — shared 측 in-flight 가드 + cache hit 으로 cheap.
  const debounced = debounce(function () {
    if (isActivePage()) {
      filterAll();
      injectButtons();
    }
    if (sharedIsProfilePage()) sharedInjectProfileStats(profileStatsAdapter);
  }, 200);
  new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true });

  if (sharedIsProfilePage()) sharedInjectProfileStats(profileStatsAdapter);
})();
true;
