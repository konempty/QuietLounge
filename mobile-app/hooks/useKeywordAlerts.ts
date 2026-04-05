import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const ALERTS_KEY = 'quiet_lounge_keyword_alerts';
const INTERVAL_KEY = 'quiet_lounge_alert_interval';
const LAST_CHECKED_KEY = 'quiet_lounge_alert_last_checked';

export interface KeywordAlert {
  id: string;
  channelId: string;
  channelName: string;
  keywords: string[];
  enabled: boolean;
  createdAt: string;
}

export interface KeywordAlertsContextType {
  alerts: KeywordAlert[];
  interval: number;
  addAlert: (channelId: string, channelName: string, keywords: string[]) => Promise<void>;
  removeAlert: (id: string) => Promise<void>;
  toggleAlert: (id: string, enabled: boolean) => Promise<void>;
  setInterval: (mins: number) => Promise<void>;
  exportData: () => { keywordAlerts?: KeywordAlert[]; alertInterval?: number } | null;
  importData: (data: { keywordAlerts?: KeywordAlert[]; alertInterval?: number }) => Promise<void>;
}

export const KeywordAlertsContext = createContext<KeywordAlertsContextType | null>(null);

export function useKeywordAlerts() {
  const ctx = useContext(KeywordAlertsContext);
  if (!ctx) throw new Error('useKeywordAlerts must be inside provider');
  return ctx;
}

export function useKeywordAlertsProvider(): KeywordAlertsContextType {
  const [alerts, setAlerts] = useState<KeywordAlert[]>([]);
  const [intervalMins, setIntervalMins] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const [rawAlerts, rawInterval] = await Promise.all([
        AsyncStorage.getItem(ALERTS_KEY),
        AsyncStorage.getItem(INTERVAL_KEY),
      ]);
      if (rawAlerts) setAlerts(JSON.parse(rawAlerts));
      if (rawInterval) setIntervalMins(parseInt(rawInterval) || 5);
    })();
  }, []);

  // 포그라운드 타이머 관리
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    checkKeywordAlerts();
    timerRef.current = setInterval(checkKeywordAlerts, intervalMins * 60 * 1000);
  }, [intervalMins]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 앱 상태 변화 감지 (포그라운드 복귀 시 즉시 체크)
  useEffect(() => {
    const hasEnabled = alerts.some((a) => a.enabled);
    if (hasEnabled) {
      startTimer();
    } else {
      stopTimer();
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasEnabled) {
        startTimer();
      } else if (state === 'background') {
        stopTimer();
      }
    });

    return () => {
      stopTimer();
      subscription.remove();
    };
  }, [alerts, startTimer, stopTimer]);

  const saveAlerts = useCallback(async (list: KeywordAlert[]) => {
    setAlerts(list);
    await AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(list));
  }, []);

  const addAlert = useCallback(
    async (channelId: string, channelName: string, keywords: string[]) => {
      const entry: KeywordAlert = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        channelId,
        channelName,
        keywords,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      await saveAlerts([...alerts, entry]);
    },
    [alerts, saveAlerts],
  );

  const removeAlert = useCallback(
    async (id: string) => {
      await saveAlerts(alerts.filter((a) => a.id !== id));
    },
    [alerts, saveAlerts],
  );

  const toggleAlert = useCallback(
    async (id: string, enabled: boolean) => {
      await saveAlerts(alerts.map((a) => (a.id === id ? { ...a, enabled } : a)));
    },
    [alerts, saveAlerts],
  );

  const setIntervalValue = useCallback(async (mins: number) => {
    const clamped = Math.max(1, Math.min(60, mins));
    setIntervalMins(clamped);
    await AsyncStorage.setItem(INTERVAL_KEY, String(clamped));
  }, []);

  const exportData = useCallback(() => {
    if (alerts.length === 0) return null;
    const result: { keywordAlerts: KeywordAlert[]; alertInterval?: number } = {
      keywordAlerts: alerts,
    };
    if (intervalMins !== 5) result.alertInterval = intervalMins;
    return result;
  }, [alerts, intervalMins]);

  const importData = useCallback(
    async (data: { keywordAlerts?: KeywordAlert[]; alertInterval?: number }) => {
      if (data.keywordAlerts && data.keywordAlerts.length > 0) {
        await saveAlerts(data.keywordAlerts);
      }
      if (data.alertInterval) {
        await setIntervalValue(data.alertInterval);
      }
    },
    [saveAlerts, setIntervalValue],
  );

  return {
    alerts,
    interval: intervalMins,
    addAlert,
    removeAlert,
    toggleAlert,
    setInterval: setIntervalValue,
    exportData,
    importData,
  };
}

// ── 키워드 체크 로직 ──

async function checkKeywordAlerts() {
  const rawAlerts = await AsyncStorage.getItem(ALERTS_KEY);
  if (!rawAlerts) return;

  const alerts: KeywordAlert[] = JSON.parse(rawAlerts);
  const enabled = alerts.filter((a) => a.enabled);
  if (enabled.length === 0) return;

  const rawLastChecked = await AsyncStorage.getItem(LAST_CHECKED_KEY);
  const lastChecked: Record<string, string> = rawLastChecked ? JSON.parse(rawLastChecked) : {};

  const channelAlerts: Record<string, KeywordAlert[]> = {};
  for (const alert of enabled) {
    if (!channelAlerts[alert.channelId]) channelAlerts[alert.channelId] = [];
    channelAlerts[alert.channelId].push(alert);
  }

  for (const [channelId, alertsForChannel] of Object.entries(channelAlerts)) {
    try {
      const newPosts = await fetchNewPosts(channelId, lastChecked[channelId]);
      if (newPosts.length === 0) continue;

      const postIds = newPosts.map((p) => p.postId);
      const titles = await fetchPostTitles(postIds);

      for (const post of titles) {
        for (const alert of alertsForChannel) {
          const matched = alert.keywords.find((kw) =>
            post.title.toLowerCase().includes(kw.toLowerCase()),
          );
          if (matched) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `[${alert.channelName}] 키워드 알림`,
                body: `"${matched}" — ${post.title}`,
                data: { postId: post.postId },
              },
              trigger: null,
            });
          }
        }
      }

      lastChecked[channelId] = newPosts[0].postId;
    } catch {
      // 네트워크 에러 무시
    }
  }

  await AsyncStorage.setItem(LAST_CHECKED_KEY, JSON.stringify(lastChecked));
}

// ── API ──

interface PostItem {
  postId: string;
  channelId?: string;
}

interface PostDetail {
  postId: string;
  title: string;
}

async function fetchNewPosts(channelId: string, lastPostId?: string): Promise<PostItem[]> {
  const url = `https://api.lounge.naver.com/discovery-api/v1/feed/channels/${channelId}/recent?limit=50`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const json = await resp.json();
  const items: PostItem[] = json.data?.items || [];

  if (!lastPostId) return items;

  const newItems: PostItem[] = [];
  for (const item of items) {
    if (item.postId === lastPostId) break;
    newItems.push(item);
  }
  return newItems;
}

async function fetchPostTitles(postIds: string[]): Promise<PostDetail[]> {
  if (postIds.length === 0) return [];
  const results: PostDetail[] = [];
  for (let i = 0; i < postIds.length; i += 50) {
    const batch = postIds.slice(i, i + 50);
    const params = batch.map((id) => `postIds=${id}`).join('&');
    const url = `https://api.lounge.naver.com/content-api/v1/posts?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const json = await resp.json();
    results.push(...(json.data || []));
  }
  return results;
}
