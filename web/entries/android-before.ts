// @ts-nocheck
// QuietLounge — Android WebView before.js (document_start)
//
// 이 파일은 esbuild 가 IIFE 로 번들해 android-app/app/src/main/assets/webview-scripts/before.js
// 산출물을 만든다. Kotlin WebViewScripts.loadBefore() 가 assets.open() 으로 읽고
// WebViewClient.onPageStarted 시점에 evaluateJavascript() 로 주입.
//
// fetch monkey-patch / hydration parser / DOM fallback 은 web/core/persona-extractor 에서
// 처리. 이 entry 의 책임은 native bridge (Android WebMessageListener) 호출만.

import { setupPersonaExtractor } from '../core/persona-extractor';
import type { PersonaExtractorAdapter } from '../platform/adapter';

(function () {
  'use strict';

  const adapter: PersonaExtractorAdapter = {
    pushPersonaMap(payload) {
      try {
        if (window.QuietLounge && typeof window.QuietLounge.postMessage === 'function') {
          window.QuietLounge.postMessage(JSON.stringify({ type: 'PERSONA_MAP_UPDATE', payload }));
        }
      } catch {
        // bridge 미설치 (예: 로컬 dev 페이지) 등은 무시.
      }
    },
  };

  setupPersonaExtractor(adapter);
})();
true;
