// chrome-extension/background/service-worker.js 의 실제 파일을 import 해
// chrome.* API 를 mock 한 환경에서 각 콜백을 invocation — 실제 커버리지 수집.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SW_PATH = path.resolve(
  process.cwd(),
  'chrome-extension/background/service-worker.js',
);

function mkChrome() {
  const runtimeOnMessageListeners = [];
  const alarmsListeners = [];
  const storageListeners = [];
  const notifClickListeners = [];

  return {
    _runtime: { onMessageListeners: runtimeOnMessageListeners, notifClickListeners },
    _alarmsListeners: alarmsListeners,
    _storageListeners: storageListeners,
    runtime: {
      onMessage: { addListener: (cb) => runtimeOnMessageListeners.push(cb) },
      onInstalled: { addListener: vi.fn() },
      getURL: (p) => `chrome-extension://abc/${p}`,
    },
    storage: {
      local: {
        _store: {},
        get: vi.fn(async function (keys) {
          const out = {};
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) if (k in this._store) out[k] = this._store[k];
          return out;
        }),
        set: vi.fn(async function (obj) {
          Object.assign(this._store, obj);
        }),
      },
      onChanged: { addListener: (cb) => storageListeners.push(cb) },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(async () => true),
      onAlarm: { addListener: (cb) => alarmsListeners.push(cb) },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    notifications: {
      create: vi.fn(),
      clear: vi.fn(),
      onClicked: { addListener: (cb) => notifClickListeners.push(cb) },
    },
    permissions: {
      contains: (req, cb) => cb(true),
    },
    tabs: {
      create: vi.fn(),
    },
  };
}

// service-worker.js 를 매 테스트마다 새로 import 해 상태를 리셋.
async function loadWorker() {
  // vitest 는 ESM import 지만 service-worker.js 는 script 형태.
  // fs 로 읽어 new Function 으로 실행 — 이렇게 해야 v8 coverage 가 파일을 인식.
  const fs = await import('node:fs/promises');
  const code = await fs.readFile(SW_PATH, 'utf8');
  // v8 coverage 가 경로 기반으로 수집하도록 sourceURL 지정
  const wrapped = `${code}\n//# sourceURL=${pathToFileURL(SW_PATH).href}\n`;
  // eslint-disable-next-line no-new-func
  const fn = new Function(wrapped);
  fn.call(globalThis);
}

