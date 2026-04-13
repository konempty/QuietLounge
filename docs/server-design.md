# QuietLounge 키워드 알림 서버 설계 문서

## Context

현재 키워드 알림은 클라이언트(앱/확장)에서 직접 네이버 라운지 API를 폴링하는 방식이다. iOS 백그라운드 실행 제한으로 실시간 알림이 불가능하고, Safari 확장은 notifications API 자체가 없다. 서버를 통해 FCM/APNs 푸시를 보내면 앱 상태와 무관하게 알림을 수신할 수 있다.

---

## 1. 제약 사항

### 네이버 라운지 API
- Rate limit: **분당 10~15회** 안전 범위 (20회 근처에서 임시 차단)
- 채널별로만 글 목록 조회 가능 (전체 피드 API 없음)
- 요청당 최대 50개 글
- 총 약 200개+ 채널 (빠르게 증가 중)

### 관련 API
| API                                                               | 용도                   |
|-------------------------------------------------------------------|----------------------|
| `GET /content-api/v1/categories?depth=2`                          | 상위 카테고리 목록           |
| `GET /content-api/v1/channels?categoryId={id}&page={n}&size={n}`  | 카테고리별 채널 목록 (페이지네이션) |
| `GET /discovery-api/v1/feed/channels/{channelId}/recent?limit=50` | 채널 최신 글 목록 (postId만) |
| `GET /content-api/v1/posts?postIds={id}&postIds={id}...`          | 글 제목/상세 일괄 조회        |

### 비즈니스 요구사항
- 유저는 어떤 채널이든 키워드 알림 등록 가능
- 로그인/회원가입 없음 (진입장벽 최소화)
- 유저 개인정보를 서버에 저장하지 않음

---

## 2. 핵심 아키텍처: FCM 토픽 기반

### 왜 FCM 토픽인가?

기존 방식(서버가 유저별 구독 관리)의 문제:
- 유저 인증 필요 → 로그인 기능 필요 → 진입장벽 증가
- 유저 개인정보 저장 → 보안 부담
- A 유저가 B 유저의 설정을 변조할 위험

FCM 토픽 방식의 장점:
- **유저 정보 불필요** — 서버에 유저/디바이스 테이블 없음
- **인증 불필요** — FCM이 토큰 기반으로 라우팅
- **확장성** — FCM이 수백만 구독자 라우팅을 처리
- **보안 단순** — 개인정보가 없으므로 유출 위험 없음

### 전체 흐름

```
┌────────────────────────────────────────────────────────────┐
│  클라이언트 (앱/확장)                                        │
│                                                            │
│  키워드 알림 등록 시:                                        │
│  1. FCM 토픽 구독: "ch_{channelId}_kw_{keyword}"            │
│  2. 서버에 토픽 활성화 요청: POST /api/topics/subscribe      │
│                                                            │
│  앱 실행 시:                                                │
│  3. 서버에 하트비트: POST /api/topics/heartbeat              │
│     (내 구독 토픽 목록 전송 → TTL 갱신)                       │
│                                                            │
│  키워드 알림 해제 시:                                        │
│  4. FCM 토픽 구독 해제                                      │
│  5. 서버에 토픽 비활성화: POST /api/topics/unsubscribe       │
└────────────────────┬───────────────────────────────────────┘
                     │ REST API
┌────────────────────▼───────────────────────────────────────┐
│  Spring Boot 서버                                          │
│                                                            │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────┐    │
│  │ API      │    │ Poller    │    │ Notification     │    │
│  │ Layer    │    │ (Cron)    │    │ Service          │    │
│  │          │    │           │    │                  │    │
│  │ - 토픽   │    │ - 5초마다  │    │ - FCM 토픽      │    │
│  │   등록   │    │   1채널    │    │   메시지 발송    │    │
│  │ - 하트비트│    │   폴링    │    │                  │    │
│  └────┬─────┘    └─────┬─────┘    └────────┬─────────┘    │
│       │                │                   │              │
│  ┌────▼────────────────▼───────────────────▼──────────┐   │
│  │                    DB                              │   │
│  │  active_topics + channel_cursors                   │   │
│  └────────────────────────────────────────────────────┘   │
└────────────────────┬──────────────────────────────────────┘
                     │
              ┌──────▼──────┐
              │   FCM       │
              │ (토픽 발송)  │──→ Android, iOS, Chrome
              └─────────────┘
```

