// applyStyle(el, blocked, mode) — hide / blur 모드별 스타일 적용 + unblock 시 초기화.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { applyStyle } from '../../../shared/web/core/style';

function makeEl(): HTMLElement {
  const dom = new JSDOM('<!doctype html><div id="t"></div>');
  return dom.window.document.getElementById('t') as HTMLElement;
}

describe('applyStyle', () => {
  it('blocked + hide → display:none', () => {
    const el = makeEl();
    applyStyle(el, true, 'hide');
    expect(el.style.display).toBe('none');
    expect(el.style.filter).toBe('');
  });

  it('blocked + blur → blur(5px) + opacity 0.3 + pointerEvents none', () => {
    const el = makeEl();
    applyStyle(el, true, 'blur');
    expect(el.style.display).toBe('');
    expect(el.style.filter).toBe('blur(5px)');
    expect(el.style.opacity).toBe('0.3');
    expect(el.style.pointerEvents).toBe('none');
  });

  it('unblock — display 복원 + 모든 필터 클리어', () => {
    const el = makeEl();
    applyStyle(el, true, 'blur');
    applyStyle(el, false, 'blur');
    expect(el.style.display).toBe('');
    expect(el.style.filter).toBe('');
    expect(el.style.opacity).toBe('');
    expect(el.style.pointerEvents).toBe('');
  });

  it('hide → blur 전환 시 display 복원 (필터 모드 변경 후 재필터링 시나리오)', () => {
    const el = makeEl();
    applyStyle(el, true, 'hide');
    expect(el.style.display).toBe('none');
    applyStyle(el, true, 'blur');
    expect(el.style.display).toBe('');
    expect(el.style.filter).toBe('blur(5px)');
  });

  it('null el — no-op (안전)', () => {
    expect(() => applyStyle(null, true, 'hide')).not.toThrow();
    expect(() => applyStyle(undefined, false, 'blur')).not.toThrow();
  });
});
