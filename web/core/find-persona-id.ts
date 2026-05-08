// 차단 버튼이 클릭된 컨테이너에서 personaId 를 추출하는 3 단계 fallback.
//
// 라운지 페이지의 personaId 는 컨텍스트마다 다른 위치에 있다:
//   1. 프로필 링크 (`a[href^="/profiles/{personaId}"]`) — 프로필 영역 안의 글에서 가장 직접적
//   2. postLink (`a[href^="/posts/{postId}"]`) → personaMap 조회 — 피드 일반 글
//   3. URL pathname (`/posts/{postId}`) → personaMap 조회 — 글 상세 페이지에서 작성자 추출
//
// personaMap 자료구조는 4 플랫폼이 다르다 (Chrome/Safari = `Map`, iOS/Android = `{[postId]: pid}`).
// `personaIdForPost` 함수로 추상화해 entry 측이 자기 자료구조에서 lookup 하게 한다 (filter-engine 과 동일 패턴).

export function findPersonaId(
  container: Element,
  personaIdForPost: (postId: string) => string | undefined,
): string | undefined {
  // 1. 프로필 링크 직접 매칭
  const profileLink = container.querySelector('a[href^="/profiles/"]');
  if (profileLink) {
    const href = profileLink.getAttribute('href');
    const pid = href ? href.replace('/profiles/', '') : '';
    if (pid) return pid;
  }

  // 2. postLink → personaMap 조회. closest 와 querySelector 모두 시도 (컨테이너 안/밖 양쪽).
  // 중요: 명시적인 postLink 가 있으면 그 postId 의 매핑 결과로 *바로 종료* 한다. 매핑 실패 시
  // URL fallback 으로 넘어가면 글 상세 페이지(`/posts/current`) 안의 카드(`/posts/card`)에서
  // card 가 미매핑일 때 current 작성자 매핑이 잘못 반환돼 엉뚱한 사람을 차단하는 P1 버그가 생긴다.
  const postLink =
    container.closest('a[href^="/posts/"]') ||
    container.querySelector('a[href^="/posts/"]') ||
    container.closest('.relative[tabindex]')?.querySelector('a[href^="/posts/"]');
  if (postLink) {
    const postId = postLink.getAttribute('href')?.replace('/posts/', '');
    return postId ? personaIdForPost(postId) : undefined;
  }

  // 3. postLink 가 아예 없을 때만 URL pathname fallback (글 상세 페이지 자체의 작성자 추출용).
  const pathMatch = window.location.pathname.match(/^\/posts\/([^/]+)/);
  if (pathMatch) {
    const pid = personaIdForPost(pathMatch[1]);
    if (pid) return pid;
  }

  return undefined;
}
