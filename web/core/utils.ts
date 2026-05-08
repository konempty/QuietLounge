// 4 entry / web/core 공통 유틸. shared/web 의 다른 module 처럼 *순수 함수 + zero platform binding*.

/**
 * trailing-edge debounce — 마지막 호출 후 `delay` ms 동안 추가 호출이 없으면 1 회 실행.
 *
 * 4 entry 의 page-level MutationObserver 가 같은 delay (200ms) 로 사용. profile-stats 의
 * MutationObserver 도 100ms 로 사용. fn 이 *void 또는 noop-style* 이어서 generic 으로 두지 않고
 * 가장 흔한 시그너처만 export — TypeScript 측에서 typing 이 필요한 케이스는 호출부에서 cast.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}
