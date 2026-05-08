// @ts-nocheck
// QuietLounge — API Interceptor (Chrome MAIN world / Safari Web Extension page world)
//
// 이 파일은 esbuild 가 IIFE 로 번들해 두 산출물을 만든다 (단일 source, 두 outfile):
//   - chrome-extension/content-scripts/api-interceptor.js
//   - safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/api-interceptor.js
//
// 두 플랫폼 모두 *page world* 에서 fetch monkey-patch 가 필요한 이유:
//   - Chrome: manifest.json `world: "MAIN"` 으로 명시 inject (CSP 우회).
//   - Safari ext: ISOLATED world 의 injector.js 가 `<script src="api-interceptor.js">` 동적 inject.
// page world 의 window.fetch 를 wrap 해서 ISOLATED world content script (main.js) 로
// `window.postMessage({ type: 'QUIET_LOUNGE_API_DATA', ... })` 로 매핑 전달.
//
// fetch 패치 / regex / DOM fallback 은 shared/web/core/persona-extractor 에서 처리. 이 entry 의
// 책임은 (a) page→content message 변환 (b) ISOLATED 의 'QUIET_LOUNGE_REQUEST_DATA' 요청 응답.

import { setupPersonaExtractor } from '../core/persona-extractor';
import type { PersonaExtractorAdapter } from '../platform/adapter';

(function () {
  'use strict';

  function postToContentScript(payload: {
    personaMap: Record<string, string>;
    personaCache: Record<string, string>;
  }) {
    window.postMessage(
      {
        type: 'QUIET_LOUNGE_API_DATA',
        personaMap: payload.personaMap,
        personaCache: payload.personaCache,
      },
      '*',
    );
  }

  const adapter: PersonaExtractorAdapter = {
    pushPersonaMap: postToContentScript,
  };

  setupPersonaExtractor(adapter);

  // ISOLATED world content script (main.js) 가 매핑 데이터 요청 시 현재 누적된 매핑을 응답.
  // shared 측의 window.__QL 에서 직접 읽어 메시지 송신.
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'QUIET_LOUNGE_REQUEST_DATA') {
      const ql = window.__QL || { personaMap: {}, personaCache: {} };
      postToContentScript({ personaMap: ql.personaMap, personaCache: ql.personaCache });
    }
  });
})();
