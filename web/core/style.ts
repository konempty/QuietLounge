import type { FilterMode } from '../../types';

// 차단된 글에 적용할 스타일 — `hide` 모드는 display:none, `blur` 모드는 흐림 + 클릭 차단.
// 항상 호출해서 unblock 시에도 흐림이 풀리도록 (4 플랫폼 동일).
//
// 인터페이스 노트: Chrome 의 기존 코드는 `applyBlockStyle(el)` (blocked=true) +
// `clearBlockStyle(el)` 둘로 분리돼 있었지만, Safari/iOS/Android 는 통합 형태였다.
// 새 shared API 는 통합으로 가고, Chrome entry 의 wrapper 가 두 헬퍼를 derive 한다.
export function applyStyle(
  el: HTMLElement | null | undefined,
  blocked: boolean,
  mode: FilterMode,
): void {
  if (!el) return;
  if (blocked) {
    if (mode === 'blur') {
      el.style.filter = 'blur(5px)';
      el.style.opacity = '0.3';
      el.style.pointerEvents = 'none';
      el.style.display = '';
    } else {
      el.style.display = 'none';
      el.style.filter = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    }
  } else {
    el.style.display = '';
    el.style.filter = '';
    el.style.opacity = '';
    el.style.pointerEvents = '';
  }
}
