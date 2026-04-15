import { describe, it, expect, beforeEach } from 'vitest';
import { BlockList, StorageAdapter } from '../../shared/block-list';
import type { BlockListData } from '../../shared/types';

class MemoryStorage implements StorageAdapter {
  private map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  clear() {
    this.map.clear();
  }
  raw() {
    return new Map(this.map);
  }
}

describe('BlockList', () => {
  let storage: MemoryStorage;
  let updates: BlockListData[];
  let bl: BlockList;

  beforeEach(() => {
    storage = new MemoryStorage();
    updates = [];
    bl = new BlockList(storage, (d) => updates.push(structuredClone(d)));
  });

  describe('초기 상태', () => {
    it('빈 데이터로 시작', () => {
      const d = bl.getData();
      expect(d.version).toBe(2);
      expect(Object.keys(d.blockedUsers)).toHaveLength(0);
      expect(d.nicknameOnlyBlocks).toHaveLength(0);
      expect(Object.keys(d.personaCache)).toHaveLength(0);
    });

    it('load 호출 시 저장소에 데이터 없으면 기본값', async () => {
      await bl.load();
      expect(Object.keys(bl.getData().blockedUsers)).toHaveLength(0);
    });

    it('load — 저장된 데이터 복원', async () => {
      const raw: BlockListData = {
        version: 2,
        blockedUsers: {
          abc123: {
            personaId: 'abc123',
            nickname: 'foo',
            previousNicknames: [],
            blockedAt: '2026-01-01T00:00:00Z',
            reason: '',
          },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      };
      await storage.set('quiet_lounge_data', JSON.stringify(raw));
      await bl.load();
      expect(bl.getData().blockedUsers['abc123'].nickname).toBe('foo');
    });

    it('load — 손상된 JSON 은 기본값으로 복구', async () => {
      await storage.set('quiet_lounge_data', '{{{ not json');
      await bl.load();
      expect(Object.keys(bl.getData().blockedUsers)).toHaveLength(0);
    });
  });

  describe('blockByPersonaId', () => {
    it('새 유저 차단 + onUpdate 콜백', async () => {
      await bl.blockByPersonaId('p1', '닉넴1');
      expect(bl.getData().blockedUsers['p1']).toBeDefined();
      expect(bl.getData().blockedUsers['p1'].nickname).toBe('닉넴1');
      expect(updates).toHaveLength(1);
    });

    it('이미 차단된 유저의 닉네임 변경 추적', async () => {
      await bl.blockByPersonaId('p1', '옛닉');
      await bl.blockByPersonaId('p1', '새닉');
      const u = bl.getData().blockedUsers['p1'];
      expect(u.nickname).toBe('새닉');
      expect(u.previousNicknames).toContain('옛닉');
    });

    it('동일 닉네임 재차단 시 previousNicknames 비어있음', async () => {
      await bl.blockByPersonaId('p1', 'same');
      await bl.blockByPersonaId('p1', 'same');
      expect(bl.getData().blockedUsers['p1'].previousNicknames).toHaveLength(0);
    });

    it('blockedAt 은 최초 차단 시점 유지', async () => {
      await bl.blockByPersonaId('p1', 'a');
      const t1 = bl.getData().blockedUsers['p1'].blockedAt;
      await new Promise((r) => setTimeout(r, 10));
      await bl.blockByPersonaId('p1', 'b');
      expect(bl.getData().blockedUsers['p1'].blockedAt).toBe(t1);
    });

    it('reason — 최초 차단 시 전달된 값 유지, 빈 값으로 재차단해도 보존', async () => {
      await bl.blockByPersonaId('p1', 'a', '광고');
      await bl.blockByPersonaId('p1', 'a', '');
      expect(bl.getData().blockedUsers['p1'].reason).toBe('광고');
    });

    it('nicknameOnlyBlocks 에 있던 동일 닉네임은 승격되며 제거', async () => {
      await bl.blockByNickname('승격닉');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(1);
      await bl.blockByPersonaId('p1', '승격닉');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(0);
      expect(bl.getData().blockedUsers['p1'].nickname).toBe('승격닉');
    });
  });

  describe('blockByNickname', () => {
    it('기본 동작', async () => {
      await bl.blockByNickname('tester', '스팸');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(1);
      expect(bl.getData().nicknameOnlyBlocks[0].nickname).toBe('tester');
      expect(bl.getData().nicknameOnlyBlocks[0].reason).toBe('스팸');
    });

    it('이미 personaId 로 차단된 닉네임은 추가 안 함', async () => {
      await bl.blockByPersonaId('p1', 'dup');
      await bl.blockByNickname('dup');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(0);
    });

    it('이미 nicknameOnlyBlocks 에 있으면 중복 추가 안 함', async () => {
      await bl.blockByNickname('once');
      await bl.blockByNickname('once');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(1);
    });
  });

  describe('unblock', () => {
    it('personaId 차단 해제', async () => {
      await bl.blockByPersonaId('p1', 'a');
      await bl.unblock('p1');
      expect(bl.getData().blockedUsers['p1']).toBeUndefined();
    });

    it('존재하지 않는 personaId 해제 — no-op', async () => {
      await bl.unblock('none');
      expect(Object.keys(bl.getData().blockedUsers)).toHaveLength(0);
    });

    it('닉네임 차단 해제', async () => {
      await bl.blockByNickname('nick');
      await bl.unblockByNickname('nick');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(0);
    });
  });

  describe('isBlocked / isBlockedByNickname', () => {
    it('isBlockedByPersonaId — 정확한 매칭', async () => {
      await bl.blockByPersonaId('p1', 'a');
      expect(bl.isBlockedByPersonaId('p1')).toBe(true);
      expect(bl.isBlockedByPersonaId('p2')).toBe(false);
    });

    it('isBlockedByNickname — persona 기반 + 닉네임 전용 둘 다 검사', async () => {
      await bl.blockByPersonaId('p1', 'withId');
      await bl.blockByNickname('noId');
      expect(bl.isBlockedByNickname('withId')).toBe(true);
      expect(bl.isBlockedByNickname('noId')).toBe(true);
      expect(bl.isBlockedByNickname('other')).toBe(false);
    });
  });

  describe('updatePersonaCache + 자동 승격', () => {
    it('nicknameOnlyBlocks 에 있던 닉네임 → personaId 차단으로 승격', async () => {
      await bl.blockByNickname('auto', '이유');
      await bl.updatePersonaCache('p1', 'auto');
      expect(bl.getData().blockedUsers['p1']?.nickname).toBe('auto');
      expect(bl.getData().blockedUsers['p1']?.reason).toBe('이유');
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(0);
    });

    it('이전에 캐시된 닉네임이 차단된 상태에서 닉네임 변경 → 자동 승격', async () => {
      // 먼저 캐시 기록
      await bl.updatePersonaCache('p1', 'oldname');
      // oldname 을 닉네임 전용으로 차단
      await bl.blockByNickname('oldname');
      // 같은 personaId 가 새 닉네임으로 감지됨 → oldname 기준으로 승격
      await bl.updatePersonaCache('p1', 'newname');
      expect(bl.getData().blockedUsers['p1']?.nickname).toBe('newname');
      // 승격 시 근거가 된 nicknameOnlyBlocks 엔트리(oldname)는 반드시 제거되어야 한다.
      // 그래야 나중에 oldname 닉네임을 쓰는 다른 사용자가 오탐 차단되지 않음.
      expect(bl.getData().nicknameOnlyBlocks).toHaveLength(0);
    });

    it('이전 닉네임 기준 승격 후 다른 유저가 oldname 을 써도 차단되지 않음', async () => {
      await bl.updatePersonaCache('pA', 'oldname');
      await bl.blockByNickname('oldname');
      await bl.updatePersonaCache('pA', 'newname');
      // 다른 personaId 가 oldname 을 쓰더라도 nicknameOnlyBlocks 가 비어 있으므로 미차단
      expect(bl.isBlockedByNickname('oldname')).toBe(false);
    });

    it('이미 차단된 유저의 닉네임 변경 추적 (cache 선행)', async () => {
      // updatePersonaCache 기반 추적은 cache 에 기존 닉네임이 있어야 발동
      await bl.updatePersonaCache('p1', 'first');
      await bl.blockByPersonaId('p1', 'first');
      await bl.updatePersonaCache('p1', 'second');
      expect(bl.getData().blockedUsers['p1'].nickname).toBe('second');
      expect(bl.getData().blockedUsers['p1'].previousNicknames).toContain('first');
    });

    it('cache 없이 blockByPersonaId 로만 닉네임 변경 추적', async () => {
      // updatePersonaCache 를 거치지 않고 blockByPersonaId 로 재차단하면 추적됨
      await bl.blockByPersonaId('p1', 'first');
      await bl.blockByPersonaId('p1', 'second');
      expect(bl.getData().blockedUsers['p1'].nickname).toBe('second');
      expect(bl.getData().blockedUsers['p1'].previousNicknames).toContain('first');
    });

    it('차단 안 된 유저의 닉네임 변경은 캐시만 갱신', async () => {
      await bl.updatePersonaCache('p1', 'hello');
      expect(bl.getData().personaCache['p1']?.nickname).toBe('hello');
      expect(bl.getData().blockedUsers['p1']).toBeUndefined();
    });
  });

  describe('getAllBlocked', () => {
    it('두 종류 차단 목록 합쳐서 반환', async () => {
      await bl.blockByPersonaId('p1', 'a');
      await bl.blockByNickname('nick');
      const all = bl.getAllBlocked();
      expect(all.byPersona).toHaveLength(1);
      expect(all.byNickname).toHaveLength(1);
    });
  });

  describe('exportJSON / importJSON', () => {
    it('exportJSON 은 personaCache 를 제외', async () => {
      await bl.blockByPersonaId('p1', 'a');
      await bl.updatePersonaCache('p2', 'cache-only');
      const parsed = JSON.parse(bl.exportJSON());
      expect(parsed.blockedUsers['p1']).toBeDefined();
      expect(parsed.personaCache).toBeUndefined();
    });

    it('importJSON — version 2 만 허용', async () => {
      const oldV: BlockListData = {
        version: 1 as unknown as 2,
        blockedUsers: {},
        nicknameOnlyBlocks: [],
        personaCache: {},
      };
      await expect(bl.importJSON(JSON.stringify(oldV))).rejects.toThrow();
    });

    it('importJSON — 기존 personaCache 유지', async () => {
      await bl.updatePersonaCache('p1', 'cached');
      const incoming: BlockListData = {
        version: 2,
        blockedUsers: {
          p2: {
            personaId: 'p2',
            nickname: 'imported',
            previousNicknames: [],
            blockedAt: '2026-01-01T00:00:00Z',
            reason: '',
          },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      };
      await bl.importJSON(JSON.stringify(incoming));
      expect(bl.getData().personaCache['p1']?.nickname).toBe('cached');
      expect(bl.getData().blockedUsers['p2'].nickname).toBe('imported');
    });

    it('export → import 왕복', async () => {
      await bl.blockByPersonaId('p1', 'n1');
      await bl.blockByNickname('n2');
      const json = bl.exportJSON();

      const fresh = new BlockList(new MemoryStorage());
      await fresh.importJSON(json);
      expect(fresh.getData().blockedUsers['p1']?.nickname).toBe('n1');
      expect(fresh.getData().nicknameOnlyBlocks[0]?.nickname).toBe('n2');
    });
  });

  describe('영속화', () => {
    it('차단 후 저장소에 JSON 기록됨', async () => {
      await bl.blockByPersonaId('p1', 'a');
      const stored = await storage.get('quiet_lounge_data');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.blockedUsers['p1'].nickname).toBe('a');
    });
  });
});
