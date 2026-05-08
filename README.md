# QuietLounge

네이버 라운지(`lounge.naver.com`)에서 특정 유저의 게시글을 숨기는 클라이언트 사이드 차단 도구.

[![개발자에게 커피 한 잔 사주기](https://img.shields.io/badge/☕_커피_한_잔_사주기-fairy.hada.io-FFCD00?style=for-the-badge&logoColor=000)](https://fairy.hada.io/@quite-lounge)

---

## 왜 만들었나

네이버 라운지에는 유저 차단(뮤트) 기능이 없다. 커뮤니티 특성상 반복적으로 불쾌한 글을 올리는 유저가 있어도, 매번 눈으로 걸러내는 수밖에 없다.

QuietLounge는 이 문제를 **클라이언트 단에서** 해결한다.

- 네이버 서버를 거치지 않는다. 로그인 세션이나 개인정보가 외부로 나가지 않는다.
- 닉네임이 아닌 **personaId**(고유 ID)로 차단하므로, 닉네임을 바꿔도 차단이 유지된다.
- Chrome 확장 프로그램, Safari 확장 프로그램(macOS/iOS), Android 앱으로 배포한다.

---

## 다운로드

[Releases](https://github.com/konempty/QuietLounge/releases)에서 최신 버전을 다운로드할 수 있다.

| 플랫폼              | 파일                                | 비고                                   |
|------------------|-----------------------------------|--------------------------------------|
| PC (Chrome 등)    | `QuietLounge-ChromeExtension.zip` | Chromium 계열 브라우저 모두 지원               |
| macOS/iOS Safari | Source code → Xcode 빌드            | 코드 사인 필요, Apple 개발자 계정으로 직접 빌드/설치    |
| Android          | `QuietLounge-Android.apk`         | Android 7.0 이상                       |

---

## PC 설치 방법 (Chrome 확장 프로그램)

### 1. 파일 다운로드

위 [다운로드](#다운로드) 링크에서 `chrome-extension.zip`을 받고 압축을 푼다.

### 2. 크롬에 설치

Chrome 주소창에 `chrome://extensions`를 입력한다.

![확장 프로그램 페이지](docs/images/chrome-extensions-page.png)

오른쪽 위 **개발자 모드** 토글을 켠다.

![개발자 모드 켜기](docs/images/chrome-dev-mode.png)

**압축해제된 확장 프로그램을 로드합니다** 버튼을 클릭하고, 압축을 풀었던 폴더를 선택한다.

![폴더 선택](docs/images/chrome-load-unpacked.png)

QuietLounge가 목록에 나타나면 설치 완료.

![설치 완료](docs/images/chrome-installed.png)

> Edge, Brave, Arc, Opera 등 Chromium 계열 브라우저에서도 동일하게 설치 가능하다.

### 3. 사용

네이버 라운지에 접속하면 자동으로 동작한다. 게시글 닉네임 옆에 **✕** 버튼이 보이면 정상.

![차단 버튼](docs/images/block-button.png)
![차단 확인](docs/images/block-confirm.png)

크롬 툴바의 QuietLounge 아이콘을 클릭하면 차단 목록 확인, 해제, 필터 모드 변경(완전 숨김/흐림 처리), 내보내기/가져오기가 가능하다.

![팝업 UI](docs/images/chrome-popup.png)

---

## Safari 설치 방법 (macOS / iOS)

Safari 확장 프로그램은 Xcode를 통해 직접 빌드하여 설치한다.

### 1. 요구 사항

- macOS + Xcode (최신 버전 권장)
- **Node.js 20+ 와 pnpm** — 라운지 inject JS 산출물 (`webview-scripts/{before,after}.js` 등) 을 빌드하기 위해 필요. 자세한 이유는 아래 § "왜 pnpm 빌드가 필요한가" 참조.
- iOS 기기 배포 시 Apple Developer 계정 필요

### 2. 빌드

```bash
# 1) JS 산출물 빌드 — Bundle 리소스로 들어갈 webview-scripts/{before,after}.js 등을 생성
pnpm install
pnpm build

# 2) Xcode 에서 프로젝트 열기
cd safari-extension/QuietLounge
open QuietLounge.xcodeproj
```

Xcode에서 프로젝트를 열고, 타겟을 선택한 뒤 빌드한다.

- **macOS**: `QuietLounge (macOS)` 타겟 선택 → Run
- **iOS**: `QuietLounge (iOS)` 타겟 선택 → 기기 연결 후 Run

> **`pnpm build` 를 안 돌리고 Xcode 빌드 시 어떤 일이 일어나나**
> 1차 가드 — **Xcode 빌드 단계에서 fail**: 각 target 의 `Verify webview-scripts artifacts` /
> `Verify content-scripts artifacts` Run Script Phase 가 Bundle 복사 후 산출물 파일 존재를 확인하고
> 누락 시 빌드를 중단 + 콘솔에 `Run 'pnpm install && pnpm build' from the lounge/ root` 안내 출력.
> 2차 가드 — Xcode 의 검증 phase 를 (예: 임의로 disable 하고) 우회한 경우에만 *런타임 fail-fast*:
> iOS 앱 시작 시 `Bundle.main.url(forResource: "after", withExtension: "js", subdirectory: "webview-scripts")`
> 로 산출물을 찾을 때 `preconditionFailure` 로 즉시 크래시 (Release 빌드 포함).
> 두 가드 모두 *silent 동작 누락* 을 차단.

### 왜 pnpm 빌드가 필요한가

라운지 페이지에 inject 되는 JS (`webview-scripts/*.js`, `content-scripts/*.js`) 는 모두 `web/` 의 TypeScript source 에서 esbuild 로 빌드되는 산출물이다. 4 플랫폼 (Chrome / Safari / iOS / Android) 이 같은 코드를 공유하기 위함. 산출물은 `.gitignore` — PR diff 노이즈 / 직접 편집 회귀 방지 + 결정론적 빌드라 누구든 같은 byte 를 얻는다.

### 3. 확장 프로그램 활성화

**macOS**:
1. Safari → 설정 → 확장 프로그램
2. QuietLounge 체크박스 활성화

**iOS**:
1. 설정 → Safari → 확장 프로그램
2. QuietLounge 활성화
3. 모든 웹사이트 허용 또는 `lounge.naver.com` 허용

### 4. 사용

Chrome 확장 프로그램과 동일하게 네이버 라운지에서 자동으로 동작한다.

iOS 앱에는 내장 브라우저(라운지 탭), 차단 목록, 설정 화면이 포함되어 있어 Safari 없이도 사용할 수 있다.

---

## Android 설치 방법

### 1. 파일 다운로드

위 [다운로드](#다운로드) 링크에서 `QuietLounge-Android.apk`를 받는다.

### 2. APK 설치

다운로드된 APK 파일을 열면 "출처를 알 수 없는 앱" 경고가 나올 수 있다. 설정에서 해당 앱(브라우저 또는 파일 관리자)의 설치를 허용한다.

![설치 허용](docs/images/android-unknown-app.png)

### 3. 사용

앱을 열면 네이버 라운지가 바로 표시된다. PC 버전과 동일하게 **✕** 버튼으로 유저를 차단할 수 있다.

![Android 앱](docs/images/android-app.png)
![차단 확인](docs/images/android-block-confirm.png)

하단 탭에서 차단 목록 확인/해제, 설정(필터 모드 변경, 내보내기/가져오기, 전체 삭제, 키워드 알림)이 가능하다.

![Android 차단 목록](docs/images/android-blocklist.png)
![Android 설정](docs/images/android-setting.png)

---

## 주요 기능

- **유저 차단**: 닉네임 옆 ✕ 버튼 클릭으로 즉시 차단
- **personaId 기반 추적**: 닉네임을 바꿔도 차단 유지, 이전 닉네임 기록
- **닉네임 차단 → 자동 승격**: personaId 미확보 시 닉네임으로 우선 차단, 이후 자동으로 personaId 보강
- **필터 모드**: 완전 숨김 또는 흐림 처리 선택 가능
- **키워드 알림**: 특정 채널의 새 글을 주기적으로 확인하여 키워드 매칭 시 알림 발송
- **차단 목록 백업**: JSON 내보내기/가져오기로 PC ↔ 앱 간 이동 가능 (키워드 알림 설정 포함)
- **보안**: 네이버 서버에 어떤 데이터도 전송하지 않음. 모든 데이터는 로컬에만 저장

### 키워드 알림

관심 있는 채널에 특정 키워드가 포함된 새 글이 올라오면 알림을 받을 수 있다.

1. 카테고리 → 채널 → 키워드를 설정하면 주기적(1~60분, 기본 5분)으로 새 글을 확인한다.
2. 키워드가 글 제목에 포함되면 알림이 표시되며, 알림을 탭하면 해당 글로 이동한다.

| 플랫폼               | 폴링 방식                              | 백그라운드           | 알림                        |
|-------------------|------------------------------------|-----------------|---------------------------|
| Chrome 확장         | chrome.alarms                      | O (서비스 워커)      | chrome.notifications      |
| Safari 확장 (iOS)   | iOS 컨테이너 앱 Timer (App Group 공유)    | X (앱 포그라운드만)    | UNUserNotificationCenter  |
| Safari 확장 (macOS) | browser.alarms (background page)   | O (Safari 실행 중) | Web Notification API      |
| Android 네이티브      | KeywordAlertScheduler (Coroutines) | X (앱 포그라운드만)    | NotificationManagerCompat |

> - **iOS / Android**: 앱이 포그라운드일 때만 주기적으로 확인하며, 앱을 닫았다가 다시 열면 그동안의 새 글을 한 번에 확인해 알림을 보낸다. iOS Safari 확장은 iOS 컨테이너 앱과 App Group으로 데이터를 공유하므로, 키워드 등록은 어디서 하든 동일하게 동작한다.
> - **macOS Safari 확장**: Safari Web Extension API의 제약(`browser.notifications` 미구현, 익스텐션 origin에서 `Notification.requestPermission` 미동작)을 우회하기 위해, background page가 매칭을 찾으면 `lounge.naver.com` 탭의 content script에 메시지를 보내 거기서 Web Notification을 발송한다. 따라서 **라운지 탭이 한 개 이상 열려 있어야 시스템 알림이 동작**하며, 탭이 없을 때는 툴바 아이콘 뱃지로 매칭 카운트를 표시한다. 권한은 `lounge.naver.com` 페이지에 자동 표시되는 안내 배너에서 한 번만 허용하면 된다.

---

## 보안 및 프라이버시

- **네이버 서버에 어떤 데이터도 전송하지 않는다.** 로그인 정보, 개인정보 수집/외부 전송 코드 없음.
- 차단 데이터는 **브라우저/폰 로컬 저장소에만** 저장된다.
- 크롬 확장 프로그램의 권한은 `lounge.naver.com`에서만 동작하도록 제한되어 있다.

---

## 기술 개요

### personaId 시스템

네이버 라운지는 유저를 8자리 영숫자 `personaId`로 식별한다. 이 ID는 DOM에 직접 노출되지 않지만, API 응답에 포함되어 있다.

QuietLounge는 `fetch`를 monkey-patch하여 API 응답을 가로채고, `postId → personaId` 매핑 테이블을 실시간으로 구축한다.

### 이중 매칭

1. 게시글의 `postId`로 personaId 매핑 테이블 조회
2. personaId가 있으면 → personaId로 차단 판단 (정확)
3. personaId가 없으면 → 닉네임으로 차단 판단 (폴백)

### 프로젝트 구조

```
shared/                          진짜 cross-platform 공통 (TypeScript)
├── types.ts                     타입 정의
└── block-list.ts                차단 목록 관리 (StorageAdapter 패턴)

web/                             라운지 페이지 inject JS 의 단일 소스 (esbuild 로 10 산출물 빌드)
├── core/                        공통 순수 함수 (selectors / pages / cleanbot / block-check / style /
│                                filter-engine / inject-buttons / find-persona-id / profile-stats /
│                                persona-extractor / storage-keys)
├── entries/                     플랫폼별 진입점 (chrome / safari-ext / ios-after / android-after /
│                                ios-before / android-before / web-api-interceptor /
│                                safari-injector / safari-storage-bridge)
└── platform/adapter.ts          InjectButtonsAdapter / ProfileStatsAdapter / PersonaExtractorAdapter

chrome-extension/                Chrome Extension (Manifest V3)
├── manifest.json
├── content-scripts/             모두 esbuild 산출물 (.gitignore — `pnpm build` 로 생성)
│   ├── main.js                  콘텐츠 스크립트 (필터링 + 차단 버튼 + 브릿지)
│   └── api-interceptor.js       MAIN world fetch 인터셉터
├── popup/                       차단 관리 팝업 UI
├── background/service-worker.js 뱃지 업데이트 + 키워드 알림 (alarms + notifications)
└── icons/

safari-extension/                Safari Web Extension (macOS + iOS)
└── QuietLounge/
    ├── Shared (Extension)/
    │   ├── Resources/
    │   │   ├── manifest.json    Safari용 매니페스트
    │   │   ├── content-scripts/ 모두 esbuild 산출물
    │   │   │   ├── main.js      콘텐츠 스크립트 (Safari 대응 + macOS 알림 권한 배너)
    │   │   │   ├── api-interceptor.js
    │   │   │   ├── injector.js  MAIN world 주입 (Safari는 world:"MAIN" 미지원)
    │   │   │   └── storage-bridge.js  iOS App Group 브릿지 (popup/content → 네이티브)
    │   │   ├── popup/           팝업 UI
    │   │   └── background/      background page (storage 브릿지 + macOS 키워드 알림)
    │   └── SafariWebExtensionHandler.swift  iOS App Group UserDefaults 라우터
    ├── iOS (App)/               iOS 컨테이너 앱 (WebView + 탭)
    │   ├── WebViewController.swift
    │   ├── BlockListViewController.swift
    │   ├── SettingsViewController.swift
    │   ├── BlockDataManager.swift           App Group UserDefaults 래퍼
    │   ├── KeywordAlertManager.swift        iOS 키워드 알림 (Timer + UNUserNotificationCenter)
    │   ├── WebViewScripts.swift             Bundle 의 before.js / after.js 산출물 로드 + placeholder 치환
    │   └── Resources/webview-scripts/       esbuild 산출물 (before.js / after.js — Bundle 리소스)
    └── macOS (App)/             macOS 컨테이너 앱 (단순 컨테이너, 모든 로직은 익스텐션이 담당)

android-app/                     네이티브 Android 앱 (Kotlin + Jetpack Compose)
├── build.gradle.kts             ktlint subproject 적용
├── gradle/libs.versions.toml    버전 카탈로그 (Kotlin / Compose / Coroutines 등)
└── app/
    ├── build.gradle.kts         R8 minify + resource shrink + bundle split
    ├── proguard-rules.pro       JavascriptInterface / kotlinx.serialization 보존 규칙
    └── src/main/
        ├── AndroidManifest.xml
        ├── kotlin/kr/konempty/quietlounge/
        │   ├── QuietLoungeApplication.kt    알림 채널 등록
        │   ├── MainActivity.kt              Splash → MainScreen 전환, 알림 클릭 처리
        │   ├── data/                        BlockListData / BlockListEngine / *Repository / KeywordAlert
        │   ├── network/LoungeApi.kt
        │   ├── notification/                NotificationHelper / KeywordAlertScheduler
        │   ├── webview/
        │   │   ├── NativeBridge.kt          JavascriptInterface (window.QuietLounge)
        │   │   └── WebViewScripts.kt        assets 의 before/after.js 로드 + 동적 치환
        │   └── ui/                          Splash / MainScreen / lounge / blocklist / settings
        └── assets/webview-scripts/          esbuild 산출물 (before.js / after.js)

scripts/build.mjs                web/ → 10 산출물 esbuild 빌드 (산출물은 .gitignore — 모든 빌드
                                  진입점이 esbuild 를 선행 호출하고 Xcode/Gradle 측은 산출물 존재 검증)

.github/workflows/build.yml      GitHub Actions 빌드 (수동 실행)
                                  - JS 단위 테스트 (esbuild 선행 후 vitest)
                                  - Safari iOS/macOS 컴파일 체크 (서명 없이) — Xcode 빌드 시 산출물 검증 phase 포함
                                  - Chrome ZIP / Android APK 빌드 + Release 생성
```

---

## 차단 데이터 구조

```json
{
  "version": 2,
  "blockedUsers": {
    "92nccavj": {
      "personaId": "92nccavj",
      "nickname": "닉네임",
      "blockedAt": "2026-03-17T12:00:00Z"
    }
  },
  "nicknameOnlyBlocks": [],
  "personaCache": {}
}
```

- `blockedUsers` — personaId 확보된 차단 유저 (닉네임 변경 시에도 차단 유지)
- `nicknameOnlyBlocks` — personaId 미확보 임시 차단 (추후 자동 승격)
- `personaCache` — 수집된 personaId-닉네임 매핑 캐시 (내보내기 시 제외)

### v2 스키마 변경 이력 (1.0.2)

`BlockedUser.previousNicknames` 와 `BlockedUser.reason` / `NicknameOnlyBlock.reason` 필드는 1.0.2 에서 제거되었다.
- 사용처 부재 — 차단 사유 입력 UI 가 없어 `reason` 은 항상 빈 문자열, `previousNicknames` 는 자동 추적되었으나 어느 플랫폼 UI 에도 노출되지 않았음.
- 옛 백업/storage 호환: 모든 파서(`kotlinx.serialization` 의 `ignoreUnknownKeys`, JS `JSON.parse`, Swift dictionary)가 옛 필드를 자동 무시하므로 import 는 깨지지 않는다. 다만 다음 저장/내보내기 때 옛 메타데이터가 떨어진다 — 사용처가 없어 실용 영향은 없으나 명시적으로 양해.
- `version` 은 그대로 `2` 유지 (forward/backward compat 모두 유지 — 옛 앱이 새 JSON 을 읽으면 빠진 필드는 default 값으로 채움).

---

## 개발

### 린팅

```bash
# 루트 (shared + chrome-extension + tampermonkey) — pnpm 사용
pnpm lint           # ESLint 검사
pnpm lint:fix       # 자동 수정
pnpm format         # Prettier 포맷팅

# Android (Kotlin)
cd android-app
./gradlew ktlintCheck             # Kotlin 포맷팅 검사
./gradlew ktlintFormat            # 자동 수정

# iOS / macOS (Swift)
cd safari-extension/QuietLounge
swiftlint                         # SwiftLint 검사
swiftlint --fix                   # 자동 수정
```

### 테스트

```bash
# 모든 플랫폼 테스트 한 번에
./run-tests.sh            # JS + Android + Swift + lint
./run-tests.sh --fast     # lint 생략
./run-tests.sh --js       # JS 만
./run-tests.sh --android  # Android 만
./run-tests.sh --swift    # Swift 만

# 플랫폼별 개별 실행
pnpm test                                          # JS/TS (Vitest)
cd android-app && ./gradlew :app:testDebugUnitTest # Android (JUnit)
cd swift-tests && swift test                       # iOS/macOS (XCTest)
```

테스트는 다음 계층을 커버한다:
- **shared/block-list.ts** (Vitest) — 차단/해제/승격/import·export
- **web** (Vitest + JSDOM) — selectors / cleanbot / pages / block-check / style / filter-engine /
  inject-buttons / profile-stats / persona-extractor + 산출물 존재 / placeholder / 핵심 토큰 회귀 가드
- **chrome-extension / safari-extension service-worker** (Vitest) — 키워드 매칭 + lastChecked 전진 로직 회귀 방지
- **android-app** (JUnit) — `BlockListEngine`, `BlockListData` 직렬화, `KeywordAlert`, `IsoDate` 파싱 등
- **iOS/macOS** (XCTest via Swift Package) — `QuietLoungeCore` (날짜 파싱, 키워드 매칭, 채널 처리,
  WebViewScripts placeholder 치환). 실제 iOS 앱 소스를 심볼릭 링크로 포함해 drift 방지.

### 로컬 빌드

```bash
# 4 플랫폼 inject JS 산출물 (편집은 web/ 에서, 산출물은 .gitignore)
pnpm install
pnpm build                        # 10 산출물 동시 빌드 (esbuild, ~수십 ms)

# Android (네이티브, Kotlin + Compose)
cd android-app
./gradlew :app:assembleRelease    # preBuild 가 esbuild 자동 hook — pnpm 만 PATH 에 있으면 됨

# iOS — Safari Web Extension + 네이티브 컨테이너
# 주의: Xcode 빌드 *전에* 위의 `pnpm build` 를 한 번 돌려야 한다 (Bundle 의 webview-scripts/* 가 산출물).
open safari-extension/QuietLounge/QuietLounge.xcodeproj
```

> Android release 빌드를 하려면 `android-app/release.keystore` (서명 키) 와 `android-app/release.keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) 가 필요하다. 이 파일들은 `.gitignore` 처리되어 있다.

---

## 주의사항

- 네이버 라운지의 DOM 구조나 API가 변경되면 업데이트가 필요할 수 있다.
- 차단 데이터는 로컬에만 저장된다. 브라우저/앱 초기화 시 데이터가 사라지므로 정기적인 백업을 권장한다.

---

## 라이선스

MIT
