// "후원" 링크의 cross-platform 일관성 회귀 가드.
// iOS native / Android / Chrome popup / Safari iOS popup / README 가
// 같은 후원 URL 을 가리키며, macOS Safari 익스텐션엔 후원 UI 가 존재하지 않아야 한다.
// 이전에 사용하던 카카오페이 URL 이 재도입되는 것도 회귀로 막는다.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SUPPORT_URL = 'https://fairy.hada.io/@quite-lounge';
const LEGACY_KAKAO = 'qr.kakaopay.com';
const LEGACY_QR_PNG = 'kakaoPayQR.png';

/** repo 루트 기준 상대 경로를 절대 경로로. */
function abs(rel) {
  return path.resolve(process.cwd(), rel);
}

/** 파일을 읽어 content 를 반환 — 존재하지 않으면 빈 문자열. */
function readSafe(rel) {
  const p = abs(rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('support link — 모든 플랫폼이 fairy.hada.io 를 가리킨다', () => {
  const PLATFORMS = [
    {
      name: 'iOS native (SettingsViewController.swift)',
      file: 'safari-extension/QuietLounge/iOS (App)/SettingsViewController.swift',
    },
    {
      name: 'Android (SettingsScreen.kt)',
      file: 'android-app/app/src/main/kotlin/kr/konempty/quietlounge/ui/settings/SettingsScreen.kt',
    },
    {
      name: 'Chrome popup (popup.js)',
      file: 'chrome-extension/popup/popup.js',
    },
    {
      name: 'Safari iOS popup (popup.js)',
      file: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.js',
    },
    {
      name: 'README',
      file: 'README.md',
    },
  ];

  for (const { name, file } of PLATFORMS) {
    describe(name, () => {
      const src = readSafe(file);

      it('파일이 존재해야 한다', () => {
        expect(src.length).toBeGreaterThan(0);
      });

      it(`현재 후원 URL(${SUPPORT_URL}) 을 포함한다`, () => {
        expect(src).toContain(SUPPORT_URL);
      });

      it('legacy 카카오페이 URL 을 더이상 포함하지 않는다', () => {
        expect(src).not.toContain(LEGACY_KAKAO);
      });
    });
  }
});

describe('support link — 마크업/엔트리포인트 회귀 가드', () => {
  it('Chrome popup HTML 에서 QR 모달/이미지 마크업 제거', () => {
    const html = readSafe('chrome-extension/popup/popup.html');
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('qr-modal');
    expect(html).not.toContain(LEGACY_QR_PNG);
    expect(html).not.toContain(LEGACY_KAKAO);
  });

  it('Safari iOS popup HTML 에서 QR 모달/이미지 마크업 제거', () => {
    const html = readSafe(
      'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.html',
    );
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('qr-modal');
    expect(html).not.toContain(LEGACY_QR_PNG);
    expect(html).not.toContain(LEGACY_KAKAO);
  });

  it('Chrome popup 은 chrome.tabs.create 로 후원 페이지 이동', () => {
    const js = readSafe('chrome-extension/popup/popup.js');
    // tabs.create 호출 + window.close 호출 둘 다 — 사용자 클릭 후 popup 이 잔류하지 않게.
    expect(js).toMatch(/chrome\.tabs\.create\s*\(\s*\{\s*url:\s*['"]https:\/\/fairy\.hada\.io\/@quite-lounge['"]/);
    expect(js).toContain('window.close()');
  });

  it('Safari iOS popup 은 browser.tabs.create 로 후원 페이지 이동', () => {
    const js = readSafe(
      'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.js',
    );
    expect(js).toMatch(/browser\.tabs\.create\s*\(\s*\{\s*url:\s*['"]https:\/\/fairy\.hada\.io\/@quite-lounge['"]/);
    expect(js).toContain('window.close()');
  });

  it('kakaoPayQR.png 자산 파일이 어떤 popup 디렉토리에도 없다', () => {
    expect(fs.existsSync(abs('chrome-extension/popup/kakaoPayQR.png'))).toBe(false);
    expect(
      fs.existsSync(
        abs(
          'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/kakaoPayQR.png',
        ),
      ),
    ).toBe(false);
  });
});

describe('support link — macOS Safari 익스텐션은 후원 UI 없음 (의도된 제외)', () => {
  // 사용자 요구사항: Mac 은 후원 기능 제외.
  const MAC_DIR = 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos';

  it('popup-macos/popup.html 에 btn-support / qr-modal / 후원 URL 모두 부재', () => {
    const html = readSafe(`${MAC_DIR}/popup.html`);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('btn-support');
    expect(html).not.toContain('qr-modal');
    expect(html).not.toContain(SUPPORT_URL);
    expect(html).not.toContain(LEGACY_KAKAO);
  });

  it('popup-macos/popup.js 에 후원 관련 핸들러/URL 모두 부재', () => {
    const js = readSafe(`${MAC_DIR}/popup.js`);
    expect(js.length).toBeGreaterThan(0);
    expect(js).not.toContain('btn-support');
    expect(js).not.toContain(SUPPORT_URL);
    expect(js).not.toContain(LEGACY_KAKAO);
  });
});
