// isBlocked(data, personaId, nickname) — 4 플랫폼이 동일 시맨틱으로 위임.
// 기존 tests/chrome-extension/block-filter.test.js 의 매트릭스를 shared 로 이전.

import { describe, it, expect } from 'vitest';
import { isBlocked, isCommentBlocked } from '../../web/core/block-check';
import type { BlockListData } from '../../../shared/types';

const sample: BlockListData = {
  version: 2,
  blockedUsers: {
    pid1: { personaId: 'pid1', nickname: 'n1', blockedAt: '' },
  },
  nicknameOnlyBlocks: [{ nickname: 'nonly', blockedAt: '' }],
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
    const empty: BlockListData = {
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
    };
    expect(isBlocked(empty, 'p', 'n')).toBe(false);
  });
});

describe('isCommentBlocked', () => {
  const commentSample: BlockListData = {
    version: 2,
    blockedUsers: {
      postsOnly: { personaId: 'postsOnly', nickname: 'postsOnlyNick', blockedAt: '' },
      comments: {
        personaId: 'comments',
        nickname: 'commentsNick',
        blockedAt: '',
        blockComments: true,
      },
    },
    nicknameOnlyBlocks: [
      { nickname: 'nickPostsOnly', blockedAt: '' },
      { nickname: 'nickComments', blockedAt: '', blockComments: true },
    ],
    personaCache: {},
  };

  it('blockComments=true 인 personaId 차단만 댓글에 적용', () => {
    expect(isCommentBlocked(commentSample, 'comments', 'any')).toBe(true);
    expect(isCommentBlocked(commentSample, 'postsOnly', 'postsOnlyNick')).toBe(false);
  });

  it('blockedUsers 닉네임 fallback 도 blockComments=true 일 때만 댓글에 적용', () => {
    expect(isCommentBlocked(commentSample, undefined, 'commentsNick')).toBe(true);
    expect(isCommentBlocked(commentSample, undefined, 'postsOnlyNick')).toBe(false);
  });

  it('nicknameOnlyBlocks 도 blockComments=true 일 때만 댓글에 적용', () => {
    expect(isCommentBlocked(commentSample, undefined, 'nickComments')).toBe(true);
    expect(isCommentBlocked(commentSample, undefined, 'nickPostsOnly')).toBe(false);
  });

  it('blockData null / 매칭 없음은 false', () => {
    expect(isCommentBlocked(null, 'comments', 'commentsNick')).toBe(false);
    expect(isCommentBlocked(commentSample, 'missing', 'missing')).toBe(false);
  });
});
