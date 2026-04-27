// 확장 팝업 "전체 삭제" 기능의 cross-platform 동기화 검증.
// iOS / Android 앱 의 clearAll 과 동일 시맨틱 — blockedUsers + nicknameOnlyBlocks + personaCache 초기화.
//
// 검증:
// 1) 3개 popup (Chrome / Safari iOS / Safari macOS) 모두 동일한 마크업/스타일/핸들러
// 2) Chrome 팝업의 실제 동작 — 빈 상태/유저 있는 상태/취소 케이스

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

describe('전체 삭제 — 3 popup 마크업/스타일/핸들러 동기화', () => {
  const popups = [
    {
      name: 'chrome',
      html: 'chrome-extension/popup/popup.html',
      js: 'chrome-extension/popup/popup.js',
      css: 'chrome-extension/popup/popup.css',
      // Chrome popup 은 일반 chromium popup → native confirm 동작
      confirmFn: 'confirm',
    },
    {
      name: 'safari-ios',
      html: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.html',
      js: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.js',
      css: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.css',
      // Safari Web Extension popup 에선 native confirm/alert 차단 → DOM modal 사용 필수
      confirmFn: 'popupConfirm',
    },
    {
      name: 'safari-macos',
      html: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.html',
      js: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.js',
      css: 'safari-extension/QuietLounge/Shared (Extension)/Resources/popup-macos/popup.css',
      confirmFn: 'popupConfirm',
    },
  ];

  for (const p of popups) {
    describe(p.name, () => {
      const html = fs.readFileSync(path.resolve(process.cwd(), p.html), 'utf8');
      const js = fs.readFileSync(path.resolve(process.cwd(), p.js), 'utf8');
      const css = fs.readFileSync(path.resolve(process.cwd(), p.css), 'utf8');

      it('HTML — btn-clear-all 버튼 존재 + btn-danger 클래스', () => {
        expect(html).toMatch(/id="btn-clear-all"[^>]*class="[^"]*btn-danger/);
      });

      it('CSS — .btn-danger 스타일 정의', () => {
        expect(css).toMatch(/\.btn-danger\s*\{/);
        expect(css).toContain('#e74c3c'); // 다른 곳에서도 쓰이지만 .btn-danger 색으로도 사용
      });

      it('JS — btn-clear-all 클릭 핸들러 등록 + 차단 + 키워드 알림 모두 초기화', () => {
        expect(js).toMatch(/getElementById\(['"]btn-clear-all['"]\)\.addEventListener\(['"]click['"]/);
        // 차단 데이터 초기화
        expect(js).toMatch(/blockData\s*=\s*createEmptyData\(\)/);
        // 키워드 알림도 초기화 — "전체 삭제" 라는 이름에 맞춰 alerts/interval/lastChecked 모두 제거
        expect(js).toMatch(/keywordAlerts\s*=\s*\[\]/);
        expect(js).toContain('KEYWORD_ALERTS_KEY');
        expect(js).toContain('ALERT_INTERVAL_KEY');
        expect(js).toContain('ALERT_LAST_CHECKED_KEY');
        // 가드: 차단 + 알림 둘 다 0 일 때만 "삭제할 데이터가 없습니다"
        expect(js).toMatch(/삭제할 데이터가 없습니다/);
        // 확인 다이얼로그 — Chrome 은 native confirm, Safari 는 popupConfirm
        const confirmRe = new RegExp(`${p.confirmFn}\\(`);
        expect(js).toMatch(confirmRe);
        // 메시지 통일 — 차단 목록 + 키워드 알림 설정 명시
        expect(js).toMatch(/차단 목록과 키워드 알림 설정을 모두 삭제/);
        expect(js).toMatch(/되돌릴 수 없습니다/);
      });

      if (p.confirmFn === 'popupConfirm') {
        it('JS — popupConfirm/popupAlert + popupModal 헬퍼 정의 (Safari 전용)', () => {
          expect(js).toMatch(/function\s+popupModal\b/);
          expect(js).toMatch(/function\s+popupConfirm\b/);
          expect(js).toMatch(/function\s+popupAlert\b/);
          // 핵심: native confirm/alert 호출이 없어야 함 — 있으면 Safari 에서 막힘
          expect(js).not.toMatch(/(?<!popup)confirm\(/);
          expect(js).not.toMatch(/(?<!popup)alert\(/);
        });
      }
    });
  }
});

// ── Chrome popup 동작 단위 테스트 ──
// JSDOM 안에서 popup.js 를 실행하고 confirm/alert 모킹.

const POPUP_HTML = path.resolve(process.cwd(), 'chrome-extension/popup/popup.html');
const POPUP_JS = path.resolve(process.cwd(), 'chrome-extension/popup/popup.js');

function mkChrome() {
  const store = {};
  const listeners = [];
  return {
    runtime: { getManifest: () => ({ version: 'test' }) },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          const arr = Array.isArray(keys) ? keys : keys ? [keys] : Object.keys(store);
          arr.forEach((k) => { if (store[k] !== undefined) out[k] = store[k]; });
          cb ? cb(out) : Promise.resolve(out);
          return Promise.resolve(out);
        },
        set: (items, cb) => {
          Object.assign(store, items);
          listeners.forEach((l) =>
            l(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]))),
          );
          cb && cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
          cb && cb();
          return Promise.resolve();
        },
      },
      onChanged: { addListener: (l) => listeners.push(l) },
    },
    notifications: { create: vi.fn(), clear: vi.fn() },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
    _storage: { _store: store },
  };
}

