import type { BlockListData } from '../../shared/types';

// personaId / nickname 으로 차단 여부 판정. 4 플랫폼 동일 시맨틱.
//   • personaId 매칭이 우선 — 같은 닉네임의 다른 유저가 있을 수 있으므로.
//   • personaId 매핑이 안 잡힌 경우(API 호출 전, 카드형 글 등) nickname 으로 fallback.
//   • blockedUsers 의 nickname 값과 nicknameOnlyBlocks 모두 검사.
export function isBlocked(
  data: BlockListData | null | undefined,
  personaId: string | null | undefined,
  nickname: string | null | undefined,
): boolean {
  if (!data) return false;
  if (personaId && data.blockedUsers && data.blockedUsers[personaId]) return true;
  if (nickname) {
    const users = data.blockedUsers || {};
    for (const key in users) {
      if (users[key].nickname === nickname) return true;
    }
    const nbs = data.nicknameOnlyBlocks || [];
    for (let i = 0; i < nbs.length; i++) {
      if (nbs[i].nickname === nickname) return true;
    }
  }
  return false;
}

// 댓글 차단 여부. 기존 차단 데이터는 "글만 차단"으로 유지하고, blockComments=true 인 항목만
// 댓글에도 적용한다. personaId 매칭을 먼저 보고, 기존 글 차단과 동일하게 닉네임 fallback 도 유지한다.
export function isCommentBlocked(
  data: BlockListData | null | undefined,
  personaId: string | null | undefined,
  nickname: string | null | undefined,
): boolean {
  if (!data) return false;
  if (personaId && data.blockedUsers?.[personaId]?.blockComments) return true;
  if (nickname) {
    const users = data.blockedUsers || {};
    for (const key in users) {
      if (users[key].nickname === nickname && users[key].blockComments) return true;
    }
    const nbs = data.nicknameOnlyBlocks || [];
    for (let i = 0; i < nbs.length; i++) {
      if (nbs[i].nickname === nickname && nbs[i].blockComments) return true;
    }
  }
  return false;
}
