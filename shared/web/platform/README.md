# shared/web/platform — 플랫폼 어댑터 인터페이스

이번 PR (#1) 에서는 **스캐폴딩만 존재**합니다. 후속 PR 에서 채워 넣게 될 4 종 어댑터의 시그너처
(`StorageAdapter`, `BridgeAdapter`, `ConfirmAdapter`, `BtnClassAdapter`) 가 `adapter.ts` 에
정의되어 있고, 각 플랫폼 entry 가 자체 구현체를 만들어 shared 함수에 주입할 예정.

## 후속 PR 에서 어떻게 활용되나

`PR #3 — inject-buttons` 부터 본격적으로 사용. 이때 `entries/*.ts` 4 개의 IIFE 안에서:

```ts
const adapter: PlatformAdapter = {
  storage: { /* chrome.storage.local 또는 browser.storage 또는 placeholder + native bridge */ },
  bridge: { sendBlock(pid, nick) { /* runtime.sendMessage 또는 webkit.messageHandlers ... */ } },
  confirm: { confirm: async (msg) => { /* native confirm() 또는 qlConfirm DOM modal */ } },
  btn: { className: 'quiet-lounge-btn' /* 또는 'ql-btn' */ },
};

setupInjectButtons(adapter); // shared 함수
```

shared 측 `setupInjectButtons` 는 `adapter` 만 보고 동작하므로 — 어떤 플랫폼인지 알 필요 없이
같은 코드가 4 곳에서 재사용된다.

## 4 플랫폼 차이 cheat sheet

| 항목          | Chrome                       | Safari ext                                             | iOS native                                          | Android                                        |
|-------------|------------------------------|--------------------------------------------------------|-----------------------------------------------------|------------------------------------------------|
| storage     | `chrome.storage.local` (cb)  | `browser.storage.local` (Promise) + `__QL_storage` 브릿지 | placeholder + `webkit.messageHandlers.qlBridge`     | placeholder + `window.QuietLounge.postMessage` |
| bridge      | `chrome.runtime.sendMessage` | `browser.runtime.sendMessage`                          | `webkit.messageHandlers.qlBridge.postMessage(JSON)` | `window.QuietLounge.postMessage(JSON)`         |
| confirm     | native `confirm()`           | `qlConfirm` DOM modal (iOS Safari 의 confirm 봉쇄 우회)     | native bridge → UIAlertController 로 콜백 받음           | native bridge → AlertDialog 로 콜백 받음            |
| btn class   | `quiet-lounge-btn`           | `quiet-lounge-btn`                                     | `ql-btn`                                            | `ql-btn`                                       |
| MAIN world  | yes (api-interceptor)        | yes (별도 파일 inject)                                     | n/a                                                 | n/a                                            |
| placeholder | n/a (storage 동기 로드)          | n/a                                                    | `__QL_BLOCK_DATA_PLACEHOLDER__`                     | `__QL_BLOCK_DATA_PLACEHOLDER__`                |
