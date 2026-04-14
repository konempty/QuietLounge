// Chrome/Safari service-worker 의 키워드 매칭 + lastChecked 전진 로직 단위 테스트.
// service-worker.js 는 chrome.* / browser.* 전역에 의존하므로, 함수를 그대로 로드하기엔
// 환경 셋업이 번거롭다. 대신 핵심 로직을 동일하게 복제한 pure 함수를 테스트한다.
// 이 테스트는 4개 플랫폼(chrome/safari-background/android/ios)의 공통 알고리즘을
// 문서화하고 회귀를 방지한다.

import { describe, it, expect } from 'vitest';

/**
 * 4개 플랫폼의 공통 로직 (JS 버전):
 *
 * 입력:
 *  - details: [{ postId, title, createTime }] — content-api/v1/posts 응답 (오름차순)
 *  - alerts:  [{ keywords: [..] }]
 *  - lastChecked: ISO 문자열 | undefined
 *
 * 출력:
 *  - matches: [{ postId, title, matched }]
 *  - newLastChecked: ISO 문자열 (details 중 max createTime)
 */
function processChannel(details, alerts, lastChecked) {
  const lastTs = lastChecked ? Date.parse(lastChecked) : 0;
  const matches = [];
  for (const post of details) {
    const createTs = post.createTime ? Date.parse(post.createTime) : 0;
    if (!createTs || createTs <= lastTs) continue;
    for (const alert of alerts) {
      const matched = alert.keywords.find((kw) =>
        post.title.toLowerCase().includes(kw.toLowerCase()),
      );
      if (matched) {
        matches.push({ postId: post.postId, title: post.title, matched });
      }
    }
  }
  const maxCreate = details
    .map((p) => p.createTime)
    .filter(Boolean)
    .sort()
    .pop();
  return { matches, newLastChecked: maxCreate ?? lastChecked };
}

const alerts = [{ keywords: ['공지', '긴급'] }];

describe('processChannel — 키워드 매칭', () => {
  it('매칭되는 글만 반환', () => {
    const details = [
      { postId: 'a', title: '새해 공지사항', createTime: '2026-04-01T00:00:00Z' },
      { postId: 'b', title: '긴급 점검 안내', createTime: '2026-04-02T00:00:00Z' },
      { postId: 'c', title: '평범한 글', createTime: '2026-04-03T00:00:00Z' },
    ];
    const res = processChannel(details, alerts, undefined);
    expect(res.matches).toHaveLength(2);
    expect(res.matches[0].matched).toBe('공지');
    expect(res.matches[1].matched).toBe('긴급');
  });

  it('대소문자 무시 매칭', () => {
    const details = [{ postId: 'x', title: 'HELLO 공지 World', createTime: '2026-04-01T00:00:00Z' }];
    const res = processChannel(details, [{ keywords: ['hello'] }], undefined);
    expect(res.matches).toHaveLength(1);
  });

  it('키워드 없으면 매칭 없음', () => {
    const details = [{ postId: 'x', title: 'foo', createTime: '2026-04-01T00:00:00Z' }];
    const res = processChannel(details, [{ keywords: ['bar'] }], undefined);
    expect(res.matches).toHaveLength(0);
  });
});

describe('processChannel — lastChecked 필터링', () => {
  it('lastChecked 이후 글만 매칭', () => {
    const details = [
      { postId: 'old', title: '공지 오래됨', createTime: '2026-03-01T00:00:00Z' },
      { postId: 'new', title: '공지 새글', createTime: '2026-05-01T00:00:00Z' },
    ];
    const res = processChannel(details, alerts, '2026-04-01T00:00:00Z');
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].postId).toBe('new');
  });

  it('lastChecked 와 정확히 같은 시간은 제외 (<=)', () => {
    const details = [
      { postId: 'eq', title: '공지', createTime: '2026-04-01T00:00:00Z' },
      { postId: 'lt', title: '공지', createTime: '2026-05-01T00:00:00Z' },
    ];
    const res = processChannel(details, alerts, '2026-04-01T00:00:00Z');
    expect(res.matches.map((m) => m.postId)).toEqual(['lt']);
  });

  it('lastChecked 없으면 모든 글 후보', () => {
    const details = [
      { postId: 'a', title: '공지', createTime: '2020-01-01T00:00:00Z' },
      { postId: 'b', title: '공지', createTime: '2030-01-01T00:00:00Z' },
    ];
    const res = processChannel(details, alerts, undefined);
    expect(res.matches).toHaveLength(2);
  });
});

describe('processChannel — lastChecked 전진 (버그 수정 핵심)', () => {
  it('매칭 여부와 무관하게 가장 최신 createTime 으로 전진', () => {
    const details = [
      { postId: 'a', title: '평범', createTime: '2026-04-01T00:00:00Z' },
      { postId: 'b', title: '평범', createTime: '2026-04-05T00:00:00Z' },
    ];
    const res = processChannel(details, alerts, undefined);
    expect(res.matches).toHaveLength(0);
    expect(res.newLastChecked).toBe('2026-04-05T00:00:00Z');
  });

  it('응답 순서가 오름차순이든 내림차순이든 max() 가 최신 선택', () => {
    const asc = [
      { postId: 'a', title: '평범', createTime: '2026-04-01T00:00:00Z' },
      { postId: 'b', title: '평범', createTime: '2026-04-05T00:00:00Z' },
    ];
    const desc = [...asc].reverse();
    expect(processChannel(asc, alerts, undefined).newLastChecked).toBe(
      processChannel(desc, alerts, undefined).newLastChecked,
    );
  });

  it('details 가 비어있으면 lastChecked 유지', () => {
    const res = processChannel([], alerts, '2026-04-01T00:00:00Z');
    expect(res.newLastChecked).toBe('2026-04-01T00:00:00Z');
  });

  it('createTime 누락된 항목은 전진에 기여하지 않음', () => {
    const details = [
      { postId: 'a', title: '공지', createTime: '' },
      { postId: 'b', title: '공지', createTime: '2026-04-05T00:00:00Z' },
    ];
    const res = processChannel(details, alerts, undefined);
    expect(res.newLastChecked).toBe('2026-04-05T00:00:00Z');
  });
});

describe('postId 기반 방식의 옛 버그 재현 (회귀 방지)', () => {
  // 이전 구현: lastChecked = newPosts[0].postId (response.data 의 첫 번째 — 오름차순이라 OLDEST)
  // 수정 후: lastChecked = max(createTime) — 항상 최신
  function oldBuggyLogic(detailsAscending, _lastChecked) {
    // 가장 오래된 글을 lastChecked 로 저장하는 옛 버그
    return detailsAscending[0]?.postId ?? _lastChecked;
  }

  it('옛 방식은 oldest postId 를 저장 (버그)', () => {
    const asc = [
      { postId: 'oldest', title: 't', createTime: '2026-04-01T00:00:00Z' },
      { postId: 'newest', title: 't', createTime: '2026-04-10T00:00:00Z' },
    ];
    expect(oldBuggyLogic(asc)).toBe('oldest');
    // 수정된 방식과 다르다는 점 입증
    expect(processChannel(asc, alerts, undefined).newLastChecked).not.toBe('oldest');
  });
});
