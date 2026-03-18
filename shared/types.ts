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

// 필터 모드
export type FilterMode = 'hide' | 'blur';
