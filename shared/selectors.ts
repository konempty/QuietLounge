import type { SelectorConfig } from './types';

export const DEFAULT_SELECTORS: SelectorConfig = {
  feed: {
    scrollContainer: '.infinite-scroll-component',
    postLink: 'a[href^="/posts/"]',
    postContainer: 'div.relative[tabindex]',
    nickname: '[data-slot="profile-name-label"] span.truncate',
    profileName: '[data-slot="profile-name"]',
    separator: '[data-slot="separator"]',
  },
  carousel: {
    card: '[data-slot="card"]',
    cardItem: '[data-slot="carousel-item"]',
    cardNickname: '[data-slot="profile-name-label"] span.truncate',
  },
};

// /posts/** 또는 /channels/** 경로에서만 동작
export function isActivePage(): boolean {
  const path = window.location.pathname;
  return path.startsWith('/posts') || path.startsWith('/channels');
}
