// safari-extension background page 의 실제 파일을 import 해
// browser.* API 를 mock 한 환경에서 각 콜백을 invocation — 실제 커버리지 수집.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SW_PATH = path.resolve(
  process.cwd(),
  'safari-extension/QuietLounge/Shared (Extension)/Resources/background/service-worker.js',
);

function mkBrowser() {
  const runtimeOnMessageListeners = [];
  const onInstalledListeners = [];
  const alarmsListeners = [];
  const storageListeners = [];
  const actionClickedListeners = [];

  return {
    _runtime: {
      onMessageListeners: runtimeOnMessageListeners,
      onInstalledListeners,
    },
    _alarmsListeners: alarmsListeners,
    _storageListeners: storageListeners,
    _actionClickedListeners: actionClickedListeners,
    runtime: {
      onMessage: { addListener: (cb) => runtimeOnMessageListeners.push(cb) },
      onInstalled: { addListener: (cb) => onInstalledListeners.push(cb) },
      sendNativeMessage: vi.fn((appId, payload, cb) => {
        // 비동기 응답 시뮬레이션
        setTimeout(() => cb({ ok: true, data: payload }), 0);
      }),
      getURL: (p) => `safari-web-extension://abc/${p}`,
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
      onClicked: { addListener: (cb) => actionClickedListeners.push(cb) },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  };
}

async function loadWorker() {
  const fs = await import('node:fs/promises');
  const code = await fs.readFile(SW_PATH, 'utf8');
  const wrapped = `${code}\n//# sourceURL=${pathToFileURL(SW_PATH).href}\n`;
  // eslint-disable-next-line no-new-func
  const fn = new Function(wrapped);
  fn.call(globalThis);
  // setupKeywordAlarm / console.log 마이크로태스크 flush
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('safari service-worker', () => {
  beforeEach(() => {
    globalThis.browser = mkBrowser();
    globalThis.chrome = undefined;
    globalThis.fetch = vi.fn();
    // console.log 억제 (테스트 출력 오염 방지)
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('초기 로드 — 활성 alert 없으면 알람 생성 안 함', async () => {
    await loadWorker();
    expect(browser.alarms.clear).toHaveBeenCalled();
    expect(browser.alarms.create).not.toHaveBeenCalled();
  });

  it('활성 alert 있으면 주기 설정', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { channelId: 'c', channelName: 'n', keywords: ['k'], enabled: true },
      ]),
      quiet_lounge_alert_interval: '7',
    };
    await loadWorker();
    expect(browser.alarms.create).toHaveBeenCalledWith(
      'quiet_lounge_keyword_check',
      { periodInMinutes: 7 },
    );
  });

  it('활성 alert 있고 interval 이 60 초과면 60 으로 clamp', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { channelId: 'c', channelName: 'n', keywords: ['k'], enabled: true },
      ]),
      quiet_lounge_alert_interval: '999',
    };
    await loadWorker();
    expect(browser.alarms.create).toHaveBeenCalledWith(
      'quiet_lounge_keyword_check',
      { periodInMinutes: 60 },
    );
  });

  it('활성 alert 있고 interval 이 1 미만이면 1 로 clamp', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { channelId: 'c', channelName: 'n', keywords: ['k'], enabled: true },
      ]),
      quiet_lounge_alert_interval: '0',
    };
    await loadWorker();
    expect(browser.alarms.create).toHaveBeenCalledWith(
      'quiet_lounge_keyword_check',
      { periodInMinutes: 1 },
    );
  });

  it('알람 fire → checkKeywordAlerts 실행', async () => {
    await loadWorker();
    const listener = browser._alarmsListeners[0];
    listener({ name: 'other' });
    listener({ name: 'quiet_lounge_keyword_check' });
    await new Promise((r) => setTimeout(r, 0));
    expect(browser.storage.local.get).toHaveBeenCalled();
  });

  it('onInstalled → setupKeywordAlarm', async () => {
    await loadWorker();
    browser.alarms.clear.mockClear();
    browser._runtime.onInstalledListeners[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(browser.alarms.clear).toHaveBeenCalled();
  });

  it('onChanged — alerts 변경 시 setup 재실행', async () => {
    await loadWorker();
    browser.alarms.clear.mockClear();
    browser._storageListeners[0](
      { quiet_lounge_keyword_alerts: { newValue: '[]' } },
      'local',
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(browser.alarms.clear).toHaveBeenCalled();
  });

  it('onChanged — local 이외 area 는 무시', async () => {
    await loadWorker();
    browser.alarms.clear.mockClear();
    browser._storageListeners[0](
      { quiet_lounge_keyword_alerts: { newValue: '[]' } },
      'sync',
    );
    expect(browser.alarms.clear).not.toHaveBeenCalled();
  });

  it('UPDATE_BADGE 메시지 → 뱃지 렌더', async () => {
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    listener(
      { type: 'UPDATE_BADGE', count: 5 },
      { tab: { id: 42 } },
      () => {},
    );
    expect(browser.action.setBadgeText).toHaveBeenCalledWith({
      text: '5',
      tabId: 42,
    });
    expect(browser.action.setBadgeBackgroundColor).toHaveBeenCalled();
  });

  it('UPDATE_BADGE count=0 → 빈 문자열', async () => {
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    listener({ type: 'UPDATE_BADGE', count: 0 }, { tab: { id: 1 } }, () => {});
    expect(browser.action.setBadgeText).toHaveBeenCalledWith({
      text: '',
      tabId: 1,
    });
  });

  it('QL_STORAGE_GET 브릿지 — native 응답 릴레이', async () => {
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    const returned = listener(
      { type: 'QL_STORAGE_GET', keys: ['k1'] },
      {},
      sendResponse,
    );
    expect(returned).toBe(true);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
  });

  it('QL_STORAGE_SET — sendNativeMessage 로 위임', async () => {
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener(
      { type: 'QL_STORAGE_SET', items: { a: 1 } },
      {},
      sendResponse,
    );
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(browser.runtime.sendNativeMessage).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
  });

  it('QL_STORAGE_GET — native 에러 전파', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.runtime.sendNativeMessage = vi.fn((_a, _p, cb) => {
      setTimeout(() => cb({}), 0);
      globalThis.browser.runtime.lastError = { message: 'native boom' };
    });
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_STORAGE_GET', keys: ['k'] }, {}, sendResponse);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
    delete browser.runtime.lastError;
  });

  it('REFRESH_MY_STATS — 라운지 탭에 브로드캐스트', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.tabs.query = vi.fn((_q, cb) => {
      cb([{ id: 11 }, { id: 22 }]);
    });
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    listener({ type: 'REFRESH_MY_STATS' }, {}, () => {});
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(11, {
      type: 'REFRESH_MY_STATS',
    });
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(22, {
      type: 'REFRESH_MY_STATS',
    });
  });

  it('비 object 메시지는 무시', async () => {
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    // return undefined 이어야 함 (no throw)
    expect(() => listener(null, {}, () => {})).not.toThrow();
    expect(() => listener('string', {}, () => {})).not.toThrow();
  });

  it('QL_KEYWORD_CHECK_NOW — setup + check 실행', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { channelId: 'c1', channelName: '채널', keywords: ['BTS'], enabled: true },
      ]),
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          items: [{ postId: 'p1' }],
        },
      }),
    }));
    // 두 번째 fetch는 post titles
    let callIdx = 0;
    globalThis.fetch = vi.fn(async () => {
      callIdx++;
      if (callIdx === 1) {
        return {
          ok: true,
          json: async () => ({ data: { items: [{ postId: 'p1' }] } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              postId: 'p1',
              title: 'BTS 신곡',
              createTime: '2099-04-10T00:00:00Z',
            },
          ],
        }),
      };
    });
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_KEYWORD_CHECK_NOW' }, {}, sendResponse);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
  });

  // URL 패턴 매칭 fetch mock — call index 에 의존하지 않아 호출 순서가 바뀌어도 견고.
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

  it('QL_KEYWORD_CHECK_NOW — 혼재된 ISO 포맷에서도 실제 최신 시각으로 lastChecked 저장', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { channelId: 'c1', channelName: '채널', keywords: ['공지'], enabled: true },
      ]),
      quiet_lounge_alert_last_checked: JSON.stringify({
        c1: '2020-01-01T00:00:00Z',
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
    const listener = browser._runtime.onMessageListeners[0];
    listener({ type: 'QL_KEYWORD_CHECK_NOW' }, {}, vi.fn());
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    const stored = JSON.parse(browser.storage.local._store.quiet_lounge_alert_last_checked);
    expect(stored.c1).toBe('2026-04-01T00:00:00Z');
  });

  it('QL_KEYWORD_CHECK_NOW — lastChecked 와 같거나 이전 글은 알림 전송 안 함', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.storage.local._store = {
      quiet_lounge_keyword_alerts: JSON.stringify([
        { channelId: 'c1', channelName: '채널', keywords: ['공지'], enabled: true },
      ]),
      quiet_lounge_alert_last_checked: JSON.stringify({
        c1: '2026-04-01T00:00:00Z',
      }),
    };
    globalThis.browser.tabs.query = vi.fn(async () => [{ id: 99 }]);

    globalThis.fetch = mkKeywordFetch({
      recentPostIds: ['p1'],
      details: [{ postId: 'p1', title: '공지', createTime: '2026-04-01T00:00:00Z' }],
    });

    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    listener({ type: 'QL_KEYWORD_CHECK_NOW' }, {}, vi.fn());
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    expect(browser.tabs.sendMessage).not.toHaveBeenCalledWith(
      99,
      expect.objectContaining({ type: 'QL_SHOW_NOTIFICATION' }),
      expect.any(Function),
    );
    const stored = JSON.parse(browser.storage.local._store.quiet_lounge_alert_last_checked);
    expect(stored.c1).toBe('2026-04-01T00:00:00Z');
  });

  it('QL_NOTIFY_TEST — dispatchKeywordNotification 호출 + 뱃지 +1', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.tabs.query = vi.fn(async () => []);
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_NOTIFY_TEST' }, {}, sendResponse);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
    expect(browser.action.setBadgeText).toHaveBeenCalled();
  });

  it('QL_NOTIFY_TEST — 탭에 전달 성공 시 delivered 경로', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.tabs.query = vi.fn(async () => [{ id: 99 }]);
    globalThis.browser.tabs.sendMessage = vi.fn((_tabId, _msg, cb) => {
      cb && cb({ ok: true });
      return Promise.resolve({ ok: true });
    });
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_NOTIFY_TEST' }, {}, sendResponse);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    expect(browser.tabs.sendMessage).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
  });

  it('QL_PROMPT_NOTIF_PERM — tabCount 반환', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.tabs.query = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_PROMPT_NOTIF_PERM' }, {}, sendResponse);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, tabCount: 2 }),
    );
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('action onClicked → 뱃지 클리어', async () => {
    await loadWorker();
    browser.action.setBadgeText.mockClear();
    browser._actionClickedListeners[0]();
    expect(browser.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('sendNative — api 가 없으면 reject', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.runtime.sendNativeMessage = undefined;
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_STORAGE_GET', keys: ['k'] }, {}, sendResponse);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
  });

  it('sendNative — Promise 반환 api 도 지원', async () => {
    globalThis.browser = mkBrowser();
    globalThis.browser.runtime.sendNativeMessage = vi.fn(() =>
      Promise.resolve({ via: 'promise' }),
    );
    await loadWorker();
    const listener = browser._runtime.onMessageListeners[0];
    const sendResponse = vi.fn();
    listener({ type: 'QL_STORAGE_SET', items: {} }, {}, sendResponse);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
  });
});
