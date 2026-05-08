// 라운지 페이지 필터링 엔진 — 4 플랫폼 공통.
//
// `runFilterPass(ctx)` 한 번 호출이 (a) 피드 게시글 (postLink 기반) (b) 캐러셀 카드 (주간 베스트 등)
// 양쪽을 일관 처리하고 차단된 글 수를 반환한다. badge 갱신 같은 platform 후처리는 entry 측 책임.
//
// 4 플랫폼 차이를 어떻게 추상화했나:
//   - personaMap 자료구조: Chrome/Safari = `Map<postId, personaId>`, iOS/Android = `{[postId]: personaId}`.
//     `personaIdForPost(postId)` 함수로 추상화해 entry 측이 자기 자료구조에서 lookup 한다.
//   - filterMode/blockData 출처: Chrome/Safari = closure 변수, iOS/Android = `window.__QL_*`.
//     ctx 객체로 한 번에 받아 내부에선 단순 인자 사용.
//   - applyStyle 통합 vs 분리 시그너처 (Chrome 의 applyBlockStyle/clearBlockStyle): shared `applyStyle`
//     은 `(el, blocked, mode)` 통합형. entry 의 wrapper 가 매개해 호출부 변경 없이 유지.

import type { BlockListData, FilterMode } from '../../types';
import { SEL } from './selectors';
import { isBlocked } from './block-check';
import { applyStyle } from './style';

export interface FilterEngineContext {
  /** 현재 차단 데이터 — call 시점의 snapshot (closure 또는 native bridge 주입 값). */
  blockData: BlockListData | null | undefined;
  /** 'hide' | 'blur'. */
  filterMode: FilterMode;
  /** postId → personaId 매핑 조회. Map.get / 객체 인덱스 추상화. 미매핑이면 undefined. */
  personaIdForPost: (postId: string) => string | undefined;
}

/** 피드 + 캐러셀을 한 번 필터링. 차단된 글 수 반환 (badge 갱신 등 후처리에 사용 가능). */
export function runFilterPass(ctx: FilterEngineContext): number {
  return filterFeedPosts(ctx) + filterCarouselCards(ctx);
}

/** `[data-slot="separator"]` 형제도 본문과 동일하게 hide/blur 적용 — 차단 글 사이의 구분선이 그대로
 *  남으면 빈 줄처럼 보이는 회귀 방지. */
function filterFeedPosts(ctx: FilterEngineContext): number {
  let blocked = 0;
  document.querySelectorAll<HTMLElement>(SEL.postLink).forEach((link) => {
    const postId = link.getAttribute('href')?.replace('/posts/', '') || undefined;
    const nicknameRaw = link.querySelector(SEL.nickname)?.textContent;
    const nickname = nicknameRaw?.trim() || undefined;
    if (!postId && !nickname) return;

    const pid = postId ? ctx.personaIdForPost(postId) : undefined;
    const isBlk = isBlocked(ctx.blockData, pid, nickname);

    // closest(postContainer) 가 fallback — 일부 마크업은 그 wrapper 가 없어 parent.parent 로 fallback.
    const container =
      (link.closest(SEL.postContainer) as HTMLElement | null) ||
      (link.parentElement?.parentElement as HTMLElement | null);
    if (!container) return;

    if (isBlk) blocked++;
    applyStyle(container, isBlk, ctx.filterMode);

    const separator = container.parentElement?.nextElementSibling as HTMLElement | null;
    if (separator && separator.getAttribute?.('data-slot') === 'separator') {
      applyStyle(separator, isBlk, ctx.filterMode);
    }
  });
  return blocked;
}

/** 카드형 (주간 베스트 등) — postLink 가 없어 personaId 매핑이 안 잡히므로 nickname-only 매칭.
 *  unblock 시에도 흐림이 풀리도록 항상 applyStyle 호출. */
function filterCarouselCards(ctx: FilterEngineContext): number {
  let blocked = 0;
  document.querySelectorAll<HTMLElement>(SEL.card).forEach((card) => {
    const nickname = card.querySelector(SEL.nickname)?.textContent?.trim();
    if (!nickname) return;

    const isBlk = isBlocked(ctx.blockData, undefined, nickname);
    const item = card.closest(SEL.cardItem) as HTMLElement | null;
    if (!item) return;

    if (isBlk) blocked++;
    applyStyle(item, isBlk, ctx.filterMode);
  });
  return blocked;
}
