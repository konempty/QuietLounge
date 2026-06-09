// 라운지 페이지 필터링 엔진 단위 테스트.
//
// 4 플랫폼이 동일하게 사용하는 web/core/filter-engine.ts 의 runFilterPass / filterFeedPosts /
// filterCarouselCards 가 - 피드 글 차단/해제 - 캐러셀 카드 차단/해제 - 분리선(separator) 동기화 -
// hide/blur 모드 차이 를 모두 정확히 처리하는지 검증.
//
// 직전 PR (#1) 까지는 이 로직이 4 entry 에 inline 으로 100+ LOC × 4 중복 → 테스트 가드 없었음.

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { runFilterPass } from '../../web/core/filter-engine';
import type { BlockListData } from '../../../shared/types';

function setupDom(html: string, url = 'https://lounge.naver.com/'): Document {
  const dom = new JSDOM(`<!doctype html><html lang="ko"><body>${html}</body></html>`, {
    url,
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

function commentHtml({
  id,
  personaId,
  nickname,
  isReply = false,
}: {
  id: string;
  personaId: string;
  nickname: string;
  isReply?: boolean;
}): string {
  const rowClass = isReply
    ? 'py-[var(--layout-spacing-l)] pl-[62px] pr-[var(--layout-spacing-xl)]'
    : 'flex w-full gap-[var(--layout-spacing-s)] px-[var(--layout-spacing-xl)] py-[var(--layout-spacing-l)]';
  return `
    <div id="${id}" class="${rowClass}">
      <a data-slot="avatar" href="/profiles/${personaId}"></a>
      <div class="min-w-0 flex-1">
        <div data-slot="profile-name">
          <a href="/profiles/${personaId}">
            <div data-slot="profile-name-label"><span class="truncate">${nickname}</span></div>
          </a>
        </div>
        <p>${nickname} content</p>
      </div>
    </div>
  `;
}

function postAuthorHtml(nickname: string): string {
  return `
    <div id="post-author" class="px-[var(--layout-spacing-xl)]">
      <div class="flex text-detail-lg whitespace-nowrap justify-between">
        <a data-slot="avatar" href="/profiles/post-author"></a>
        <div data-slot="profile-name">
          <a href="/profiles/post-author">
            <div data-slot="profile-name-label"><span class="truncate">${nickname}</span></div>
          </a>
        </div>
      </div>
    </div>
  `;
}

function makeBlockData(
  opts: {
    blockedUsers?: BlockListData['blockedUsers'];
    nicknameOnlyBlocks?: BlockListData['nicknameOnlyBlocks'];
  } = {},
): BlockListData {
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

describe('runFilterPass — 글 상세 댓글/대댓글', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  const postUrl = 'https://lounge.naver.com/posts/post-1';

  it('글만 차단 항목은 댓글을 숨기지 않는다', () => {
    const doc = setupDom(
      commentHtml({ id: 'comment-a', personaId: 'pid-a', nickname: '차단유저' }),
      postUrl,
    );

    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: {
          'pid-a': { personaId: 'pid-a', nickname: '차단유저', blockedAt: '' },
        },
      }),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });

    expect(blocked).toBe(0);
    expect(doc.querySelector<HTMLElement>('#comment-a')!.style.display).toBe('');
    expect(doc.querySelector('[data-ql-comment-placeholder]')).toBeNull();
  });

  it('글+댓글 차단 + hide 모드에서는 댓글 행만 안내 문구로 대체하고 대댓글은 유지한다', () => {
    const doc = setupDom(
      postAuthorHtml('차단유저') +
        `<div id="thread">` +
        commentHtml({ id: 'comment-a', personaId: 'pid-a', nickname: '차단유저' }) +
        commentHtml({ id: 'reply-b', personaId: 'pid-b', nickname: '일반답글', isReply: true }) +
        `</div>`,
      postUrl,
    );

    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: {
          'pid-a': {
            personaId: 'pid-a',
            nickname: '차단유저',
            blockedAt: '',
            blockComments: true,
          },
        },
      }),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });

    const comment = doc.querySelector<HTMLElement>('#comment-a')!;
    const reply = doc.querySelector<HTMLElement>('#reply-b')!;
    const placeholder = comment.previousElementSibling as HTMLElement | null;

    expect(blocked).toBe(1);
    expect(doc.querySelector<HTMLElement>('#post-author')!.style.display).toBe('');
    expect(comment.style.display).toBe('none');
    expect(placeholder?.getAttribute('data-ql-comment-placeholder')).toBe('true');
    expect(placeholder?.textContent).toBe('QuietLounge에 의해 차단된 댓글입니다');
    expect(reply.style.display).toBe('');
  });

  it('차단 유저가 대댓글을 쓴 경우 해당 대댓글만 안내 문구로 대체한다', () => {
    const doc = setupDom(
      `<div id="thread">` +
        commentHtml({ id: 'comment-a', personaId: 'pid-a', nickname: '일반댓글' }) +
        commentHtml({ id: 'reply-b', personaId: 'pid-b', nickname: '차단답글', isReply: true }) +
        `</div>`,
      postUrl,
    );

    const blocked = runFilterPass({
      blockData: makeBlockData({
        blockedUsers: {
          'pid-b': {
            personaId: 'pid-b',
            nickname: '차단답글',
            blockedAt: '',
            blockComments: true,
          },
        },
      }),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });

    const comment = doc.querySelector<HTMLElement>('#comment-a')!;
    const reply = doc.querySelector<HTMLElement>('#reply-b')!;

    expect(blocked).toBe(1);
    expect(comment.style.display).toBe('');
    expect(reply.style.display).toBe('none');
    expect(reply.previousElementSibling?.getAttribute('data-ql-comment-placeholder')).toBe('true');
  });

  it('blur 모드에서는 댓글을 숨기지 않고 흐림 처리하며 안내 문구를 만들지 않는다', () => {
    const doc = setupDom(
      commentHtml({ id: 'comment-a', personaId: 'pid-a', nickname: '차단유저' }),
      postUrl,
    );

    const blocked = runFilterPass({
      blockData: makeBlockData({
        nicknameOnlyBlocks: [{ nickname: '차단유저', blockedAt: '', blockComments: true }],
      }),
      filterMode: 'blur',
      personaIdForPost: () => undefined,
    });

    const comment = doc.querySelector<HTMLElement>('#comment-a')!;
    expect(blocked).toBe(1);
    expect(comment.style.display).toBe('');
    expect(comment.style.filter).toBe('blur(5px)');
    expect(comment.style.opacity).toBe('0.3');
    expect(doc.querySelector('[data-ql-comment-placeholder]')).toBeNull();
  });

  it('동적으로 추가된 댓글도 다음 필터 패스에서 처리한다', () => {
    const doc = setupDom('<div id="comments"></div>', postUrl);
    const ctx = {
      blockData: makeBlockData({
        nicknameOnlyBlocks: [{ nickname: '늦게온댓글', blockedAt: '', blockComments: true }],
      }),
      filterMode: 'hide' as const,
      personaIdForPost: () => undefined,
    };

    expect(runFilterPass(ctx)).toBe(0);
    doc
      .querySelector('#comments')!
      .insertAdjacentHTML(
        'beforeend',
        commentHtml({ id: 'comment-late', personaId: 'pid-late', nickname: '늦게온댓글' }),
      );

    expect(runFilterPass(ctx)).toBe(1);
    const comment = doc.querySelector<HTMLElement>('#comment-late')!;
    expect(comment.style.display).toBe('none');
    expect(comment.previousElementSibling?.textContent).toBe(
      'QuietLounge에 의해 차단된 댓글입니다',
    );
  });

  it('차단 해제 후 다시 필터링하면 안내 문구와 숨김 스타일이 제거된다', () => {
    const doc = setupDom(
      commentHtml({ id: 'comment-a', personaId: 'pid-a', nickname: '차단유저' }),
      postUrl,
    );
    const comment = doc.querySelector<HTMLElement>('#comment-a')!;

    runFilterPass({
      blockData: makeBlockData({
        blockedUsers: {
          'pid-a': {
            personaId: 'pid-a',
            nickname: '차단유저',
            blockedAt: '',
            blockComments: true,
          },
        },
      }),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });
    expect(comment.style.display).toBe('none');
    expect(doc.querySelector('[data-ql-comment-placeholder]')).not.toBeNull();

    runFilterPass({
      blockData: makeBlockData(),
      filterMode: 'hide',
      personaIdForPost: () => undefined,
    });
    expect(comment.style.display).toBe('');
    expect(doc.querySelector('[data-ql-comment-placeholder]')).toBeNull();
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
