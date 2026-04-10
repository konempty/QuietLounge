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

  if (message.type === 'QL_KEYWORD_CHECK_NOW') {
    console.log('[QL][bg] CHECK_NOW triggered');
    setupKeywordAlarm()
      .then(() => checkKeywordAlerts())
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.warn('[QL][bg] CHECK_NOW failed', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      });
    return true;
  }

  if (message.type === 'QL_PROMPT_NOTIF_PERM') {
    console.log('[QL][bg] PROMPT_NOTIF_PERM triggered');
    promptPermissionOnLoungeTabs()
      .then((tabCount) => sendResponse({ ok: true, tabCount }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message.type === 'QL_NOTIFY_TEST') {
    console.log('[QL][bg] NOTIFY_TEST triggered');
    dispatchKeywordNotification(
      { channelName: '\ud14c\uc2a4\ud2b8' },
      { postId: 'test', title: '\ud14c\uc2a4\ud2b8 \uc54c\ub9bc\uc785\ub2c8\ub2e4' },
      'test',
    )
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

browser.runtime.onInstalled.addListener(() => {
  console.log('[QL][bg] onInstalled');
  setupKeywordAlarm();
});

// ──────────────────────────────────────────────────────────────────────────────
// 키워드 알림 (macOS Safari 전용 동작 — iOS는 storage bridge → 네이티브 앱이 처리)
//
// iOS popup은 storage-bridge.js를 통해 키워드 알림을 App Group UserDefaults로
// 저장하므로, iOS에서는 background의 browser.storage.local가 비어있다. 따라서
// 아래 로직은 platform 가드 없이 그냥 실행해도 iOS에서는 자동 no-op이 된다.
// (UA sniffing은 background page에서 신뢰성이 낮아 제거)
// ──────────────────────────────────────────────────────────────────────────────

const KEYWORD_ALERTS_KEY = 'quiet_lounge_keyword_alerts';
const ALERT_INTERVAL_KEY = 'quiet_lounge_alert_interval';
const ALERT_LAST_CHECKED_KEY = 'quiet_lounge_alert_last_checked';
const ALARM_NAME = 'quiet_lounge_keyword_check';

async function setupKeywordAlarm() {
  if (!browser.alarms) {
    console.warn('[QL][bg] browser.alarms unavailable');
    return;
  }
  try {
    const result = await browser.storage.local.get([KEYWORD_ALERTS_KEY, ALERT_INTERVAL_KEY]);
    const alerts = result[KEYWORD_ALERTS_KEY] ? JSON.parse(result[KEYWORD_ALERTS_KEY]) : [];
    const interval = Math.max(1, parseInt(result[ALERT_INTERVAL_KEY], 10) || 5);
    const hasEnabled = alerts.some((a) => a.enabled);

    await browser.alarms.clear(ALARM_NAME);
    if (hasEnabled) {
      browser.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      console.log(`[QL][bg] alarm registered: ${alerts.length} alerts, ${interval} min interval`);
    } else {
      console.log('[QL][bg] no enabled alerts → alarm cleared');
    }
  } catch (e) {
    console.warn('[QL][bg] setupKeywordAlarm failed', e);
  }
}

async function checkKeywordAlerts() {
  try {
    const result = await browser.storage.local.get([KEYWORD_ALERTS_KEY, ALERT_LAST_CHECKED_KEY]);
    const alerts = result[KEYWORD_ALERTS_KEY] ? JSON.parse(result[KEYWORD_ALERTS_KEY]) : [];
    const lastChecked = result[ALERT_LAST_CHECKED_KEY]
      ? JSON.parse(result[ALERT_LAST_CHECKED_KEY])
      : {};

    const enabledAlerts = alerts.filter((a) => a.enabled);
    console.log(`[QL][bg] checkKeywordAlerts → ${enabledAlerts.length} enabled`);
    if (enabledAlerts.length === 0) return;

    const channelAlerts = {};
    for (const alert of enabledAlerts) {
      if (!channelAlerts[alert.channelId]) channelAlerts[alert.channelId] = [];
      channelAlerts[alert.channelId].push(alert);
    }

    for (const [channelId, alertsForChannel] of Object.entries(channelAlerts)) {
      try {
        const newPosts = await fetchNewPosts(channelId, lastChecked[channelId]);
        console.log(
          `[QL][bg] channel ${channelId}: ${newPosts.length} new posts (lastChecked=${lastChecked[channelId] || 'none'})`,
        );
        if (newPosts.length === 0) continue;

        const postTitles = await fetchPostTitles(newPosts.map((p) => p.postId));
        console.log(`[QL][bg] fetched ${postTitles.length} titles`);
        for (const post of postTitles) {
          for (const alert of alertsForChannel) {
            const matched = alert.keywords.find((kw) =>
              post.title.toLowerCase().includes(kw.toLowerCase()),
            );
            if (matched) {
              console.log(`[QL][bg] match: "${matched}" in postId=${post.postId}`);
              await dispatchKeywordNotification(alert, post, matched);
            }
          }
        }

        lastChecked[channelId] = newPosts[0].postId;
      } catch (e) {
        console.warn(`[QL][bg] channel ${channelId} failed`, e);
      }
    }

    await browser.storage.local.set({
      [ALERT_LAST_CHECKED_KEY]: JSON.stringify(lastChecked),
    });
  } catch (e) {
    console.warn('[QL][bg] checkKeywordAlerts failed', e);
  }
}

async function fetchNewPosts(channelId, lastPostId) {
  const url = `https://api.lounge.naver.com/discovery-api/v1/feed/channels/${channelId}/recent?limit=50`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const json = await resp.json();
  const items = json.data?.items || [];
  if (!lastPostId) return items;

  const newItems = [];
  for (const item of items) {
    if (item.postId === lastPostId) break;
    newItems.push(item);
  }
  return newItems;
}

async function fetchPostTitles(postIds) {
  if (postIds.length === 0) return [];
  const results = [];
  for (let i = 0; i < postIds.length; i += 50) {
    const batch = postIds.slice(i, i + 50);
    const params = batch.map((id) => `postIds=${id}`).join('&');
    const url = `https://api.lounge.naver.com/content-api/v1/posts?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const json = await resp.json();
    const posts = json.data || [];
    results.push(...posts);
  }
  return results;
}

// 한국어 키워드가 들어간 식별자는 macOS 알림 시스템에서 silently dropped 되는 사례가
// 있어 hex로 인코딩한다. 클릭 핸들러는 두 번째 segment(postId)만 본다.
function hexEncode(str) {
  let out = '';
  const bytes = new TextEncoder().encode(str);
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// Safari Web Extension은 browser.notifications API 미구현이고, 익스텐션 origin
// (safari-web-extension://) 에서는 Notification.requestPermission()이 prompt를
// 띄우지 않고 즉시 denied로 떨어진다. 따라서 lounge.naver.com (HTTPS top-level)
// content script에 메시지를 보내 거기서 Web Notification을 띄운다.
// 추가로 툴바 뱃지에도 카운트를 표시해, 라운지 탭이 닫혀 있어도 사용자가 인지 가능.
let badgeCount = 0;

function bumpBadge(delta) {
  badgeCount += delta;
  try {
    browser.action.setBadgeText({ text: badgeCount > 0 ? String(badgeCount) : '' });
    browser.action.setBadgeBackgroundColor({ color: '#1FAF63' });
  } catch (e) {
    console.warn('[QL][bg] setBadge failed', e);
  }
}

function clearBadge() {
  badgeCount = 0;
  try {
    browser.action.setBadgeText({ text: '' });
  } catch {
    // 무시
  }
}

// Safari의 tabs.sendMessage 직렬화가 non-ASCII 문자를 망가뜨리는 사례가 있어
// 텍스트는 UTF-8 → base64로 감싸 전송하고 content script에서 디코드한다.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function dispatchKeywordNotification(alert, post, matchedKeyword) {
  // Safari가 JS 소스 파일을 Latin-1로 잘못 해석해 한글 리터럴이 메모리 시점에
  // 이미 깨지는 사례가 있어, 한글/em-dash 리터럴은 \u 이스케이프로 표기한다.
  // (\ud0a4\uc6cc\ub4dc \uc54c\ub9bc = "키워드 알림", \u2014 = em dash)
  const payload = {
    postId: post.postId,
    titleB64: utf8ToBase64(`[${alert.channelName}] \ud0a4\uc6cc\ub4dc \uc54c\ub9bc`),
    bodyB64: utf8ToBase64(`"${matchedKeyword}" \u2014 ${post.title}`),
    icon: browser.runtime.getURL('icons/icon128.png'),
  };

  // 라운지 탭에 메시지 전송 — 첫 성공 시 break
  let delivered = false;
  try {
    const tabs = await browser.tabs.query({ url: 'https://lounge.naver.com/*' });
    console.log(`[QL][bg] dispatch → ${tabs.length} lounge tab(s)`);
    for (const tab of tabs) {
      if (delivered) break;
      try {
        const resp = await new Promise((resolve) => {
          let settled = false;
          const done = (val) => {
            if (settled) return;
            settled = true;
            resolve(val);
          };
          try {
            const maybe = browser.tabs.sendMessage(
              tab.id,
              { type: 'QL_SHOW_NOTIFICATION', payload },
              (r) => done(r),
            );
            if (maybe && typeof maybe.then === 'function') {
              maybe.then(done, () => done(null));
            }
          } catch {
            done(null);
          }
          setTimeout(() => done(null), 1500);
        });
        if (resp && resp.ok) {
          delivered = true;
          console.log(`[QL][bg] notification delivered via tab ${tab.id}`);
        }
      } catch (e) {
        console.warn(`[QL][bg] sendMessage to tab ${tab.id} failed`, e);
      }
    }
  } catch (e) {
    console.warn('[QL][bg] tabs.query failed', e);
  }

  if (!delivered) {
    console.log('[QL][bg] no lounge tab accepted notification → badge fallback');
  }
  bumpBadge(1);
}

// 사용자가 익스텐션 아이콘 클릭하면 뱃지 초기화
if (browser.action?.onClicked) {
  browser.action.onClicked.addListener(() => {
    clearBadge();
  });
}

async function promptPermissionOnLoungeTabs() {
  let tabCount = 0;
  try {
    const tabs = await browser.tabs.query({ url: 'https://lounge.naver.com/*' });
    tabCount = tabs.length;
    console.log(`[QL][bg] prompt perm → ${tabCount} lounge tab(s)`);
    for (const tab of tabs) {
      try {
        browser.tabs.sendMessage(tab.id, { type: 'QL_PROMPT_NOTIF_PERM' });
      } catch (e) {
        console.warn(`[QL][bg] sendMessage to tab ${tab.id} failed`, e);
      }
    }
  } catch (e) {
    console.warn('[QL][bg] tabs.query failed', e);
  }
  return tabCount;
}

console.log(
  `[QL][bg] init — alarms=${!!browser.alarms} action=${!!browser.action} ua=${(typeof navigator !== 'undefined' && navigator.userAgent) || ''}`,
);

if (browser.alarms) {
  browser.alarms.onAlarm.addListener((alarm) => {
    console.log(`[QL][bg] alarm fired: ${alarm.name}`);
    if (alarm.name === ALARM_NAME) checkKeywordAlerts();
  });
}

if (browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    if (changes[KEYWORD_ALERTS_KEY] || changes[ALERT_INTERVAL_KEY]) {
      console.log('[QL][bg] keyword alerts/interval changed → re-setup alarm');
      setupKeywordAlarm();
    }
  });
}

// background page 재시작 시 알람 복원
setupKeywordAlarm();
