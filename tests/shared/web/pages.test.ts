// isActivePage / isBlockButtonPage — pathname 기반 활성/버튼 페이지 분류.

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { isActivePage, isBlockButtonPage } from '../../../shared/web/core/pages';

function setPath(p: string) {
  // jsdom: window.location 은 readonly — JSDOM 인스턴스를 path 별로 새로 만들어 globalThis 에 주입.
  const dom = new JSDOM('<!doctype html>', { url: `https://lounge.naver.com${p}` });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
}

describe('isActivePage — 차단 필터가 적용되는 페이지', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('홈 ("/") true', () => {
    setPath('/');
    expect(isActivePage()).toBe(true);
  });

  it('글 상세 ("/posts/abc") true', () => {
    setPath('/posts/abc');
    expect(isActivePage()).toBe(true);
  });

  it('채널 ("/channels/foo") true', () => {
    setPath('/channels/foo');
    expect(isActivePage()).toBe(true);
  });

  it('프로필 ("/profiles/bar") false — 차단 필터 비대상', () => {
    setPath('/profiles/bar');
    expect(isActivePage()).toBe(false);
  });
});

describe('isBlockButtonPage — 차단 버튼이 노출되는 페이지', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('글 상세 / 채널 만 true', () => {
    setPath('/posts/x');
    expect(isBlockButtonPage()).toBe(true);
    setPath('/channels/x');
    expect(isBlockButtonPage()).toBe(true);
  });

  it('홈 ("/") false — 닉네임 자리에 채널명이 표시되어 차단 의미 없음', () => {
    setPath('/');
    expect(isBlockButtonPage()).toBe(false);
  });

  it('프로필 false', () => {
    setPath('/profiles/bar');
    expect(isBlockButtonPage()).toBe(false);
  });
});