---

## 3. 기술 스택

| 항목  | 선택                             | 비고                         |
|-----|--------------------------------|----------------------------|
| 서버  | Spring Boot (Kotlin)           |                            |
| DB  | H2 (초기) → PostgreSQL (운영)      |                            |
| 푸시  | FCM (Firebase Cloud Messaging) | Android, iOS, Chrome 모두 지원 |
| 빌드  | Gradle (Kotlin DSL)            |                            |
| 레포  | 별도 레포 (`quietlounge-server`)   |                            |
| 호스팅 | 추후 결정                          | VPS 또는 AWS                 |

### FCM과 APNs 관계
- FCM은 iOS에도 푸시를 보낼 수 있음 (FCM이 내부적으로 APNs를 호출)
- 따라서 **FCM만으로 Android + iOS + Chrome 모두 커버 가능**
- Apple Developer Program ($99/년) 필요 (APNs 인증서/키)
- Safari 확장은 FCM 미지원 → 로컬 폴링 유지

---

## 4. DB 스키마

### active_topics
구독자가 있는 (채널, 키워드) 쌍을 관리. 유저 정보 없음.

```sql
CREATE TABLE active_topics (
    channel_id        VARCHAR(50)   NOT NULL,
    keyword           VARCHAR(100)  NOT NULL,
    subscriber_count  INT           NOT NULL DEFAULT 1,
    last_refreshed_at TIMESTAMP     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, keyword)
);
```

- `subscriber_count`: 해당 토픽을 구독 중인 디바이스 수 (정확하지 않아도 됨, 참조용)
- `last_refreshed_at`: 마지막 하트비트 시각 (가비지 정리 기준)

### channel_cursors
채널별 마지막 체크 포인트.

```sql
CREATE TABLE channel_cursors (
    channel_id      VARCHAR(50)  PRIMARY KEY,
    last_post_id    VARCHAR(50),
    last_checked_at TIMESTAMP    NOT NULL DEFAULT NOW()
);
```

### notification_log (선택사항)
중복 발송 방지 + 통계용.

```sql
CREATE TABLE notification_log (
    id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    channel_id VARCHAR(50)  NOT NULL,
    post_id    VARCHAR(50)  NOT NULL,
    keyword    VARCHAR(100) NOT NULL,
    sent_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, post_id, keyword)
);
```

---

## 5. API 설계

### 토픽 구독 등록
```
POST /api/topics/subscribe
Body: {
    "channelId": "0P7DE12WXXQQC",
    "keyword": "테스트",
    "fcmToken": "eXaMpLe_FcM_ToKeN..."   ← 봇 방어용 검증
}
Response: 200 OK
```

처리:
1. FCM 토큰 유효성 검증 (테스트 메시지 발송으로 확인)
2. `active_topics`에 해당 (channelId, keyword) 있으면 `subscriber_count + 1`, 없으면 INSERT
3. `last_refreshed_at` 갱신

### 토픽 구독 해제
```
POST /api/topics/unsubscribe
Body: {
    "channelId": "0P7DE12WXXQQC",
    "keyword": "테스트"
}
Response: 200 OK
```

처리:
1. `subscriber_count - 1`
2. 0 이하이면 행 삭제 또는 유지 (크론에서 정리)

### 하트비트 (가비지 정리용)
```
POST /api/topics/heartbeat
Body: {
    "topics": [
        { "channelId": "0P7DE12WXXQQC", "keyword": "테스트" },
        { "channelId": "0P7DE12WXXQQC", "keyword": "공지" }
    ]
}
Response: 200 OK
```

처리:
1. 해당 토픽들의 `last_refreshed_at` 갱신
2. 앱 실행 시마다 호출 (포그라운드 진입 시)

