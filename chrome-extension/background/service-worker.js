// QuietLounge — Background Service Worker

const KEYWORD_ALERTS_KEY = 'quiet_lounge_keyword_alerts';
const ALERT_INTERVAL_KEY = 'quiet_lounge_alert_interval';
const ALERT_LAST_CHECKED_KEY = 'quiet_lounge_alert_last_checked';
const ALARM_NAME = 'quiet_lounge_keyword_check';

// ISO 문자열 배열에서 파싱된 timestamp 기준 max 값을 반환.
// sort().pop() 는 사전순 정렬이라 `+09:00` / `Z` / fractional seconds 가 섞이면 오답이 나올 수 있음.
function pickMaxIsoDate(candidates) {
  let bestIso = null;
  let bestTs = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const ts = Date.parse(c);
    if (Number.isFinite(ts) && ts > bestTs) {
      bestTs = ts;
      bestIso = c;
    }
  }
  return bestIso;
}

// ── 뱃지 업데이트 ──
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'UPDATE_BADGE') {
    const count = message.count;
    const text = count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ text, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: sender.tab?.id });
  }
});

// ── 알람 설정/해제 ──
async function setupAlarm() {
  const result = await chrome.storage.local.get([KEYWORD_ALERTS_KEY, ALERT_INTERVAL_KEY]);
  const alerts = result[KEYWORD_ALERTS_KEY] ? JSON.parse(result[KEYWORD_ALERTS_KEY]) : [];
  const rawInterval = result[ALERT_INTERVAL_KEY];
  // README 문서상 허용 범위 1~60 분. 저장된 값이 범위를 벗어나 있어도 정상 폴링을 보장.
  const interval = Math.min(60, Math.max(1, Number.isFinite(rawInterval) ? Math.round(rawInterval) : 5));

  const hasEnabled = alerts.some((a) => a.enabled);

  await chrome.alarms.clear(ALARM_NAME);
  if (hasEnabled) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
  }
}

// ── 키워드 체크 로직 ──
async function checkKeywordAlerts() {
  const result = await chrome.storage.local.get([KEYWORD_ALERTS_KEY, ALERT_LAST_CHECKED_KEY]);
  const alerts = result[KEYWORD_ALERTS_KEY] ? JSON.parse(result[KEYWORD_ALERTS_KEY]) : [];
  const lastChecked = result[ALERT_LAST_CHECKED_KEY]
    ? JSON.parse(result[ALERT_LAST_CHECKED_KEY])
    : {};

  const enabledAlerts = alerts.filter((a) => a.enabled);
  if (enabledAlerts.length === 0) return;

  // 채널별로 그룹핑
  const channelAlerts = {};
  for (const alert of enabledAlerts) {
    if (!channelAlerts[alert.channelId]) {
      channelAlerts[alert.channelId] = [];
    }
    channelAlerts[alert.channelId].push(alert);
  }

  for (const [channelId, alertsForChannel] of Object.entries(channelAlerts)) {
    try {
      const recentIds = await fetchRecentPostIds(channelId);
      if (recentIds.length === 0) continue;

      // 제목 + createTime 가져오기
      const details = await fetchPostTitles(recentIds);
      if (details.length === 0) continue;

      // lastChecked 는 ISO timestamp — 그보다 나중 글만 새 글로 간주
      const lastTs = lastChecked[channelId] ? Date.parse(lastChecked[channelId]) : 0;

      // 키워드 매칭
      for (const post of details) {
        const createTs = post.createTime ? Date.parse(post.createTime) : 0;
        if (!createTs || createTs <= lastTs) continue;
        for (const alert of alertsForChannel) {
          const matched = alert.keywords.find((kw) =>
            post.title.toLowerCase().includes(kw.toLowerCase()),
          );
          if (matched) {
            await showNotification(alert, post, matched);
          }
        }
      }

      // lastChecked 를 가장 최신 글 시점으로 전진 (매칭 여부 무관) —
      // postId 기반의 "기준 글 삭제 시 전체를 새 글로 간주" 문제 해결.
      // ISO 포맷이 혼재해도 올바르게 비교하도록 Date.parse 기반 비교.
      const maxCreate = pickMaxIsoDate(details.map((p) => p.createTime));
      if (maxCreate) lastChecked[channelId] = maxCreate;
    } catch (e) {
      console.error(`[QuietLounge] 키워드 체크 실패 (${channelId}):`, e);
    }
  }

  await chrome.storage.local.set({
    [ALERT_LAST_CHECKED_KEY]: JSON.stringify(lastChecked),
  });
}

