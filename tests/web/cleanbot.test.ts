// 라운지 클린봇 검열 글 검출 — false-positive 방지를 위해 두 신호 (구조 + 텍스트) 의 AND.
// 기존 tests/shared/cleanbot-skip.test.js 의 "isCleanbotFiltered — 순수 시맨틱" 부분을
// web/core 로 이전한 뒤 inline mirror 대신 import 로 사용.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { isCleanbotFiltered } from '../../web/core/cleanbot';

function makeContainer(innerHtml: string): Element | null {
  const dom = new JSDOM(`<!doctype html><html lang="ko"><body>
    <a href="/posts/abc123" class="relative" tabindex="0">${innerHtml}</a>
  </body></html>`);
  return dom.window.document.querySelector('.relative[tabindex]');
}

describe('isCleanbotFiltered — 두 신호 AND', () => {
  it('cleanbot 검열 글 (data-slot 없음 + "클린봇"/"감지" 포함) → true', () => {
    const c = makeContainer(
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 게시글입니다</div></div>',
    );
    expect(isCleanbotFiltered(c)).toBe(true);
  });

  it('"댓글입니다" 등 라운지 카피 변경 → true (두 키워드 매칭에 의해 관대하게)', () => {
    const c = makeContainer(
      '<div class="flex"><div>클린봇이 부적절한 표현을 감지한 댓글입니다</div></div>',
    );
    expect(isCleanbotFiltered(c)).toBe(true);
  });

  it('일반 게시글 (작성자 profile-name 슬롯 노출) → false', () => {
    const c = makeContainer(
      '<div class="flex"><h2>일반 제목</h2><div data-slot="profile-name">홍길동</div></div>',
    );
    expect(isCleanbotFiltered(c)).toBe(false);
  });

  it('썸네일만 있는 카드형 (주간 베스트 등) → false', () => {
    const c = makeContainer(
      '<div data-slot="thumbnail"><img/></div><div>제목</div>',
    );
    expect(isCleanbotFiltered(c)).toBe(false);
  });

  it('사용자 제목 spoofing — "클린봇이 ... 감지" 를 제목으로 작성해도 false', () => {
    // 일반 게시글이라면 작성자/썸네일 슬롯이 함께 노출되므로 [data-slot] 매칭에 걸려
    // 텍스트 키워드가 들어있어도 가드가 발동되지 않는다.
    const c = makeContainer(
      '<div class="flex">' +
        '<h2>제 글이 클린봇이 부적절한 표현을 감지한 글로 분류됐어요</h2>' +
        '<div data-slot="profile-name">홍길동</div>' +
      '</div>',
    );
    expect(isCleanbotFiltered(c)).toBe(false);
  });

  it('"클린봇" 단어만 있는 본문 → false (감지 키워드 누락)', () => {
    const c = makeContainer('<div>오늘 클린봇 알림이 와서 깜짝 놀랐네요</div>');
    expect(isCleanbotFiltered(c)).toBe(false);
  });

  it('"감지" 단어만 있는 본문 → false (클린봇 키워드 누락)', () => {
    const c = makeContainer('<div>이상 신호 감지 안내</div>');
    expect(isCleanbotFiltered(c)).toBe(false);
  });

  it('null / undefined → false', () => {
    expect(isCleanbotFiltered(null)).toBe(false);
    expect(isCleanbotFiltered(undefined)).toBe(false);
  });
});
