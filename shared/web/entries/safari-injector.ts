// @ts-nocheck
// QuietLounge — Safari Web Extension injector (ISOLATED world, document_start)
//
// 이 파일은 esbuild 가 IIFE 로 번들해
// safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/injector.js 산출물을
// 만든다. manifest.json 의 content_scripts 첫 번째 항목 (storage-bridge.js + injector.js) 에서
// 호출되어 page world (MAIN world) 에 api-interceptor.js 를 동적 inject 한다.
//
// Chrome 은 manifest 의 `world: "MAIN"` 으로 직접 inject 가능하지만 Safari ext 은 미지원이라
// ISOLATED 측에서 <script src=...> 동적 삽입으로 같은 효과.

(function () {
  'use strict';
  const script = document.createElement('script');
  script.src = (typeof browser !== 'undefined' ? browser : chrome).runtime.getURL(
    'content-scripts/api-interceptor.js',
  );
  document.documentElement.appendChild(script);
  script.onload = function () {
    script.remove();
  };
})();
