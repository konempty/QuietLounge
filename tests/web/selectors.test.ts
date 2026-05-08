// SEL 상수가 4 플랫폼 entry 가 의존하는 8 키를 모두 보유하는지 검증.
// 키가 빠지면 esbuild 가 컴파일은 통과해도 runtime 에 셀렉터가 undefined → 차단 동작 silent 로 죽는다.

import { describe, it, expect } from 'vitest';
import { SEL } from '../../web/core/selectors';

describe('SEL — 라운지 DOM 셀렉터 상수', () => {
  it('8 개 키 모두 존재', () => {
    const expected = [
      'scrollContainer',
      'postLink',
      'postContainer',
      'nickname',
      'profileName',
      'separator',
      'card',
      'cardItem',
    ] as const;
    for (const key of expected) {
      expect(SEL[key]).toBeTypeOf('string');
      expect(SEL[key].length).toBeGreaterThan(0);
    }
    expect(Object.keys(SEL).sort()).toEqual([...expected].sort());
  });

  it('postLink / postContainer / profileName 의 셀렉터 형태 검증', () => {
    expect(SEL.postLink).toBe('a[href^="/posts/"]');
    expect(SEL.postContainer).toBe('.relative[tabindex]');
    expect(SEL.profileName).toBe('[data-slot="profile-name"]');
  });
});