// 채널의 최신 글 postId 목록만 가져오기
async function fetchRecentPostIds(channelId) {
  const url = `https://api.lounge.naver.com/discovery-api/v1/feed/channels/${channelId}/recent?limit=50`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const json = await resp.json();
  const items = json.data?.items || [];
  return items.map((item) => item.postId).filter(Boolean);
}

// 글 제목 가져오기 (최대 50개씩 배치)
async function fetchPostTitles(postIds) {
  if (postIds.length === 0) return [];

  const results = [];
  // 50개씩 나눠서 요청
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

// 알림 표시
async function showNotification(alert, post, matchedKeyword) {
  // notifications 권한이 없으면 무시
  const hasPermission = await new Promise((resolve) => {
    chrome.permissions.contains({ permissions: ['notifications'] }, resolve);
  });
  if (!hasPermission) return;

  const notifId = `ql_kw_${post.postId}_${matchedKeyword}`;
  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `[${alert.channelName}] 키워드 알림`,
    message: `"${matchedKeyword}" — ${post.title}`,
    contextMessage: 'QuietLounge 키워드 알림',
    priority: 2,
  });
}

// 알림 클릭 시 해당 글 열기 (optional permission이므로 존재 여부 확인)
if (chrome.notifications) {
  chrome.notifications.onClicked.addListener((notifId) => {
    if (notifId.startsWith('ql_kw_')) {
      const postId = notifId.split('_')[2];
      if (postId) {
        chrome.tabs.create({ url: `https://lounge.naver.com/posts/${postId}` });
      }
      chrome.notifications.clear(notifId);
    }
  });
}

// ── 알람 이벤트 ──
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkKeywordAlerts();
  }
});

// ── 스토리지 변경 감지 → 알람 재설정 ──
chrome.storage.onChanged.addListener((changes) => {
  if (changes[KEYWORD_ALERTS_KEY] || changes[ALERT_INTERVAL_KEY]) {
    setupAlarm();
  }
});

// ── 메시지 핸들러 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_CATEGORIES') {
    fetch('https://api.lounge.naver.com/content-api/v1/categories?depth=2')
      .then((r) => r.json())
      .then((json) => sendResponse({ data: json.data }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'FETCH_CHANNELS') {
    fetchAllChannels(message.categoryId)
      .then((channels) => sendResponse({ data: channels }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }

  if (message.type === 'CHECK_KEYWORD_NOW') {
    checkKeywordAlerts()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
});

// 카테고리의 모든 채널을 페이지네이션으로 가져오기
async function fetchAllChannels(categoryId) {
  const channels = [];
  let page = 1;
  const size = 50;

  let hasMore = true;
  while (hasMore) {
    const url = `https://api.lounge.naver.com/content-api/v1/channels?categoryId=${categoryId}&page=${page}&size=${size}`;
    const resp = await fetch(url);
    if (!resp.ok) break;
    const json = await resp.json();
    const items = json.data?.items || [];
    channels.push(...items);

    const pageInfo = json.data?.page;
    if (!pageInfo || page * size >= pageInfo.totalElements) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return channels;
}

// ── 초기화 ──
chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
});

// 서비스 워커 재시작 시에도 알람 복원
setupAlarm();
