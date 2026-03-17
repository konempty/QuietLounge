# QuietLounge

네이버 라운지(`lounge.naver.com`)에서 특정 유저의 게시글을 숨기는 클라이언트 사이드 차단 도구.

---

## 왜 만들었나

네이버 라운지에는 유저 차단(뮤트) 기능이 없다. 커뮤니티 특성상 반복적으로 불쾌한 글을 올리는 유저가 있어도, 매번 눈으로 걸러내는 수밖에 없다.

QuietLounge는 이 문제를 **클라이언트 단에서** 해결한다.

- 네이버 서버를 거치지 않는다. 로그인 세션이나 개인정보가 외부로 나가지 않는다.
- 닉네임이 아닌 **personaId**(고유 ID)로 차단하므로, 닉네임을 바꿔도 차단이 유지된다.
- 브라우저 확장 프로그램(Chrome)과 Tampermonkey 스크립트, 두 가지 방식을 지원한다.

---

## 설치 방법

### Chrome 확장 프로그램 (권장)

1. 이 저장소를 클론하거나 다운로드한다.
2. Chrome에서 `chrome://extensions`로 이동한다.
3. 우측 상단 **개발자 모드**를 켠다.
4. **압축해제된 확장 프로그램을 로드합니다** 를 클릭한다.
5. `chrome-extension/` 폴더를 선택한다.
6. 네이버 라운지에 접속하면 자동으로 동작한다.

> Edge, Brave, Arc 등 Chromium 계열 브라우저에서도 동일하게 사용 가능하다.

### Tampermonkey (테스트용)

1. 브라우저에 [Tampermonkey](https://www.tampermonkey.net/) 확장 프로그램을 설치한다.
2. Tampermonkey 대시보드에서 새 스크립트를 추가한다.
3. `tampermonkey-test.user.js` 내용을 붙여넣고 저장한다.
4. 네이버 라운지에 접속하면 자동으로 동작한다.

---

## 사용 방법

### 유저 차단

네이버 라운지의 게시글 목록(`/channels/**` 또는 `/posts/**` 페이지)에서 각 게시글의 닉네임 옆에 작은 **✕** 버튼이 나타난다. 클릭하면 확인 팝업 후 해당 유저가 차단된다.

- personaId가 확보된 경우: 닉네임을 바꿔도 차단 유지
- personaId가 아직 없는 경우: 닉네임 기반으로 즉시 차단, 이후 자동으로 personaId 보강

### 차단 해제

Chrome 확장 프로그램의 팝업 아이콘을 클릭하면 차단 목록이 표시된다. 각 유저 옆의 **해제** 버튼으로 차단을 풀 수 있다.

### 차단 목록 백업

팝업 하단의 **내보내기 (JSON)** 버튼으로 차단 목록을 JSON 파일로 저장하고, **가져오기** 버튼으로 복원할 수 있다.

---

## 동작 경로 제한

필터링과 차단 버튼은 아래 경로에서만 동작한다:

- `/posts/**` — 게시글 목록 및 상세
- `/channels/**` — 채널 피드

랭킹, 검색 등 다른 페이지에서는 동작하지 않는다. API 인터셉터(personaId 수집)만 모든 페이지에서 백그라운드로 동작한다.

---

## 기술 개요

### personaId 시스템

네이버 라운지는 유저를 8자리 영숫자 `personaId`로 식별한다. 이 ID는 DOM에 직접 노출되지 않지만, 피드 API 응답에 포함되어 있다.

QuietLounge는 `fetch`를 monkey-patch하여 무한 스크롤 시 호출되는 피드 API 응답을 가로채고, `postId → personaId` 매핑 테이블을 실시간으로 구축한다.

### 이중 매칭

1. 게시글의 `postId`로 personaId 매핑 테이블 조회
2. personaId가 있으면 → personaId로 차단 판단 (정확)
3. personaId가 없으면 → 닉네임으로 차단 판단 (폴백)

### 프로젝트 구조

```
shared/                          공통 모듈 (TypeScript)
├── types.ts                     타입 정의
├── selectors.ts                 DOM 셀렉터, URL 체크 함수
├── block-list.ts                차단 목록 관리
├── api-interceptor.ts           fetch 인터셉트, personaId 수집
├── filter-engine.ts             게시글 필터링 엔진
└── ui-injector.ts               차단 버튼 주입

chrome-extension/                Chrome Extension (Manifest V3)
├── manifest.json
├── content-scripts/main.js      콘텐츠 스크립트
├── popup/                       차단 관리 팝업 UI
├── background/service-worker.js 뱃지 업데이트
└── icons/

tampermonkey-test.user.js        Tampermonkey 테스트 스크립트
```

`shared/`는 모든 플랫폼(Chrome Extension, Tampermonkey, 추후 모바일 앱)에서 재사용하는 공통 로직이다. Chrome Extension의 `main.js`는 이 로직을 순수 JS로 인라인 번들한 형태다.

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
- `personaCache` — 수집된 personaId-닉네임 매핑 캐시

---

## 브라우저 지원

| 브라우저 | 방식 |
|----------|------|
| Chrome | Chrome Extension |
| Edge, Brave, Arc, Opera, Vivaldi | Chrome Extension (동일) |
| Firefox | Tampermonkey (Add-on 포팅 예정) |
| 기타 | Tampermonkey |

---

## 주의사항

- 네이버 라운지의 DOM 구조나 API가 변경되면 셀렉터/인터셉터 업데이트가 필요할 수 있다.
- 이 도구는 클라이언트 사이드에서만 동작하며, 네이버 서버에 어떠한 요청도 보내지 않는다.
- 차단 데이터는 브라우저 로컬 저장소에만 저장된다. 브라우저를 초기화하면 데이터가 사라지므로 정기적인 백업을 권장한다.

---

## 라이선스

MIT