### 채널 목록 프록시 (Rate limit 절약)
```
GET /api/channels/categories
GET /api/channels?categoryId=9&page=1&size=50
```

처리:
1. 네이버 API 응답을 서버에서 캐싱 (TTL 1시간)
2. 클라이언트는 서버를 통해 조회 → 네이버 API rate limit 절약

---

## 6. 폴링 전략

### 기본 페이스
- **5초에 1회** 요청 (분당 12회, 안전 마진 확보)
- 채널당 요청 수: 새 글 없으면 1회, 있으면 2회 (글 목록 + 제목 조회)

### 폴링 스케줄러

```kotlin
@Scheduled(fixedDelay = 5000) // 5초마다
fun pollNextChannel() {
    // 1. active_topics에 있는 고유 채널 중
    //    last_checked_at이 가장 오래된 채널 1개 선택
    val channel = channelCursorRepository.findOldest(activeChannelIds) ?: return

    // 2. 최신 글 목록 조회
    val posts = naverClient.fetchRecentPosts(channel.channelId, limit = 50)

    // 3. last_post_id 이후의 새 글만 필터링
    val newPosts = filterNewPosts(posts, channel.lastPostId)
    if (newPosts.isEmpty()) {
        channel.lastCheckedAt = now()
        return
    }

    // 4. 새 글 제목 일괄 조회
    val details = naverClient.fetchPostTitles(newPosts.map { it.postId })

    // 5. 이 채널에 등록된 키워드 목록 조회
    val keywords = activeTopicRepository.findKeywordsByChannel(channel.channelId)

    // 6. 키워드 매칭 + FCM 토픽 발송
    for (post in details) {
        for (keyword in keywords) {
            if (post.title.contains(keyword, ignoreCase = true)) {
                val topic = "ch_${channel.channelId}_kw_${keyword.hashTopicSafe()}"
                fcmService.sendToTopic(topic, post)
                notificationLogRepository.save(channel.channelId, post.postId, keyword)
            }
        }
    }

    // 7. 커서 갱신
    channel.lastPostId = newPosts.first().postId
    channel.lastCheckedAt = now()
}
```

### 폴링 주기 계산 (단일 서버, 분당 12회)

| 구독된 고유 채널 수 | 최악 (모두 새 글) | 평균 (10%만 새 글) |
|-------------|-------------|---------------|
| 50개         | 8.3분        | 4.6분          |
| 100개        | 16.7분       | 9.2분          |
| 200개        | 33.3분       | 18.3분         |
| 300개        | 50분         | 27.5분         |

---

## 7. 스케일링 전략

### 단계 1: 단일 서버 (초기, 구독 채널 ~100개)
- 서버 1대로 운영
- 평균 5~10분 주기로 전체 스캔
- VPS 월 $5~12

### 단계 2: 우선순위 폴링 (구독 채널 100~200개)
- **구독자 수 가중치**: 구독자 많은 채널 → 2~3배 자주 폴링
- **활동 빈도 기반**: 글이 자주 올라오는 채널 → 우선 폴링
- **시간대 조절**: 새벽 (01~06시) → 폴링 간격 2배로 늘림
- **비활성 채널 스킵**: 최근 1시간 새 글 없던 채널 → 다음 폴링을 뒤로 미룸

### 단계 3: 다중 서버/IP (구독 채널 200개+)
- 채널을 서버별로 분배 (해시 기반 샤딩)
- 각 서버가 독립 IP → 별도 rate limit
- 서버 N대 = 분당 12N회 → 처리량 N배
- 예: 2대 → 200채널 약 9분, 3대 → 300채널 약 9분

### 단계 4: 하이브리드 (장기, 채널 500개+)
- 인기 채널 (구독자 상위 30%): 서버 폴링 + 푸시
- 비인기 채널: 클라이언트 로컬 폴링 유지 (서버 부하 분산)
- 클라이언트가 서버 폴링 대상인지 확인 후 로컬 폴링 on/off

---

## 8. FCM 토픽 네이밍

### 규칙
```
ch_{channelId}_kw_{keywordHash}
```

