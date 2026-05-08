// 차단 버튼 inject — 4 플랫폼 공통.
//
// path A (`[data-slot="profile-name"]` 슬롯이 있는 일반 글) 와 path B (슬롯 없는 카드형) 양쪽을
// 일관 처리. 나머지 (버튼 DOM / 클릭 flow / bfcache 가드 등) 는 adapter 에 위임 — 플랫폼 차이가
// 가장 큰 영역이라 ctx + adapter 두 단계로 분리.

import { SEL } from './selectors';
import { isCleanbotFiltered } from './cleanbot';
import { isBlockButtonPage } from './pages';
import { findPersonaId } from './find-persona-id';
import type { InjectButtonsAdapter } from '../platform/adapter';

export interface InjectButtonsContext {
  /** post container → personaId 추출 (3 단계 fallback). [findPersonaId] 의 wrapper.
   *  entry 가 자기 personaMap (Map vs Object) 을 wiring. */
  findPersonaId(container: Element): string | undefined;
  /** path B 에서 personaId → 닉네임 캐시 조회. 카드형 글의 닉네임을 alert 메시지에 쓰기 위함.
   *  미구현 시 닉네임이 personaId 로 fallback. */
  nicknameForPersonaId?(personaId: string): string | null | undefined;
}

/** 외부 헬퍼로도 export — entry 가 ctx.findPersonaId 를 만들 때 사용. */
export { findPersonaId };

export function injectBlockButtons(adapter: InjectButtonsAdapter, ctx: InjectButtonsContext): void {
  if (!isBlockButtonPage()) return;

  const btnSelector = '.' + adapter.buttonClassName;

  // 방법 A: data-slot="profile-name" 슬롯이 있는 게시글 (피드, 글 상세).
  document.querySelectorAll(SEL.profileName).forEach((el) => {
    if (skipExistingButton(el, btnSelector, adapter)) return;
    // 클린봇 검열 글: 작성자 정보가 가려진 채 안내문만 있어 차단 의미 없음.
    if (isCleanbotFiltered(el.closest(SEL.postContainer) || el.closest(SEL.postLink))) return;

    const btn = adapter.createButton();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const nickname = el
        .querySelector('[data-slot="profile-name-label"] span.truncate')
        ?.textContent?.trim();
      if (!nickname) return;

      const pid = ctx.findPersonaId(el);
      await adapter.onBlockClick(pid, nickname);
    });

    el.appendChild(btn);
    adapter.onButtonAttached?.(btn);
  });

  // 방법 B: profile-name 슬롯이 없는 카드형 (주간 베스트 등).
  document.querySelectorAll(SEL.postContainer).forEach((container) => {
    if (container.querySelector(SEL.profileName)) return; // 방법 A 처리
    if (isCleanbotFiltered(container)) return;
    if (skipExistingButton(container, btnSelector, adapter)) return;

    const postLink = container.querySelector(SEL.postLink) || container.closest(SEL.postLink);
    if (!postLink) return;

    // path B 의 personaId 미매핑 정책. iOS/Android 는 'skip' (버튼 미노출 — silent no-op 방지),
    // Chrome/Safari 는 'show-error' (클릭 시 안내).
    const pid = ctx.findPersonaId(container);
    if (!pid && adapter.pathBMissingPidStrategy === 'skip') return;

    const btn = adapter.createButton();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // 클릭 시점에 다시 조회 — DOM 인젝션 후 personaMap 이 채워졌을 수 있음.
      const currentPid = ctx.findPersonaId(container);
      if (!currentPid) {
        await adapter.onMissingPersonaId?.();
        return;
      }
      const nickname = ctx.nicknameForPersonaId?.(currentPid) || currentPid;
      await adapter.onBlockClick(currentPid, nickname);
    });

    const firstRow = container.querySelector('a > div');
    if (firstRow) firstRow.appendChild(btn);
    else container.appendChild(btn);
    adapter.onButtonAttached?.(btn);
  });
}

/** 이미 버튼이 있을 때 skip 할지 결정. adapter.shouldSkipExistingButton 미구현 시 default 는 항상 skip.
 *  Safari ext 만 bfcache 복원된 죽은 버튼을 제거 후 새로 등록하는 비-default 동작. */
function skipExistingButton(
  container: Element,
  btnSelector: string,
  adapter: InjectButtonsAdapter,
): boolean {
  const existing = container.querySelector(btnSelector);
  if (!existing) return false;
  if (adapter.shouldSkipExistingButton?.(existing) ?? true) return true;
  existing.remove();
  return false;
}
