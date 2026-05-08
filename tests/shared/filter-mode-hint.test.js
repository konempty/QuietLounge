// 차단 직후 "흐림 처리 모드 안내" hint 의 cross-platform 동기화 검증.
// iOS QuietLoungeCore.shouldShowFilterModeHint /
// Android WebViewToolbarLogic.shouldShowFilterModeHint 와
// Chrome/Safari content-script 의 maybeShowFilterModeHint 가 같은 시맨틱이어야 함.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 양 익스텐션 content-script 가 사용하는 것과 동일한 의사결정 로직.
 * Production 코드와 drift 가 나면 아래 string match 테스트가 실패하도록 가드.
 */
function shouldShowFilterModeHint(filterMode, dontShowFilterHint) {
  if (filterMode === 'blur') return false;
  return !dontShowFilterHint;
}

describe('shouldShowFilterModeHint — pure 시맨틱', () => {
  it('HIDE 모드 + dontShow false → 표시', () => {
    expect(shouldShowFilterModeHint('hide', false)).toBe(true);
  });

  it('이미 BLUR 모드 → 표시 안 함', () => {
    expect(shouldShowFilterModeHint('blur', false)).toBe(false);
  });

  it('다시 보지 않기 → 표시 안 함', () => {
    expect(shouldShowFilterModeHint('hide', true)).toBe(false);
  });

  it('BLUR 이면서 다시 보지 않기까지 → 표시 안 함', () => {
    expect(shouldShowFilterModeHint('blur', true)).toBe(false);
  });
});

describe('content-scripts — filter hint 구현 동기화', () => {
  const files = [
    'chrome-extension/content-scripts/main.js',
    'safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/main.js',
  ];

  for (const rel of files) {
    describe(rel, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

      it('DONT_SHOW_FILTER_HINT_KEY 상수 선언', () => {
        // 정확한 storage key 컨벤션 — Android/iOS 와 동일 ("quiet_lounge_dont_show_filter_hint").
        // esbuild 산출물은 const + 따옴표 종류 무관 — 문자열 리터럴만 매칭.
        expect(src).toMatch(/DONT_SHOW_FILTER_HINT_KEY\s*=\s*['"]quiet_lounge_dont_show_filter_hint['"]/);
      });

      it('dontShowFilterHint 변수 선언 (캐시)', () => {
        expect(src).toMatch(/let\s+dontShowFilterHint\s*=\s*false/);
      });

      it('showFilterModeHintDialog (web/core/filter-mode-hint) DOM modal 패턴 보존', () => {
        // web/core/filter-mode-hint.ts 에서 export — 산출물에 함수 정의가 그대로 들어옴.
        expect(src).toMatch(/function\s+showFilterModeHintDialog\s*\(/);
        // 모달 안에 "다시 보지 않기" 와 "확인" 두 버튼이 존재해야 함 (따옴표 종류 무관).
        expect(src).toMatch(/dontBtn\.textContent\s*=\s*['"]다시 보지 않기['"]/);
        expect(src).toMatch(/okBtn\.textContent\s*=\s*['"]확인['"]/);
        // resolve 값으로 'dontShow' 가 사용돼야 storage 분기가 됨
        expect(src).toMatch(/close\(\s*['"]dontShow['"]\s*\)/);
      });

      it('maybeShowFilterModeHint 함수 — pure 로직과 동일 시맨틱', () => {
        expect(src).toMatch(/async\s+function\s+maybeShowFilterModeHint/);
        // BLUR 가드 + dontShow 가드 둘 다 존재
        expect(src).toMatch(/if\s*\(\s*filterMode\s*===\s*['"]blur['"]\s*\)\s*return/);
        expect(src).toMatch(/if\s*\(\s*dontShowFilterHint\s*\)\s*return/);
        // dontShow 응답 시 storage 영속화
        expect(src).toMatch(/result\s*===\s*['"]dontShow['"]/);
      });

      it('storage.onChanged 가 hint flag 도 관찰', () => {
        expect(src).toMatch(/changes\[DONT_SHOW_FILTER_HINT_KEY\]/);
      });

      it('차단 호출 (blockUser) 직후 hint 트리거', () => {
        // PR #3 이전엔 path A / path B 각각이 inline 으로 hint 호출 (2 군데). PR #3 이후엔 adapter
        // onBlockClick 에서 단일 호출 — path A/B 차이가 shared injectBlockButtons 안으로 흡수됨.
        // 호출 횟수는 ≥ 1 로 완화하되, blockUser 직후 (await blockUser → filterAll → ... →
        // maybeShowFilterModeHint) 패턴이 깨지지 않았는지 검증.
        const calls = src.match(/await\s+maybeShowFilterModeHint\s*\(\s*\)/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(1);
        // adapter onBlockClick 의 sequence 가 깨지면 hint 가 안 뜸 — blockUser → filterAll → hint 순서 회귀 가드.
        expect(src).toMatch(/blockUser[\s\S]{0,200}filterAll[\s\S]{0,200}maybeShowFilterModeHint/);
      });
    });
  }
});
