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
          const k = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : null;
          if (k && k in store._data) out[k] = store._data[k];
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

async function setup({ seed = {} } = {}) {
  const html = await fs.readFile(POPUP_HTML, 'utf8');
  const js = await fs.readFile(POPUP_JS, 'utf8');
  const dom = new JSDOM(html, {
    url: 'safari-web-extension://abc/popup.html',
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.browser = mkBrowser({ seed });
  win.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
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
