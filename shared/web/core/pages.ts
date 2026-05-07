// 라운지의 SPA 경로 분류 — 차단/필터 동작이 적용되는 영역 판별.
// 홈("/") / 글 상세("/posts/...") / 채널("/channels/...") 에서 차단 필터를 수행.
// 차단 버튼은 글이 있는 페이지(/posts, /channels) 에서만 노출 — 홈/랭킹은 닉네임 자리에
// 채널명이 표시되어 차단 의미가 없으므로 버튼 자체를 숨긴다.

export function isActivePage(): boolean {
  const p = window.location.pathname;
  return p === '/' || p.startsWith('/posts') || p.startsWith('/channels');
}

export function isBlockButtonPage(): boolean {
  const p = window.location.pathname;
  return p.startsWith('/posts') || p.startsWith('/channels');
}
