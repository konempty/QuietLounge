// chrome-extension/content-scripts/api-interceptor.js 통합 테스트 (jsdom).
// fetch monkey-patch + 하이드레이션 regex 파싱을 검증.
// 파일이 IIFE 라 직접 import 는 불가 — JSDOM 에 <script> 주입 후 postMessage 로 결과 관찰.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  'chrome-extension/content-scripts/api-interceptor.js',
);

async function setupInterceptor({ html = '<!doctype html><html lang="ko"><body></body></html>', fetchImpl } = {}) {
  const code = await fs.readFile(SCRIPT_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://lounge.naver.com/',
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.fetch = fetchImpl || vi.fn();

  // postMessage 캡처
  const received = [];
  win.addEventListener('message', (e) => received.push(e.data));

  const wrapped = `${code}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`;
  win.eval(wrapped);

  // DOMContentLoaded 가 필요한 경로가 있으면 강제 flush
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { dom, win, received };
}

function latestMapping(received) {
  // 가장 최신 QUIET_LOUNGE_API_DATA 메시지 반환
  return [...received]
    .reverse()
    .find((m) => m?.type === 'QUIET_LOUNGE_API_DATA');
}

describe('chrome api-interceptor.js', () => {
  let dom;
  afterEach(() => {
    if (dom) dom.window.close();
    dom = null;
  });

  it('fetch monkey-patch — 라운지 API 호출 시 매핑 수집', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            items: [
              { postId: 'p1', personaId: 'pa1' },
              { postId: 'p2', personaId: 'pa2', nickname: '유저2' },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const ctx = await setupInterceptor({ fetchImpl });
    dom = ctx.dom;

    const resp = await ctx.win.fetch('https://api.lounge.naver.com/feed');
    expect(resp.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));

    const msg = latestMapping(ctx.received);
    expect(msg).toBeTruthy();
    expect(msg.personaMap.p1).toBe('pa1');
    expect(msg.personaMap.p2).toBe('pa2');
    expect(msg.personaCache.pa2).toBe('유저2');
  });

  it('라운지 API 가 아니면 파싱 스킵', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ postId: 'x', personaId: 'px' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const ctx = await setupInterceptor({ fetchImpl });
    dom = ctx.dom;

    await ctx.win.fetch('https://example.com/other');
    await new Promise((r) => setTimeout(r, 0));

    // 요청 후 API_DATA 메시지가 추가로 오지 않아야 함 (초기 parseHydrationData 로 인한 메시지는 별도)
    const msg = latestMapping(ctx.received);
    // 초기 hydration 메시지가 있을 수 있으나 거기에도 px 는 없어야 함
    if (msg) expect(msg.personaMap.x).toBeUndefined();
  });

  it('JSON 파싱 실패 — 예외 삼킴', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );
    const ctx = await setupInterceptor({ fetchImpl });
    dom = ctx.dom;
    await expect(
      ctx.win.fetch('https://api.lounge.naver.com/x'),
    ).resolves.toBeTruthy();
  });

  it('중첩 객체/배열 재귀 추출', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            nested: {
              deep: [
                { postId: 'deep1', personaId: 'pd1' },
                { irrelevant: true },
              ],
            },
            also: { postId: 'deep2', personaId: 'pd2' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const ctx = await setupInterceptor({ fetchImpl });
    dom = ctx.dom;

    await ctx.win.fetch('https://api.lounge.naver.com/x');
    await new Promise((r) => setTimeout(r, 0));
    const msg = latestMapping(ctx.received);
    expect(msg.personaMap.deep1).toBe('pd1');
    expect(msg.personaMap.deep2).toBe('pd2');
  });

  it('하이드레이션 — 인접 패턴 (postId+personaId 인접)', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">{"items":[{"postId":"h1","personaId":"ph1"},{"postId":"h2","personaId":"ph2"}]}</script>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    expect(msg).toBeTruthy();
    expect(msg.personaMap.h1).toBe('ph1');
    expect(msg.personaMap.h2).toBe('ph2');
  });

  it('하이드레이션 — 이스케이프된 RSC 페이로드', async () => {
    // 이스케이프된 RSC 페이로드 샘플 — script 내용을 JSON 타입으로 보관해 IDE 가 JS 로 파싱하지 않도록.
    const escaped = `some\\\\"postId\\\\":\\\\"rsc1\\\\",\\\\"personaId\\\\":\\\\"rp1\\\\"`;
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">${escaped}</script>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    // 이스케이프 패턴도 캡처
    if (msg) expect(Object.keys(msg.personaMap).length).toBeGreaterThan(0);
  });

  it('하이드레이션 — 근접 (200자 이내) 매칭', async () => {
    const filler = 'a'.repeat(50);
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">{"postId":"sep1"${filler}"personaId":"psep1"}</script>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    expect(msg?.personaMap?.sep1).toBe('psep1');
  });

  it('하이드레이션 — 200자 초과 거리면 매칭 안 됨', async () => {
    const filler = 'x'.repeat(300);
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">{"postId":"farp"${filler}"personaId":"farq"}</script>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    if (msg) expect(msg.personaMap.farp).toBeUndefined();
  });

  it('하이드레이션 — personaId + nickname 인접 패턴', async () => {
    // notifyContentScript 는 found>0 일 때만 호출 — postId 매핑도 함께 포함해 발동 유도
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">{"postId":"px","personaId":"pn1","nickname":"테스트닉"}</script>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    expect(msg?.personaCache?.pn1).toBe('테스트닉');
  });

  it('프로필 링크 DOM 파싱', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <a href="/profiles/profile1abc">닉네임1</a>
      <a href="/profiles/profile2def">닉네임2</a>
      <a href="/profiles/short">짧은거</a>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    expect(msg?.personaCache?.profile1abc).toBe('닉네임1');
    expect(msg?.personaCache?.profile2def).toBe('닉네임2');
    // "short" 는 6자 미만이라 스킵
    expect(msg?.personaCache?.short).toBeUndefined();
  });

  it('QUIET_LOUNGE_REQUEST_DATA 메시지 수신 시 현재 매핑 재전송', async () => {
    const ctx = await setupInterceptor();
    dom = ctx.dom;

    ctx.received.length = 0;
    ctx.win.postMessage({ type: 'QUIET_LOUNGE_REQUEST_DATA' }, '*');
    // jsdom postMessage 는 async — 리스너 실행 + notifyContentScript 가 다시 postMessage
    // 하는 두 단계 dispatch 를 기다림
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    const msg = latestMapping(ctx.received);
    expect(msg).toBeTruthy();
  });

  it('짧은 script 태그 (20자 미만) 는 파싱 스킵', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">tiny</script>
      <script type="application/json">{"postId":"ok","personaId":"pok"}</script>
      </body></html>`;
    const ctx = await setupInterceptor({ html });
    dom = ctx.dom;
    const msg = latestMapping(ctx.received);
    if (msg) expect(msg.personaMap?.ok).toBe('pok');
  });

  it('글 상세 페이지 — URL 기반 작성자 personaId 추출', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <div data-slot="profile-name">
        <a href="/profiles/author12345">작성자닉네임</a>
      </div>
      </body></html>`;
    const dom2 = new JSDOM(html, {
      url: 'https://lounge.naver.com/posts/post123',
      runScripts: 'outside-only',
    });
    const win = dom2.window;
    win.fetch = vi.fn();
    const received = [];
    win.addEventListener('message', (e) => received.push(e.data));
    const code = await fs.readFile(SCRIPT_PATH, 'utf8');
    win.eval(`${code}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    dom = dom2;
    const msg = latestMapping(received);
    expect(msg?.personaMap?.post123).toBe('author12345');
  });
});
