// safari-extension api-interceptor.js 통합 테스트 — chrome 과 파일 내용은 동일하나
// 별도 파일이므로 coverage 수집을 위해 safari 경로에서 로드.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  'safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/api-interceptor.js',
);

async function setup({ html = '<!doctype html><html lang="ko"><body></body></html>', fetchImpl, url = 'https://lounge.naver.com/' } = {}) {
  const code = await fs.readFile(SCRIPT_PATH, 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const win = dom.window;
  win.fetch = fetchImpl || vi.fn();
  const received = [];
  win.addEventListener('message', (e) => received.push(e.data));
  win.eval(`${code}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { dom, win, received };
}

const latest = (arr) => [...arr].reverse().find((m) => m?.type === 'QUIET_LOUNGE_API_DATA');

describe('safari api-interceptor.js', () => {
  let dom;
  afterEach(() => {
    if (dom) dom.window.close();
    dom = null;
  });

  it('fetch 매핑 수집', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [{ postId: 'sp1', personaId: 'spa1', nickname: '닉' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const ctx = await setup({ fetchImpl });
    dom = ctx.dom;
    await ctx.win.fetch('https://api.lounge.naver.com/feed');
    await new Promise((r) => setTimeout(r, 0));
    const msg = latest(ctx.received);
    expect(msg?.personaMap?.sp1).toBe('spa1');
    expect(msg?.personaCache?.spa1).toBe('닉');
  });

  it('라운지 아닌 URL 스킵', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ postId: 'z', personaId: 'pz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const ctx = await setup({ fetchImpl });
    dom = ctx.dom;
    await ctx.win.fetch('https://other.com/');
    await new Promise((r) => setTimeout(r, 0));
    const msg = latest(ctx.received);
    if (msg) expect(msg.personaMap?.z).toBeUndefined();
  });

  it('하이드레이션 인접 패턴', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <script type="application/json">{"items":[{"postId":"sh1","personaId":"sph1"}]}</script>
    </body></html>`;
    const ctx = await setup({ html });
    dom = ctx.dom;
    const msg = latest(ctx.received);
    expect(msg?.personaMap?.sh1).toBe('sph1');
  });

  it('프로필 링크 파싱', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <a href="/profiles/sprof123">닉S</a>
    </body></html>`;
    const ctx = await setup({ html });
    dom = ctx.dom;
    const msg = latest(ctx.received);
    expect(msg?.personaCache?.sprof123).toBe('닉S');
  });

  it('글 상세 URL 작성자 추출', async () => {
    const html = `<!doctype html><html lang="ko"><body>
      <div data-slot="profile-name"><a href="/profiles/sauth999">작성자</a></div>
    </body></html>`;
    const ctx = await setup({ html, url: 'https://lounge.naver.com/posts/spost77' });
    dom = ctx.dom;
    const msg = latest(ctx.received);
    expect(msg?.personaMap?.spost77).toBe('sauth999');
  });

  it('JSON 파싱 실패 삼킴', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<<bad', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );
    const ctx = await setup({ fetchImpl });
    dom = ctx.dom;
    await expect(
      ctx.win.fetch('https://api.lounge.naver.com/x'),
    ).resolves.toBeTruthy();
  });

  it('REQUEST_DATA 메시지에 응답', async () => {
    const ctx = await setup();
    dom = ctx.dom;
    ctx.received.length = 0;
    ctx.win.postMessage({ type: 'QUIET_LOUNGE_REQUEST_DATA' }, '*');
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(latest(ctx.received)).toBeTruthy();
  });
});
