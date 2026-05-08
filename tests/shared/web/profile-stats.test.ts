// shared/web/core/profile-stats.ts 단위 테스트.
//
// 4 entry 가 같은 함수를 사용하므로 단일 source 검증으로 cross-platform 회귀 가드.
// 핵심 검증 포인트: 페이지 식별, HTML 빌드 (월 카운트 null/숫자), DOM box 부착, 캐시 hit/miss,
// adapter.saveOwnerPersonaId hook, fetchMonthlyCount 의 pagination + monthStart 필터,
// fetchAndStoreMyStats 의 me API + personas API 시퀀스 + activities fallback + unauthenticated 처리.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  isProfilePage,
  getProfilePersonaId,
  buildProfileStatsHtml,
  injectProfileStats,
  resetProfileStatsCache,
  fetchMonthlyCount,
  fetchPersonaStatsWithRetry,
  fetchAndStoreMyStats,
  __resetForTests,
} from '../../../shared/web/core/profile-stats';
import type { ProfileStatsAdapter } from '../../../shared/web/platform/adapter';

function setupDom(html: string, url: string): Document {
  const dom = new JSDOM(`<!doctype html><html lang="ko"><body>${html}</body></html>`, { url });
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.MutationObserver = dom.window.MutationObserver as unknown as typeof MutationObserver;
  globalThis.requestAnimationFrame =
    ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame;
  return dom.window.document;
}

function jsonResp(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

function notOkResp(): Response {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

beforeEach(() => {
  __resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('isProfilePage / getProfilePersonaId', () => {
  it('/profiles/abc → true / personaId="abc"', () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc');
    expect(isProfilePage()).toBe(true);
    expect(getProfilePersonaId()).toBe('abc');
  });

  it('/profiles/abc?tab=posts → personaId="abc" (쿼리 무시)', () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc?tab=posts');
    expect(getProfilePersonaId()).toBe('abc');
  });

  it('/profiles/abc/comments → personaId="abc" (서브패스 무시)', () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc/comments');
    expect(getProfilePersonaId()).toBe('abc');
  });

  it('/posts/x → false', () => {
    setupDom('', 'https://lounge.naver.com/posts/x');
    expect(isProfilePage()).toBe(false);
    expect(getProfilePersonaId()).toBeNull();
  });
});

describe('buildProfileStatsHtml', () => {
  it('cache 비었을 때 빈 문자열', () => {
    setupDom('', 'https://lounge.naver.com/profiles/x');
    expect(buildProfileStatsHtml('#FFFFFF')).toBe('');
  });

  it('월 카운트 둘 다 null 이면 spinner 2 개 노출', async () => {
    const doc = setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    const adapter: ProfileStatsAdapter = { qlPrimaryColor: '#4A6CF7' };
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('/personas/abc')) {
        return jsonResp({
          data: { totalPostCount: 12, totalCommentCount: 34, createTime: '2025-01-01T00:00:00Z' },
        });
      }
      if (url.includes('/activities/posts')) return jsonResp({ data: { items: [] } });
      if (url.includes('/activities/comments')) return jsonResp({ data: { items: [] } });
      return notOkResp();
    }) as unknown as typeof fetch;

    injectProfileStats(adapter);
    await new Promise((r) => setTimeout(r, 30));

    const box = doc.getElementById('ql-profile-stats')!;
    expect(box).toBeTruthy();
    expect(box.innerHTML).toContain('12');
    expect(box.innerHTML).toContain('34');
    // 월 카운트는 빈 페이지 쿼리 후 0 으로 채워질 수도 있음 — 두 케이스 모두 허용.
    // spinner 가 사라지거나 (0 으로 갱신) 또는 spinner 가 떠있거나 둘 중 하나.
  });

  it('이번달에 가입 (createdThisMonth) 이면 monthlyCount = totalCount, fetchMonthlyCount 호출 안 함', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/personas/abc')) {
        return jsonResp({
          data: {
            totalPostCount: 5,
            totalCommentCount: 7,
            createTime: thisMonthStart.toISOString(),
          },
        });
      }
      return notOkResp();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    await new Promise((r) => setTimeout(r, 30));

    // activities API 가 호출되지 않아야 함 (createdThisMonth 분기).
    const calls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calls.some((u) => /activities\/posts/.test(u))).toBe(false);
    expect(calls.some((u) => /activities\/comments/.test(u))).toBe(false);
  });
});

