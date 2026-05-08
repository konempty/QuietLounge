// 4 플랫폼(Chrome / Safari ext / iOS native / Android) 차이를 흡수하는 어댑터 인터페이스 모음.
// 각 entry 가 자체 구현 객체를 만들어 shared core 함수에 주입 — shared 측은 어떤 플랫폼인지 모르고
// 인터페이스에만 의존한다.

/** 차단 목록 + 필터 설정 영속화. 4 플랫폼이 다른 backend 를 사용. */
export interface StorageAdapter {
  /** 한 번에 여러 키 조회 — chrome/safari 의 multi-key API 와 일치. */
  get(keys: string[]): Promise<Record<string, unknown>>;
  /** key/value 다중 저장. */
  set(values: Record<string, unknown>): Promise<void>;
  /** 키 삭제 — 단일 또는 다중. */
  remove(keys: string | string[]): Promise<void>;
  /** popup / 다른 탭 / 네이티브 변경 감지. iOS WebView native 는 폴링으로 대체될 수 있음. */
  onChanged?: (cb: (changes: Record<string, { newValue?: unknown }>) => void) => void;
}

/** 네이티브/백그라운드 측에 메시지 전송 — 차단 / 배지 갱신 등. */
export interface BridgeAdapter {
  /** 차단 요청 — 4 플랫폼 동일 페이로드 형태. */
  sendBlock(personaId: string | null, nickname: string): void;
  /** 차단 카운트 배지 (Chrome / Safari ext 만 사용 — iOS / Android 는 no-op). */
  updateBadge?(count: number): void;
}

/** 사용자 확인 다이얼로그 — 플랫폼별로 native confirm / DOM modal / 네이티브 콜백 분기. */
export interface ConfirmAdapter {
  /** 확인 텍스트 표시. true=차단 진행 / false=취소. */
  confirm(message: string): Promise<boolean>;
  /** 안내 텍스트만 (확인 버튼 1 개). */
  alert(message: string): Promise<void>;
}

/** 차단 버튼 외형 — Chrome / Safari ext 는 quiet-lounge-btn, iOS / Android 는 ql-btn 의 의도적 분기. */
export interface BtnClassAdapter {
  /** 차단 버튼에 부여할 className. */
  className: string;
  /** hover/touch 시 스타일 차이를 외부에서 위탁할 수 있도록 한 핀-포인트 hook. */
  applyHoverState?(btn: HTMLElement, hovered: boolean): void;
}

/**
 * 차단 버튼 inject — 4 플랫폼 차이를 흡수하는 본격 어댑터.
 *
 * shared `injectBlockButtons(adapter, ctx)` 는 path A / path B / cleanbot 가드 / DOM iteration
 * 같은 100% 동일 부분만 처리하고, 나머지는 모두 adapter 에 위임:
 *   - 버튼 DOM 생성 (className / 스타일 / hover-touch event 모두 포함)
 *   - 클릭 시 차단 flow (confirm + block + filter-mode hint 등 — 플랫폼별 통째로)
 *   - path B 에서 personaId 미매핑 처리 정책 (Chrome/Safari = error 안내 / iOS/Android = 버튼 미노출)
 *   - bfcache 같은 platform-specific 가드 (Safari ext 의 liveButtons WeakSet)
 */
export interface InjectButtonsAdapter {
  /** 버튼의 className. cleanbot 가드 / "이미 버튼 있음" 체크에 사용. */
  buttonClassName: string;

  /** 버튼 DOM 생성 — className / 스타일 / hover/touch 이벤트 wiring 모두 adapter 책임.
   *  click handler 는 shared 측이 등록하므로 여기서 만들지 말 것. */
  createButton(): HTMLElement;

  /** 사용자가 버튼을 누른 시점 — confirm + block + filterAll + maybeShowFilterModeHint 등
   *  post-block 후처리까지 플랫폼이 통째로 처리. iOS/Android 는 native bridge 호출만 하고 native 측이 confirm. */
  onBlockClick(personaId: string | undefined, nickname: string): void | Promise<void>;

  /**
   * Path B 에서 personaId 매핑이 안 잡힌 경우 어떻게 할지.
   * - `'show-error'`: 버튼은 만들고, 클릭 시 [onMissingPersonaId] 호출 (Chrome/Safari 패턴).
   * - `'skip'`: 버튼 자체 미노출 — silent no-op 방지. personaMap 채워지면 다음 호출 때 자동 등장
   *   (iOS/Android 패턴, 현재로선 native bridge 가 nickname-only 차단을 지원 안 함).
   */
  pathBMissingPidStrategy: 'show-error' | 'skip';