async function setupPopup({ seed = {}, confirmReturn = true } = {}) {
  const html = await fsp.readFile(POPUP_HTML, 'utf8');
  const js = await fsp.readFile(POPUP_JS, 'utf8');

  const dom = new JSDOM(html, { url: 'https://popup.test/', runScripts: 'outside-only' });
  const win = dom.window;

  const chrome = mkChrome();
  Object.assign(chrome._storage._store, seed);
  win.chrome = chrome;
  win.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }));
  win.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

  const alertSpy = vi.fn();
  const confirmSpy = vi.fn(() => confirmReturn);
  win.alert = alertSpy;
  win.confirm = confirmSpy;

  const wrapped = `${js}\n//# sourceURL=${pathToFileURL(POPUP_JS).href}\n`;
  win.eval(wrapped);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

  return { dom, win, chrome, alertSpy, confirmSpy };
}

describe('Chrome 팝업 — 전체 삭제 동작', () => {
  let dom;
  afterEach(() => {
    dom?.window?.close();
    dom = undefined;
    vi.restoreAllMocks();
  });

  it('차단 + 알림 모두 0 일 때 — alert 만 띄우고 confirm 호출 안 함', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    ctx.win.document.getElementById('btn-clear-all').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.alertSpy).toHaveBeenCalledWith('삭제할 데이터가 없습니다.');
    expect(ctx.confirmSpy).not.toHaveBeenCalled();
  });

  it('차단/알림 데이터 있을 때 confirm true → 차단 + 키워드 알림 storage 모두 초기화', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: { personaId: 'p1', nickname: 'A', blockedAt: '2026-04-01T00:00:00Z' },
        },
        nicknameOnlyBlocks: [{ nickname: 'B', blockedAt: '2026-04-02T00:00:00Z' }],
        personaCache: { p9: { nickname: '캐시', lastSeen: '2026-04-03T00:00:00Z' } },
      }),
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a1', channelId: 'c1', channelName: '채널', keywords: ['kw'], enabled: true, createdAt: '2026-04-01T00:00:00Z' },
      ]),
      quiet_lounge_alert_interval: 7,
      quiet_lounge_alert_last_checked: JSON.stringify({ c1: '2026-04-05T00:00:00Z' }),
    };
    const ctx = await setupPopup({ seed, confirmReturn: true });
    dom = ctx.dom;

    expect(ctx.win.document.getElementById('blocked-count').textContent).toBe('2');
    ctx.win.document.getElementById('btn-clear-all').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.confirmSpy).toHaveBeenCalled();
    // 통일된 메시지 — 차단 목록 + 키워드 알림 설정 둘 다 명시
    expect(ctx.confirmSpy.mock.calls[0][0]).toContain('차단 목록과 키워드 알림 설정을 모두 삭제');
    expect(ctx.confirmSpy.mock.calls[0][0]).toContain('되돌릴 수 없습니다');

    expect(ctx.win.document.getElementById('blocked-count').textContent).toBe('0');
    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_data);
    expect(stored.blockedUsers).toEqual({});
    expect(stored.nicknameOnlyBlocks).toEqual([]);
    // personaCache 도 초기화 — iOS save(createEmpty()) / Android engine.clear() 과 동일 시맨틱
    expect(stored.personaCache).toEqual({});
    // 키워드 알림 storage 3개 모두 제거됨
    expect(ctx.chrome._storage._store.quiet_lounge_keyword_alerts).toBeUndefined();
    expect(ctx.chrome._storage._store.quiet_lounge_alert_interval).toBeUndefined();
    expect(ctx.chrome._storage._store.quiet_lounge_alert_last_checked).toBeUndefined();
  });

  it('차단 0명이지만 키워드 알림이 있으면 가드 통과 (alert 안 띄우고 confirm 진행)', async () => {
    const seed = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a1', channelId: 'c1', channelName: '채널', keywords: ['kw'], enabled: true, createdAt: '2026-04-01T00:00:00Z' },
      ]),
    };
    const ctx = await setupPopup({ seed, confirmReturn: true });
    dom = ctx.dom;
    ctx.win.document.getElementById('btn-clear-all').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.alertSpy).not.toHaveBeenCalled();
    expect(ctx.confirmSpy).toHaveBeenCalled();
    expect(ctx.chrome._storage._store.quiet_lounge_keyword_alerts).toBeUndefined();
  });

  it('confirm 취소 시 데이터 변경 없음', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: { personaId: 'p1', nickname: 'A', blockedAt: '2026-04-01T00:00:00Z' },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
    };
    const ctx = await setupPopup({ seed, confirmReturn: false });
    dom = ctx.dom;

    ctx.win.document.getElementById('btn-clear-all').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.confirmSpy).toHaveBeenCalled();
    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_data);
    expect(stored.blockedUsers.p1).toBeDefined();
  });
});
