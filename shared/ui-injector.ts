import type { SelectorConfig } from './types';
import type { ApiInterceptor } from './api-interceptor';
import { isActivePage } from './selectors';

export type BlockUserCallback = (personaId: string | undefined, nickname: string) => void;

export class UIInjector {
  private selectors: SelectorConfig;
  private interceptor: ApiInterceptor;
  private onBlockUser: BlockUserCallback;
  private observer: MutationObserver | null = null;

  constructor(
    selectors: SelectorConfig,
    interceptor: ApiInterceptor,
    onBlockUser: BlockUserCallback
  ) {
    this.selectors = selectors;
    this.interceptor = interceptor;
    this.onBlockUser = onBlockUser;
  }

  injectBlockButtons(): void {
    // /posts/** 또는 /channels/** 경로에서만 동작
    if (!isActivePage()) return;

    const profileNames = document.querySelectorAll(this.selectors.feed.profileName);

    profileNames.forEach((el) => {
      if (el.querySelector('.quiet-lounge-btn')) return;

      const btn = document.createElement('button');
      btn.className = 'quiet-lounge-btn';
      btn.textContent = '\u2715';
      btn.title = '이 유저 차단';
      btn.style.cssText = [
        'margin-left:4px',
        'cursor:pointer',
        'opacity:0.3',
        'font-size:11px',
        'border:none',
        'background:none',
        'padding:0 2px',
        'line-height:1',
        'color:inherit',
        'vertical-align:middle',
        'transition:opacity 0.15s',
      ].join(';');

      btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.8'));
      btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.3'));

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const nickname = el
          .querySelector('[data-slot="profile-name-label"] span.truncate')
          ?.textContent?.trim();

        if (!nickname) return;

        // 게시글 링크에서 postId → personaId 조회
        const postLink =
          el.closest(this.selectors.feed.postLink) ||
          el.closest('div')?.querySelector(this.selectors.feed.postLink) ||
          el.closest('[tabindex]')?.querySelector(this.selectors.feed.postLink);

        let personaId: string | undefined;
        if (postLink) {
          const postId = postLink.getAttribute('href')?.replace('/posts/', '');
          if (postId) {
            personaId = this.interceptor.getPersonaId(postId);
          }
        }

        if (confirm(`"${nickname}" 유저를 차단하시겠습니까?`)) {
          this.onBlockUser(personaId, nickname);
        }
      });

      el.appendChild(btn);
    });
  }

  observe(): void {
    if (this.observer) return;

    const target =
      document.querySelector(this.selectors.feed.scrollContainer) || document.body;

    let debounceTimer: ReturnType<typeof setTimeout>;
    this.observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.injectBlockButtons(), 300);
    });

    this.observer.observe(target, { childList: true, subtree: true });
    this.injectBlockButtons();
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
