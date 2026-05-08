// shared/web/core/persona-extractor.ts 단위 테스트.
//
// iOS / Android before entry 가 같은 함수를 사용하므로 단일 source 검증으로 cross-platform 회귀 가드.
// 핵심 검증 포인트: extractMappings 의 트리 순회 / fetch monkey-patch 의 lounge URL 분기 /
// pushPersonaMap adapter 호출 / DOMContentLoaded hydration parser / DOM profile link 추출 /
// /posts/{postId} 작성자 fallback / __QL_BEFORE_INSTALLED 두 번째 install 가드.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  extractMappings,
  setupPersonaExtractor,
  __resetForTests,
} from '../../../shared/web/core/persona-extractor';

type Ql = { personaMap: Record<string, string>; personaCache: Record<string, string> };

function makeQl(): Ql {
  return { personaMap: {}, personaCache: {} };
}

function setupDom(html: string, url: string): { doc: Document; dom: JSDOM } {
  const dom = new JSDOM(`<!doctype html><html lang="ko"><body>${html}</body></html>`, { url });
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  return { doc: dom.window.document, dom };
}

function jsonResp(body: unknown): Response {
  return {
    ok: true,
    clone() {
      return this;
    },
    json: async () => body,
  } as unknown as Response;
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

describe('extractMappings — 트리 순회', () => {
  it('flat object 의 postId+personaId pair', () => {
    const ql = makeQl();
    extractMappings({ postId: 'p1', personaId: 'pid1' }, ql);
    expect(ql.personaMap.p1).toBe('pid1');
  });

  it('flat object 의 personaId+nickname pair', () => {
    const ql = makeQl();
    extractMappings({ personaId: 'pid1', nickname: '홍길동' }, ql);
    expect(ql.personaCache.pid1).toBe('홍길동');
  });

  it('nested array + object 모두 재귀', () => {
    const ql = makeQl();
    extractMappings(
      {
        data: {
          items: [
            { postId: 'p1', personaId: 'a' },
            { postId: 'p2', personaId: 'b' },
          ],
          authors: { x: { personaId: 'a', nickname: 'A' } },
        },
      },
      ql,
    );
    expect(ql.personaMap.p1).toBe('a');
    expect(ql.personaMap.p2).toBe('b');
    expect(ql.personaCache.a).toBe('A');
  });

  it('postId 또는 personaId 가 string 이 아니면 무시', () => {
    const ql = makeQl();
    extractMappings({ postId: 123, personaId: 'pid' }, ql);
    extractMappings({ postId: 'p', personaId: null }, ql);
    expect(ql.personaMap).toEqual({});
  });

  it('null / undefined / primitive 는 안전하게 무시', () => {
    const ql = makeQl();
    expect(() => extractMappings(null, ql)).not.toThrow();
    expect(() => extractMappings(undefined, ql)).not.toThrow();
    expect(() => extractMappings('string', ql)).not.toThrow();
    expect(() => extractMappings(42, ql)).not.toThrow();
    expect(ql.personaMap).toEqual({});
  });
});

describe('setupPersonaExtractor — fetch monkey-patch', () => {
  it('lounge API 응답에서 매핑 추출 후 pushPersonaMap 호출', async () => {
    setupDom('', 'https://lounge.naver.com/');
    (window as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
      jsonResp({ data: { postId: 'p1', personaId: 'pid1', nickname: '닉' } }),
    );
    const pushPersonaMap = vi.fn();

    setupPersonaExtractor({ pushPersonaMap });
    await window.fetch('https://api.lounge.naver.com/user-api/v1/personas/pid1');

    expect(pushPersonaMap).toHaveBeenCalled();
    const payload = pushPersonaMap.mock.calls[0][0];
    expect(payload.personaMap).toEqual({ p1: 'pid1' });
    expect(payload.personaCache).toEqual({ pid1: '닉' });
  });

  it('비-lounge URL 은 매핑 추출 / push 모두 안 함', async () => {
    setupDom('', 'https://lounge.naver.com/');
    (window as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
      jsonResp({ data: { postId: 'p1', personaId: 'pid1' } }),
    );
    const pushPersonaMap = vi.fn();
    setupPersonaExtractor({ pushPersonaMap });

    await window.fetch('https://example.com/something');

    // hydration parser 가 DOMContentLoaded (자동 또는 수동) 에서 push 한 번 보낼 수도 있지만,
    // 우리가 호출한 fetch (example.com) 의 매핑 (p1 → pid1) 은 들어가지 *않아야* 함.
    for (const call of pushPersonaMap.mock.calls) {
      expect(call[0].personaMap).not.toHaveProperty('p1');
    }
    expect(window.__QL?.personaMap).not.toHaveProperty('p1');
  });

  it('JSON parse 실패해도 fetch 자체 결과는 그대로 반환 (silent error swallow)', async () => {
    setupDom('', 'https://lounge.naver.com/');
    const broken = {
      ok: true,
      clone() {
        return this;
      },
      json: async () => {
        throw new Error('parse fail');
      },
    } as unknown as Response;
    (window as unknown as { fetch: unknown }).fetch = vi.fn(async () => broken);
    setupPersonaExtractor({ pushPersonaMap: vi.fn() });

    const resp = await window.fetch('https://api.lounge.naver.com/x');
    expect(resp).toBe(broken);
    // parse 실패하더라도 personaMap 은 비어있어야 (silent error swallow).
    expect(window.__QL?.personaMap).toEqual({});
  });

  it('두 번째 install 시 noop — fetch 가 두 번 wrap 되지 않음', async () => {
    setupDom('', 'https://lounge.naver.com/');
    (window as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
      jsonResp({ data: {} }),
    );

    setupPersonaExtractor({ pushPersonaMap: vi.fn() });
    const fetchAfterFirst = window.fetch;
    setupPersonaExtractor({ pushPersonaMap: vi.fn() });
    // 두 번째 install 이 fetch 를 또 wrap 했으면 reference 가 다름.
    expect(window.fetch).toBe(fetchAfterFirst);
  });
});

describe('setupPersonaExtractor — DOMContentLoaded hydration parser', () => {
  // 4 케이스가 setupDom + fetch stub + setupPersonaExtractor + dispatchEvent 패턴을 공유.
  // 중복 코드 제거 위해 helper 로 추출 — 각 it 은 html / url 만 다르고 본문은 1 줄.
  async function runHydration(
    html: string,
    url: string,
  ): Promise<{ personaMap: Record<string, string>; personaCache: Record<string, string> }> {
    setupDom(html, url);
    (window as unknown as { fetch: unknown }).fetch = vi.fn();
    const pushPersonaMap = vi.fn();
    setupPersonaExtractor({ pushPersonaMap });
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 0));
    return pushPersonaMap.mock.lastCall![0];
  }

  it('인접 패턴 ("postId":"x","personaId":"y") 추출', async () => {
    const html = `<script>window.__INITIAL = "{\\"postId\\":\\"p1\\",\\"personaId\\":\\"pid1\\"}";</script>`;
    const payload = await runHydration(html, 'https://lounge.naver.com/');
    expect(payload.personaMap.p1).toBe('pid1');
  });

  it('DOM `a[href^="/profiles/"]` 에서 personaId-닉네임 추출', async () => {
    const payload = await runHydration(
      `<a href="/profiles/persona_long_id">홍길동</a>`,
      'https://lounge.naver.com/',
    );
    expect(payload.personaCache.persona_long_id).toBe('홍길동');
  });

  it('persona id 가 6자 미만이면 신뢰하지 않음', async () => {
    const payload = await runHydration(
      `<a href="/profiles/short">짧</a>`,
      'https://lounge.naver.com/',
    );
    expect(payload.personaCache).toEqual({});
  });

  it('/posts/{postId} URL 에서 작성자 personaId DOM fallback', async () => {
    const payload = await runHydration(
      `<div data-slot="profile-name"><a href="/profiles/author_pid">작성자</a></div>`,
      'https://lounge.naver.com/posts/post_42',
    );
    expect(payload.personaMap.post_42).toBe('author_pid');
  });

  it('postId 가 이미 매핑됐으면 DOM fallback 으로 덮지 않음', async () => {
    // hydration script 가 post_42 → pid_from_script 로 매핑한 후 DOM author 가 덮지 않음.
    const html = `
      <script>window.X = "{\\"postId\\":\\"post_42\\",\\"personaId\\":\\"pid_from_script\\"}";</script>
      <div data-slot="profile-name"><a href="/profiles/author_pid">작성자</a></div>
    `;
    const payload = await runHydration(html, 'https://lounge.naver.com/posts/post_42');
    expect(payload.personaMap.post_42).toBe('pid_from_script');
  });
});
