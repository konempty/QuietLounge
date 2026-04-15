import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  'safari-extension/QuietLounge/Shared (App)/Resources/Script.js',
);

async function setup() {
  const js = await fs.readFile(SCRIPT_PATH, 'utf8');
  const dom = new JSDOM(
    `
      <body>
        <div class="platform-mac state-on"></div>
        <div class="platform-mac state-off"></div>
        <div class="platform-mac state-unknown"></div>
        <button class="platform-mac open-preferences"></button>
      </body>
    `,
    {
      url: 'https://example.test/',
      runScripts: 'outside-only',
    },
  );
  dom.window.webkit = {
    messageHandlers: {
      controller: {
        postMessage: vi.fn(),
      },
    },
  };
  dom.window.eval(`${js}\n//# sourceURL=${pathToFileURL(SCRIPT_PATH).href}\n`);
  return dom;
}

describe('Safari shared app Script.js', () => {
  let dom;

  afterEach(() => {
    if (dom) dom.window.close();
    dom = null;
  });

  it('show(platform, enabled=true) 는 플랫폼/상태 클래스를 켠다', async () => {
    dom = await setup();
    dom.window.show('mac', true, false);

    expect(dom.window.document.body.classList.contains('platform-mac')).toBe(true);
    expect(dom.window.document.body.classList.contains('state-on')).toBe(true);
    expect(dom.window.document.body.classList.contains('state-off')).toBe(false);
  });

  it('show(platform, enabled=false, useSettingsInsteadOfPreferences=true) 는 안내 문구를 settings 기준으로 교체', async () => {
    dom = await setup();
    dom.window.show('mac', false, true);

    const doc = dom.window.document;
    expect(doc.getElementsByClassName('platform-mac state-on')[0].innerText).toContain(
      '활성화되어 있습니다.',
    );
    expect(doc.getElementsByClassName('platform-mac open-preferences')[0].innerText).toBe(
      'Safari 확장 프로그램 설정 열기',
    );
    expect(doc.body.classList.contains('state-on')).toBe(false);
    expect(doc.body.classList.contains('state-off')).toBe(true);
  });

  it('show(platform, enabled=unknown) 는 on/off 클래스를 제거한다', async () => {
    dom = await setup();
    dom.window.document.body.classList.add('state-on', 'state-off');

    dom.window.show('ios', undefined, false);

    expect(dom.window.document.body.classList.contains('platform-ios')).toBe(true);
    expect(dom.window.document.body.classList.contains('state-on')).toBe(false);
    expect(dom.window.document.body.classList.contains('state-off')).toBe(false);
  });

  it('openPreferences 버튼 클릭 시 네이티브 메시지를 보낸다', async () => {
    dom = await setup();

    dom.window.document.querySelector('button.open-preferences').click();

    expect(
      dom.window.webkit.messageHandlers.controller.postMessage,
    ).toHaveBeenCalledWith('open-preferences');
  });
});
