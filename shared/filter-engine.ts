import type { SelectorConfig, FilterMode } from './types';
import type { BlockList } from './block-list';
import type { ApiInterceptor } from './api-interceptor';
import { isActivePage } from './selectors';

function debounce(fn: () => void, delay: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

export class FilterEngine {
  private blockList: BlockList;
  private interceptor: ApiInterceptor;
  private selectors: SelectorConfig;
  private filterMode: FilterMode;
  private observer: MutationObserver | null = null;
  private blockedCount = 0;

  constructor(
    blockList: BlockList,
    interceptor: ApiInterceptor,
    selectors: SelectorConfig,
    filterMode: FilterMode = 'hide'
  ) {
    this.blockList = blockList;
    this.interceptor = interceptor;
    this.selectors = selectors;
    this.filterMode = filterMode;
  }

  setFilterMode(mode: FilterMode): void {
    this.filterMode = mode;
    this.filterAll();
  }

  getBlockedCount(): number {
    return this.blockedCount;
  }

  filterAll(): void {
    // /posts/** 또는 /channels/** 경로에서만 동작
    if (!isActivePage()) return;

    this.blockedCount = 0;
    this.filterFeedPosts();
    this.filterCarouselCards();
  }

  private filterFeedPosts(): void {
    const postLinks = document.querySelectorAll<HTMLAnchorElement>(
      this.selectors.feed.postLink
    );

    postLinks.forEach((link) => {
      const postId = link.getAttribute('href')?.replace('/posts/', '');
      const nicknameEl = link.querySelector(this.selectors.feed.nickname);
      const nickname = nicknameEl?.textContent?.trim();

      if (!postId && !nickname) return;

      let isBlocked = false;

      if (postId) {
        const personaId = this.interceptor.getPersonaId(postId);
        if (personaId) {
          isBlocked = this.blockList.isBlockedByPersonaId(personaId);
        }
      }

      // 닉네임 폴백
      if (!isBlocked && nickname) {
        isBlocked = this.blockList.isBlockedByNickname(nickname);
      }

      const container =
        link.closest(this.selectors.feed.postContainer) ||
        link.parentElement?.parentElement;

      if (!container || !(container instanceof HTMLElement)) return;

      if (isBlocked) {
        this.blockedCount++;
        this.applyFilter(container);
        const wrapper = container.parentElement;
        const separator = wrapper?.nextElementSibling;
        if (
          separator instanceof HTMLElement &&
          separator.getAttribute('data-slot') === 'separator'
        ) {
          separator.style.display = 'none';
        }
      } else {
        this.removeFilter(container);
        const wrapper = container.parentElement;
        const separator = wrapper?.nextElementSibling;
        if (
          separator instanceof HTMLElement &&
          separator.getAttribute('data-slot') === 'separator'
        ) {
          separator.style.display = '';
        }
      }
    });
  }

  private filterCarouselCards(): void {
    const cards = document.querySelectorAll(this.selectors.carousel.card);

    cards.forEach((card) => {
      const nicknameEl = card.querySelector(this.selectors.carousel.cardNickname);
      const nickname = nicknameEl?.textContent?.trim();
      if (!nickname) return;

      const isBlocked = this.blockList.isBlockedByNickname(nickname);
      const carouselItem = card.closest(this.selectors.carousel.cardItem);

      if (!carouselItem || !(carouselItem instanceof HTMLElement)) return;

      if (isBlocked) {
        this.blockedCount++;
        carouselItem.style.display = 'none';
      } else {
        carouselItem.style.display = '';
      }
    });
  }

  private applyFilter(el: HTMLElement): void {
    if (this.filterMode === 'hide') {
      el.style.display = 'none';
      el.removeAttribute('data-quiet-lounge-blur');
    } else {
      el.style.display = '';
      el.setAttribute('data-quiet-lounge-blur', 'true');
      el.style.filter = 'blur(5px)';
      el.style.opacity = '0.4';
      el.style.pointerEvents = 'none';
      el.style.userSelect = 'none';
    }
  }

  private removeFilter(el: HTMLElement): void {
    el.style.display = '';
    el.style.filter = '';
    el.style.opacity = '';
    el.style.pointerEvents = '';
    el.style.userSelect = '';
    el.removeAttribute('data-quiet-lounge-blur');
  }

  observe(): void {
    if (this.observer) return;

    const target =
      document.querySelector(this.selectors.feed.scrollContainer) || document.body;

    const debouncedFilter = debounce(() => this.filterAll(), 200);

    this.observer = new MutationObserver(debouncedFilter);
    this.observer.observe(target, { childList: true, subtree: true });

    this.filterAll();
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
