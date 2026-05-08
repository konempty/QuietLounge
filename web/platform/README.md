# web/platform — 플랫폼 어댑터 인터페이스

`adapter.ts` 가 shared core 함수가 의존하는 모든 어댑터를 정의한다. 각 플랫폼 entry 가 자체 구현체를
만들어 shared 함수에 주입 — shared 측은 어떤 플랫폼인지 모르고 어댑터 인터페이스만 본다.

## 어댑터 목록

| 어댑터 | 사용처 | 핵심 책임 |
|---|---|---|
| `InjectButtonsAdapter` | `core/inject-buttons.ts` | 차단 버튼 DOM 생성 / 클릭 시 차단 flow / path B pid 미매핑 정책 / bfcache 가드 |
| `ProfileStatsAdapter` | `core/profile-stats.ts` | 브랜드 색 / 본인 프로필 영속화 / 내 통계 (Chrome·Safari 만) |
| `PersonaExtractorAdapter` | `core/persona-extractor.ts` | fetch monkey-patch 결과를 native bridge / window.postMessage 로 push |
| `StorageAdapter` / `BridgeAdapter` / `ConfirmAdapter` / `BtnClassAdapter` | (스캐폴딩) | 후속 작업이 있을 경우 사용할 4 종 묶음. 현재 entry 들은 위 3 개만 직접 의존 |

## 사용 패턴 (예: inject-buttons)

```ts
const adapter: InjectButtonsAdapter = {
  buttonClassName: 'quiet-lounge-btn',
  pathBMissingPidStrategy: 'show-error',
  createButton() { /* className / 스타일 / hover/touch */ },
  onBlockClick(pid, nick) { /* confirm + block + filterAll + hint */ },
};

injectBlockButtons(adapter, ctx); // shared 함수
```

shared 측 `injectBlockButtons` 는 `adapter` 만 보고 path A / path B / cleanbot 가드 / bfcache
liveButtons 같은 공통 로직을 처리한다.

## 4 플랫폼 차이 cheat sheet

| 항목 | Chrome | Safari ext | iOS native | Android |
|---|---|---|---|---|
| storage | `chrome.storage.local` (cb) | `browser.storage.local` (Promise) + `__QL_storage` 브릿지 | placeholder | placeholder |
| bridge | `chrome.runtime.sendMessage` | `browser.runtime.sendMessage` | `webkit.messageHandlers.qlBridge` | `window.QuietLounge.postMessage` |
| confirm | native `confirm()` | `qlConfirm` DOM modal | native bridge → UIAlertController | native bridge → AlertDialog |
| btn 클래스 | `quiet-lounge-btn` | `quiet-lounge-btn` | `ql-btn` | `ql-btn` |
| MAIN world 분리 | manifest `world: "MAIN"` | injector.js 동적 `<script>` | n/a | n/a |
| placeholder | n/a | n/a | `__QL_BLOCK_DATA_PLACEHOLDER__` | `__QL_BLOCK_DATA_PLACEHOLDER__` |
