// storage 키 cross-platform 동기화 검증.
//
// `web/core/storage-keys.ts` 는 source of truth. 4 플랫폼이 같은 키 문자열로 저장해야 popup /
// background / content script / native 측이 같은 데이터를 읽고 쓴다. 한 곳이라도 어긋나면
// silent 하게 *데이터가 안 보임* / *덮어씀* 같은 회귀가 발생 — UI 가드 없음.
//
// 검증 전략:
//   - web/core/storage-keys.ts 의 export 된 상수 값을 *런타임에* 읽어 single source 로 사용
//   - Chrome / Safari ext popup·background, iOS Swift, Android Kotlin source 가 같은 키 *문자열*
//     을 hardcode 로 보유하는지 grep
//   - 산출물 (Chrome / Safari ext content-script main.js) 도 esbuild 후 같은 토큰 보유 (artifacts.test 가 별도)

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  STORAGE_KEY,
  FILTER_MODE_KEY,
  DONT_SHOW_FILTER_HINT_KEY,
} from '../../web/core/storage-keys';

const ROOT = process.cwd();

function read(rel) {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
}

// 키별로 hardcode 로 들어있어야 하는 production source 들. 누군가 web/core/storage-keys.ts
// 의 상수를 import 하지 않고 자체 hardcode 로 키 문자열을 넣은 위치 — 한 곳이라도 drift 나면 회귀.
// (entry / 산출물은 web/core/storage-keys.ts 를 import 해서 자동 동기화 — 별도 검증 불필요.)
const PLATFORM_FILES_FOR_STORAGE_KEY = [
  // popup UI (storage 직접 접근).
  'chrome-extension/popup/popup.js',
  'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.js',
  'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.js',
  // Safari ext native handler — App Group UserDefaults 의 키 알아야 함.
  'safari-extension/QuietLounge/Shared (Extension)/SafariWebExtensionHandler.swift',
  // iOS / Android native data layer.
  'safari-extension/QuietLounge/iOS (App)/BlockDataManager.swift',
  'android-app/app/src/main/kotlin/kr/konempty/quietlounge/data/PreferencesKeys.kt',
];

const PLATFORM_FILES_FOR_FILTER_MODE_KEY = [
  'chrome-extension/popup/popup.js',
  'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.js',
  'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.js',
  'android-app/app/src/main/kotlin/kr/konempty/quietlounge/data/PreferencesKeys.kt',
  // iOS 는 BlockDataManager 가 filter mode 도 함께 들고 있음.
  'safari-extension/QuietLounge/iOS (App)/BlockDataManager.swift',
];

const PLATFORM_FILES_FOR_DONT_SHOW_HINT = [
  // popup 토글이 없어 popup 측 hardcode 없음 — content script / native 만 read/write.
  // (Android 의 BlockListRepository.kt 는 PreferencesKeys 상수 import 라 hardcode 위치는 PreferencesKeys.kt 만.)
  'safari-extension/QuietLounge/iOS (App)/BlockDataManager.swift',
  'android-app/app/src/main/kotlin/kr/konempty/quietlounge/data/PreferencesKeys.kt',
];

describe('storage 키 — web/core/storage-keys.ts 의 값', () => {
  it('STORAGE_KEY 값 고정 ("quiet_lounge_data")', () => {
    // 키 자체가 바뀌면 모든 사용자의 기존 데이터가 *날아간 것처럼* 보인다 (다른 키로 저장돼 있어서).
    // 의도적으로 마이그레이션할 때만 변경 — 일반 변경은 차단.
    expect(STORAGE_KEY).toBe('quiet_lounge_data');
  });

  it('FILTER_MODE_KEY 값 고정', () => {
    expect(FILTER_MODE_KEY).toBe('quiet_lounge_filter_mode');
  });

  it('DONT_SHOW_FILTER_HINT_KEY 값 고정', () => {
    expect(DONT_SHOW_FILTER_HINT_KEY).toBe('quiet_lounge_dont_show_filter_hint');
  });
});

describe('storage 키 cross-platform 동기화 — 모든 플랫폼이 같은 문자열 hardcode', () => {
  for (const rel of PLATFORM_FILES_FOR_STORAGE_KEY) {
    it(`${rel} 가 STORAGE_KEY (${STORAGE_KEY}) 보유`, () => {
      const text = read(rel);
      expect(text).toContain(STORAGE_KEY);
    });
  }

  for (const rel of PLATFORM_FILES_FOR_FILTER_MODE_KEY) {
    it(`${rel} 가 FILTER_MODE_KEY (${FILTER_MODE_KEY}) 보유`, () => {
      const text = read(rel);
      expect(text).toContain(FILTER_MODE_KEY);
    });
  }

  for (const rel of PLATFORM_FILES_FOR_DONT_SHOW_HINT) {
    it(`${rel} 가 DONT_SHOW_FILTER_HINT_KEY (${DONT_SHOW_FILTER_HINT_KEY}) 보유`, () => {
      const text = read(rel);
      expect(text).toContain(DONT_SHOW_FILTER_HINT_KEY);
    });
  }
});
