// 프로필 페이지(`/profiles/{personaId}`) 활동 통계 박스 inject.
//
// 이전엔 4 entry (chrome / safari-ext / ios-after / android-after) 가 같은 ~300 LOC 를 인라인으로
// 갖고 있었다 (PR #4 이전). 이번에 단일 source 로 통합하면서 4 곳의 미세한 차이만 ProfileStatsAdapter
// 로 흡수: 브랜드 색 (인라인 스타일), 본인 프로필 영속화, 내 통계 영속화.
//
// 핵심 흐름:
//   1. SPA 네비게이션 → `injectProfileStats()` 호출 (entry 측이 popstate / history.pushState 감시)
//   2. personaId 추출 → 캐시 hit 면 `startProfileStatsGuard()` 만, miss 면 `fetchPersonaStats()` 후 동일
//   3. createTime 이 이번달이면 totalPostCount/totalCommentCount 그대로 (월 카운트 = 총 카운트),
//      아니면 `fetchMonthlyCount('posts'|'comments')` 로 페이지네이션 순회
//   4. `startProfileStatsGuard()`: rAF 폴링 3 초 (프로그레스 바 / 탭 전환 등 빠른 리렌더 대응) →
//      MutationObserver 로 전환 (장기 안정 상태)
//
// 캐시는 module-level 상태 — 같은 personaId 재방문 시 fetch 재호출 방지.

import type { MyStatsRecord, ProfileStatsAdapter } from '../platform/adapter';

const PROFILE_BOX_ID = 'ql-profile-stats';
const SPINNER_STYLE_ID = 'ql-spinner-style';
const TABS_SLOT_SELECTOR = '[data-slot="tabs"]';

interface PersonaStats {
  personaId?: string;
  nickname?: string;
  totalPostCount?: number;
  totalCommentCount?: number;
  isOwner?: boolean;
  createTime?: string;
}

interface ProfileStatsCache {
  personaId: string | null;
  stats: PersonaStats | null;
  monthlyPosts: number | null;
  monthlyComments: number | null;
}

let cache: ProfileStatsCache = {
  personaId: null,
  stats: null,
  monthlyPosts: null,
  monthlyComments: null,
};

let rafId: number | null = null;
let observer: MutationObserver | null = null;

// in-flight fetch 가드 — page-level MutationObserver 가 매 mutation 시 injectProfileStats 를
// 호출해도 같은 personaId 의 fetch 가 진행 중이면 중복 호출 방지. fetch 완료 시 null 로 복구.
let inFlightPersonaId: string | null = null;

export function isProfilePage(): boolean {
  return window.location.pathname.startsWith('/profiles/');
}

export function getProfilePersonaId(): string | null {
  const match = window.location.pathname.match(/^\/profiles\/([^/?]+)/);
  return match ? match[1] : null;
}

