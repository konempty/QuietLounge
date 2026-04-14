// safari-extension storage-bridge.js — content script 에서 background 로
// 모든 storage I/O 를 위임하는 브릿지. browser.runtime.sendMessage 를 mock.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  'safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/storage-bridge.js',
);

function mkBrowser({ sendMessage } = {}) {
  return {
    runtime: {
      sendMessage:
        sendMessage ||
        vi.fn((payload, cb) => {
          cb && cb({ ok: true, response: { data: {} } });
        }),
      lastError: null,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      },
    },
  };
}

async function load({ browser, userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } = {}) {
  const code = await fs.readFile(SCRIPT_PATH, 'utf8');
  const dom = new JSDOM('<!doctype html><html lang="ko"><body></body></html>', {
    url: 'https://lounge.naver.com/',
    runScripts: 'outside-only',
    userAgent,
  });
  const win = dom.window;
  win.browser = browser || mkBrowser();
  win.eval(`${code}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { dom, win };
}

describe('safari storage-bridge.js', () => {
  let dom;
  afterEach(() => {
    if (dom) dom.window.close();
    dom = null;
  });

  it('iOS Safari — __QL_storage 가 노출됨', async () => {
    const ctx = await load();
    dom = ctx.dom;
    expect(ctx.win.__QL_storage).toBeDefined();
    expect(ctx.win.__QL_storage._ready).toBe(true);
    expect(typeof ctx.win.__QL_storage.get).toBe('function');
    expect(typeof ctx.win.__QL_storage.set).toBe('function');
    expect(typeof ctx.win.__QL_storage.remove).toBe('function');
  });

  it('sendMessage 미지원 환경 — 즉시 return (__QL_storage 미노출)', async () => {
    const code = await fs.readFile(SCRIPT_PATH, 'utf8');
    const dom2 = new JSDOM('<!doctype html><html lang="ko"><body></body></html>', {
      url: 'https://lounge.naver.com/',
      runScripts: 'outside-only',
    });
    dom2.window.browser = { runtime: {} }; // sendMessage 없음
    dom2.window.eval(`${code}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`);
    dom = dom2;
    expect(dom2.window.__QL_storage).toBeUndefined();
  });

  it('iPadOS — Request Desktop Site (maxTouchPoints>1 로 모바일 감지)', async () => {
    // JSDOM 에 maxTouchPoints 설정 후 로드
    const code = await fs.readFile(SCRIPT_PATH, 'utf8');
    const dom2 = new JSDOM('<!doctype html><html lang="ko"><body></body></html>', {
      url: 'https://lounge.naver.com/',
      runScripts: 'outside-only',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
    });
    Object.defineProperty(dom2.window.navigator, 'maxTouchPoints', { value: 5 });
    dom2.window.browser = mkBrowser();
    dom2.window.eval(`${code}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`);
    dom = dom2;
    // maxTouchPoints>1 이면 isAppleMobile true → bridge 활성화
    expect(dom2.window.__QL_storage).toBeDefined();
  });

  it('get — background 에 QL_STORAGE_GET 전달 + 응답 반환', async () => {
    const browser = mkBrowser({
      sendMessage: vi.fn((payload, cb) => {
        expect(payload.type).toBe('QL_STORAGE_GET');
        expect(payload.keys).toEqual(['k1']);
        cb({ ok: true, response: { data: { k1: 'value1' } } });
      }),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const result = await ctx.win.__QL_storage.get('k1');
    expect(result.k1).toBe('value1');
  });

  it('get — 배열 key 지원', async () => {
    const browser = mkBrowser({
      sendMessage: vi.fn((payload, cb) => {
        cb({ ok: true, response: { data: { a: 1, b: 2 } } });
      }),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const result = await ctx.win.__QL_storage.get(['a', 'b']);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('get — object 디폴트 적용 (누락된 key 는 default 값)', async () => {
    const browser = mkBrowser({
      sendMessage: vi.fn((_, cb) => cb({ ok: true, response: { data: { a: 99 } } })),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const result = await ctx.win.__QL_storage.get({ a: 'da', missing: 'dm' });
    expect(result.a).toBe(99);
    expect(result.missing).toBe('dm');
  });

  it('get — 빈/널 키 즉시 빈 객체', async () => {
    const ctx = await load();
    dom = ctx.dom;
    expect(await ctx.win.__QL_storage.get(null)).toEqual({});
    expect(await ctx.win.__QL_storage.get([])).toEqual({});
  });

  it('set — QL_STORAGE_SET 전달 + 변경 리스너 트리거', async () => {
    let sendPayload = null;
    const browser = mkBrowser({
      sendMessage: vi.fn((payload, cb) => {
        if (payload.type === 'QL_STORAGE_SET') sendPayload = payload;
        cb({ ok: true, response: {} });
      }),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const listener = vi.fn();
    ctx.win.__QL_storage.onChanged.addListener(listener);
    await ctx.win.__QL_storage.set({ k: 'v' });
    expect(sendPayload.items).toEqual({ k: 'v' });
    expect(listener).toHaveBeenCalled();
    const [changes, area] = listener.mock.calls[0];
    expect(changes.k.newValue).toBe('v');
    expect(area).toBe('local');
  });

  it('set — 리스너 예외는 무시하고 다른 리스너 호출', async () => {
    const ctx = await load();
    dom = ctx.dom;
    const good = vi.fn();
    ctx.win.__QL_storage.onChanged.addListener(() => {
      throw new Error('listener error');
    });
    ctx.win.__QL_storage.onChanged.addListener(good);
    await ctx.win.__QL_storage.set({ k: 'v' });
    expect(good).toHaveBeenCalled();
  });

  it('remove — QL_STORAGE_REMOVE 전달 + 변경 리스너', async () => {
    const ctx = await load();
    dom = ctx.dom;
    const listener = vi.fn();
    ctx.win.__QL_storage.onChanged.addListener(listener);
    await ctx.win.__QL_storage.remove('k1');
    expect(listener).toHaveBeenCalled();
  });

  it('hasListener / removeListener 동작', async () => {
    const ctx = await load();
    dom = ctx.dom;
    const fn = vi.fn();
    ctx.win.__QL_storage.onChanged.addListener(fn);
    expect(ctx.win.__QL_storage.onChanged.hasListener(fn)).toBe(true);
    ctx.win.__QL_storage.onChanged.removeListener(fn);
    expect(ctx.win.__QL_storage.onChanged.hasListener(fn)).toBe(false);
  });

  it('sendBg 실패 시 get 은 빈 객체 반환', async () => {
    const browser = mkBrowser({
      sendMessage: vi.fn((_, cb) => cb({ ok: false, error: 'fail' })),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const result = await ctx.win.__QL_storage.get({ a: 'x' });
    // 실패 시 defaults 만 반환
    expect(result).toEqual({ a: 'x' });
  });

  it('browser.storage.local.get — 오버라이드되어 bridge 로 우회', async () => {
    const browser = mkBrowser({
      sendMessage: vi.fn((payload, cb) => {
        cb({ ok: true, response: { data: { overridden: 'yes' } } });
      }),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const r = await ctx.win.browser.storage.local.get('overridden');
    expect(r.overridden).toBe('yes');
  });

  it('sendMessage throw 도 안전하게 처리', async () => {
    const browser = mkBrowser({
      sendMessage: vi.fn(() => {
        throw new Error('sync throw');
      }),
    });
    const ctx = await load({ browser });
    dom = ctx.dom;
    const r = await ctx.win.__QL_storage.get('k');
    expect(r).toEqual({});
  });
});
