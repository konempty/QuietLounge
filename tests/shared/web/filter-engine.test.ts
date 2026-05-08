// 라운지 페이지 필터링 엔진 단위 테스트.
//
// 4 플랫폼이 동일하게 사용하는 shared/web/core/filter-engine.ts 의 runFilterPass / filterFeedPosts /
// filterCarouselCards 가 - 피드 글 차단/해제 - 캐러셀 카드 차단/해제 - 분리선(separator) 동기화 -
// hide/blur 모드 차이 를 모두 정확히 처리하는지 검증.
//
// 직전 PR (#1) 까지는 이 로직이 4 entry 에 inline 으로 100+ LOC × 4 중복 → 테스트 가드 없었음.

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { runFilterPass } from '../../../shared/web/core/filter-engine';
import type { BlockListData } from '../../../shared/types';

function setupDom(html: string): Document {
  const dom = new JSDOM(`<!doctype html><html lang="ko"><body>${html}</body></html>`, {
    url: 'https://lounge.naver.com/',
  });
  // filter-engine 은 `document.querySelectorAll` 같은 글로벌 DOM API 에 의존 → globalThis 에 주입.
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  return dom.window.document;
}

function feedPostHtml(postId: string, nickname: string, withSeparator = true): string {
  // 라운지 실제 마크업의 핵심 구조 — postLink + profile-name-label / span.truncate + post container.
  // separator 는 post container 의 부모(wrapper) 의 nextElementSibling 으로 위치한다 — 차단 시
  // 본문 + 분리선이 함께 사라져 빈 줄 잔재가 안 보이도록.
  return `
    <div class="post-wrapper">
      <div class="relative" tabindex="0">
        <a href="/posts/${postId}">
          <div data-slot="profile-name">
            <div data-slot="profile-name-label"><span class="truncate">${nickname}</span></div>
          </div>
        </a>
      </div>
    </div>
    ${withSeparator ? '<div data-slot="separator"></div>' : ''}
  `;
}

function carouselCardHtml(nickname: string): string {
  return `
    <div data-slot="carousel-item">
      <div data-slot="card">
        <div data-slot="profile-name">
          <div data-slot="profile-name-label"><span class="truncate">${nickname}</span></div>
        </div>
      </div>
    </div>
  `;
}

function makeBlockData(opts: {
  blockedUsers?: Record<string, { personaId: string; nickname: string; blockedAt: string }>;
  nicknameOnlyBlocks?: { nickname: string; blockedAt: string }[];
} = {}): BlockListData {
  return {
    version: 2,
    blockedUsers: opts.blockedUsers ?? {},
    nicknameOnlyBlocks: opts.nicknameOnlyBlocks ?? [],
    personaCache: {},
  };
}

