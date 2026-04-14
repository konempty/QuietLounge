// content-scripts/main.js 의 isBlocked / applyBlockStyle 순수 로직 단위 테스트.
// DOM 조작은 제외하고 판정 로직만 추출.

import { describe, it, expect } from 'vitest';

function isBlocked(blockData, personaId, nickname) {
  if (!blockData) return false;
  if (personaId && blockData.blockedUsers && blockData.blockedUsers[personaId]) return true;
  if (nickname) {
    const users = blockData.blockedUsers || {};
    for (const key in users) {
      if (users[key].nickname === nickname) return true;
    }
    const nbs = blockData.nicknameOnlyBlocks || [];
    for (let i = 0; i < nbs.length; i++) {
      if (nbs[i].nickname === nickname) return true;
    }
  }
  return false;
}

const sample = {
  version: 2,
  blockedUsers: {
    pid1: { personaId: 'pid1', nickname: 'n1', previousNicknames: [], blockedAt: '', reason: '' },
  },
  nicknameOnlyBlocks: [{ nickname: 'nonly', blockedAt: '', reason: '' }],
  personaCache: {},
};

describe('isBlocked', () => {
  it('personaId 매칭 우선', () => {
    expect(isBlocked(sample, 'pid1', 'anyname')).toBe(true);
  });

  it('blockedUsers 의 닉네임 매칭', () => {
    expect(isBlocked(sample, undefined, 'n1')).toBe(true);
  });

  it('nicknameOnlyBlocks 매칭', () => {
    expect(isBlocked(sample, undefined, 'nonly')).toBe(true);
  });

  it('매칭 없음', () => {
    expect(isBlocked(sample, 'xxx', 'yyy')).toBe(false);
  });

  it('personaId 만, 닉네임 없음 — 매칭 없음', () => {
    expect(isBlocked(sample, 'nope', undefined)).toBe(false);
  });

  it('둘 다 없음', () => {
    expect(isBlocked(sample, undefined, undefined)).toBe(false);
  });

  it('blockData null 처리', () => {
    expect(isBlocked(null, 'pid1', 'n1')).toBe(false);
  });

  it('blockedUsers 가 빈 객체', () => {
    const empty = { version: 2, blockedUsers: {}, nicknameOnlyBlocks: [], personaCache: {} };
    expect(isBlocked(empty, 'pid1', 'n1')).toBe(false);
  });
});
