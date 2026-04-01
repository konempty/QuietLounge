# QuietLounge

네이버 라운지(`lounge.naver.com`)에서 특정 유저의 게시글을 숨기는 클라이언트 사이드 차단 도구.

[![개발자에게 커피 한 잔 사주기](https://img.shields.io/badge/☕_커피_한_잔_사주기-카카오페이-FFCD00?style=for-the-badge&logoColor=000)](https://qr.kakaopay.com/FG31jvTdV)

---

## 왜 만들었나

네이버 라운지에는 유저 차단(뮤트) 기능이 없다. 커뮤니티 특성상 반복적으로 불쾌한 글을 올리는 유저가 있어도, 매번 눈으로 걸러내는 수밖에 없다.

QuietLounge는 이 문제를 **클라이언트 단에서** 해결한다.

- 네이버 서버를 거치지 않는다. 로그인 세션이나 개인정보가 외부로 나가지 않는다.
- 닉네임이 아닌 **personaId**(고유 ID)로 차단하므로, 닉네임을 바꿔도 차단이 유지된다.
- 현재는 Chrome 확장 프로그램과 Android 앱만 배포한다.

---

## 다운로드

[Releases](https://github.com/konempty/QuietLounge/releases)에서 최신 버전을 다운로드할 수 있다.

| 플랫폼           | 파일                                | 비고                     |
|---------------|-----------------------------------|------------------------|
| PC (Chrome 등) | `QuietLounge-ChromeExtension.zip` | Chromium 계열 브라우저 모두 지원 |
| Android       | `QuietLounge-Android.apk`         | Android 8.0 이상         |

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

## Android 설치 방법

### 1. 파일 다운로드

위 [다운로드](#다운로드) 링크에서 `android-apk`를 받는다. (GitHub 로그인 필요)

### 2. APK 설치

다운로드된 APK 파일을 열면 "출처를 알 수 없는 앱" 경고가 나올 수 있다. 설정에서 해당 앱(브라우저 또는 파일 관리자)의 설치를 허용한다.

![설치 허용](docs/images/android-unknown-app.png)

### 3. 사용

앱을 열면 네이버 라운지가 바로 표시된다. PC 버전과 동일하게 **✕** 버튼으로 유저를 차단할 수 있다.

![Android 앱](docs/images/android-app.png)
![차단 확인](docs/images/android-block-confirm.png)

하단 탭에서 차단 목록 확인/해제, 설정(필터 모드 변경, 내보내기/가져오기, 전체 삭제)이 가능하다.

![Android 차단 목록](docs/images/android-blocklist.png)
![Android 설정](docs/images/android-setting.png)

---

## 주요 기능

- **유저 차단**: 닉네임 옆 ✕ 버튼 클릭으로 즉시 차단
- **personaId 기반 추적**: 닉네임을 바꿔도 차단 유지, 이전 닉네임 기록
- **닉네임 차단 → 자동 승격**: personaId 미확보 시 닉네임으로 우선 차단, 이후 자동으로 personaId 보강
- **필터 모드**: 완전 숨김 또는 흐림 처리 선택 가능
- **차단 목록 백업**: JSON 내보내기/가져오기로 PC ↔ 앱 간 이동 가능
- **보안**: 네이버 서버에 어떤 데이터도 전송하지 않음. 모든 데이터는 로컬에만 저장

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
shared/                          공통 모듈 (TypeScript)
├── types.ts                     타입 정의
└── block-list.ts                차단 목록 관리 (StorageAdapter 패턴)

chrome-extension/                Chrome Extension (Manifest V3)
├── manifest.json
├── content-scripts/
│   ├── main.js                  콘텐츠 스크립트 (필터링 + 차단 버튼 + 브릿지)
│   └── api-interceptor.js       MAIN world fetch 인터셉터
├── popup/                       차단 관리 팝업 UI
├── background/service-worker.js 뱃지 업데이트
└── icons/

mobile-app/                      Android 앱 (Expo + React Native)
├── app/
│   ├── _layout.tsx              BlockListProvider + 테마
│   └── (tabs)/
│       ├── _layout.tsx          3탭 (라운지/차단목록/설정)
│       ├── index.tsx            WebView + JS inject + 브릿지
│       ├── blocklist.tsx        차단 목록 네이티브 UI
│       └── settings.tsx         설정
├── hooks/
│   ├── useBlockList.ts          차단 목록 상태관리 (shared/ import)
│   └── useThemeColors.ts        라이트/다크 테마 컬러
├── utils/
│   └── webview-scripts.ts       injectable JS 문자열 생성
└── constants/
    └── Colors.ts                테마 컬러 정의

tampermonkey-test.user.js        Tampermonkey 스크립트 (개발/테스트용)

.github/workflows/build.yml     GitHub Actions 빌드 (수동 실행)
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
      "previousNicknames": [],
      "blockedAt": "2026-03-17T12:00:00Z",
      "reason": ""
    }
  },
  "nicknameOnlyBlocks": [],
  "personaCache": {}
}
```

- `blockedUsers` — personaId 확보된 차단 유저 (닉네임 변경 시에도 차단 유지)
- `nicknameOnlyBlocks` — personaId 미확보 임시 차단 (추후 자동 승격)
- `personaCache` — 수집된 personaId-닉네임 매핑 캐시 (내보내기 시 제외)

---

## 개발

### 린팅

```bash
# 루트 (shared + chrome-extension + tampermonkey)
npm run lint        # ESLint 검사
npm run lint:fix    # 자동 수정
npm run format      # Prettier 포맷팅

# 모바일 앱
cd mobile-app
npm run lint        # ESLint 검사
```

### 모바일 앱 로컬 빌드

```bash
cd mobile-app
npm install
npx expo prebuild
npx expo run:android    # Android
npx expo run:ios        # iOS (개발용, 배포 미지원)
```

---

## 주의사항

- 네이버 라운지의 DOM 구조나 API가 변경되면 업데이트가 필요할 수 있다.
- 차단 데이터는 로컬에만 저장된다. 브라우저/앱 초기화 시 데이터가 사라지므로 정기적인 백업을 권장한다.

---

## 라이선스

MIT