describe('runFilterPass — 피드 게시글', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('차단되지 않은 글은 그대로 표시', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동', false));
    const personaMap = new Map([['p1', 'pid1']]);
    const blocked = runFilterPass({
      blockData: makeBlockData(),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    expect(blocked).toBe(0);
    const container = doc.querySelector<HTMLElement>('.relative[tabindex]')!;
    expect(container.style.display).toBe('');
    expect(container.style.filter).toBe('');
  });

  it('personaId 차단 + hide 모드 → display:none', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동', false));
    const personaMap = new Map([['p1', 'pid_block']]);
    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: {
          pid_block: { personaId: 'pid_block', nickname: '홍길동', blockedAt: '' },
        },
      }),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    expect(blocked).toBe(1);
    const container = doc.querySelector<HTMLElement>('.relative[tabindex]')!;
    expect(container.style.display).toBe('none');
  });

  it('personaId 차단 + blur 모드 → blur(5px) + opacity 0.3', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동', false));
    const personaMap = new Map([['p1', 'pid_block']]);
    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: {
          pid_block: { personaId: 'pid_block', nickname: '홍길동', blockedAt: '' },
        },
      }),
      filterMode: 'blur',
      personaIdForPost: (id) => personaMap.get(id),
    });
    expect(blocked).toBe(1);
    const container = doc.querySelector<HTMLElement>('.relative[tabindex]')!;
    expect(container.style.filter).toBe('blur(5px)');
    expect(container.style.opacity).toBe('0.3');
    expect(container.style.pointerEvents).toBe('none');
    expect(container.style.display).toBe('');
  });

  it('nickname-only 차단도 매칭 (personaId 매핑 없어도)', () => {
    const doc = setupDom(feedPostHtml('p_unmapped', '익명사용자', false));
    const blocked = runFilterPass({
      blockData: makeBlockData({
        nicknameOnlyBlocks: [{ nickname: '익명사용자', blockedAt: '' }],
      }),
      filterMode: 'hide',
      personaIdForPost: () => undefined, // 매핑 없음
    });
    expect(blocked).toBe(1);
    const container = doc.querySelector<HTMLElement>('.relative[tabindex]')!;
    expect(container.style.display).toBe('none');
  });

  it('separator 도 본문과 함께 hide (빈 줄 회귀 방지)', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동', true));
    const personaMap = new Map([['p1', 'pid_block']]);
    runFilterPass({
      blockData: makeBlockData({
        blockedUsers: { pid_block: { personaId: 'pid_block', nickname: '홍길동', blockedAt: '' } },
      }),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    const sep = doc.querySelector<HTMLElement>('[data-slot="separator"]')!;
    expect(sep.style.display).toBe('none');
  });

  it('차단 → 해제로 전환 시 hide 가 풀려 다시 보임', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동', false));
    const personaMap = new Map([['p1', 'pid_block']]);

    // 1차 — 차단
    runFilterPass({
      blockData: makeBlockData({
        blockedUsers: { pid_block: { personaId: 'pid_block', nickname: '홍길동', blockedAt: '' } },
      }),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    const container = doc.querySelector<HTMLElement>('.relative[tabindex]')!;
    expect(container.style.display).toBe('none');

    // 2차 — 해제 후 다시 패스
    runFilterPass({
      blockData: makeBlockData(),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    expect(container.style.display).toBe('');
    expect(container.style.filter).toBe('');
  });
});

describe('runFilterPass — 캐러셀 카드', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('카드 닉네임 매칭 시 carousel-item 에 hide 적용', () => {
    const doc = setupDom(carouselCardHtml('주간베스트유저'));
    const blocked = runFilterPass({
      blockData: makeBlockData({
        nicknameOnlyBlocks: [{ nickname: '주간베스트유저', blockedAt: '' }],
      }),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });
    expect(blocked).toBe(1);
    const item = doc.querySelector<HTMLElement>('[data-slot="carousel-item"]')!;
    expect(item.style.display).toBe('none');
  });

  it('카드 닉네임 미매칭은 그대로', () => {
    const doc = setupDom(carouselCardHtml('일반유저'));
    const blocked = runFilterPass({
      blockData: makeBlockData(),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });
    expect(blocked).toBe(0);
    const item = doc.querySelector<HTMLElement>('[data-slot="carousel-item"]')!;
    expect(item.style.display).toBe('');
  });
});

describe('runFilterPass — 혼합 시나리오', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('피드 + 캐러셀 동시 처리 — 합산 카운트', () => {
    setupDom(
      feedPostHtml('p1', '차단A', false) +
      feedPostHtml('p2', '일반유저', false) +
      carouselCardHtml('차단B') +
      carouselCardHtml('일반유저2'),
    );
    const personaMap = new Map([
      ['p1', 'pidA'],
      ['p2', 'pidB'],
    ]);
    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: { pidA: { personaId: 'pidA', nickname: '차단A', blockedAt: '' } },
        nicknameOnlyBlocks: [{ nickname: '차단B', blockedAt: '' }],
      }),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    expect(blocked).toBe(2);
  });

  it('blockData null → 모든 글 통과 (방어 가드)', () => {
    setupDom(feedPostHtml('p1', '홍길동', false) + carouselCardHtml('주간1'));
    const blocked = runFilterPass({
      blockData: null,
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });
    expect(blocked).toBe(0);
  });
});

describe('personaIdForPost 추상화 — Map vs Object 모두 지원', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('Map (Chrome / Safari ext 패턴)', () => {
    setupDom(feedPostHtml('p1', '홍길동', false));
    const personaMap = new Map([['p1', 'pid_block']]);
    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: { pid_block: { personaId: 'pid_block', nickname: '홍길동', blockedAt: '' } },
      }),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap.get(id),
    });
    expect(blocked).toBe(1);
  });

  it('Object (iOS / Android 패턴 — window.__QL.personaMap)', () => {
    setupDom(feedPostHtml('p1', '홍길동', false));
    const personaMap: Record<string, string> = { p1: 'pid_block' };
    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: { pid_block: { personaId: 'pid_block', nickname: '홍길동', blockedAt: '' } },
      }),
      filterMode: 'hide',
      personaIdForPost: (id) => personaMap[id],
    });
    expect(blocked).toBe(1);
  });
});
