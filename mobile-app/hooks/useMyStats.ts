import { useState, useEffect, useCallback } from 'react';

interface MyStats {
  nickname: string;
  totalPosts: number;
  totalComments: number;
  monthlyPosts: number | string;
  monthlyComments: string;
}

const API_BASE = 'https://api.lounge.naver.com';

async function fetchMonthlyPosts(personaId: string, monthStart: Date): Promise<number> {
  let count = 0;
  let cursor = '';

  for (let page = 0; page < 50; page++) {
    try {
      const url = `${API_BASE}/user-api/v1/personas/${personaId}/activities/posts?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) break;
      const json = await resp.json();
      const items = json.data?.items || [];
      if (items.length === 0) break;

      const ids = items.map((item: { postId: string }) => item.postId);
      const params = ids.map((id: string) => `postIds=${id}`).join('&');
      const detailResp = await fetch(`${API_BASE}/content-api/v1/posts?${params}`, {
        credentials: 'include',
      });
      if (!detailResp.ok) break;
      const detailJson = await detailResp.json();
      const details = Array.isArray(detailJson.data) ? detailJson.data : [];

      let hasThisMonth = false;
      for (const item of details) {
        const dateStr = item.createTime || '';
        if (dateStr && new Date(dateStr) >= monthStart) {
          count++;
          hasThisMonth = true;
        }
      }

      if (!hasThisMonth) break;
      if (!json.data?.cursorInfo?.hasNext) break;
      cursor = json.data?.cursorInfo?.endCursor || '';
      if (!cursor) break;
    } catch {
      break;
    }
  }
  return count;
}

export function useMyStats() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 1단계: me API로 personaId
      const meResp = await fetch(`${API_BASE}/user-api/v1/members/me/personas`, {
        credentials: 'include',
      });
      if (!meResp.ok) {
        setStats(null);
        return;
      }
      const meJson = await meResp.json();
      const meData = Array.isArray(meJson.data) ? meJson.data[0] : meJson.data;
      if (!meData?.personaId) {
        setStats(null);
        return;
      }

      // 2단계: personas API로 총 수
      const statsResp = await fetch(`${API_BASE}/user-api/v1/personas/${meData.personaId}`, {
        credentials: 'include',
      });
      if (!statsResp.ok) {
        setStats(null);
        return;
      }
      const statsJson = await statsResp.json();
      const data = statsJson.data;
      if (!data) {
        setStats(null);
        return;
      }

      const totalPosts = data.totalPostCount || 0;
      const totalComments = data.totalCommentCount || 0;

      // 총 수 먼저 반영
      setStats({
        nickname: data.nickname || '',
        totalPosts,
        totalComments,
        monthlyPosts: '...',
        monthlyComments: '-',
      });

      // 이번달 카운트
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const createTime = data.createTime ? new Date(data.createTime) : null;
      const createdThisMonth = createTime && createTime >= monthStart;

      let monthlyPosts: number | string;
      if (createdThisMonth) {
        monthlyPosts = totalPosts;
      } else {
        monthlyPosts = await fetchMonthlyPosts(meData.personaId, monthStart);
      }

      setStats({
        nickname: data.nickname || '',
        totalPosts,
        totalComments,
        monthlyPosts,
        monthlyComments: '-',
      });
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, refresh };
}
