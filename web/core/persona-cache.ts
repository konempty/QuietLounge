// personaCache 갱신 + 자동 승격 — Chrome / Safari ext entry 공유 helper.
//
// shared/block-list.ts `BlockList.updatePersonaCache`, Android `BlockListEngine.updatePersonaCache`,
// Swift `QuietLoungeCore.applyPersonaCacheUpdate` 와 *동일한 시맨틱* — drift 방지를 위해 단일 source.
//
// 핵심: storage 측 `blockData.personaCache` 의 *이전* 닉네임도 `nicknameOnlyBlocks` 매칭 대상으로
// 사용한다. 이전엔 Chrome / Safari entry 가 in-memory `personaCache` Map 의 *현재* 닉네임만 봤는데,
// 그러면 사용자가 oldname → newname 으로 닉네임 바꾼 경우 oldname 으로 등록된 nickname-only block 이
// 정리되지 않고 남아 다른 유저까지 가리는 stale 회귀가 발생.

export interface BlockedUser {
  personaId: string;
  nickname: string;
  blockedAt: string;
}

export interface NicknameOnlyBlock {
  nickname: string;
  blockedAt: string;
}

export interface PersonaCacheEntry {
  nickname: string;
  lastSeen: string;
}

export interface BlockListLike {
  blockedUsers: Record<string, BlockedUser>;
  nicknameOnlyBlocks: NicknameOnlyBlock[];
  personaCache: Record<string, PersonaCacheEntry>;
}

/**
 * 단건 personaId / nickname 매핑을 받아 BlockListLike 를 *in-place 갱신* + *의미 있는* 변경 여부 반환.
 * 호출자는 changed=true 일 때만 storage save — 라운지 API 매 응답마다의 storage write 폭증을 막음.
 *
 * 동작:
 *   1) personaCache[personaId] 는 *항상* in-memory 갱신 (lastSeen 매번 새로). save 트리거는 (2)/(3) 만.
 *   2) nicknameOnlyBlocks 에서 *현재 nickname* 또는 *이전 cached nickname* 매칭 시 → 차단 승격
 *      (entry 제거 + blockedUsers[personaId] 등록) → changed=true
 *   3) 매칭 없고 nickname 만 바뀐 경우 → blockedUsers[personaId].nickname 만 갱신 → changed=true
 *   4) 그 외 (단순 lastSeen 갱신, 신규 personaCache 항목 추가) → changed=false
 *
 * shared/block-list.ts BlockList.updatePersonaCache, Android BlockListEngine, iOS QuietLoungeCore 와
 * 동일 시맨틱 — 4 플랫폼 모두 *실제 promotion / nickname 갱신* 시에만 persist.
 */
export function applyPersonaCacheUpdate(
  data: BlockListLike,
  personaId: string,
  nickname: string,
): { changed: boolean } {
  // 기존 사용자의 v1 storage 또는 partial-write 손상으로 missing field 들어올 수 있음 — defensive
  // normalize 로 `Cannot read properties of undefined` TypeError 회귀 차단. createEmptyData() 와 동일 shape.
  if (!data.personaCache) data.personaCache = {};
  if (!data.blockedUsers) data.blockedUsers = {};
  if (!data.nicknameOnlyBlocks) data.nicknameOnlyBlocks = [];

  const cached = data.personaCache[personaId];
  const oldNickname = cached && cached.nickname !== nickname ? cached.nickname : null;

  // 1) personaCache 갱신 — in-memory 만. storage save 는 (2)/(3) 트리거 시에만.
  data.personaCache[personaId] = {
    nickname,
    lastSeen: new Date().toISOString(),
  };

  // 2) nickname-only block 매칭 — 현재 또는 옛 닉네임 둘 다 검사.
  const idx = data.nicknameOnlyBlocks.findIndex(
    (b) => b.nickname === nickname || (oldNickname !== null && b.nickname === oldNickname),
  );
  if (idx !== -1) {
    const [block] = data.nicknameOnlyBlocks.splice(idx, 1);
    data.blockedUsers[personaId] = {
      personaId,
      nickname,
      blockedAt: block.blockedAt,
    };
    return { changed: true };
  }

  // 3) 닉네임만 바뀐 경우 — blockedUsers 의 닉네임 갱신.
  if (oldNickname !== null && data.blockedUsers[personaId]) {
    const user = data.blockedUsers[personaId];
    if (user.nickname !== nickname) {
      user.nickname = nickname;
      return { changed: true };
    }
  }

  return { changed: false };
}

/**
 * Map 형태의 in-memory personaCache (Chrome / Safari ext entry 패턴) 를 batch 로 일괄 적용.
 * 매 항목마다 storage 갱신하지 않고 한 번에 처리하도록 도움. 호출 후 `changed` 가 true 면 save.
 */
export function applyPersonaCacheBatch(
  data: BlockListLike,
  entries: Iterable<[string, string]>,
): { changed: boolean } {
  let any = false;
  for (const [pid, nick] of entries) {
    const r = applyPersonaCacheUpdate(data, pid, nick);
    if (r.changed) any = true;
  }
  return { changed: any };
}
