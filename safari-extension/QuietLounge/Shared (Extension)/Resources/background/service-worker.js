// QuietLounge — Background Page (non-persistent)
// Safari MV3 service worker에서는 sendNativeMessage가 노출되지 않으므로
// manifest에서 background.scripts 형식을 사용 (Safari가 background page로 로드).

const browser = globalThis.browser || globalThis.chrome;

// Safari Web Extension에서 native handler로 전달.
// 컨테이닝 앱 번들 ID — Safari에서는 이 값이 무시되긴 하지만 형식상 전달.
const NATIVE_APP_ID = 'kr.konempty.quietlounge';

function sendNative(payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (val) => {
      if (settled) return;
      settled = true;
      resolve(val || {});
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    // browser → chrome 순으로 fallback
    const api =
      browser?.runtime?.sendNativeMessage || globalThis.chrome?.runtime?.sendNativeMessage;
    if (typeof api !== 'function') {
      fail(new Error('sendNativeMessage unavailable in this context'));
      return;
    }

    try {
      const maybe = api.call(
        browser?.runtime || globalThis.chrome.runtime,
        NATIVE_APP_ID,
        payload,
        (response) => {
          const err = browser?.runtime?.lastError || globalThis.chrome?.runtime?.lastError;
          if (err) {
            fail(err);
            return;
          }
          ok(response);
        },
      );
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(ok, fail);
      }
    } catch (e) {
      fail(e);
    }
  });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  // ── Storage 브릿지 ──
  if (
    message.type === 'QL_STORAGE_GET' ||
    message.type === 'QL_STORAGE_SET' ||
    message.type === 'QL_STORAGE_REMOVE'
  ) {
    const nativeType = message.type.replace('QL_', '');
    sendNative({ type: nativeType, keys: message.keys, items: message.items })
      .then((response) => sendResponse({ ok: true, response }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // async sendResponse
  }

  if (message.type === 'UPDATE_BADGE') {
    const count = message.count;
    const text = count > 0 ? String(count) : '';
    browser.action.setBadgeText({ text, tabId: sender.tab?.id });
    browser.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: sender.tab?.id });
    return;
  }

  if (message.type === 'REFRESH_MY_STATS') {
    browser.tabs.query({ url: 'https://lounge.naver.com/*' }, (tabs) => {
      for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, { type: 'REFRESH_MY_STATS' }).catch(() => {});
      }
    });
    return;
  }
});

browser.runtime.onInstalled.addListener(() => {});
