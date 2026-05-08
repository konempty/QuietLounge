// @ts-nocheck
// QuietLounge — iOS Native WebView beforeScript (WKUserScript .atDocumentStart)
//
// 이 파일은 esbuild 가 IIFE 로 번들해
// safari-extension/QuietLounge/iOS (App)/Resources/webview-scripts/before.js 산출물을 만든다.
// Swift WebViewScripts.beforeScript() 가 Bundle.main.url 로 이 파일을 로드해
// WKUserScript / evaluateJavaScript 로 주입 (afterScript 와 동일 패턴).
//
// fetch monkey-patch / hydration parser / DOM fallback 은 shared/web/core/persona-extractor 에서
// 처리. 이 entry 의 책임은 native bridge (webkit.messageHandlers.qlBridge) 호출만.

import { setupPersonaExtractor } from '../core/persona-extractor';
import type { PersonaExtractorAdapter } from '../platform/adapter';

(function () {
  'use strict';

  const adapter: PersonaExtractorAdapter = {
    pushPersonaMap(payload) {
      try {
        const handler =
          window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.qlBridge;
        if (handler && typeof handler.postMessage === 'function') {
          handler.postMessage(JSON.stringify({ type: 'PERSONA_MAP_UPDATE', payload }));
        }
      } catch {
        // 무시
      }
    },
  };

  setupPersonaExtractor(adapter);
})();
true;
