// 라운지 자체 검열(클린봇) 글에는 차단 버튼을 붙이지 않는 동작의 cross-platform 검증.
//
// **PR #1 이후 — source of truth 는 shared/web/core/cleanbot.ts**. 4 곳 산출물
// (Chrome / Safari ext / iOS native / Android) 은 esbuild 가 동일 source 에서 빌드.
//   • 순수 시맨틱은 tests/shared/web/cleanbot.test.ts 에서 import 로 검증.
//   • 이 파일은 (a) DOM 마크업 시뮬레이션 (b) sample13 실제 fixture
//     (c) 4 산출물 source-level 회귀 가드 — 빌드 후 토큰/패턴 보존을 본다.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const PLATFORM_ARTIFACTS = {
  chrome: 'chrome-extension/content-scripts/main.js',
  safariExt: 'safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/main.js',
  iosAfter: 'safari-extension/QuietLounge/iOS (App)/Resources/webview-scripts/after.js',
  androidAfter: 'android-app/app/src/main/assets/webview-scripts/after.js',
};

function read(rel) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

// production 로직의 동일 mirror — 마크업 시뮬레이션용. 실제 production 코드는
// shared/web/core/cleanbot.ts 에 단일 정의. drift 시 source-level guard 가 잡아낸다.
function isCleanbotFiltered(container) {
  if (!container) return false;
  if (container.querySelector('[data-slot]')) return false;
  const text = container.textContent || '';
  return text.includes('클린봇') && text.includes('감지');
}

function makeContainer(innerHtml) {
  const dom = new JSDOM(`<!doctype html><html lang="ko"><body>
    <a href="/posts/abc123" class="relative" tabindex="0">${innerHtml}</a>
  </body></html>`);
  return dom.window.document.querySelector('.relative[tabindex]');
}

describe('cleanbot 가드 — path 분기 시뮬레이션', () => {
  // 실제 inject 로직의 핵심 흐름을 인라인으로 재현해 가드 효과만 확인.
  // 4 플랫폼 모두 같은 분기 순서: 이미 버튼 → profile-name 자식 (path A 위임) → cleanbot 가드 → path B inject.
  function pathBDecision(container, options = { withGuard: true }) {
    if (container.querySelector('.quiet-lounge-btn,.ql-btn')) return 'already';
    if (container.querySelector('[data-slot="profile-name"]')) return 'pathA';
    if (options.withGuard && isCleanbotFiltered(container)) return 'skipped-cleanbot';
    return 'pathB-injected';
  }

  it('cleanbot 글 — 가드 ON 시 skip / 가드 OFF 시 inject (가드 효과 검증)', () => {
    const c = makeContainer(
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 게시글입니다</div></div>',
    );
    expect(pathBDecision(c, { withGuard: false })).toBe('pathB-injected');
    expect(pathBDecision(c, { withGuard: true })).toBe('skipped-cleanbot');
  });

  it('일반 카드형 글 — 가드 유무와 무관하게 inject', () => {
    const c = makeContainer(
      '<div data-slot="thumbnail"><img/></div><div>일반 제목</div>',
    );
    expect(pathBDecision(c, { withGuard: false })).toBe('pathB-injected');
    expect(pathBDecision(c, { withGuard: true })).toBe('pathB-injected');
  });

  it('이미 버튼 있음 → 가드 진입 전에 already 반환 (재실행 안전)', () => {
    const c = makeContainer(
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 게시글입니다</div>' +
        '<button class="quiet-lounge-btn">x</button></div>',
    );
    expect(pathBDecision(c)).toBe('already');
  });
});

