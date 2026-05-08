// 차단 버튼 inject 단위 테스트.
//
// shared/web/core/inject-buttons.ts 가 path A / path B / cleanbot 가드 / pid 미매핑 strategy /
// bfcache shouldSkipExistingButton 같은 핵심 동작을 정확히 처리하는지 — 4 entry 가 같은 함수를
// 사용하므로 단일 source 검증으로 4 플랫폼 회귀를 막는다.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { injectBlockButtons, findPersonaId } from '../../../shared/web/core/inject-buttons';
import type { InjectButtonsAdapter } from '../../../shared/web/platform/adapter';

function setupDom(html: string): Document {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://lounge.naver.com/posts/abc',
  });
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  return dom.window.document;
}

function feedPostHtml(postId: string, nickname: string): string {
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
  `;
}

function carouselCardHtml(postId: string): string {
  // path B — profile-name 슬롯 없음. 카드 안에 postLink 만 있음.
  return `
    <div class="relative" tabindex="0">
      <a href="/posts/${postId}">
        <div>주간 베스트 글 — 닉네임 정보 없음</div>
      </a>
    </div>
  `;
}

function cleanbotHtml(): string {
  return `
    <div class="post-wrapper">
      <div class="relative" tabindex="0">
        <a href="/posts/x">
          <div>클린봇이 부적절한 표현을 감지한 게시글입니다</div>
        </a>
      </div>
    </div>
  `;
}

function makeAdapter(overrides: Partial<InjectButtonsAdapter> = {}): InjectButtonsAdapter {
  const onBlockClick = vi.fn();
  const onMissingPersonaId = vi.fn();
  return {
    buttonClassName: 'quiet-lounge-btn',
    pathBMissingPidStrategy: 'show-error',
    createButton() {
      const btn = document.createElement('button');
      btn.className = 'quiet-lounge-btn';
      return btn;
    },
    onBlockClick,
    onMissingPersonaId,
    ...overrides,
  };
}

describe('injectBlockButtons — path A (profile-name 슬롯)', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('일반 글에 차단 버튼 1 개 부착', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동'));
    const adapter = makeAdapter();
    injectBlockButtons(adapter, {
      findPersonaId: () => 'pid1',
    });
    const buttons = doc.querySelectorAll('.quiet-lounge-btn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].parentElement?.getAttribute('data-slot')).toBe('profile-name');
  });

  it('이미 버튼이 있으면 중복 부착 안 함 (default)', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동'));
    const adapter = makeAdapter();
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' }); // 두 번 호출
    expect(doc.querySelectorAll('.quiet-lounge-btn')).toHaveLength(1);
  });

  it('cleanbot 검열 글엔 버튼 부착 안 함', () => {
    const doc = setupDom(cleanbotHtml());
    const adapter = makeAdapter();
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });
    expect(doc.querySelectorAll('.quiet-lounge-btn')).toHaveLength(0);
  });

  it('버튼 클릭 시 onBlockClick(personaId, nickname) 호출', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동'));
    const adapter = makeAdapter();
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });
    const btn = doc.querySelector<HTMLButtonElement>('.quiet-lounge-btn')!;
    btn.click();
    expect(adapter.onBlockClick).toHaveBeenCalledWith('pid1', '홍길동');
  });

  it('닉네임 없는 글은 클릭 시 onBlockClick 호출 안 함', () => {
    setupDom(`
      <div class="post-wrapper">
        <div class="relative" tabindex="0">
          <a href="/posts/p1">
            <div data-slot="profile-name">
              <div data-slot="profile-name-label"><span class="truncate"></span></div>
            </div>
          </a>
        </div>
      </div>
    `);
    const adapter = makeAdapter();
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });
    const btn = document.querySelector<HTMLButtonElement>('.quiet-lounge-btn')!;
    btn.click();
    expect(adapter.onBlockClick).not.toHaveBeenCalled();
  });
});

describe('injectBlockButtons — path B (profile-name 없음, 카드형)', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("'show-error' strategy: pid 매핑돼도 버튼 부착, 클릭 시 onBlockClick", () => {
    const doc = setupDom(carouselCardHtml('p1'));
    const adapter = makeAdapter({ pathBMissingPidStrategy: 'show-error' });
    injectBlockButtons(adapter, {
      findPersonaId: () => 'pid_card',
      nicknameForPersonaId: () => '카드유저',
    });
    const btn = doc.querySelector<HTMLButtonElement>('.quiet-lounge-btn')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(adapter.onBlockClick).toHaveBeenCalledWith('pid_card', '카드유저');
  });

  it("'show-error' strategy: pid 미매핑 시 버튼은 부착, 클릭 시 onMissingPersonaId 호출", () => {
    const doc = setupDom(carouselCardHtml('p1'));
    const adapter = makeAdapter({ pathBMissingPidStrategy: 'show-error' });
    injectBlockButtons(adapter, { findPersonaId: () => undefined });
    const btn = doc.querySelector<HTMLButtonElement>('.quiet-lounge-btn');
    expect(btn).toBeTruthy();
    btn!.click();
    expect(adapter.onMissingPersonaId).toHaveBeenCalled();
    expect(adapter.onBlockClick).not.toHaveBeenCalled();
  });

  it("'skip' strategy: pid 미매핑 시 버튼 자체 미노출 (silent no-op 방지 — iOS/Android 패턴)", () => {
    const doc = setupDom(carouselCardHtml('p1'));
    const adapter = makeAdapter({ pathBMissingPidStrategy: 'skip' });
    injectBlockButtons(adapter, { findPersonaId: () => undefined });
    expect(doc.querySelectorAll('.quiet-lounge-btn')).toHaveLength(0);
  });

  it("'skip' strategy: pid 매핑되면 버튼 부착 + 클릭 시 native bridge 호출", () => {
    const doc = setupDom(carouselCardHtml('p1'));
    const adapter = makeAdapter({ pathBMissingPidStrategy: 'skip' });
    injectBlockButtons(adapter, {
      findPersonaId: () => 'pid_card',
      nicknameForPersonaId: () => '카드유저',
    });
    const btn = doc.querySelector<HTMLButtonElement>('.quiet-lounge-btn')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(adapter.onBlockClick).toHaveBeenCalledWith('pid_card', '카드유저');
  });

  it('nicknameForPersonaId 미구현 시 닉네임이 personaId 로 fallback', () => {
    setupDom(carouselCardHtml('p1'));
    const adapter = makeAdapter({ pathBMissingPidStrategy: 'show-error' });
    injectBlockButtons(adapter, { findPersonaId: () => 'pid_card' });
    document.querySelector<HTMLButtonElement>('.quiet-lounge-btn')!.click();
    expect(adapter.onBlockClick).toHaveBeenCalledWith('pid_card', 'pid_card');
  });
});

describe('injectBlockButtons — bfcache liveButtons (Safari ext 패턴)', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('shouldSkipExistingButton=false → 죽은 버튼 제거 후 새 버튼 등록', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동'));
    const liveButtons = new WeakSet<Element>();
    const adapter = makeAdapter({
      shouldSkipExistingButton: (existing) => liveButtons.has(existing),
      onButtonAttached: (btn) => liveButtons.add(btn),
    });

    // 1차 inject — 살아있는 버튼 등록.
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });
    const firstBtn = doc.querySelector('.quiet-lounge-btn');
    expect(firstBtn).toBeTruthy();
    expect(liveButtons.has(firstBtn!)).toBe(true);

    // bfcache 복원 시뮬: liveButtons 비우기 (WeakSet 이 GC 된 상태). 같은 DOM 의 버튼은 여전히 존재.
    liveButtons.delete(firstBtn!);
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });

    // 새 버튼이 들어왔어야 함 — 같은 DOM 위치, 다른 인스턴스.
    const buttons = doc.querySelectorAll('.quiet-lounge-btn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).not.toBe(firstBtn);
    expect(liveButtons.has(buttons[0])).toBe(true);
  });

  it('shouldSkipExistingButton=true → 살아있는 버튼은 그대로 둠', () => {
    const doc = setupDom(feedPostHtml('p1', '홍길동'));
    const liveButtons = new WeakSet<Element>();
    const adapter = makeAdapter({
      shouldSkipExistingButton: (existing) => liveButtons.has(existing),
      onButtonAttached: (btn) => liveButtons.add(btn),
    });

    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });
    const firstBtn = doc.querySelector('.quiet-lounge-btn');
    injectBlockButtons(adapter, { findPersonaId: () => 'pid1' });

    expect(doc.querySelectorAll('.quiet-lounge-btn')).toHaveLength(1);
    expect(doc.querySelector('.quiet-lounge-btn')).toBe(firstBtn);
  });
});

describe('findPersonaId — 3 단계 fallback', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('1순위: 프로필 링크에서 직접 추출', () => {
    setupDom(`
      <div class="profile-block">
        <a href="/profiles/pid_direct"><span>홍길동</span></a>
      </div>
    `);
    const container = document.querySelector('.profile-block')!;
    const pid = findPersonaId(container, () => undefined);
    expect(pid).toBe('pid_direct');
  });

  it('2순위: postLink → personaMap 조회 (프로필 링크 없을 때)', () => {
    setupDom(`
      <div class="container">
        <a href="/posts/post_1"><span>닉</span></a>
      </div>
    `);
    const container = document.querySelector('.container')!;
    const pid = findPersonaId(container, (id) => (id === 'post_1' ? 'pid_via_map' : undefined));
    expect(pid).toBe('pid_via_map');
  });

  it('3순위: URL pathname → personaMap (글 상세 페이지 작성자 추출)', () => {
    setupDom('<div class="container"></div>');
    const container = document.querySelector('.container')!;
    // url 은 setupDom 의 default '/posts/abc'
    const pid = findPersonaId(container, (id) => (id === 'abc' ? 'pid_url' : undefined));
    expect(pid).toBe('pid_url');
  });

  it('모두 매칭 안 되면 undefined', () => {
    setupDom('<div class="container"></div>');
    const container = document.querySelector('.container')!;
    const pid = findPersonaId(container, () => undefined);
    expect(pid).toBeUndefined();
  });

  it('P1 회귀 가드: 컨테이너 postLink 미매핑이면 URL pathname fallback 으로 넘어가지 않음', () => {
    // 시나리오: 글 상세 페이지(/posts/current) 안의 주간 베스트 카드가 다른 글(/posts/card) 을
    // 가리킴. card 는 personaMap 미매핑, current 는 매핑됨. fallback 으로 넘어가면 카드 버튼이
    // *current 작성자* 를 잘못 반환해 엉뚱한 사람을 차단하게 됨.
    const dom = new JSDOM(
      '<!doctype html><html><body><div class="container"><a href="/posts/card">카드</a></div></body></html>',
      { url: 'https://lounge.naver.com/posts/current' },
    );
    globalThis.document = dom.window.document as unknown as Document;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    const container = document.querySelector('.container')!;
    const pid = findPersonaId(container, (id) =>
      id === 'current' ? 'pid_current' : undefined,
    );
    expect(pid).toBeUndefined();
  });
});