export async function fetchPersonaStats(personaId: string): Promise<PersonaStats | null> {
  try {
    const resp = await fetch(
      `https://api.lounge.naver.com/user-api/v1/personas/${personaId}`,
      { credentials: 'include' },
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    return (json.data as PersonaStats) || null;
  } catch {
    return null;
  }
}

/**
 * fetchPersonaStats + 짧은 backoff retry.
 *
 * 글 상세 → 프로필로 빠르게 이동하면 글 상세의 진행 중 fetch 와 race 해서 personas API 가 일시 실패할
 * 수 있다. 단발 호출은 silent skip 으로 끝나 활동 통계가 영영 안 뜨는 것처럼 보인다 — 이를 방지하기 위해
 * 1 초 / 2 초 backoff 로 최대 2 회 재시도. 페이지를 떠났거나 personaId 가 바뀌면 즉시 abort.
 */
export async function fetchPersonaStatsWithRetry(
  personaId: string,
  retries = 2,
): Promise<PersonaStats | null> {
  for (let i = 0; i <= retries; i++) {
    const stats = await fetchPersonaStats(personaId);
    if (stats) return stats;
    if (i === retries) return null;
    await new Promise<void>((r) => setTimeout(r, 1000 * (i + 1)));
    // backoff 도중 다른 페이지로 이동 / 다른 프로필로 전환됐으면 더 시도하지 않음.
    if (!isProfilePage() || getProfilePersonaId() !== personaId) return null;
  }
  return null;
}

/**
 * 이번달 작성 글 / 댓글 카운트 — activities API + content API 2 단계 페이지네이션.
 * activities 는 ID 만 주고, content 는 createTime / regTimeGmt 를 주므로 monthStart 이후만 필터.
 * 한 페이지라도 전부 monthStart 미만이면 break (시간 역순 정렬 가정).
 */
export async function fetchMonthlyCount(
  personaId: string,
  type: 'posts' | 'comments',
  monthStart: Date,
): Promise<number> {
  const isComments = type === 'comments';
  let count = 0;
  let cursor = '';

  for (let page = 0; page < 50; page++) {
    try {
      const actUrl =
        `https://api.lounge.naver.com/user-api/v1/personas/${personaId}/activities/${type}` +
        `?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
      const actResp = await fetch(actUrl, { credentials: 'include' });
      if (!actResp.ok) break;
      const actJson = await actResp.json();
      const items = actJson.data?.items || [];
      if (items.length === 0) break;

      let detailUrl: string;
      if (isComments) {
        const ids = items.map((it: { commentId: string }) => it.commentId);
        const params = ids.map((id: string) => `commentNoList=${id}`).join('&');
        detailUrl = `https://api.lounge.naver.com/content-api/v1/comments?${params}`;
      } else {
        const ids = items.map((it: { postId: string }) => it.postId);
        const params = ids.map((id: string) => `postIds=${id}`).join('&');
        detailUrl = `https://api.lounge.naver.com/content-api/v1/posts?${params}`;
      }
      const detailResp = await fetch(detailUrl, { credentials: 'include' });
      if (!detailResp.ok) break;
      const detailJson = await detailResp.json();

      let hasThisMonth = false;
      if (isComments) {
        const raw = detailJson.data?.rawResponse;
        const parsed = raw ? JSON.parse(raw) : null;
        const commentList = parsed?.result?.commentList || [];
        for (const c of commentList) {
          const dateStr = c.regTimeGmt || '';
          if (dateStr && new Date(dateStr) >= monthStart) {
            count++;
            hasThisMonth = true;
          }
        }
      } else {
        const details = Array.isArray(detailJson.data) ? detailJson.data : [];
        for (const item of details) {
          const dateStr = item.createTime || '';
          if (dateStr && new Date(dateStr) >= monthStart) {
            count++;
            hasThisMonth = true;
          }
        }
      }

      if (!hasThisMonth) break;
      if (!actJson.data?.cursorInfo?.hasNext) break;
      cursor = actJson.data?.cursorInfo?.endCursor || '';
      if (!cursor) break;
    } catch {
      break;
    }
  }

  return count;
}

export function buildProfileStatsHtml(qlPrimary: string): string {
  const stats = cache.stats;
  if (!stats) return '';
  const totalPosts = stats.totalPostCount || 0;
  const totalComments = stats.totalCommentCount || 0;
  const mp = cache.monthlyPosts;
  const mc = cache.monthlyComments;
  const spinner =
    `<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.2);` +
    `border-top-color:${qlPrimary};border-radius:50%;animation:ql-spin 0.8s linear infinite;` +
    `vertical-align:middle;"></span>`;
  const mpText = mp !== null ? String(mp) : spinner;
  const mcText = mc !== null ? String(mc) : spinner;

  return (
    `<div style="font-weight:600;font-size:14px;margin-bottom:10px;color:${qlPrimary};">활동 통계</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">` +
    `<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">` +
    `<div style="font-size:20px;font-weight:700;">${totalPosts}</div>` +
    `<div style="font-size:11px;opacity:0.7;margin-top:2px;">총 작성글</div></div>` +
    `<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">` +
    `<div style="font-size:20px;font-weight:700;">${totalComments}</div>` +
    `<div style="font-size:11px;opacity:0.7;margin-top:2px;">총 댓글</div></div>` +
    `<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">` +
    `<div style="font-size:20px;font-weight:700;">${mpText}</div>` +
    `<div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 작성글</div></div>` +
    `<div style="text-align:center;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;">` +
    `<div style="font-size:20px;font-weight:700;">${mcText}</div>` +
    `<div style="font-size:11px;opacity:0.7;margin-top:2px;">이번달 댓글</div></div></div>`
  );
}