describe('현실적 혼재 피드 — cleanbot 만 정확히 skip', () => {
  // 실제 라운지 피드는 cleanbot 글이 일반 글 사이에 끼어 등장 — 한 DOM 안에서 여러 컨테이너가
  // 동시에 들어있을 때 가드가 cleanbot 글에만 정확히 발동해야 한다.

  function buildFeed(htmls) {
    const dom = new JSDOM(
      `<!doctype html><html lang="ko"><body>${htmls
        .map((h, i) => `<a href="/posts/p${i}" class="relative" tabindex="0">${h}</a>`)
        .join('<div data-orientation="horizontal" data-slot="separator"></div>')}</body></html>`,
    );
    return dom.window.document.querySelectorAll('.relative[tabindex]');
  }

  function pathBDecision(container, withGuard = true) {
    if (container.querySelector('.quiet-lounge-btn,.ql-btn')) return 'already';
    if (container.querySelector('[data-slot="profile-name"]')) return 'pathA';
    if (withGuard && isCleanbotFiltered(container)) return 'skipped-cleanbot';
    return 'pathB-injected';
  }

  it('cleanbot + 피드 일반글 + 카드형 일반글 혼재 → 각각 다른 분기로 라우팅', () => {
    const containers = buildFeed([
      // cleanbot
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 게시글입니다</div></div>',
      // 피드 일반글 (profile-name 있음 → path A)
      '<div class="flex"><h2>제목</h2><div data-slot="profile-name">홍길동</div></div>',
      // 카드형 일반글 (썸네일만 → path B)
      '<div data-slot="thumbnail"><img/></div><div>주간 베스트 글</div>',
    ]);

    expect(containers).toHaveLength(3);
    expect(pathBDecision(containers[0])).toBe('skipped-cleanbot');
    expect(pathBDecision(containers[1])).toBe('pathA');
    expect(pathBDecision(containers[2])).toBe('pathB-injected');
  });

  it('연속된 cleanbot 글 다수 → 전부 skip', () => {
    const containers = buildFeed([
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 게시글입니다</div></div>',
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 댓글입니다</div></div>',
      '<div class="flex"><div>클린봇이 ... 감지한 ...</div></div>',
    ]);
    for (const c of containers) {
      expect(pathBDecision(c)).toBe('skipped-cleanbot');
    }
  });
});

describe('sample13.txt 실제 마크업 fixture — 클래스 노이즈 영향 없음', () => {
  // 라운지 빌드의 Tailwind utility 가 듬뿍 들어간 실제 클래스 문자열 — 정규식이 아닌
  // 단순 querySelector / textContent 매칭이라 영향은 없어야 하지만, 회귀 가드.

  it('실제 sample13 cleanbot 글 마크업 → true', () => {
    const html =
      '<a href="/posts/0QA41B5ADWC00?tc=lounge_channel"' +
      ' class="relative overflow-hidden before:absolute before:inset-0' +
      ' before:rounded-[var(--radius-l)] before:bg-[var(--color-secondary-background-alpha-1)]' +
      ' before:opacity-[var(--bg-opacity)] focus-inset flex min-h-fit flex-col' +
      ' gap-[var(--layout-spacing-xs)] px-[var(--layout-spacing-xl)] py-[13px]"' +
      ' tabindex="0" style="--bg-opacity: 0;">' +
      '<div class="flex min-h-[24px] items-center gap-[var(--layout-spacing-2xs)]">' +
      '<div class="text-[length:var(--typography-font-size-label-medium)]' +
      ' leading-[var(--typography-line-height-label-medium)]' +
      ' tracking-[var(--typography-letter-spacing-default)]' +
      ' [&_strong]:font-[var(--typography-font-weight-600)] truncate' +
      ' text-[color:var(--color-neutral-foreground-decorative-1)]">' +
      '클린봇이 부적절한 표현을 감지한 게시글입니다</div>' +
      '</div></a>';
    const dom = new JSDOM(`<!doctype html><html lang="ko"><body>${html}</body></html>`);
    const container = dom.window.document.querySelector('.relative[tabindex]');
    expect(isCleanbotFiltered(container)).toBe(true);
  });

  it('실제 sample13 일반 카드형 글 마크업 → false (data-slot 다수)', () => {
    const html =
      '<a href="/posts/0QA3ZY0FNKW07" class="relative overflow-hidden ... focus-inset flex" tabindex="0">' +
      '<div class="flex w-full min-h-[56px] items-center">' +
      '<div class="min-w-0 flex-1">' +
      '<div class="flex"><div class="truncate">대전 터미네이터 등장</div></div>' +
      '<div data-slot="profile-name" class="...">' +
      '<div data-slot="profile-name-label" class="..."><span class="truncate">영맨의모터노트</span></div>' +
      '</div>' +
      '<div data-slot="profile-sub-text">30분 전</div>' +
      '</div>' +
      '<div data-slot="thumbnail"><img data-slot="thumbnail-image"/></div>' +
      '</div></a>';
    const dom = new JSDOM(`<!doctype html><html lang="ko"><body>${html}</body></html>`);
    const container = dom.window.document.querySelector('.relative[tabindex]');
    expect(isCleanbotFiltered(container)).toBe(false);
  });
});