describe('chrome service-worker', () => {
  beforeEach(() => {
    globalThis.chrome = mkChrome();
    globalThis.fetch = vi.fn();
  });

  it('로드 시 setupAlarm 호출 — 활성 alert 없으면 create 호출 안 함', async () => {
    await loadWorker();
    // setupAlarm 은 비동기 — 다음 마이크로태스크까지 대기
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.alarms.clear).toHaveBeenCalled();
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('활성 alert 있으면 알람 주기 설정', async () => {
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'c', channelName: 'n', keywords: ['k'], enabled: true },
      ]),
      quiet_lounge_alert_interval: 10,
    };
    await loadWorker();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'quiet_lounge_keyword_check',
      { periodInMinutes: 10 },
    );
  });

  it('활성 alert 있고 interval 이 60 초과면 60 으로 clamp', async () => {
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'c', channelName: 'n', keywords: ['k'], enabled: true },
      ]),
      quiet_lounge_alert_interval: 999,
    };
    await loadWorker();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'quiet_lounge_keyword_check',
      { periodInMinutes: 60 },
    );
  });

  it('활성 alert 있고 interval 이 1 미만이면 1 로 clamp', async () => {
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'c', channelName: 'n', keywords: ['k'], enabled: true },
      ]),
      quiet_lounge_alert_interval: 0,
    };
    await loadWorker();
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'quiet_lounge_keyword_check',
      { periodInMinutes: 1 },
    );
  });

  it('UPDATE_BADGE 메시지 → 뱃지 렌더', async () => {
    await loadWorker();
    const listener = chrome._runtime.onMessageListeners[0];
    listener(
      { type: 'UPDATE_BADGE', count: 3 },
      { tab: { id: 77 } },
      () => {},
    );
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      text: '3',
      tabId: 77,
    });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalled();
  });

  it('UPDATE_BADGE count 0 → 빈 문자열', async () => {
    await loadWorker();
    const listener = chrome._runtime.onMessageListeners[0];
    listener({ type: 'UPDATE_BADGE', count: 0 }, { tab: { id: 1 } }, () => {});
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      text: '',
      tabId: 1,
    });
  });

  it('FETCH_CATEGORIES — fetch 결과를 sendResponse 로 전달', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'cat1' }] }),
    }));
    await loadWorker();
    // 메시지 리스너 index: 0 = UPDATE_BADGE, 1 = message handler (FETCH_CATEGORIES / FETCH_CHANNELS / CHECK_KEYWORD_NOW)
    const handlers = chrome._runtime.onMessageListeners;
    const sendResponse = vi.fn();
    const returned = handlers[1](
      { type: 'FETCH_CATEGORIES' },
      {},
      sendResponse,
    );
    expect(returned).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith({ data: [{ id: 'cat1' }] });
  });

  it('FETCH_CATEGORIES — fetch 실패 시 error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('boom');
    });
    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    const sendResponse = vi.fn();
    handlers[1]({ type: 'FETCH_CATEGORIES' }, {}, sendResponse);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith({ error: 'boom' });
  });

  it('FETCH_CHANNELS — 페이지네이션으로 모든 채널 모음', async () => {
    // size=50 hardcoded — hasMore 분기를 타려면 totalElements > 50
    let page = 0;
    globalThis.fetch = vi.fn(async () => {
      page++;
      const items =
        page === 1
          ? Array.from({ length: 50 }, (_, i) => ({ id: `p1-${i}` }))
          : [{ id: 'p2-0' }];
      return {
        ok: true,
        json: async () => ({ data: { items, page: { totalElements: 51 } } }),
      };
    });
    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    const sendResponse = vi.fn();
    handlers[1]({ type: 'FETCH_CHANNELS', categoryId: 'cat1' }, {}, sendResponse);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledOnce();
    const resp = sendResponse.mock.calls[0][0];
    expect(resp.data).toHaveLength(51);
    expect(resp.data[50]).toEqual({ id: 'p2-0' });
  });

  it('CHECK_KEYWORD_NOW — 매칭된 글이 있으면 notification 발생', async () => {
    globalThis.chrome = mkChrome();
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'ch1', channelName: '채널', keywords: ['BTS'], enabled: true },
      ]),
      quiet_lounge_alert_last_checked: JSON.stringify({
        ch1: '2020-01-01T00:00:00Z',
      }),
    };

    let step = 0;
    globalThis.fetch = vi.fn(async () => {
      step++;
      if (step === 1) {
        // fetchRecentPostIds
        return {
          ok: true,
          json: async () => ({ data: { items: [{ postId: 'p1' }] } }),
        };
      }
      // fetchPostTitles
      return {
        ok: true,
        json: async () => ({
          data: [
            { postId: 'p1', title: 'BTS 신곡', createTime: '2030-04-10T00:00:00Z' },
          ],
        }),
      };
    });

    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    const sendResponse = vi.fn();
    handlers[1]({ type: 'CHECK_KEYWORD_NOW' }, {}, sendResponse);

    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    expect(chrome.notifications.create).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  // URL 패턴 매칭 fetch mock — step 카운터에 의존하지 않아 fetch 호출 순서가 바뀌어도 견고.
  // /recent 엔드포인트는 postId 목록, 그 외(content-api/posts 등)는 상세 반환.
  function mkKeywordFetch({ recentPostIds, details }) {
    return vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('/recent')) {
        return {
          ok: true,
          json: async () => ({ data: { items: recentPostIds.map((id) => ({ postId: id })) } }),
        };
      }
      return { ok: true, json: async () => ({ data: details }) };
    });
  }

  it('CHECK_KEYWORD_NOW — 혼재된 ISO 포맷에서도 실제 최신 시각으로 lastChecked 저장', async () => {
    globalThis.chrome = mkChrome();
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'ch1', channelName: '채널', keywords: ['공지'], enabled: true },
      ]),
      quiet_lounge_alert_last_checked: JSON.stringify({
        ch1: '2020-01-01T00:00:00Z',
      }),
    };

    globalThis.fetch = mkKeywordFetch({
      recentPostIds: ['p1', 'p2'],
      details: [
        { postId: 'p1', title: '공지 A', createTime: '2026-04-01T00:00:00+09:00' },
        { postId: 'p2', title: '공지 B', createTime: '2026-04-01T00:00:00Z' },
      ],
    });

    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    handlers[1]({ type: 'CHECK_KEYWORD_NOW' }, {}, vi.fn());
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(chrome.storage.local._store.quiet_lounge_alert_last_checked);
    expect(stored.ch1).toBe('2026-04-01T00:00:00Z');
  });

  it('CHECK_KEYWORD_NOW — notifications 권한 없으면 create 생략', async () => {
    globalThis.chrome = mkChrome();
    globalThis.chrome.permissions.contains = (_req, cb) => cb(false);
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'ch1', channelName: '채널', keywords: ['공지'], enabled: true },
      ]),
      quiet_lounge_alert_last_checked: JSON.stringify({
        ch1: '2020-01-01T00:00:00Z',
      }),
    };

    globalThis.fetch = mkKeywordFetch({
      recentPostIds: ['p1'],
      details: [{ postId: 'p1', title: '공지', createTime: '2030-01-01T00:00:00Z' }],
    });

    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    handlers[1]({ type: 'CHECK_KEYWORD_NOW' }, {}, vi.fn());
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));

    expect(chrome.notifications.create).not.toHaveBeenCalled();
    const stored = JSON.parse(chrome.storage.local._store.quiet_lounge_alert_last_checked);
    expect(stored.ch1).toBe('2030-01-01T00:00:00Z');
  });

  it('CHECK_KEYWORD_NOW — 활성 alert 없으면 no-op', async () => {
    globalThis.chrome = mkChrome();
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([]),
    };
    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    const sendResponse = vi.fn();
    handlers[1]({ type: 'CHECK_KEYWORD_NOW' }, {}, sendResponse);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('CHECK_KEYWORD_NOW — 네트워크 실패해도 전체는 계속', async () => {
    globalThis.chrome = mkChrome();
    globalThis.chrome.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { id: 'a', channelId: 'ch1', channelName: '채널', keywords: ['k'], enabled: true },
      ]),
    };
    globalThis.fetch = vi.fn(async () => {
      throw new Error('net');
    });
    await loadWorker();
    const handlers = chrome._runtime.onMessageListeners;
    const sendResponse = vi.fn();
    handlers[1]({ type: 'CHECK_KEYWORD_NOW' }, {}, sendResponse);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('알람 fire → checkKeywordAlerts', async () => {
    await loadWorker();
    const alarmListener = chrome._alarmsListeners[0];
    // 다른 이름 알람은 무시
    alarmListener({ name: 'other' });
    // 맞는 이름은 실행 (에러 없으면 OK)
    alarmListener({ name: 'quiet_lounge_keyword_check' });
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.storage.local.get).toHaveBeenCalled();
  });

  it('storage onChanged — alerts 변경 시 setupAlarm', async () => {
    await loadWorker();
    const listener = chrome._storageListeners[0];
    chrome.alarms.clear.mockClear();
    listener({ quiet_lounge_keyword_alerts: { newValue: '[]' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(chrome.alarms.clear).toHaveBeenCalled();
  });

  it('storage onChanged — 관련 없는 키 변경은 무시', async () => {
    await loadWorker();
    const listener = chrome._storageListeners[0];
    chrome.alarms.clear.mockClear();
    listener({ unrelated_key: { newValue: 'x' } });
    expect(chrome.alarms.clear).not.toHaveBeenCalled();
  });

  it('notification click — 글로 이동', async () => {
    await loadWorker();
    const listener = chrome._runtime.notifClickListeners[0];
    listener('ql_kw_post123_keyword');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://lounge.naver.com/posts/post123',
    });
    expect(chrome.notifications.clear).toHaveBeenCalledWith(
      'ql_kw_post123_keyword',
    );
  });

  it('notification click — ql_kw_ 이외 prefix 는 무시', async () => {
    await loadWorker();
    const listener = chrome._runtime.notifClickListeners[0];
    chrome.tabs.create.mockClear();
    listener('something_else');
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
