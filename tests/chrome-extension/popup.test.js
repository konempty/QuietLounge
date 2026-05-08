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
            blockedAt: '2026-04-01T00:00:00Z',
          },
        },
        nicknameOnlyBlocks: [
          { nickname: 'B_닉네임', blockedAt: '2026-04-02T00:00:00Z' },
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

  it('해제 버튼 클릭 → confirm 후 blockedUser 제거 (4 플랫폼 통일 UX)', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: {
            personaId: 'p1',
            nickname: 'X',
            blockedAt: '2026-04-01T00:00:00Z',
          },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    // 4 플랫폼 통일 — Chrome popup 도 native confirm() 으로 한 번 더 확인.
    ctx.win.confirm = vi.fn(() => true);

    const btn = doc.querySelector('button[data-type="persona"][data-id="p1"]');
    expect(btn).toBeTruthy();
    btn.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.win.confirm).toHaveBeenCalledWith(
      expect.stringContaining('"X" 유저의 차단을 해제하시겠습니까?'),
    );
    expect(doc.getElementById('blocked-count').textContent).toBe('0');
    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_data);
    expect(stored.blockedUsers.p1).toBeUndefined();
  });

  it('해제 버튼 클릭 → confirm 취소 시 차단 유지', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: { personaId: 'p1', nickname: 'X', blockedAt: '2026-04-01T00:00:00Z' },
        },
        nicknameOnlyBlocks: [],
        personaCache: {},
      }),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    ctx.win.confirm = vi.fn(() => false);

    doc.querySelector('button[data-type="persona"][data-id="p1"]').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(ctx.win.confirm).toHaveBeenCalled();
    expect(doc.getElementById('blocked-count').textContent).toBe('1');
    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_data);
    expect(stored.blockedUsers.p1).toBeDefined();
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

  it('커피 버튼 → fairy.hada.io 새 탭 이동 + 팝업 닫기', async () => {
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;

    const closeSpy = vi.spyOn(ctx.win, 'close').mockImplementation(() => {});
    doc.getElementById('btn-support').click();

    expect(ctx.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://fairy.hada.io/@quite-lounge',
    });
    expect(closeSpy).toHaveBeenCalled();
  });

  it('Chrome popup 에는 QR 모달/이미지 마크업이 더이상 존재하지 않는다', async () => {
    const html = await fs.readFile(POPUP_HTML, 'utf8');
    expect(html).not.toContain('qr-modal');
    expect(html).not.toContain('kakaoPayQR.png');
    expect(html).not.toContain('qr.kakaopay.com');
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

  it('import 시 빈 keywordAlerts 배열은 전체 해제로 반영', async () => {
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
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    // 기존 알림이 있는 상태 확인
    expect(doc.getElementById('keyword-alerts-list').innerHTML).toContain('기존채널');

    // 빈 keywordAlerts 를 담은 import 파일 시뮬레이션
    const importJson = JSON.stringify({
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
      keywordAlerts: [],
    });
    const fileInput = doc.getElementById('file-import');
    const file = {
      text: async () => importJson,
    };
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    // alert 억제
    ctx.win.alert = () => {};
    fileInput.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    // 빈 배열로 덮어써져야 함 — 기존채널이 더 이상 보이지 않음
    expect(doc.getElementById('keyword-alerts-list').innerHTML).not.toContain('기존채널');
    // 저장소에도 빈 배열 반영
    const stored = ctx.chrome._storage._store.quiet_lounge_keyword_alerts;
    expect(JSON.parse(stored)).toEqual([]);
  });

  it('import 시 keywordAlerts 필드 없으면 기존 알림 유지', async () => {
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
    const ctx = await setupPopup({ seed });
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
    const file = { text: async () => importJson };
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    ctx.win.alert = () => {};
    fileInput.dispatchEvent(new ctx.win.Event('change'));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    // 기존 알림이 유지되어야 함
    expect(doc.getElementById('keyword-alerts-list').innerHTML).toContain('유지채널');
  });

  it('export 클릭 — personaCache 는 내보낸 JSON 에서 제외', async () => {
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {
          p1: {
            personaId: 'p1',
            nickname: '유저',
            blockedAt: '2026-04-01T00:00:00Z',
          },
        },
        nicknameOnlyBlocks: [],
        personaCache: {
          p1: { nickname: '유저', lastSeen: '2026-04-01T00:00:00Z' },
          p2: { nickname: '캐시만', lastSeen: '2026-04-01T00:00:00Z' },
        },
      }),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    // export 는 Blob 을 만들고 a.click() 으로 다운로드 — Blob 의 내용을 가로채려면 URL.createObjectURL 을 mock
    let capturedJson = null;
    ctx.win.URL.createObjectURL = (blob) => {
      blob.text().then((txt) => {
        capturedJson = txt;
      });
      return 'blob:mocked';
    };
    ctx.win.URL.revokeObjectURL = () => {};
    // a.click() 는 무시 (jsdom 다운로드 미지원)
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const el = origCreateElement(tag);
      if (tag === 'a') el.click = () => {};
      return el;
    };

    doc.getElementById('btn-export').click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(capturedJson).toBeTruthy();
    const parsed = JSON.parse(capturedJson);
    expect(parsed.personaCache).toBeUndefined();
    expect(parsed.blockedUsers.p1).toBeDefined();
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

  it('회귀 가드: 닉네임에 따옴표가 들어와도 data-* attribute 가 깨지지 않음 (escapeHtml 5-char)', async () => {
    // 이전 escapeHtml 은 textContent → innerHTML 패턴으로 `"` 를 escape 하지 않아
    // `data-nickname="${escapeHtml(...)}"` 안 따옴표가 attribute 경계를 깨뜨림 → dataset 값 잘림 →
    // 다른 닉네임이 unblock 되는 P2 회귀.
    const tricky = 'A" data-x="1';
    const seed = {
      quiet_lounge_data: JSON.stringify({
        version: 2,
        blockedUsers: {},
        nicknameOnlyBlocks: [
          { nickname: tricky, blockedAt: '2026-04-01T00:00:00Z' },
          { nickname: 'normal', blockedAt: '2026-04-02T00:00:00Z' },
        ],
        personaCache: {},
      }),
    };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;

    const btns = doc.querySelectorAll('button[data-type="nickname"]');
    expect(btns).toHaveLength(2);
    // dataset 이 원본과 정확히 일치 — attribute 경계 깨짐 없음.
    const nicknames = Array.from(btns).map((b) => b.dataset.nickname).sort();
    expect(nicknames).toEqual([tricky, 'normal'].sort());

    // tricky 닉네임 unblock — 정확히 그 entry 만 제거.
    ctx.win.confirm = vi.fn(() => true);
    const trickyBtn = Array.from(btns).find((b) => b.dataset.nickname === tricky);
    trickyBtn.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_data);
    expect(stored.nicknameOnlyBlocks).toHaveLength(1);
    expect(stored.nicknameOnlyBlocks[0].nickname).toBe('normal');
  });

  it('회귀 가드: 손상된 keywordAlerts JSON 은 빈 배열로 정규화 — popup UI 가 멈추지 않음 (Codex 49 F2)', async () => {
    // 깨진 JSON / 배열 아닌 값 모두 [] 로 fallback. 이전엔 JSON.parse 가 throw 해
    // loadKeywordAlerts() 가 reject → popup 초기화 / pending alert finalize / export 모두 멈춤.
    const seed = { quiet_lounge_keyword_alerts: '{broken-json' };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    // popup 이 정상 로드 — empty 메시지 표시 (UI 멈춤 없음)
    expect(doc.getElementById('keyword-alerts-list').textContent).toContain(
      '등록된 키워드 알림이 없습니다',
    );
  });

  it('회귀 가드: JSON 은 valid 지만 배열이 아닌 값 (object) 도 빈 배열로 정규화', async () => {
    const seed = { quiet_lounge_keyword_alerts: '{"not":"array"}' };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    expect(doc.getElementById('keyword-alerts-list').textContent).toContain(
      '등록된 키워드 알림이 없습니다',
    );
  });

  it('회귀 가드: finalizePendingAlert 가 malformed shape 거부 (Codex 55 F2 — array / empty / wrong types)', async () => {
    // pending = JSON 은 valid 지만 shape 가 잘못된 경우 (배열, empty object, wrong types).
    // 이전엔 typeof === "object" 만 검사 → push 후 keywords.map(...) TypeError → 모달 깨짐 + storage 오염.
    const cases = [
      JSON.stringify([]), // array
      JSON.stringify({}), // empty object
      JSON.stringify({ channelId: 'c1', channelName: 'n', keywords: 'wrong' }), // keywords non-array
      JSON.stringify({ channelId: 'c1', channelName: 'n', keywords: [] }), // empty keywords
      JSON.stringify({ channelId: 'c1', channelName: 'n', keywords: [123, 'k'] }), // keywords mixed type
      JSON.stringify({ channelId: '', channelName: 'n', keywords: ['k'] }), // empty channelId
      JSON.stringify({ channelId: 'c1', channelName: null, keywords: ['k'] }), // channelName null
    ];
    for (const raw of cases) {
      const ctx = await setupPopup({ seed: { quiet_lounge_pending_alert: raw } });
      // finalizePendingAlert 는 popup 로드 후 자동 호출 — 비동기.
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

      // PENDING_ALERT_KEY 는 항상 remove (정상 / malformed 모두) — 그 부분은 변경 없음.
      expect(ctx.chrome._storage._store.quiet_lounge_pending_alert).toBeUndefined();
      // keywordAlerts 에 push 되지 *않아야* — storage 미오염.
      const stored = ctx.chrome._storage._store.quiet_lounge_keyword_alerts;
      if (stored !== undefined) {
        expect(JSON.parse(stored)).toEqual([]);
      }
      ctx.dom.window.close();
    }
    dom = null;
  });

  it('회귀 가드: finalizePendingAlert 정상 shape 만 통과', async () => {
    const valid = JSON.stringify({
      channelId: 'c1',
      channelName: '정상채널',
      keywords: ['k1', 'k2'],
    });
    const ctx = await setupPopup({ seed: { quiet_lounge_pending_alert: valid } });
    dom = ctx.dom;
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(ctx.chrome._storage._store.quiet_lounge_keyword_alerts);
    expect(stored).toHaveLength(1);
    expect(stored[0].channelId).toBe('c1');
    expect(stored[0].channelName).toBe('정상채널');
    expect(stored[0].keywords).toEqual(['k1', 'k2']);
  });

  it('회귀 가드: storage onChanged 가 손상된 keywordAlerts 에서 throw 하지 않음 (Codex 52 F2)', async () => {
    // 다른 surface 에서 손상된 값이 들어와도 listener throw 없이 빈 배열로 정규화.
    // 이전엔 listener 안 raw JSON.parse 가 throw → 키워드 알림 UI 갱신 멈춤.
    const ctx = await setupPopup();
    dom = ctx.dom;
    const doc = ctx.win.document;
    // popup.js 가 storage.onChanged 를 3번 등록 — 키워드 알림 리스너는 마지막 (line 720 부근).
    const listener =
      ctx.chrome._storage._listeners[ctx.chrome._storage._listeners.length - 1];

    expect(() =>
      listener({ quiet_lounge_keyword_alerts: { newValue: '{broken-json' } }),
    ).not.toThrow();
    expect(doc.getElementById('keyword-alerts-list').textContent).toContain(
      '등록된 키워드 알림이 없습니다',
    );

    // 배열 아닌 valid JSON 도 빈 배열로 정규화.
    expect(() =>
      listener({ quiet_lounge_keyword_alerts: { newValue: '{"not":"array"}' } }),
    ).not.toThrow();
    expect(doc.getElementById('keyword-alerts-list').textContent).toContain(
      '등록된 키워드 알림이 없습니다',
    );
  });

  it('회귀 가드: 손상된 keywordAlerts 라도 export 가 throw 하지 않고 keywordAlerts:[] 으로 백업', async () => {
    const seed = { quiet_lounge_keyword_alerts: 'corrupted' };
    const ctx = await setupPopup({ seed });
    dom = ctx.dom;
    const doc = ctx.win.document;
    // export 클릭 시 throw 없이 keywordAlerts:[] 인 export 데이터 생성.
    let captured = null;
    ctx.win.URL.createObjectURL = (blob) => {
      blob.text().then((t) => {
        captured = t;
      });
      return 'blob:mock';
    };
    ctx.win.URL.revokeObjectURL = vi.fn();
    doc.getElementById('btn-export').click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(captured).toBeTruthy();
    const parsed = JSON.parse(captured);
    expect(parsed.keywordAlerts).toEqual([]);
  });
});
