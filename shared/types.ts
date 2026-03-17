// 차단된 유저 정보 (personaId 확보)
export interface BlockedUser {
  personaId: string;
  nickname: string;
  previousNicknames: string[];
  blockedAt: string; // ISO 8601
  reason: string;
}

// 닉네임만으로 차단된 유저 (personaId 미확보)
export interface NicknameOnlyBlock {
  nickname: string;
  blockedAt: string;
  reason: string;
}

// personaId 캐시 항목
export interface PersonaCacheEntry {
  nickname: string;
  lastSeen: string;
}

// 차단 목록 전체 구조
export interface BlockListData {
  version: number;
  blockedUsers: Record<string, BlockedUser>;
  nicknameOnlyBlocks: NicknameOnlyBlock[];
  personaCache: Record<string, PersonaCacheEntry>;
}

// 셀렉터 설정
export interface SelectorConfig {
  feed: {
    scrollContainer: string;
    postLink: string;
    postContainer: string;
    nickname: string;
    profileName: string;
    separator: string;
  };
  carousel: {
    card: string;
    cardItem: string;
    cardNickname: string;
  };
}

// 필터 모드
export type FilterMode = 'hide' | 'blur';

// 네이티브 브릿지 메시지 타입
export type BridgeMessage =
  | { type: 'BLOCK_USER'; payload: { personaId?: string; nickname: string } }
  | { type: 'UNBLOCK_USER'; payload: { personaId: string } }
  | { type: 'UPDATE_BLOCK_LIST'; payload: BlockListData }
  | { type: 'GET_BLOCK_LIST' }
  | { type: 'BLOCK_LIST_UPDATED'; payload: BlockListData };