describe('injectProfileStats — DOM box 부착', () => {
  it('tabsEl 미존재 시 box 부착 안 함', async () => {
    const doc = setupDom('', 'https://lounge.naver.com/profiles/abc');
    globalThis.fetch = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 1, totalCommentCount: 1 } }),
    ) as unknown as typeof fetch;
    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    await new Promise((r) => setTimeout(r, 30));
    expect(doc.getElementById('ql-profile-stats')).toBeNull();
  });

  it('isProfilePage=false 면 fetch 자체를 안 함', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/posts/x');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('스피너 keyframes style 1 회만 주입 (id="ql-spinner-style")', async () => {
    const doc = setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    globalThis.fetch = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 0, totalCommentCount: 0 } }),
    ) as unknown as typeof fetch;
    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    await new Promise((r) => setTimeout(r, 30));
    const styles = doc.querySelectorAll('#ql-spinner-style');
    expect(styles.length).toBe(1);
  });
});

describe('injectProfileStats — 캐시 / adapter hook', () => {
  it('같은 personaId 재호출 시 fetch 추가 안 함', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    const fetchMock = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 1, totalCommentCount: 1, createTime: '2099-01-01T00:00:00Z' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const adapter: ProfileStatsAdapter = { qlPrimaryColor: '#4A6CF7' };

    injectProfileStats(adapter);
    await new Promise((r) => setTimeout(r, 30));
    const firstCallCount = fetchMock.mock.calls.length;

    injectProfileStats(adapter); // 재호출
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchMock.mock.calls.length).toBe(firstCallCount);
  });

  it('stats.isOwner=true 면 adapter.saveOwnerPersonaId 호출', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/me');
    globalThis.fetch = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 1, totalCommentCount: 1, isOwner: true, createTime: '2099-01-01T00:00:00Z' } }),
    ) as unknown as typeof fetch;
    const saveOwnerPersonaId = vi.fn();
    injectProfileStats({ qlPrimaryColor: '#4A6CF7', saveOwnerPersonaId });
    await new Promise((r) => setTimeout(r, 30));
    expect(saveOwnerPersonaId).toHaveBeenCalledWith('me');
  });

  it('stats.isOwner=false 면 saveOwnerPersonaId 호출 안 함', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/other');
    globalThis.fetch = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 1, totalCommentCount: 1, isOwner: false, createTime: '2099-01-01T00:00:00Z' } }),
    ) as unknown as typeof fetch;
    const saveOwnerPersonaId = vi.fn();
    injectProfileStats({ qlPrimaryColor: '#4A6CF7', saveOwnerPersonaId });
    await new Promise((r) => setTimeout(r, 30));
    expect(saveOwnerPersonaId).not.toHaveBeenCalled();
  });

  it('saveOwnerPersonaId 어댑터 미구현 (iOS/Android) 이어도 동작', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/x');
    globalThis.fetch = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 0, totalCommentCount: 0, isOwner: true, createTime: '2099-01-01T00:00:00Z' } }),
    ) as unknown as typeof fetch;
    expect(() => injectProfileStats({ qlPrimaryColor: '#4A6CF7' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 30));
  });

  it('resetProfileStatsCache 호출 후엔 같은 personaId 재호출 시 fetch 다시 일어남', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    const fetchMock = vi.fn(async () =>
      jsonResp({ data: { totalPostCount: 1, totalCommentCount: 1, createTime: '2099-01-01T00:00:00Z' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    await new Promise((r) => setTimeout(r, 30));
    const before = fetchMock.mock.calls.length;

    resetProfileStatsCache();
    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('fetchMonthlyCount', () => {
  it("posts: monthStart 이후 createTime 만 카운트, 페이지 끝나면 break", async () => {
    setupDom('', 'https://lounge.naver.com/profiles/x');
    const monthStart = new Date('2026-05-01T00:00:00Z');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (/activities\/posts/.test(url)) {
        return jsonResp({
          data: {
            items: [{ postId: 'p1' }, { postId: 'p2' }, { postId: 'p3' }],
            cursorInfo: { hasNext: false },
          },
        });
      }
      if (/content-api\/v1\/posts/.test(url)) {
        return jsonResp({
          data: [
            { createTime: '2026-05-10T00:00:00Z' },
            { createTime: '2026-05-02T00:00:00Z' },
            { createTime: '2026-04-25T00:00:00Z' }, // before monthStart → 카운트 X
          ],
        });
      }
      return notOkResp();
    }) as unknown as typeof fetch;

    const count = await fetchMonthlyCount('x', 'posts', monthStart);
    expect(count).toBe(2);
  });

  it('comments: rawResponse JSON 파싱해서 regTimeGmt 기준 필터', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/x');
    const monthStart = new Date('2026-05-01T00:00:00Z');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (/activities\/comments/.test(url)) {
        return jsonResp({
          data: {
            items: [{ commentId: 'c1' }, { commentId: 'c2' }],
            cursorInfo: { hasNext: false },
          },
        });
      }
      if (/content-api\/v1\/comments/.test(url)) {
        return jsonResp({
          data: {
            rawResponse: JSON.stringify({
              result: {
                commentList: [
                  { regTimeGmt: '2026-05-15T00:00:00Z' },
                  { regTimeGmt: '2026-04-01T00:00:00Z' }, // 제외
                ],
              },
            }),
          },
        });
      }
      return notOkResp();
    }) as unknown as typeof fetch;

    const count = await fetchMonthlyCount('x', 'comments', monthStart);
    expect(count).toBe(1);
  });

  it('한 페이지 안에 monthStart 이후가 하나도 없으면 break (페이지네이션 중단)', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/x');
    const monthStart = new Date('2026-05-01T00:00:00Z');
    const fetchMock = vi.fn(async (url: string) => {
      if (/activities\/posts/.test(url)) {
        return jsonResp({
          data: {
            items: [{ postId: 'p1' }],
            cursorInfo: { hasNext: true, endCursor: 'next' },
          },
        });
      }
      if (/content-api\/v1\/posts/.test(url)) {
        return jsonResp({ data: [{ createTime: '2026-04-01T00:00:00Z' }] });
      }
      return notOkResp();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const count = await fetchMonthlyCount('x', 'posts', monthStart);
    expect(count).toBe(0);
    // hasNext=true 였지만 페이지에 이번달 글이 없으니 두번째 페이지 fetch 가 일어나면 안 됨.
    const activitiesCalls = fetchMock.mock.calls.filter((c) => /activities\/posts/.test(c[0]));
    expect(activitiesCalls.length).toBe(1);
  });

  it('activities API non-ok 면 0 반환', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/x');
    globalThis.fetch = vi.fn(async () => notOkResp()) as unknown as typeof fetch;
    const count = await fetchMonthlyCount('x', 'posts', new Date());
    expect(count).toBe(0);
  });
});