- `channelId`: 네이버 라운지 채널 ID (영숫자)
- `keywordHash`: 키워드를 URL-safe하게 인코딩 (한글 등 특수문자 대응)
- FCM 토픽 이름 제한: `/topics/[a-zA-Z0-9-_.~%]+`, 최대 약 900바이트

### 예시
```
ch_0P7DE12WXXQQC_kw_7YWM7Iqk7Yq4     (키워드: "테스트", Base64)
ch_0P7DE12WXXQQC_kw_6rO17KeA           (키워드: "공지", Base64)
```

### 인코딩 함수 (클라이언트/서버 동일 로직)
```kotlin
fun keywordToTopicSafe(keyword: String): String {
    return Base64.getUrlEncoder().withoutPadding()
        .encodeToString(keyword.toByteArray(Charsets.UTF_8))
}

fun buildTopicName(channelId: String, keyword: String): String {
    return "ch_${channelId}_kw_${keywordToTopicSafe(keyword)}"
}
```

---

## 9. 보안

### 봇/악의적 대량 등록 방어

**1. FCM 토큰 검증 (핵심)**
- `POST /api/topics/subscribe` 요청 시 FCM 토큰 필수
- 서버가 해당 토큰으로 dry-run 메시지 전송하여 유효성 확인
- 유효한 FCM 토큰은 실제 앱이 설치된 기기에서만 발급 → 스크립트 대량 등록 차단

```kotlin
fun validateFcmToken(token: String): Boolean {
    return try {
        val message = Message.builder()
            .setToken(token)
            .build()
        FirebaseMessaging.getInstance().send(message, /* dryRun = */ true)
        true
    } catch (e: FirebaseMessagingException) {
        false
    }
}
```

**2. Rate Limit**
- IP당: 분당 구독/해제 요청 5회 제한
- FCM 토큰당: 시간당 구독 요청 20회 제한
- 초과 시 429 Too Many Requests

**3. 구독 상한**
- FCM 토큰당 최대 구독 토픽 수 제한 (예: 30개)
- 서버에 토큰별 카운트 저장 (유저 정보가 아닌 토큰 해시만 저장)

### API 보안
- HTTPS 필수
- API 키 헤더 (앱에 하드코딩된 키, 간단한 1차 필터)
- CORS 제한 (브라우저 확장용)

---

## 10. 가비지 데이터 정리

### 문제
앱을 삭제하거나 안 쓰게 된 유저의 구독이 서버에 영구히 남음.

### 해결: TTL + 하트비트

**클라이언트 (앱 실행 시마다):**
```
POST /api/topics/heartbeat
Body: { "topics": [{ "channelId": "...", "keyword": "..." }, ...] }
```

**서버 크론 (매일 1회, 새벽):**
```kotlin
@Scheduled(cron = "0 0 4 * * *") // 매일 새벽 4시
fun cleanupStaleTopics() {
    // 30일 이상 하트비트 없는 토픽의 subscriber_count 감소
    val staleDate = now().minusDays(30)
    val staleTopics = activeTopicRepository.findByLastRefreshedBefore(staleDate)

    for (topic in staleTopics) {
        topic.subscriberCount -= 1
        if (topic.subscriberCount <= 0) {
            activeTopicRepository.delete(topic)
            // channel_cursors도 해당 채널의 구독이 0이면 삭제
        }
    }
}
```

**결과:**
- 활성 유저: 앱 실행 시 하트비트 → TTL 갱신 → 영구 유지
- 이탈 유저: 30일 후 subscriber_count 감소 → 0이면 토픽 삭제
- 가비지 데이터 최대 잔류 기간: 30일

---

## 11. 클라이언트 변경 사항 (서버 연동 시)

### 변경 포인트
1. **앱 실행 시**: FCM 토큰 발급 + `POST /api/topics/heartbeat`
2. **키워드 알림 추가**: 로컬 저장 + FCM 토픽 구독 + `POST /api/topics/subscribe`
3. **키워드 알림 삭제**: 로컬 삭제 + FCM 토픽 해제 + `POST /api/topics/unsubscribe`
4. **푸시 수신**: FCM 토픽 메시지 수신 → 로컬 알림 표시
5. **로컬 폴링**: 서버 미연결 시 폴백으로 유지

