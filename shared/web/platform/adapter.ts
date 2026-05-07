// 후속 PR (#3 inject-buttons / #4 profile-stats / #5 before / #6 api-interceptor / #7 storage-bridge)
// 에서 4 플랫폼 차이를 통합할 어댑터 인터페이스 — 이번 PR (#1) 에서는 스캐폴딩만.
//
// 각 플랫폼 entry (`entries/*.ts`) 가 구체 구현을 IIFE 안에 인라인으로 만들고 shared 함수에
// 주입한다. shared 측은 이 인터페이스에만 의존해야 — 어떤 플랫폼인지 모른다.
//
// 처음 entry 가 `import { ... } from '../platform/adapter'` 로 인터페이스만 가져오는 게 아니라,
// 구체 어댑터 객체를 entry 안에서 만들어 shared 의 setup 함수에 넘기는 형태가 될 예정.
// (호출 형태는 PR #3 에서 구체화.)

import type { BlockListData, FilterMode } from '../../types';

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

/** 4 종 어댑터를 한 번에 주입하는 컨테이너. 후속 PR shared 함수의 setup 시그너처로 사용 예정. */
export interface PlatformAdapter {
  storage: StorageAdapter;
  bridge: BridgeAdapter;
  confirm: ConfirmAdapter;
  btn: BtnClassAdapter;
}

/** 플랫폼 식별 — 디버깅 / 분기 (예: bfcache 핸들링은 Safari 전용) 에 한정 사용. shared 함수 본문은
 *  가능한 한 이 식별자에 의존하지 말고 어댑터 인터페이스로 추상화할 것. */
export type Platform = 'chrome' | 'safari-ext' | 'ios-native' | 'android';

/** 후속 PR 에서 채울 setup 시그너처 예시 — 호출 형태는 PR #3 에서 확정. */
export interface CoreContext {
  blockData: BlockListData;
  filterMode: FilterMode;
  adapter: PlatformAdapter;
  platform: Platform;
}
