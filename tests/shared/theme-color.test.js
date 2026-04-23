// QuietLounge 브랜드 컬러의 다크 모드 시인성 보정 로직 테스트.
// chrome-extension, safari-extension content-scripts, android webview-script 모두
// 동일한 패턴을 사용: matchMedia('(prefers-color-scheme: dark)').matches 가 true 면 밝은 톤, 아니면 원본.
//
// 여기서는 각 콘텐트 스크립트에 하드코딩된 QL_PRIMARY 계산식을 그대로 복제해 검증 —
// drift 가 나면 테스트가 실패하도록 각 구현 파일의 문자열 내용도 같이 어서트.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * content-script 의 QL_PRIMARY 계산 로직 — production 과 100% 동일한 수식.
 * window.matchMedia 가 없거나 매치 안되면 라이트 모드 (원본 색상).
 */
function resolvePrimary(win) {
  return typeof win !== 'undefined' &&
    win.matchMedia &&
    win.matchMedia('(prefers-color-scheme: dark)').matches
    ? '#6A86F8'
    : '#4A6CF7';
}

function mockWindow(matches) {
  return {
    matchMedia: (q) => ({
      matches: q === '(prefers-color-scheme: dark)' ? matches : false,
    }),
  };
}

describe('QL_PRIMARY — 다크 모드 시인성 보정', () => {
  it('다크 모드에선 밝은 톤 #6A86F8', () => {
    expect(resolvePrimary(mockWindow(true))).toBe('#6A86F8');
  });

  it('라이트 모드에선 원본 #4A6CF7', () => {
    expect(resolvePrimary(mockWindow(false))).toBe('#4A6CF7');
  });

  it('matchMedia 미지원 — fallback 은 라이트 원본', () => {
    expect(resolvePrimary({})).toBe('#4A6CF7');
  });

  it('win 자체가 undefined — fallback 은 라이트 원본', () => {
    expect(resolvePrimary(undefined)).toBe('#4A6CF7');
  });
});

describe('content-scripts — QL_PRIMARY 하드코딩 동기화', () => {
  const files = [
    'chrome-extension/content-scripts/main.js',
    'safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/main.js',
    'android-app/app/src/main/assets/webview-scripts/after.js',
  ];

  for (const rel of files) {
    it(`${rel} — QL_PRIMARY 선언 패턴이 프로덕션/테스트 사이 동기화`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      // 핵심: 다크 = #6A86F8, 라이트 = #4A6CF7 가 함께 등장해야 함
      expect(src).toContain("'#6A86F8'");
      expect(src).toContain("'#4A6CF7'");
      // matchMedia 기반 분기
      expect(src).toMatch(/matchMedia\(['"]?\(prefers-color-scheme:\s*dark\)['"]?\)/);
    });
  }
});

describe('popup CSS — 다크 기본 + 라이트 override', () => {
  const cssWithMediaQuery = [
    'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.css',
    'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.css',
    'chrome-extension/popup/popup.css',
  ];

  for (const rel of cssWithMediaQuery) {
    it(`${rel} — --ql-primary 다크 기본 + light override`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      // 다크 기본: :root 에서 --ql-primary: #6A86F8
      expect(src).toMatch(/:root\s*\{[^}]*--ql-primary:\s*#6A86F8/);
      // 라이트 override: @media (prefers-color-scheme: light) { :root { --ql-primary: #4A6CF7
      expect(src).toMatch(
        /@media\s*\(prefers-color-scheme:\s*light\)\s*\{[\s\S]*?--ql-primary:\s*#4A6CF7/,
      );
      // 사용처는 var(--ql-primary) 로 참조
      expect(src).toContain('var(--ql-primary)');
      // self-reference 회피: 다크 기본값이 var(--ql-primary) 로 망가지면 안 됨
      expect(src).not.toMatch(/--ql-primary:\s*var\(--ql-primary\)/);
      // color-scheme 선언으로 폼 컨트롤도 자동 대응
      expect(src).toMatch(/color-scheme:\s*dark\s+light/);
    });
  }
});

/**
 * `@media (prefers-color-scheme: light) { ... }` 블록을 모두 찾아 본문을 합친다.
 * 한 파일 안에 :root override 와 본문 override 가 따로 있을 수 있어서 (e.g. Safari popup)
 * 모든 매치를 모아 합쳐야 셀렉터 커버리지 검증이 정확함.
 * 중괄호 매칭은 깊이 카운팅 — 정규식 backtracking 으론 중첩 룰셋을 안전하게 못 자름.
 */
function extractAllLightModeBlocks(src) {
  const re = /@media\s*\(prefers-color-scheme:\s*light\)\s*\{/g;
  const blocks = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const startIdx = m.index + m[0].length;
    let depth = 1;
    for (let i = startIdx; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(src.slice(startIdx, i));
          re.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  return blocks.join('\n');
}

describe('popup CSS — 라이트 모드 본문/카드 override 보강', () => {
  const popupCss = [
    'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.css',
    'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.css',
    'chrome-extension/popup/popup.css',
  ];

  for (const rel of popupCss) {
    describe(rel, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      const lightBlocks = extractAllLightModeBlocks(src);

      it('다크 기본 body — 어두운 배경/밝은 글자', () => {
        expect(src).toMatch(/body\s*\{[^}]*background:\s*#1a1a1a/);
        expect(src).toMatch(/body\s*\{[^}]*color:\s*#e0e0e0/);
      });

      it('라이트 모드에서 body 배경/글자색이 라이트 톤으로 override', () => {
        expect(lightBlocks.length).toBeGreaterThan(0);
        // 라이트 body 배경은 흰톤
        expect(lightBlocks).toMatch(/body\s*\{[^}]*background:\s*#f2f2f7/);
        expect(lightBlocks).toMatch(/body\s*\{[^}]*color:\s*#1c1c1e/);
      });

      it('라이트 모드에서 카드(.stat / .block-item) 배경이 흰색', () => {
        expect(lightBlocks).toMatch(/\.stat\s*\{[^}]*background:\s*#fff/);
        expect(lightBlocks).toMatch(/\.block-item\s*\{[^}]*background:\s*#fff/);
      });

      it('라이트 모드 override 블록이 충분한 셀렉터를 커버 (drift 가드)', () => {
        // 셀렉터 룰셋 개수 — 너무 적으면 누락된 컴포넌트가 다크 톤 그대로 노출됨
        const ruleCount = (lightBlocks.match(/\{/g) || []).length;
        expect(ruleCount).toBeGreaterThanOrEqual(20);
      });
    });
  }
});

describe('popup CSS — Safari/Chrome 라이트 톤 팔레트 일관성', () => {
  // Apple 시스템 컬러 톤을 양쪽이 동일하게 쓰는지 검사 — 디자인 drift 방지.
  // (popup-macos 는 별도로 다루고, 여기서는 iOS Safari 와 Chrome 만 비교)
  const sharedLightTokens = [
    '#f2f2f7', // base background (light gray)
    '#1c1c1e', // primary text
    '#8e8e93', // secondary text
    '#d1d1d6', // border separator
    '#c7c7cc', // input border
    '#3a3a3c', // strong text on light
    '#e5e5ea', // tag/secondary button bg
  ];
  const popupCss = [
    'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.css',
    'chrome-extension/popup/popup.css',
  ];

  for (const rel of popupCss) {
    it(`${rel} — Apple 시스템 라이트 톤 토큰 7종 모두 사용`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      for (const token of sharedLightTokens) {
        expect(src, `${token} 누락`).toContain(token);
      }
    });
  }
});
