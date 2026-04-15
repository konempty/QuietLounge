// safari-extension popup.html + popup.js 통합 테스트 (jsdom).
// browser.* (storage-bridge 는 미로드 — popup 단독 검증) mock.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const POPUP_HTML = path.resolve(
  process.cwd(),
  'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.html',
);
const POPUP_JS = path.resolve(
  process.cwd(),
  'safari-extension/QuietLounge/Shared (Extension)/Resources/popup/popup.js',
);

function mkBrowser({ seed = {} } = {}) {
  const store = { _data: { ...seed }, _listeners: [] };
  return {
    _store: store,
    runtime: {
      getManifest: () => ({ version: '1.0.0' }),
      sendMessage: vi.fn((_p, cb) => cb && cb({ ok: true })),
      lastError: null,
    },
    storage: {
      local: {
        get: (key, cb) => {
          const out = {};
          const keys = typeof key === 'string' ? [key] : Array.isArray(key) ? key : [];
          for (const k of keys) {
            if (k in store._data) out[k] = store._data[k];
          }
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set: (obj, cb) => {
          Object.assign(store._data, obj);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (key, cb) => {
          delete store._data[key];
          if (cb) cb();
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (cb) => store._listeners.push(cb),
      },
    },
    tabs: {
      query: (_q, cb) => cb && cb([]),
      sendMessage: vi.fn(),
      create: vi.fn(),
    },
  };
}

async function setup({ seed = {}, userAgent, fetchImpl } = {}) {
  const html = await fs.readFile(POPUP_HTML, 'utf8');
  const js = await fs.readFile(POPUP_JS, 'utf8');
  const dom = new JSDOM(html, {
    url: 'safari-web-extension://abc/popup.html',
    runScripts: 'outside-only',
  });
  const win = dom.window;
  if (userAgent) {
    Object.defineProperty(win.navigator, 'userAgent', {
      value: userAgent,
      configurable: true,
    });
  }
  win.browser = mkBrowser({ seed });
  win.fetch = fetchImpl || vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  win.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  win.eval(`${js}\n//# sourceURL=${pathToFileURL(POPUP_JS).href}\n`);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return { dom, win };
}

describe('safari popup.html + popup.js', () => {
  let dom;
  afterEach(() => {
    if (dom) dom.window.close();
    dom = null;
  });

  it('초기 렌더 — 버전 표시 + 빈 상태', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;
    expect(doc.getElementById('app-version').textContent).toBe('v1.0.0');
    expect(doc.getElementById('blocked-count').textContent).toBe('0');
  });

  it('차단 유저 있으면 카운트 + 목록 렌더', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: {
            personaId: 'p1',
            nickname: 'S_유저',
            previousNicknames: [],
            blockedAt: '2026-04-01T00:00:00Z',
            reason: '',
          },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    expect(doc.getElementById('blocked-count').textContent).toBe('1');
    expect(
      doc.getElementById('block-list-container').innerHTML,
    ).toContain('S_유저');
  });

  it('필터 토글 — blur 저장', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;
    const toggle = doc.getElementById('filter-mode-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ctx.win.browser._store._data.quiet_lounge_filter_mode).toBe('blur');
  });

  it('커피 버튼 → QR 모달 open', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;
    doc.getElementById('btn-support').click();
    const modal = doc.getElementById('qr-modal');
    expect(modal.classList.contains('active')).toBe(true);
  });

  it('키워드 알림 추가 버튼 → 모달 active', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;
    const modal = doc.getElementById('alert-modal');
    expect(modal.classList.contains('active')).toBe(false);
    doc.getElementById('btn-add-alert').click();
    expect(modal.classList.contains('active')).toBe(true);
  });

  it('키워드 알림 리스트 렌더', async () => {
    const seed = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        {
          id: 'a1',
          channelId: 'c1',
          channelName: 'S채널',
          keywords: ['k1'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const list = ctx.win.document.getElementById('keyword-alerts-list');
    expect(list.innerHTML).toContain('S채널');
  });

  it('키워드 알림 토글 변경 시 enabled 저장', async () => {
    const seed = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        {
          id: 'a1',
          channelId: 'c1',
          channelName: 'S채널',
          keywords: ['k1'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    const toggle = doc.querySelector('.alert-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(ctx.win.browser._store._data.quiet_lounge_keyword_alerts);
    expect(stored[0].enabled).toBe(false);
    expect(doc.getElementById('keyword-alerts-list').innerHTML).toContain('alert-disabled');
  });

  it('키워드 알림 삭제 버튼으로 목록에서 제거', async () => {
    const seed = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        {
          id: 'a1',
          channelId: 'c1',
          channelName: '삭제채널',
          keywords: ['k1'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    doc.querySelector('.btn-delete-alert').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(ctx.win.browser._store._data.quiet_lounge_keyword_alerts);
    expect(stored).toEqual([]);
    expect(doc.getElementById('keyword-alerts-list').textContent).toContain(
      '등록된 키워드 알림이 없습니다',
    );
  });

  it('내 활동 통계가 있으면 값과 스피너를 렌더', async () => {
    const seed = {
      quiet_lounge_my_stats: JSON.stringify({
        totalPosts: 12,
        totalComments: 34,
        monthlyPosts: '...',
        monthlyComments: 7,
      }),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    expect(doc.getElementById('my-total-posts').textContent).toBe('12');
    expect(doc.getElementById('my-total-comments').textContent).toBe('34');
    expect(doc.getElementById('my-monthly-posts').innerHTML).toContain('ql-spinner');
    expect(doc.getElementById('my-monthly-comments').textContent).toBe('7');
    expect(doc.getElementById('my-stats-hint').textContent).toBe('');
  });

  it('깨진 내 활동 통계 JSON 은 에러 힌트를 표시', async () => {
    const seed = {
      quiet_lounge_my_stats: '{broken-json',
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    expect(doc.getElementById('my-stats-hint').textContent).toBe(
      '통계를 불러올 수 없습니다',
    );
  });

  it('통계가 없을 때 갱신 버튼은 안내만 표시하고 요청 플래그는 저장하지 않음', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    doc.getElementById('btn-refresh-stats').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(doc.getElementById('my-stats-hint').textContent).toBe(
      '라운지에 접속하면 통계가 자동으로 갱신됩니다',
    );
    expect(ctx.win.browser._store._data.quiet_lounge_refresh_stats).toBeUndefined();
  });

  it('통계가 있으면 갱신 버튼이 refresh 플래그를 저장', async () => {
    const seed = {
      quiet_lounge_my_stats: JSON.stringify({
        totalPosts: 1,
        totalComments: 2,
        monthlyPosts: 3,
        monthlyComments: 4,
      }),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    ctx.win.setInterval = vi.fn(() => 123);
    ctx.win.clearInterval = vi.fn();

    doc.getElementById('btn-refresh-stats').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    expect(doc.getElementById('my-stats-hint').textContent).toBe('갱신 중...');
    expect(typeof ctx.win.browser._store._data.quiet_lounge_refresh_stats).toBe('number');
    expect(ctx.win.setInterval).toHaveBeenCalled();
  });

  it('카테고리 → 채널 → 키워드 저장 흐름으로 새 알림을 등록', async () => {
    let callIdx = 0;
    const ctx = await setup({
      fetchImpl: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          return {
            ok: true,
            json: async () => ({
              data: {
                items: [{ categoryId: 'cat1', name: '게임' }],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              items: [{ finalChannelId: 'ch1', name: '채널A' }],
              page: { totalElements: 1 },
            },
          }),
        };
      }),
    });
    dom = ctx.dom;
    const doc = ctx.win.document;

    doc.getElementById('btn-add-alert').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(doc.getElementById('category-list').innerHTML).toContain('게임');

    doc.querySelector('#category-list .select-item').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(doc.getElementById('channel-list').innerHTML).toContain('채널A');

    doc.querySelector('#channel-list .select-item').click();
    doc.getElementById('keyword-input').value = 'BTS';
    doc.getElementById('btn-add-keyword').click();
    doc.getElementById('btn-save-alert').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(ctx.win.browser._store._data.quiet_lounge_keyword_alerts);
    expect(stored).toHaveLength(1);
    expect(stored[0].channelId).toBe('ch1');
    expect(stored[0].channelName).toBe('채널A');
    expect(stored[0].keywords).toEqual(['BTS']);
    expect(doc.getElementById('keyword-alerts-list').innerHTML).toContain('채널A');
    expect(doc.getElementById('alert-modal').classList.contains('active')).toBe(false);
  });

  it('중복 키워드는 pending 목록에 한 번만 추가', async () => {
    let callIdx = 0;
    const ctx = await setup({
      fetchImpl: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          return {
            ok: true,
            json: async () => ({
              data: {
                items: [{ categoryId: 'cat1', name: '게임' }],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              items: [{ finalChannelId: 'ch1', name: '채널A' }],
              page: { totalElements: 1 },
            },
          }),
        };
      }),
    });
    dom = ctx.dom;
    const doc = ctx.win.document;

    doc.getElementById('btn-add-alert').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    doc.querySelector('#category-list .select-item').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    doc.querySelector('#channel-list .select-item').click();

    const keywordInput = doc.getElementById('keyword-input');
    keywordInput.value = 'BTS';
    keywordInput.dispatchEvent(
      new ctx.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    keywordInput.value = 'BTS';
    doc.getElementById('btn-add-keyword').click();

    expect(doc.querySelectorAll('.keyword-tag')).toHaveLength(1);
    expect(doc.getElementById('btn-save-alert').disabled).toBe(false);
  });

  it('macOS 에서 알림 저장 직후 background 메시지를 보낸다', async () => {
    let callIdx = 0;
    const ctx = await setup({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      fetchImpl: vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) {
          return {
            ok: true,
            json: async () => ({
              data: {
                items: [{ categoryId: 'cat1', name: '게임' }],
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              items: [{ finalChannelId: 'ch1', name: '채널A' }],
              page: { totalElements: 1 },
            },
          }),
        };
      }),
    });
    dom = ctx.dom;
    const doc = ctx.win.document;

    doc.getElementById('btn-add-alert').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    doc.querySelector('#category-list .select-item').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    doc.querySelector('#channel-list .select-item').click();
    doc.getElementById('keyword-input').value = 'BTS';
    doc.getElementById('btn-add-keyword').click();
    doc.getElementById('btn-save-alert').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.win.browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'QL_KEYWORD_CHECK_NOW' },
      expect.any(Function),
    );
    expect(ctx.win.browser.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'QL_PROMPT_NOTIF_PERM' },
      expect.any(Function),
    );
  });

  it('export — navigator.share 로 keywordAlerts 빈 배열까지 항상 포함', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {},
        nicknameOnlyBlocks: [],
        personaCache: {
          p1: { nickname: '캐시유저', lastSeen: '2026-04-01T00:00:00Z' },
        },
      }),
      // keywordAlerts 가 storage 에 없는 상태 = 알림 0 개
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    let captured = null;
    ctx.win.navigator.share = async (data) => {
      const file = data.files?.[0];
      if (file) captured = await file.text();
      return undefined;
    };

    doc.getElementById('btn-export').click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(captured).toBeTruthy();
    const parsed = JSON.parse(captured);
    // cleared state: keywordAlerts 가 빈 배열이라도 항상 명시
    expect(Array.isArray(parsed.keywordAlerts)).toBe(true);
    expect(parsed.keywordAlerts).toHaveLength(0);
    // personaCache 는 export 에서 제외
    expect(parsed.personaCache).toBeUndefined();
  });

  it('export — keywordAlerts 가 있으면 그대로 포함', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {},
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
      quiet_lounge_keyword_alerts: JSON.stringify([
        {
          id: 'k1',
          channelId: 'c1',
          channelName: '채널A',
          keywords: ['키'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
      quiet_lounge_alert_interval: 12,
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    let captured = null;
    ctx.win.navigator.share = async (data) => {
      const file = data.files?.[0];
      if (file) captured = await file.text();
    };

    doc.getElementById('btn-export').click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    const parsed = JSON.parse(captured);
    expect(parsed.keywordAlerts).toHaveLength(1);
    expect(parsed.keywordAlerts[0].channelName).toBe('채널A');
    expect(parsed.alertInterval).toBe(12);
  });

  it('import — 빈 keywordAlerts 배열은 기존 알림 전체 해제', async () => {
    const seed = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        {
          id: 'old',
          channelId: 'c1',
          channelName: '기존채널',
          keywords: ['old'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    expect(doc.getElementById('keyword-alerts-list').innerHTML).toContain('기존채널');

    const importJson = JSON.stringify({
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
      keywordAlerts: [],
    });
    const fileInput = doc.getElementById('file-import');
    Object.defineProperty(fileInput, 'files', {
      value: [{ text: async () => importJson }],
      configurable: true,
    });
    ctx.win.alert = () => {};
    fileInput.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(doc.getElementById('keyword-alerts-list').innerHTML).not.toContain('기존채널');
    const stored = ctx.win.browser._store._data.quiet_lounge_keyword_alerts;
    expect(JSON.parse(stored)).toEqual([]);
  });

  it('import — alertInterval 을 1..60 으로 clamp', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const importJson = JSON.stringify({
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
      alertInterval: 9999,
    });
    const fileInput = doc.getElementById('file-import');
    Object.defineProperty(fileInput, 'files', {
      value: [{ text: async () => importJson }],
      configurable: true,
    });
    ctx.win.alert = () => {};
    fileInput.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.win.browser._store._data.quiet_lounge_alert_interval).toBe(60);
    expect(doc.getElementById('alert-interval').value).toBe('60');
  });

  it('import — alertInterval 0 은 1 로 clamp', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const importJson = JSON.stringify({
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
      alertInterval: 0,
    });
    const fileInput = doc.getElementById('file-import');
    Object.defineProperty(fileInput, 'files', {
      value: [{ text: async () => importJson }],
      configurable: true,
    });
    ctx.win.alert = () => {};
    fileInput.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.win.browser._store._data.quiet_lounge_alert_interval).toBe(1);
  });

  it('import — keywordAlerts 필드 없으면 기존 알림 유지', async () => {
    const seed = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        {
          id: 'keep',
          channelId: 'c1',
          channelName: '유지채널',
          keywords: ['k'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    const importJson = JSON.stringify({
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
      // keywordAlerts 필드 없음
    });
    const fileInput = doc.getElementById('file-import');
    Object.defineProperty(fileInput, 'files', {
      value: [{ text: async () => importJson }],
      configurable: true,
    });
    ctx.win.alert = () => {};
    fileInput.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(doc.getElementById('keyword-alerts-list').innerHTML).toContain('유지채널');
  });

  it('export — 손상된 keywordAlerts 저장값은 빈 배열로 정규화', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {},
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
      quiet_lounge_keyword_alerts: '{not-json',
    };
    const ctx = await setup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    let captured = null;
    ctx.win.navigator.share = async (data) => {
      const file = data.files?.[0];
      if (file) captured = await file.text();
    };

    doc.getElementById('btn-export').click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    const parsed = JSON.parse(captured);
    expect(parsed.keywordAlerts).toEqual([]);
  });

  it('storage onChanged — 차단 목록 갱신', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    const doc = ctx.win.document;
    // popup.js 는 quiet_lounge_data 변경 시 render — 첫 번째 listener
    const listener = ctx.win.browser._store._listeners[0];
    listener({
      quiet_lounge_data: {
        newValue: JSON.stringify({
          version: 2,
          blockedUsers: {
            px: {
              personaId: 'px',
              nickname: '갱신유저',
              previousNicknames: [],
              blockedAt: '2026-04-01T00:00:00Z',
              reason: '',
            },
          },
          nicknameOnlyBlocks: [],
          personaCache: {},
        }),
      },
    });
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
    expect(
      doc.getElementById('block-list-container').innerHTML,
    ).toContain('갱신유저');
  });
});
