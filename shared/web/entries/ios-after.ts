// @ts-nocheck
// QuietLounge — iOS Native WebView afterScript (WKUserScript .atDocumentEnd)
//
// 이 파일은 esbuild 가 IIFE 로 번들해
// safari-extension/QuietLounge/iOS (App)/Resources/webview-scripts/after.js 산출물을 만든다.
// Swift WebViewScripts.afterScript 가 Bundle.main.url 로 이 파일을 로드해
// __QL_BLOCK_DATA_PLACEHOLDER__ / __QL_FILTER_MODE_PLACEHOLDER__ 를 치환한 뒤
// WKUserScript / evaluateJavaScript 로 주입.
//
// placeholder 는 esbuild 가 미정의 글로벌을 그대로 통과시키므로 산출물에 보존된다
// (tests/build/artifacts.test.js 가 회귀 가드).

import { isActivePage } from '../core/pages';
import { runFilterPass } from '../core/filter-engine';
import { injectBlockButtons, findPersonaId as sharedFindPersonaId } from '../core/inject-buttons';
import {
  injectProfileStats as sharedInjectProfileStats,
  resetProfileStatsCache as sharedResetProfileStatsCache,
  isProfilePage as sharedIsProfilePage,
} from '../core/profile-stats';
import type { InjectButtonsAdapter, ProfileStatsAdapter } from '../platform/adapter';
// isBlocked / applyStyle 은 runFilterPass 가 내부에서 사용. iOS entry 는 다른 곳에서 직접 호출 안 함.
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
  window.__QL_BLOCK_DATA = __QL_BLOCK_DATA_PLACEHOLDER__;
  window.__QL_FILTER_MODE = '__QL_FILTER_MODE_PLACEHOLDER__';

  // QuietLounge 브랜드 컬러 — 다크 모드에선 어두운 배경 위 시인성을 위해 한 톤 밝게 사용.
  var QL_PRIMARY = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? '#6A86F8' : '#4A6CF7';

  function filterAll() {
    // 핵심 로직은 shared/web/core/filter-engine.ts. iOS 는 badge 가 없어 카운트 무시.
    if (!isActivePage()) return;
    var ql = window.__QL || { personaMap: {} };
    runFilterPass({
      blockData: window.__QL_BLOCK_DATA,
      filterMode: window.__QL_FILTER_MODE || 'hide',
      personaIdForPost: function (id) { return ql.personaMap[id]; },
    });
  }

  function sendBlockMessage(pid, nickname) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge) {
      window.webkit.messageHandlers.qlBridge.postMessage(JSON.stringify({
        type: 'BLOCK_USER', payload: { personaId: pid || null, nickname: nickname }
      }));
    }
  }

  // ── UI Injector (차단 버튼) ──
  // 핵심 path A / path B / cleanbot 가드는 shared/web/core/inject-buttons.ts. iOS 책임은 (a) ql-btn
  // 외형 (b) sendBlockMessage 로 native bridge 호출 — confirm + 실제 차단은 native 측 처리.
  // path B 의 'skip' strategy: pid 미매핑 시 버튼 자체 미노출 — silent no-op 방지.
  const injectButtonsAdapter: InjectButtonsAdapter = {
    buttonClassName: 'ql-btn',
    pathBMissingPidStrategy: 'skip',

    createButton() {
      var btn = document.createElement('button');
      btn.className = 'ql-btn';
      btn.textContent = '✕';
      btn.style.cssText = 'margin-left:6px;cursor:pointer;opacity:0.5;font-size:16px;border:none;background:rgba(200,50,50,0.12);padding:4px 8px;color:#e74c3c;border-radius:4px;transition:opacity 0.15s;line-height:1;min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center;';
      btn.ontouchstart = function() { btn.style.opacity='1'; };
      btn.ontouchend = function() { btn.style.opacity='0.5'; };
      return btn;
    },

    onBlockClick(personaId, nickname) {
      // confirm + 실제 차단은 native (Swift) 측 — bridge 메시지만 보내면 끝.
      sendBlockMessage(personaId || null, nickname);
    },
  };

  function injectButtons() {
    injectBlockButtons(injectButtonsAdapter, {
      findPersonaId: function (container) {
        var ql = window.__QL || { personaMap: {} };
        return sharedFindPersonaId(container, function (id) { return ql.personaMap[id]; });
      },
      nicknameForPersonaId: function (pid) {
        var ql = window.__QL || { personaCache: {} };
        return ql.personaCache[pid];
      },
    });
  }

  window.__QL_onBlockListUpdate = function() { filterAll(); injectButtons(); };
  window.__QL_setFilterMode = function(mode) { window.__QL_FILTER_MODE = mode; filterAll(); };

  if (isActivePage()) { filterAll(); injectButtons(); }

  // ── 프로필 통계 (shared/web/core/profile-stats 로 이전. 어댑터만 entry 에 둠) ──
  // iOS native WebView 는 popup 이 SwiftUI 라 saveOwnerPersonaId / saveMyStats / removeMyStats 미구현.
  // 색상만 어댑터로 전달 — fetch / DOM 가드 / 캐시 전부 shared.
  var profileStatsAdapter: ProfileStatsAdapter = { qlPrimaryColor: QL_PRIMARY };

  var timer;
  var debounced = function() {
    clearTimeout(timer);
    timer = setTimeout(function() {
      if (isActivePage()) { filterAll(); injectButtons(); }
      // 프로필 페이지에서 SPA layout 이 늦게 그려지는 케이스용 — shared in-flight / cache 가드로 cheap.
      if (sharedIsProfilePage()) sharedInjectProfileStats(profileStatsAdapter);
    }, 200);
  };
  // SEL.scrollContainer 는 SPA 전환 시 detach 되어 observer 가 끊길 수 있어 document.body 사용.
  new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true });

  var lastPath = window.location.pathname;
  function onNavigate() {
    var newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;
    sharedResetProfileStatsCache();
    if (isActivePage()) { setTimeout(function() { filterAll(); injectButtons(); }, 500); }
    if (sharedIsProfilePage()) { setTimeout(function() { sharedInjectProfileStats(profileStatsAdapter); }, 500); }
  }
  window.addEventListener('popstate', onNavigate);
  var origPush = history.pushState;
  history.pushState = function() { origPush.apply(this, arguments); onNavigate(); };
  var origReplace = history.replaceState;
  history.replaceState = function() { origReplace.apply(this, arguments); onNavigate(); };

  if (sharedIsProfilePage()) sharedInjectProfileStats(profileStatsAdapter);
})();
true;