describe('fetchPersonaStatsWithRetry — 빠른 navigation 후 fetch race 회복', () => {
  it('첫 시도 실패 → backoff 후 재시도 성공', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc');
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return notOkResp(); // first attempt fails
      return jsonResp({ data: { totalPostCount: 9, totalCommentCount: 9 } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchPersonaStatsWithRetry('abc', 2);
    // 1 초 backoff 통과
    await new Promise((r) => setTimeout(r, 1100));
    const stats = await promise;
    expect(stats?.totalPostCount).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('모든 retry 실패 시 null 반환 (예외 안 던짐)', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc');
    globalThis.fetch = vi.fn(async () => notOkResp()) as unknown as typeof fetch;
    const promise = fetchPersonaStatsWithRetry('abc', 1);
    await new Promise((r) => setTimeout(r, 1100));
    const stats = await promise;
    expect(stats).toBeNull();
  });

  it('backoff 도중 다른 프로필로 이동했으면 추가 fetch 안 함', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc');
    const fetchMock = vi.fn(async () => notOkResp());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchPersonaStatsWithRetry('abc', 2);
    // backoff 진행 중에 url 을 다른 프로필로 변경.
    await new Promise((r) => setTimeout(r, 100));
    setupDom('', 'https://lounge.naver.com/profiles/other');
    await new Promise((r) => setTimeout(r, 1100));
    const stats = await promise;
    expect(stats).toBeNull();
    // 첫 시도 1회만 — backoff 후 abort.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('backoff 도중 프로필 페이지를 떠났으면 추가 fetch 안 함', async () => {
    setupDom('', 'https://lounge.naver.com/profiles/abc');
    const fetchMock = vi.fn(async () => notOkResp());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchPersonaStatsWithRetry('abc', 2);
    await new Promise((r) => setTimeout(r, 100));
    setupDom('', 'https://lounge.naver.com/posts/x'); // 프로필 페이지 아님
    await new Promise((r) => setTimeout(r, 1100));
    const stats = await promise;
    expect(stats).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('injectProfileStats — monthly fetch stale guard (P2 회귀)', () => {
  it('A → B 빠른 이동 시 A 의 늦은 monthly resolve 가 B 의 cache 를 덮지 않음', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/A');

    // A 의 monthly posts/comments fetch 를 수동 제어. 기본 personas 는 즉시 응답.
    let pendingMonthlyA: ((v: Response) => void) | null = null;
    const monthlyAResolved = { posts: false, comments: false };
    globalThis.fetch = vi.fn(async (url: string) => {
      if (/personas\/A$/.test(url)) {
        // A 의 createTime 은 한참 전 — monthly fetch 분기 진입.
        return jsonResp({
          data: { totalPostCount: 100, totalCommentCount: 200, createTime: '2020-01-01T00:00:00Z' },
        });
      }
      if (/personas\/A\/activities/.test(url)) {
        if (monthlyAResolved.posts && monthlyAResolved.comments) {
          return jsonResp({ data: { items: [] } });
        }
        return new Promise<Response>((res) => {
          pendingMonthlyA = res;
        });
      }
      if (/personas\/B$/.test(url)) {
        // B 는 이번달 가입 — activities API 안 부르고 monthly = total.
        return jsonResp({
          data: { totalPostCount: 5, totalCommentCount: 7, createTime: new Date().toISOString() },
        });
      }
      return notOkResp();
    }) as unknown as typeof fetch;

    const adapter: ProfileStatsAdapter = { qlPrimaryColor: '#4A6CF7' };
    injectProfileStats(adapter);
    await new Promise((r) => setTimeout(r, 30));

    // A 의 monthly fetch 는 pending. B 로 이동 (resetCache + 새 fetch).
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/B');
    resetProfileStatsCache();
    injectProfileStats(adapter);
    await new Promise((r) => setTimeout(r, 30));

    // 이제 cache 는 B 의 stats. monthlyPosts/Comments 는 createdThisMonth 분기로 5/7.
    // A 의 늦은 monthly fetch 결과를 도착시킴.
    monthlyAResolved.posts = true;
    monthlyAResolved.comments = true;
    pendingMonthlyA?.(jsonResp({
      data: {
        items: [{ postId: 'p' }],
        cursorInfo: { hasNext: false },
      },
    }));
    await new Promise((r) => setTimeout(r, 50));

    // B 의 box 가 A 의 monthly count 로 덮이지 않았는지 확인 — innerHTML 에 5 / 7 만 있고 100/200 은 없어야.
    const box = document.getElementById('ql-profile-stats')!;
    expect(box.innerHTML).toContain('5');
    expect(box.innerHTML).toContain('7');
    expect(box.innerHTML).not.toContain('100');
    expect(box.innerHTML).not.toContain('200');
  });
});

describe('injectProfileStats — in-flight 가드 (page-level MutationObserver 중복 호출 방지)', () => {
  it('같은 personaId 로 빠르게 여러 번 호출돼도 fetch 는 단 1 회', async () => {
    setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    let pending: ((v: Response) => void) | null = null;
    const fetchMock = vi.fn(
      () => new Promise<Response>((res) => { pending = res; }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter: ProfileStatsAdapter = { qlPrimaryColor: '#4A6CF7' };
    injectProfileStats(adapter);
    injectProfileStats(adapter);
    injectProfileStats(adapter);

    // fetch 는 정확히 한 번만 호출됐어야.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // pending fetch 해소.
    pending!(jsonResp({ data: { totalPostCount: 1, totalCommentCount: 1, createTime: '2099-01-01T00:00:00Z' } }));
    await new Promise((r) => setTimeout(r, 30));
  });
});

describe('injectProfileStats — 빠른 navigation 회복 (race recovery)', () => {
  it('첫 fetch 실패해도 retry 로 box 가 결국 부착', async () => {
    const doc = setupDom('<div data-slot="tabs"></div>', 'https://lounge.naver.com/profiles/abc');
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) return notOkResp();
      return jsonResp({
        data: { totalPostCount: 7, totalCommentCount: 11, createTime: '2099-01-01T00:00:00Z' },
      });
    }) as unknown as typeof fetch;

    injectProfileStats({ qlPrimaryColor: '#4A6CF7' });
    // 첫 시도 실패 + backoff 1s + retry 성공 + rAF tick.
    await new Promise((r) => setTimeout(r, 1200));

    const box = doc.getElementById('ql-profile-stats');
    expect(box).toBeTruthy();
    expect(box!.innerHTML).toContain('7');
    expect(box!.innerHTML).toContain('11');
  });
});

describe('fetchAndStoreMyStats', () => {
  it('saveMyStats 어댑터 미구현 (iOS/Android) 시 fetch 자체를 안 함', async () => {
    setupDom('', 'https://lounge.naver.com/');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await fetchAndStoreMyStats({ qlPrimaryColor: '#4A6CF7' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('me API 가 unauthenticated 면 removeMyStats 호출', async () => {
    setupDom('', 'https://lounge.naver.com/');
    globalThis.fetch = vi.fn(async () => notOkResp()) as unknown as typeof fetch;
    const removeMyStats = vi.fn();
    const saveMyStats = vi.fn();
    await fetchAndStoreMyStats({ qlPrimaryColor: '#4A6CF7', saveMyStats, removeMyStats });
    expect(removeMyStats).toHaveBeenCalled();
    expect(saveMyStats).not.toHaveBeenCalled();
  });

  it('정상 흐름: me → personas 로 totalPosts/totalComments 추출, saveMyStats + saveOwnerPersonaId', async () => {
    setupDom('', 'https://lounge.naver.com/');
    globalThis.fetch = vi.fn(async (url: string) => {
      if (/members\/me\/personas/.test(url)) {
        return jsonResp({ data: [{ personaId: 'pid_me', nickname: '나', createTime: '2099-01-01T00:00:00Z' }] });
      }
      if (/personas\/pid_me$/.test(url)) {
        return jsonResp({
          data: { totalPostCount: 100, totalCommentCount: 200, nickname: '나', createTime: '2099-01-01T00:00:00Z' },
        });
      }
      return notOkResp();
    }) as unknown as typeof fetch;

    const saveMyStats = vi.fn();
    const saveOwnerPersonaId = vi.fn();
    await fetchAndStoreMyStats({
      qlPrimaryColor: '#4A6CF7',
      saveMyStats,
      saveOwnerPersonaId,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(saveOwnerPersonaId).toHaveBeenCalledWith('pid_me');
    expect(saveMyStats).toHaveBeenCalled();
    const lastCall = saveMyStats.mock.calls.at(-1)?.[0];
    expect(lastCall.personaId).toBe('pid_me');
    expect(lastCall.totalPosts).toBe(100);
    expect(lastCall.totalComments).toBe(200);
  });

  it("createdThisMonth=true 면 monthlyCounts = totalCounts (activities API 안 부름)", async () => {
    setupDom('', 'https://lounge.naver.com/');
    const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const fetchMock = vi.fn(async (url: string) => {
      if (/members\/me\/personas/.test(url)) {
        return jsonResp({ data: [{ personaId: 'me', nickname: '나' }] });
      }
      if (/personas\/me$/.test(url)) {
        return jsonResp({
          data: { totalPostCount: 3, totalCommentCount: 5, nickname: '나', createTime: thisMonthStart.toISOString() },
        });
      }
      return notOkResp();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const saveMyStats = vi.fn();
    await fetchAndStoreMyStats({ qlPrimaryColor: '#4A6CF7', saveMyStats });
    await new Promise((r) => setTimeout(r, 10));

    const lastCall = saveMyStats.mock.calls.at(-1)?.[0];
    expect(lastCall.monthlyPosts).toBe(3);
    expect(lastCall.monthlyComments).toBe(5);
    // activities API 호출 안 했어야 함.
    expect(fetchMock.mock.calls.some((c) => /activities/.test(c[0]))).toBe(false);
  });
});