  /** Path B 에서 pid 없을 때 사용자 안내. `pathBMissingPidStrategy === 'show-error'` 일 때만 호출됨. */
  onMissingPersonaId?(): void | Promise<void>;

  /** 이미 등록된 버튼이 있을 때 skip 할지. Safari ext 의 bfcache liveButtons 가드용 — 핸들러가 죽었으면
   *  false 반환 → 제거 후 새로 등록. 미구현 시 default 는 항상 skip (Chrome / iOS / Android). */
  shouldSkipExistingButton?(existingButton: Element): boolean;

  /** 새 버튼이 DOM 에 부착된 후 호출 — Safari ext 가 liveButtons WeakSet 에 추가하는 hook. */
  onButtonAttached?(button: HTMLElement): void;
}

/**
 * 프로필 통계 inject — `/profiles/{personaId}` 페이지 진입 시 활동 통계 박스를 inject.
 *
 * shared `injectProfileStats(adapter)` 는 personaId 추출 / fetch / 캐시 / DOM 가드 (rAF 폴링 →
 * MutationObserver) / HTML 빌드 / box 부착을 모두 처리한다. adapter 가 흡수하는 것은:
 *   - QL 브랜드 색 (스피너 / 헤더 텍스트 색 — 4 entry 가 다른 hex 사용)
 *   - 본인 프로필일 때 ownerPersonaId 영속화 (Chrome/Safari ext 의 popup 갱신용 — iOS/Android 는 미구현)
 *   - 내 통계 (`fetchAndStoreMyStats` 결과) 영속화 — Chrome/Safari ext 만, iOS/Android 는 native 가 처리
 */
export interface ProfileStatsAdapter {
  /** QL 브랜드 색 (예: '#4A6CF7'). 스피너 border-top-color / 헤더 텍스트 색에 인라인 스타일로 주입. */
  qlPrimaryColor: string;

  /** 프로필 페이지 stats.isOwner 가 true 일 때 호출 — popup 의 my_persona_id 갱신용.
   *  iOS/Android 는 popup 이 native 라 미구현. */
  saveOwnerPersonaId?(personaId: string): void;

  /** 내 통계 (popup 의 "내 활동 통계") 갱신용 storage write — Chrome/Safari ext 만 구현. */
  saveMyStats?(stats: MyStatsRecord): void;

  /** 내 통계 영속 데이터 제거 — me API 가 unauthenticated 일 때 호출. Chrome/Safari ext 만 구현. */
  removeMyStats?(): void;
}

/**
 * fetch monkey-patch 로 라운지 API 응답에서 postId/personaId/nickname 매핑을 수집해 다음 단계로 push.
 * 4 플랫폼 모두 사용 — iOS/Android 의 before.js, Chrome/Safari ext 의 api-interceptor (page world).
 *
 * shared `setupPersonaExtractor(adapter)` 가 fetch 패치 / DOM hydration 파싱 / DOM fallback 을
 * 모두 처리하고, 어댑터는 *수집된 매핑 push* 만 책임:
 *   - iOS: `webkit.messageHandlers.qlBridge.postMessage(JSON)`
 *   - Android: `window.QuietLounge.postMessage(JSON)`
 *   - Chrome / Safari ext: `window.postMessage({ type: 'QUIET_LOUNGE_API_DATA', ... }, '*')`
 *     (page world → ISOLATED world content script)
 */
export interface PersonaExtractorAdapter {
  pushPersonaMap(payload: {
    personaMap: Record<string, string>;
    personaCache: Record<string, string>;
  }): void;
}

/** popup 의 "내 활동 통계" 카드에 노출될 직렬화 형태. JSON 으로 저장. */
export interface MyStatsRecord {
  personaId: string;
  nickname: string;
  totalPosts: number;
  totalComments: number;
  monthlyPosts: number | string;
  monthlyComments: number | string;
  updatedAt: string;
}

/** 플랫폼 식별 — 디버깅 / 분기 (예: bfcache 핸들링은 Safari 전용) 에 한정 사용. shared 함수 본문은
 *  가능한 한 이 식별자에 의존하지 말고 어댑터 인터페이스로 추상화할 것. */
export type Platform = 'chrome' | 'safari-ext' | 'ios-native' | 'android';
