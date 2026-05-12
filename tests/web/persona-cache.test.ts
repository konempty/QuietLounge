// web/core/persona-cache.ts 단위 테스트.
//
// shared/block-list / Android BlockListEngine / iOS QuietLoungeCore 와 *동일 시맨틱* 인지 검증.
// 특히 Codex 리뷰의 P2 finding — Chrome/Safari entry 가 storage personaCache 의 *옛 닉네임* 도
// nickname-only block 매칭 대상으로 사용해야 한다 — 회귀 가드.

import { describe, it, expect } from 'vitest';
import {
  applyPersonaCacheUpdate,
  applyPersonaCacheBatch,
  type BlockListLike,
} from '../../web/core/persona-cache';

function emptyData(): BlockListLike {
  return { blockedUsers: {}, nicknameOnlyBlocks: [], personaCache: {} };
}

describe('applyPersonaCacheUpdate', () => {
  it('현재 닉네임 매칭 → nicknameOnlyBlock 제거 + blockedUsers 등록', () => {
    const data = emptyData();
    data.nicknameOnlyBlocks.push({ nickname: '닉A', blockedAt: '2026-01-01T00:00:00Z' });
    const r = applyPersonaCacheUpdate(data, 'pid1', '닉A');
    expect(r.changed).toBe(true);
    expect(data.blockedUsers.pid1).toEqual({
      personaId: 'pid1',
      nickname: '닉A',
      blockedAt: '2026-01-01T00:00:00Z',
    });
    expect(data.nicknameOnlyBlocks).toHaveLength(0);
    expect(data.personaCache.pid1.nickname).toBe('닉A');
  });

  it('P2 회귀 가드: 옛 캐시 닉네임이 nicknameOnlyBlock 과 매칭 → 승격 + 옛 entry 제거', () => {
    // 시나리오: 사용자가 oldname 으로 nickname-only 차단. 그 사용자가 newname 으로 닉네임 변경.
    // 우리 측이 newname 을 personaId 와 함께 보면 *옛 cached oldname* 도 nickname-only 매칭 대상이 돼야.
    const data = emptyData();
    data.personaCache['pid1'] = { nickname: 'oldname', lastSeen: '2026-01-01T00:00:00Z' };
    data.nicknameOnlyBlocks.push({ nickname: 'oldname', blockedAt: '2026-01-01T00:00:00Z' });

    const r = applyPersonaCacheUpdate(data, 'pid1', 'newname');
    expect(r.changed).toBe(true);
    // 차단 승격 — pid1 → newname.
    expect(data.blockedUsers.pid1.nickname).toBe('newname');
    expect(data.blockedUsers.pid1.blockedAt).toBe('2026-01-01T00:00:00Z');
    // oldname nicknameOnlyBlock 제거.
    expect(data.nicknameOnlyBlocks).toHaveLength(0);
    // personaCache 의 nickname 도 newname 으로 업데이트.
    expect(data.personaCache.pid1.nickname).toBe('newname');
  });

  it('이미 차단된 personaId 가 닉네임 변경 → blockedUsers.nickname 갱신', () => {
    const data = emptyData();
    data.blockedUsers.pid1 = {
      personaId: 'pid1',
      nickname: 'old',
      blockedAt: '2026-01-01T00:00:00Z',
    };
    data.personaCache.pid1 = { nickname: 'old', lastSeen: '2026-01-01T00:00:00Z' };

    const r = applyPersonaCacheUpdate(data, 'pid1', 'new');
    expect(r.changed).toBe(true);
    expect(data.blockedUsers.pid1.nickname).toBe('new');
    expect(data.blockedUsers.pid1.blockedAt).toBe('2026-01-01T00:00:00Z'); // unchanged
  });

  it('매칭 없으면 personaCache 만 in-memory 갱신 + changed=false (storage save 폭증 방지)', () => {
    // 라운지 API 매 응답마다 호출되는 hot path — 의미 있는 변화 없이는 changed=false 여야 한다.
    // shared/block-list.ts / Android BlockListEngine / iOS QuietLoungeCore 와 동일 시맨틱.
    const data = emptyData();
    const r = applyPersonaCacheUpdate(data, 'pid1', '닉');
    expect(r.changed).toBe(false);
    expect(data.personaCache.pid1.nickname).toBe('닉'); // in-memory 는 갱신
    expect(data.blockedUsers).toEqual({});
    expect(data.nicknameOnlyBlocks).toEqual([]);
  });

  it('lastSeen 만 갱신되는 케이스 → changed=false', () => {
    const data = emptyData();
    data.personaCache.pid1 = { nickname: '동일', lastSeen: '2026-01-01T00:00:00Z' };
    const r = applyPersonaCacheUpdate(data, 'pid1', '동일');
    expect(r.changed).toBe(false);
    expect(data.personaCache.pid1.nickname).toBe('동일');
  });

  it('blockedUsers nickname 도 동일하면 changed=false (oldNickname 가 다르더라도 매칭 없을 때)', () => {
    // 시나리오: personaCache 에 oldname 으로 cache, blockedUsers 에는 personaId 가 없는 경우.
    // oldNickname 이 nicknameOnlyBlocks 와도 매칭 안 되면 — 단순 cache 닉네임 변화만 일어남.
    const data = emptyData();
    data.personaCache.pid1 = { nickname: 'old', lastSeen: '2026-01-01T00:00:00Z' };
    const r = applyPersonaCacheUpdate(data, 'pid1', 'new');
    expect(r.changed).toBe(false);
    expect(data.personaCache.pid1.nickname).toBe('new');
  });

  it('opps: 같은 닉네임이 여러 nickname-only entry 에 있을 경우 *첫번째* 만 제거', () => {
    // 일반 사용 시 dedup 으로 한 번만 들어가지만 방어적 검증.
    const data = emptyData();
    data.nicknameOnlyBlocks.push(
      { nickname: '같음', blockedAt: '2026-01-01T00:00:00Z' },
      { nickname: '같음', blockedAt: '2026-02-01T00:00:00Z' },
    );
    applyPersonaCacheUpdate(data, 'pid1', '같음');
    expect(data.nicknameOnlyBlocks).toHaveLength(1);
    expect(data.blockedUsers.pid1.blockedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('회귀 가드: v1 storage / partial-write 손상 (missing personaCache) 도 throw 안 함', () => {
    // 기존 사용자의 storage 가 v1 format (personaCache 필드 없음) 또는 partial-write 손상이면
    // `data.personaCache[personaId]` 가 throw 'Cannot read properties of undefined' 회귀 — defensive
    // normalize 가 진입에서 빈 object 로 채워야.
    const data = {
      blockedUsers: {},
      nicknameOnlyBlocks: [],
    } as unknown as BlockListLike;
    expect(() => applyPersonaCacheUpdate(data, 'pid1', '닉')).not.toThrow();
    expect(data.personaCache).toBeDefined();
    expect(data.personaCache.pid1.nickname).toBe('닉');
  });

  it('회귀 가드: 모든 field missing (totally corrupted) 도 throw 안 함', () => {
    const data = {} as unknown as BlockListLike;
    expect(() => applyPersonaCacheUpdate(data, 'pid1', '닉')).not.toThrow();
    expect(data.personaCache.pid1.nickname).toBe('닉');
    expect(data.blockedUsers).toEqual({});
    expect(data.nicknameOnlyBlocks).toEqual([]);
  });
});

describe('applyPersonaCacheBatch', () => {
  it('여러 항목 한 번에 처리 — 각각 매칭 / 갱신 모두 적용', () => {
    const data = emptyData();
    data.nicknameOnlyBlocks.push(
      { nickname: 'A', blockedAt: '2026-01-01T00:00:00Z' },
      { nickname: 'B-old', blockedAt: '2026-01-02T00:00:00Z' },
    );
    data.personaCache['pidB'] = { nickname: 'B-old', lastSeen: '2026-01-01T00:00:00Z' };

    const r = applyPersonaCacheBatch(data, [
      ['pidA', 'A'],
      ['pidB', 'B-new'],
      ['pidC', 'C'], // 매칭 없음
    ]);
    expect(r.changed).toBe(true);
    expect(data.blockedUsers.pidA.nickname).toBe('A');
    expect(data.blockedUsers.pidB.nickname).toBe('B-new');
    expect(data.blockedUsers.pidB.blockedAt).toBe('2026-01-02T00:00:00Z');
    expect(data.blockedUsers.pidC).toBeUndefined();
    expect(data.nicknameOnlyBlocks).toHaveLength(0);
  });

  it('빈 entries → changed=false (for 루프 미진입)', () => {
    const data = emptyData();
    const r = applyPersonaCacheBatch(data, []);
    expect(r.changed).toBe(false);
  });

  it('회귀 가드: 매칭 없는 batch 100 회 호출 → 항상 changed=false (storage save 폭증 방지)', () => {
    // 라운지 1 페이지 진입에서 fetch 5~20 회마다 personaExtractor 가 batch 호출.
    // 이전 회귀: applyPersonaCacheUpdate 가 항상 changed=true 라 매번 storage write.
    const data = emptyData();
    for (let i = 0; i < 100; i++) {
      const r = applyPersonaCacheBatch(data, [[`pid${i}`, `nick${i}`]]);
      expect(r.changed).toBe(false);
    }
    // 같은 pid 를 다시 호출해도 (lastSeen 만 변화) 여전히 false.
    for (let i = 0; i < 50; i++) {
      const r = applyPersonaCacheBatch(data, [[`pid${i}`, `nick${i}`]]);
      expect(r.changed).toBe(false);
    }
  });

  it('회귀 가드: batch 안에서 한 항목만 매칭 → changed=true (다른 항목은 false 여도 OR 됨)', () => {
    const data = emptyData();
    data.nicknameOnlyBlocks.push({ nickname: '매칭', blockedAt: '2026-01-01T00:00:00Z' });
    const r = applyPersonaCacheBatch(data, [
      ['pidA', '매칭없음1'],
      ['pidB', '매칭'],
      ['pidC', '매칭없음2'],
    ]);
    expect(r.changed).toBe(true);
    expect(data.blockedUsers.pidB.nickname).toBe('매칭');
  });
});
