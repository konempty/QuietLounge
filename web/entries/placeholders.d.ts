// iOS Swift WebViewScripts.swift / Android WebViewScripts.kt 가 빌드 산출물 텍스트를
// 읽어 `replacingOccurrences` / `String.replace` 로 런타임에 주입하는 placeholder.
// JS 파일 안에서는 절대 평가되지 않지만 (네이티브 측이 치환), TypeScript 타입 검사를
// 통과시키기 위한 ambient 선언.
//
// esbuild 는 `define` 옵션을 사용하지 않는 한 미정의 글로벌을 그대로 통과시키므로
// 산출물에 식별자가 보존된다 (`tests/build/artifacts.test.js` 가 회귀 가드).
declare const __QL_BLOCK_DATA_PLACEHOLDER__: unknown;
