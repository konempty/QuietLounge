// chrome-extension popup.html + popup.js 통합 테스트 (jsdom).
// chrome.* API 를 mock 한 뒤 popup.html 을 jsdom 으로 파싱하고 popup.js 를 로드해
// DOM 렌더/상호작용을 검증 — 실제 파일에 대한 커버리지 수집.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const POPUP_HTML = path.resolve(
  process.cwd(),
  'chrome-extension/popup/popup.html',
);
const POPUP_JS = path.resolve(
  process.cwd(),
  'chrome-extension/popup/popup.js',
);

function mkChrome() {
  const storage = { _store: {}, _listeners: [] };
  return {
    _storage: storage,
    runtime: {
      getManifest: () => ({ version: '1.0.0' }),
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: (key, cb) => {
          const out = {};
          const k = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : null;
          if (k && k in storage._store) out[k] = storage._store[k];
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set: (obj, cb) => {
          Object.assign(storage._store, obj);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (key, cb) => {
          delete storage._store[key];
          if (cb) cb();
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (cb) => storage._listeners.push(cb),
      },
    },
    tabs: {
      query: (_q, cb) => cb && cb([]),
      sendMessage: vi.fn(),
      create: vi.fn(),
    },
    permissions: {
      contains: (_q, cb) => cb(true),
      request: (_q, cb) => cb(true),
    },
    notifications: { create: vi.fn(), clear: vi.fn() },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
  };
}

async function setupPopup({ seed = {} } = {}) {
  const html = await fs.readFile(POPUP_HTML, 'utf8');
  const js = await fs.readFile(POPUP_JS, 'utf8');

  const dom = new JSDOM(html, {
    url: 'https://popup.test/',
    runScripts: 'outside-only',
  });
  const win = dom.window;

  const chrome = mkChrome();
  Object.assign(chrome._storage._store, seed);

  win.chrome = chrome;
  win.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: null }),
  }));
  win.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  // popup.js 실행
  const wrapped = `${js}\n//# sourceURL=${pathToFileURL(POPUP_JS).href}\n`;
  win.eval(wrapped);

  // 비동기 초기화 완료까지 대기
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

  return { dom, win, chrome };
}

describe('chrome popup.html + popup.js', () => {
  let dom;

  afterEach(() => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  it('초기 렌더 — 비어있을 때 empty 메시지', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    expect(doc.getElementById('blocked-count').textContent).toBe('0');
    expect(doc.getElementById('persona-count').textContent).toBe('0');
    expect(doc.getElementById('nickname-count').textContent).toBe('0');
    expect(doc.querySelector('#block-list-container .empty-message')).toBeTruthy();
    expect(doc.getElementById('app-version').textContent).toBe('v1.0.0');
  });

  it('차단 유저 있으면 목록 렌더 + 카운트 반영', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: {
            personaId: 'p1',
            nickname: '유저A',
            previousNicknames: [],
            blockedAt: '2026-04-01T00:00:00Z',
            reason: '',
          },
        },
        nicknameOnlyBlocks: [
          { nickname: 'B_닉네임', blockedAt: '2026-04-02T00:00:00Z', reason: '' },
        ],
        personaCache: {},
      }),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    expect(doc.getElementById('blocked-count').textContent).toBe('2');
    expect(doc.getElementById('persona-count').textContent).toBe('1');
    expect(doc.getElementById('nickname-count').textContent).toBe('1');
    expect(doc.querySelector('#block-list-container').innerHTML).toContain('유저A');
    expect(doc.querySelector('#block-list-container').innerHTML).toContain('B_닉네임');
  });

  it('해제 버튼 클릭 시 blockedUser 제거', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: {
            personaId: 'p1',
            nickname: 'X',
            previousNicknames: [],
            blockedAt: '2026-04-01T00:00:00Z',
            reason: '',
          },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    const btn = doc.querySelector('button[data-type="persona"][data-id="p1"]');
    expect(btn).toBeTruthy();
    btn.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(doc.getElementById('blocked-count').textContent).toBe('0');
    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_data);
    expect(stored.blockedUsers.p1).toBeUndefined();
  });

  it('필터 모드 토글 — 체크 시 blur 저장', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const toggle = doc.getElementById('filter-mode-toggle');
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.chrome._storage._store.quiet_lounge_filter_mode).toBe('blur');
  });

  it('저장된 filter 모드 blur — UI 체크 상태 반영', async () => {
    const seed = { quiet_lounge_filter_mode: 'blur' };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    expect(doc.getElementById('filter-mode-toggle').checked).toBe(true);
  });

  it('커피 버튼 → QR 모달 열림', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const btn = doc.getElementById('btn-support');
    btn.click();
    const modal = doc.getElementById('qr-modal');
    expect(modal.classList.contains('active') || modal.style.display !== 'none').toBe(
      true,
    );
  });

  it('QR 모달 닫기 버튼 → 모달 닫힘', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    doc.getElementById('btn-support').click();
    doc.getElementById('qr-modal-close').click();
    const modal = doc.getElementById('qr-modal');
    // active 클래스가 빠졌거나 display none 이 적용됨
    expect(
      !modal.classList.contains('active') || modal.style.display === 'none',
    ).toBe(true);
  });

  it('키워드 알림 모달 — 추가 버튼 클릭 시 열림', async () => {
    const ctx = await setupPopup();
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
          channelName: '공식채널',
          keywords: ['공지', 'BTS'],
          enabled: true,
          createdAt: '2026-04-01T00:00:00Z',
        },
      ]),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    const list = doc.getElementById('keyword-alerts-list');
    expect(list.innerHTML).toContain('공식채널');
    expect(list.innerHTML).toContain('공지');
    expect(list.innerHTML).toContain('BTS');
  });

  it('주기 입력 1분 — 경고 메시지 표시', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const input = doc.getElementById('alert-interval');
    input.value = '1';
    input.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    const warn = doc.getElementById('interval-warning');
    expect(warn.style.display).not.toBe('none');
  });

  it('주기 입력 10분 — 경고 숨김', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const input = doc.getElementById('alert-interval');
    input.value = '10';
    input.dispatchEvent(new ctx.win.Event('change'));
    const warn = doc.getElementById('interval-warning');
    expect(warn.style.display).toBe('none');
  });

  it('storage onChanged — 키워드 알림 리스트 재렌더', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    // popup.js 는 onChanged 를 3번 등록 — 키워드 알림 리스너는 마지막(line 664)
    const listener =
      ctx.chrome._storage._listeners[ctx.chrome._storage._listeners.length - 1];
    listener({
      quiet_lounge_keyword_alerts: {
        newValue: JSON.stringify([
          {
            id: 'x',
            channelId: 'cx',
            channelName: '새채널',
            keywords: ['k'],
            enabled: true,
            createdAt: '2026-04-01T00:00:00Z',
          },
        ]),
      },
    });
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
    expect(
      doc.getElementById('keyword-alerts-list').innerHTML,
    ).toContain('새채널');
  });
});