function ensureSpinnerStyle(): void {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SPINNER_STYLE_ID;
  style.textContent = '@keyframes ql-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

function insertProfileStatsBox(qlPrimary: string): void {
  if (document.getElementById(PROFILE_BOX_ID)) return;
  const tabsEl = document.querySelector(TABS_SLOT_SELECTOR);
  if (!tabsEl) return;
  const box = document.createElement('div');
  box.id = PROFILE_BOX_ID;
  box.style.cssText =
    'margin:12px 20px 0;padding:14px 16px;background:rgba(74,108,247,0.08);' +
    'border:1px solid rgba(74,108,247,0.2);border-radius:10px;font-size:13px;' +
    'color:var(--color-neutral-foreground-default,#e0e0e0);';
  box.innerHTML = buildProfileStatsHtml(qlPrimary);
  tabsEl.before(box);
}

function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

/**
 * Phase 1: rAF 폴링 (3 초). 탭 전환 / 프로그레스 바 / 첫 페인트 직후의 빠른 DOM 리렌더 대응.
 * Phase 2: MutationObserver (debounced 100ms). 장기 안정 상태 — rAF 같은 비용 안 들임.
 */
export function startProfileStatsGuard(qlPrimary: string): void {
  stopProfileStatsGuard();
  const startTime = Date.now();
  function tick(): void {
    if (!isProfilePage() || !cache.stats) {
      rafId = null;
      return;
    }
    insertProfileStatsBox(qlPrimary);
    if (Date.now() - startTime < 3000) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      observer = new MutationObserver(
        debounce(() => {
          if (isProfilePage() && cache.stats) insertProfileStatsBox(qlPrimary);
        }, 100),
      );
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  rafId = requestAnimationFrame(tick);
}

export function stopProfileStatsGuard(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

export function resetProfileStatsCache(): void {
  cache = { personaId: null, stats: null, monthlyPosts: null, monthlyComments: null };
  stopProfileStatsGuard();
  // in-flight 가드도 함께 비움 — 새 페이지/persona 의 fetch 를 막지 않도록.
  inFlightPersonaId = null;
}

export function injectProfileStats(adapter: ProfileStatsAdapter): void {
  if (!isProfilePage()) return;
  const personaId = getProfilePersonaId();
  if (!personaId) return;

  ensureSpinnerStyle();

  // 같은 personaId 재방문 — fetch 안 하고 가드만 재시작.
  if (cache.personaId === personaId && cache.stats) {
    startProfileStatsGuard(adapter.qlPrimaryColor);
    return;
  }

  // page-level MutationObserver 가 mutation 마다 호출해도 fetch 가 in-flight 면 중복 안 함.
  if (inFlightPersonaId === personaId) return;
  inFlightPersonaId = personaId;

  fetchPersonaStatsWithRetry(personaId).then((stats) => {
    inFlightPersonaId = null;
    // 도중에 다른 페이지로 이동했거나 다른 프로필로 전환된 경우 stale 결과 폐기.
    if (!isProfilePage() || getProfilePersonaId() !== personaId) return;
    if (!stats) return;

    if (stats.isOwner) {
      adapter.saveOwnerPersonaId?.(personaId);
    }

    cache = { personaId, stats, monthlyPosts: null, monthlyComments: null };

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const createTime = stats.createTime ? new Date(stats.createTime) : null;
    const createdThisMonth = createTime && createTime >= monthStart;

    if (createdThisMonth) {
      // 이번달에 가입했으면 총 카운트가 곧 이번달 카운트.
      cache.monthlyPosts = stats.totalPostCount || 0;
      cache.monthlyComments = stats.totalCommentCount || 0;
    } else {
      // A → B 빠른 이동 시 A 의 monthly fetch 가 늦게 resolve 되어 B 의 cache 를 덮지 않도록 stale guard.
      // resetProfileStatsCache 에서 cache.personaId = null 이 되거나, 새 personaId 의 fetch 결과가 cache 를
      // 갱신하면 이 비교가 false → 무시.
      fetchMonthlyCount(personaId, 'posts', monthStart).then((count) => {
        if (cache.personaId !== personaId) return;
        cache.monthlyPosts = count;
        const el = document.getElementById(PROFILE_BOX_ID);
        if (el) el.innerHTML = buildProfileStatsHtml(adapter.qlPrimaryColor);
      });
      fetchMonthlyCount(personaId, 'comments', monthStart).then((count) => {
        if (cache.personaId !== personaId) return;
        cache.monthlyComments = count;
        const el = document.getElementById(PROFILE_BOX_ID);
        if (el) el.innerHTML = buildProfileStatsHtml(adapter.qlPrimaryColor);
      });
    }

    startProfileStatsGuard(adapter.qlPrimaryColor);
  });
}

/**
 * 라운지 접속 시마다 본인 통계를 갱신 — popup 의 "내 활동 통계" 카드 데이터.
 *
 * Chrome / Safari ext 만 호출 (saveMyStats / removeMyStats 어댑터 메서드 구현된 경우만).
 * iOS / Android 는 popup 이 native 라 native 측에서 자체 처리.
 *
 * 1) me API 로 personaId 확인 → 없으면 unauthenticated, removeMyStats.
 * 2) personas API 로 총 글/댓글 수 — 실패 시 activities API 의 totalPostCount / totalCommentCount fallback.
 * 3) 총 수 먼저 saveMyStats (popup 즉시 반영), 이번달 카운트는 비동기로 추가 갱신.
 */
export async function fetchAndStoreMyStats(adapter: ProfileStatsAdapter): Promise<void> {
  if (!adapter.saveMyStats) return;

  try {
    const meResp = await fetch(
      'https://api.lounge.naver.com/user-api/v1/members/me/personas',
      { credentials: 'include' },
    );
    if (!meResp.ok) {
      adapter.removeMyStats?.();
      return;
    }
    const meJson = await meResp.json();
    const meData = Array.isArray(meJson.data) ? meJson.data[0] : meJson.data;
    if (!meData?.personaId) return;

    const personaId: string = meData.personaId;
    adapter.saveOwnerPersonaId?.(personaId);

    let totalPosts = 0;
    let totalComments = 0;
    let nickname: string = meData.nickname || '';
    let createTime: Date | null = meData.createTime ? new Date(meData.createTime) : null;

    try {
      const statsResp = await fetch(
        `https://api.lounge.naver.com/user-api/v1/personas/${personaId}`,
        { credentials: 'include' },
      );
      if (statsResp.ok) {
        const statsJson = await statsResp.json();
        const sData = statsJson.data;
        if (sData) {
          totalPosts = sData.totalPostCount || 0;
          totalComments = sData.totalCommentCount || 0;
          nickname = sData.nickname || nickname;
          createTime = sData.createTime ? new Date(sData.createTime) : createTime;
        }
      }
    } catch {
      try {
        const postsResp = await fetch(
          `https://api.lounge.naver.com/user-api/v1/personas/${personaId}/activities/posts?limit=1`,
          { credentials: 'include' },
        );
        if (postsResp.ok) {
          const pJson = await postsResp.json();
          totalPosts = pJson.data?.totalPostCount || 0;
        }
        const commentsResp = await fetch(
          `https://api.lounge.naver.com/user-api/v1/personas/${personaId}/activities/comments?limit=1`,
          { credentials: 'include' },
        );
        if (commentsResp.ok) {
          const cJson = await commentsResp.json();
          totalComments = cJson.data?.totalCommentCount || cJson.data?.totalCount || 0;
        }
      } catch {
        // both failed
      }
    }

    const now = new Date();
    const stats: MyStatsRecord = {
      personaId,
      nickname,
      totalPosts,
      totalComments,
      monthlyPosts: '...',
      monthlyComments: '...',
      updatedAt: now.toISOString(),
    };
    adapter.saveMyStats(stats);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const createdThisMonth = createTime && createTime >= monthStart;

    if (createdThisMonth) {
      stats.monthlyPosts = totalPosts;
      stats.monthlyComments = totalComments;
      adapter.saveMyStats(stats);
    } else {
      // 글/댓글 따로 — 빨리 끝나는 쪽부터 popup 에 반영.
      fetchMonthlyCount(personaId, 'posts', monthStart)
        .then((c) => {
          stats.monthlyPosts = c;
        })
        .catch(() => {
          stats.monthlyPosts = '?';
        })
        .finally(() => adapter.saveMyStats?.(stats));
      fetchMonthlyCount(personaId, 'comments', monthStart)
        .then((c) => {
          stats.monthlyComments = c;
        })
        .catch(() => {
          stats.monthlyComments = '?';
        })
        .finally(() => adapter.saveMyStats?.(stats));
    }
  } catch {
    // 조회 실패 무시
  }
}

// 테스트 전용 — module-level cache 리셋.
export function __resetForTests(): void {
  cache = { personaId: null, stats: null, monthlyPosts: null, monthlyComments: null };
  rafId = null;
  observer = null;
  inFlightPersonaId = null;
}
