// 라운지(lounge.naver.com) DOM 셀렉터 — 4 플랫폼 inject 스크립트 공통 상수.
// 라운지의 Tailwind / data-slot 컨벤션을 따르며, 라운지 빌드가 변경되면 여기 한 곳만 갱신.
export const SEL = {
  scrollContainer: '.infinite-scroll-component',
  postLink: 'a[href^="/posts/"]',
  postContainer: '.relative[tabindex]',
  nickname: '[data-slot="profile-name-label"] span.truncate',
  profileName: '[data-slot="profile-name"]',
  separator: '[data-slot="separator"]',
  card: '[data-slot="card"]',
  cardItem: '[data-slot="carousel-item"]',
} as const;
