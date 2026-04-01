import { useState, useEffect, useCallback, useRef } from 'react';

interface MyStats {
  nickname: string;
  totalPosts: number;
  totalComments: number;
  monthlyPosts: number | string;
  monthlyComments: number | string;
}

const API_BASE = 'https://api.lounge.naver.com';

async function fetchMonthlyCount(
  personaId: string,
  type: 'posts' | 'comments',
  monthStart: Date,
): Promise<number> {
  let count = 0;
  let cursor = '';
  const isComments = type === 'comments';

  for (let page = 0; page < 50; page++) {
    try {
      const actUrl = `${API_BASE}/user-api/v1/personas/${personaId}/activities/${type}?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
      const actResp = await fetch(actUrl, { credentials: 'include' });
      if (!actResp.ok) break;
      const actJson = await actResp.json();
      const items = actJson.data?.items || [];
      if (items.length === 0) break;

      let detailUrl: string;
      if (isComments) {
        const ids = items.map((item: { commentId: string }) => item.commentId);
        detailUrl = `${API_BASE}/content-api/v1/comments?${ids.map((id: string) => `commentNoList=${id}`).join('&')}`;
      } else {
        const ids = items.map((item: { postId: string }) => item.postId);
        detailUrl = `${API_BASE}/content-api/v1/posts?${ids.map((id: string) => `postIds=${id}`).join('&')}`;
      }

      const detailResp = await fetch(detailUrl, { credentials: 'include' });
      if (!detailResp.ok) break;
      const detailJson = await detailResp.json();

      let hasThisMonth = false;
      if (isComments) {
        const raw = detailJson.data?.rawResponse;
        const parsed = raw ? JSON.parse(raw) : null;
        const commentList = parsed?.result?.commentList || [];
        for (const comment of commentList) {
          const dateStr = comment.regTimeGmt || '';
          if (dateStr && new Date(dateStr) >= monthStart) {
            count++;
            hasThisMonth = true;
          }
        }
      } else {
        const details = Array.isArray(detailJson.data) ? detailJson.data : [];
        for (const item of details) {
          const dateStr = item.createTime || '';
          if (dateStr && new Date(dateStr) >= monthStart) {
            count++;
            hasThisMonth = true;
          }
        }
      }

      if (!hasThisMonth) break;
      if (!actJson.data?.cursorInfo?.hasNext) break;
      cursor = actJson.data?.cursorInfo?.endCursor || '';
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
  const [attempted, setAttempted] = useState(false);
  const statsRef = useRef<MyStats | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setAttempted(true);
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
      const base: MyStats = {
        nickname: data.nickname || '',
        totalPosts,
        totalComments,
        monthlyPosts: '...',
        monthlyComments: '...',
      };
      statsRef.current = { ...base };
      setStats({ ...base });

      // 이번달 카운트
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const createTime = data.createTime ? new Date(data.createTime) : null;
      const createdThisMonth = createTime && createTime >= monthStart;

      if (createdThisMonth) {
        statsRef.current = { ...base, monthlyPosts: totalPosts, monthlyComments: totalComments };
        setStats({ ...statsRef.current });
      } else {
        // 독립적으로 로드, 먼저 완료되는 것부터 반영
        fetchMonthlyCount(meData.personaId, 'posts', monthStart).then((count) => {
          if (statsRef.current) {
            statsRef.current = { ...statsRef.current, monthlyPosts: count };
            setStats({ ...statsRef.current });
          }
        });
        fetchMonthlyCount(meData.personaId, 'comments', monthStart).then((count) => {
          if (statsRef.current) {
            statsRef.current = { ...statsRef.current, monthlyComments: count };
            setStats({ ...statsRef.current });
          }
        });
      }
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, attempted, refresh };
}