### 플랫폼별 지원
| 플랫폼       | 푸시 방식      | 서버 연동 | 비고                  |
|-----------|------------|-------|---------------------|
| Android 앱 | FCM        | O     | 앱 종료 시에도 수신         |
| iOS 앱     | FCM → APNs | O     | 앱 종료 시에도 수신         |
| Chrome 확장 | FCM        | O     | service worker에서 수신 |
| Safari 확장 | 불가         | X     | 로컬 폴링 유지 (API 미지원)  |

---

## 12. 프로젝트 구조 (별도 레포)

```
quietlounge-server/
├── src/main/kotlin/kr/konempty/quietlounge/
│   ├── QuietLoungeApplication.kt
│   ├── config/
│   │   ├── SchedulerConfig.kt        # 폴링 스케줄러 설정
│   │   ├── FcmConfig.kt              # Firebase 초기화
│   │   └── RateLimitConfig.kt        # Rate limit 설정
│   ├── controller/
│   │   ├── TopicController.kt        # subscribe/unsubscribe/heartbeat
│   │   └── ChannelProxyController.kt # 채널 목록 프록시 (캐싱)
│   ├── service/
│   │   ├── PollingService.kt         # 채널 폴링 + 키워드 매칭
│   │   ├── FcmService.kt             # FCM 토픽 메시지 발송
│   │   ├── NaverLoungeClient.kt      # 네이버 라운지 API 클라이언트
│   │   └── CleanupService.kt         # 가비지 정리 크론
│   ├── domain/
│   │   ├── ActiveTopic.kt
│   │   ├── ChannelCursor.kt
│   │   └── NotificationLog.kt
│   └── repository/
│       ├── ActiveTopicRepository.kt
│       ├── ChannelCursorRepository.kt
│       └── NotificationLogRepository.kt
├── src/main/resources/
│   ├── application.yml
│   └── firebase-service-account.json # Firebase 인증 (gitignore)
├── build.gradle.kts
├── Dockerfile
└── README.md
```

---

## 13. 비용 예상

| 항목                      | 비용                             |
|-------------------------|--------------------------------|
| VPS (2 vCPU, 2GB)       | 월 $5~12                        |
| Apple Developer Program | 연 $99 (iOS 푸시용)                |
| Firebase (FCM)          | 무료                             |
| PostgreSQL              | VPS 내 설치 (무료)                  |
| 도메인 + SSL               | Let's Encrypt 무료, 도메인 연 $10~15 |
| **합계**                  | **월 $5~12 + 연 $99~115**        |

---

## 14. 구현 우선순위

| 단계          | 내용                            | 의존성                       |
|-------------|-------------------------------|---------------------------|
| **Phase 1** | 서버 기본 구조 + DB + API + 폴링 스케줄러 | 없음                        |
| **Phase 2** | FCM 연동 (토픽 메시지 발송)            | Firebase 프로젝트 생성          |
| **Phase 3** | Android 앱 연동                  | Phase 2                   |
| **Phase 4** | iOS 앱 연동                      | Phase 2 + Apple Developer |
| **Phase 5** | Chrome 확장 연동                  | Phase 2                   |
| **Phase 6** | 우선순위 폴링 + 모니터링 + 로깅           | Phase 1                   |
| **Phase 7** | 다중 서버 스케일링 (필요 시)             | Phase 6                   |

---

## 15. 미결 사항 / 추후 검토

- [ ] 호스팅 선택 (VPS vs AWS vs GCP)
- [ ] 도메인 결정
- [ ] Apple Developer 가입 여부 (iOS 푸시용)
- [ ] FCM 토픽 구독 수 제한 (FCM 자체 제한: 토픽당 무제한, 디바이스당 2000개)
- [ ] 채널 목록 캐싱 주기 결정
- [ ] 에러 모니터링 도구 (Sentry 등)
- [ ] 서버 헬스체크 / 알림 (서버 다운 감지)
