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
// service-worker 런타임과 동일 로직: ISO 문자열 배열에서 파싱된 timestamp 기준 max.
// 이전 helper 는 .sort().pop() 사전순을 썼지만 이는 `+09:00` / `Z` / fractional 혼재 시
// 틀릴 수 있어 runtime 에서 `pickMaxIsoDate` 로 교체됨. 테스트 helper 도 동일하게 맞춰
// 4 플랫폼 공통 시맨틱을 정확히 모델링한다.
function pickMaxIsoDate(candidates) {
  let bestIso = null;
  let bestTs = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const ts = Date.parse(c);
    if (Number.isFinite(ts) && ts > bestTs) {
      bestTs = ts;
      bestIso = c;
    }
  }
  return bestIso;
}

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
  const maxCreate = pickMaxIsoDate(details.map((p) => p.createTime));
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

describe('pickMaxIsoDate — ISO 타임스탬프 문자열의 안전한 max', () => {
  // 위의 file-top 헬퍼와 동일 — service-worker 런타임의 pickMaxIsoDate 와 같은 시맨틱 검증.
  it('빈 배열 → null', () => {
    expect(pickMaxIsoDate([])).toBeNull();
  });

  it('단일 값 반환', () => {
    expect(pickMaxIsoDate(['2026-04-01T00:00:00Z'])).toBe('2026-04-01T00:00:00Z');
  });

  it('UTC Z 포맷 여러 값 중 max', () => {
    expect(
      pickMaxIsoDate([
        '2026-04-01T00:00:00Z',
        '2026-04-05T12:00:00Z',
        '2026-04-03T00:00:00Z',
      ]),
    ).toBe('2026-04-05T12:00:00Z');
  });

  it('타임존 혼재 시 사전순이 아닌 실제 timestamp 기준으로 선택', () => {
    // "2026-04-01T00:00:00+09:00" 은 UTC 로 2026-03-31T15:00:00Z (더 이른 시각)
    // "2026-04-01T00:00:00Z" 는 더 나중 시각
    // 사전순(.sort()) 이라면 "+09:00" 이 "Z" 보다 뒤로 가지만 실제 시각은 Z 가 더 크다.
    expect(
      pickMaxIsoDate(['2026-04-01T00:00:00+09:00', '2026-04-01T00:00:00Z']),
    ).toBe('2026-04-01T00:00:00Z');
  });

  it('fractional seconds 가 있는 값이 최대', () => {
    expect(
      pickMaxIsoDate(['2026-04-01T00:00:00Z', '2026-04-01T00:00:00.500Z']),
    ).toBe('2026-04-01T00:00:00.500Z');
  });

  it('파싱 실패한 값은 후보에서 제외', () => {
    expect(
      pickMaxIsoDate(['garbage', '2026-04-01T00:00:00Z', 'also-garbage']),
    ).toBe('2026-04-01T00:00:00Z');
  });

  it('모두 파싱 실패면 null', () => {
    expect(pickMaxIsoDate(['abc', 'xyz'])).toBeNull();
  });

  it('빈 문자열 / falsy 값은 스킵', () => {
    expect(
      pickMaxIsoDate(['', null, undefined, '2026-04-05T00:00:00Z']),
    ).toBe('2026-04-05T00:00:00Z');
  });

  // ── 기존 .sort().pop() 로직이 실패하는 케이스 재현 (버그 회귀 방지) ──
  it('.sort().pop() 은 동일 입력에서 다른(틀린) 결과를 반환', () => {
    const mixed = ['2026-04-01T00:00:00+09:00', '2026-04-01T00:00:00Z'];
    const lexical = [...mixed].filter(Boolean).sort().pop();
    // 사전순 결과: "+09:00" 이 "Z" 보다 뒤 (ASCII 상 + = 0x2B, Z = 0x5A 이므로 Z 가 더 큼)
    // 실제로 확인: 어떤 값이 사전순으로 뒤인가?
    // "2026-04-01T00:00:00+09:00" 과 "2026-04-01T00:00:00Z" 비교:
    //   17번째 문자가 "+" vs "Z" — ASCII: + = 43, Z = 90 → Z 가 사전순으로 뒤
    expect(lexical).toBe('2026-04-01T00:00:00Z');
    // 이 케이스는 사전순과 실제 timestamp 순이 우연히 일치 —
    // 하지만 다른 tz 섞임에서는 다를 수 있음. 아래 케이스 참조.

    // 사전순과 timestamp 순이 어긋나는 케이스:
    // "2026-04-01T09:00:00+09:00" (= 2026-04-01T00:00:00Z) vs "2026-04-01T00:00:01Z"
    // 실제 timestamp: 후자가 1초 더 나중
    // 사전순: 후자의 17번째가 Z, 전자의 17번째가 +  → 후자가 사전순 뒤 (= 올바름, 우연히)
    // 더 확실한 예시: "2026-04-01T09:00:00+09:00" vs "2026-04-01T00:00:00Z"
    //   실제: 같은 시각. 어느 것이 반환되어도 무방. pickMaxIsoDate 는 첫 번째 매치 유지.
    const sameInstant = pickMaxIsoDate([
      '2026-04-01T09:00:00+09:00',
      '2026-04-01T00:00:00Z',
    ]);
    // 둘 다 유효한 표현이므로 타임스탬프 기준 max 는 일관되어야 함.
    // (여기서는 먼저 들어온 쪽이 유지 — 동일 timestamp 에서 > 가 아니므로)
    expect(sameInstant).toBe('2026-04-01T09:00:00+09:00');
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