describe('path A — profile-name 에서 post container 까지 closest() 로 climb', () => {
  // path A 의 호출은 isCleanbotFiltered(el.closest(SEL.postContainer) || el.closest(SEL.postLink)).
  // 누군가 entry 리팩토링 중에 closest 를 빠뜨리고 el 만 그대로 넘기면, el (= profile-name) 자체가
  // [data-slot="profile-name"] 속성을 갖고 있어 구조 신호가 항상 false → 가드가 silent 로 죽는다.
  // 4 플랫폼 산출물 (esbuild build output) 에서 path A invocation 이 closest 패턴을 사용하는지 회귀 가드.

  for (const [name, rel] of Object.entries(PLATFORM_ARTIFACTS)) {
    it(`${name} — path A 호출에 closest(...) 패턴이 있다`, () => {
      const src = read(rel);
      // path A 의 invocation 형태: isCleanbotFiltered(el.closest(...) ...)
      // (정확한 위치/변수명은 플랫폼마다 다를 수 있으므로 패턴만 매칭)
      const pattern = /isCleanbotFiltered\s*\(\s*\w+\s*\.\s*closest\s*\(/;
      expect(src).toMatch(pattern);
    });
  }
});

describe('산출물 회귀 가드 — 4 플랫폼 모두 같은 검출 로직 보유', () => {
  // shared/web/core/cleanbot.ts 가 단일 source 지만 4 산출물에 inline 으로 펼쳐져 들어가야
  // 각 플랫폼 IIFE 가 자체 작동. esbuild 가 keepNames + bundle 로 함수명/문자열 보존.
  for (const [name, rel] of Object.entries(PLATFORM_ARTIFACTS)) {
    describe(`${name} (${rel})`, () => {
      const src = read(rel);

      it('isCleanbotFiltered 함수가 정의되어 있다', () => {
        expect(src).toMatch(/function\s+isCleanbotFiltered\s*\(/);
      });

      it('구조 신호 — [data-slot] 셀렉터로 메타 슬롯 존재 여부 검사', () => {
        // querySelector('[data-slot]') 호출이 isCleanbotFiltered 함수 본문에 있어야 함.
        // false-positive (사용자 제목 spoofing) 방지의 핵심 신호.
        expect(src).toMatch(/querySelector\(\s*['"]\[data-slot\]['"]\s*\)/);
      });

      it('텍스트 신호 — "클린봇" + "감지" 두 키워드 모두 검사', () => {
        // 단일 substring 매칭으로 회귀하면 사용자 본문 spoofing 에 취약하므로 두 키워드를 모두 봐야 함.
        expect(src).toContain('클린봇');
        expect(src).toContain('감지');
      });

      it('inject 함수에서 isCleanbotFiltered 호출 최소 2 군데 — path A + path B', () => {
        // path A / path B 둘 다 가드를 거치는지 회귀 가드.
        const calls = src.match(/isCleanbotFiltered\s*\(/g) || [];
        // 정의 1 + 호출 ≥ 2 = 총 ≥ 3
        expect(calls.length).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
