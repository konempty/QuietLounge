// QuietLounge — Background Service Worker

const browser = globalThis.browser || globalThis.chrome;

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'UPDATE_BADGE') {
    const count = message.count;
    const text = count > 0 ? String(count) : '';
    browser.action.setBadgeText({ text, tabId: sender.tab?.id });
    browser.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: sender.tab?.id });
  }

  if (message.type === 'REFRESH_MY_STATS') {
    browser.tabs.query({ url: 'https://lounge.naver.com/*' }, (tabs) => {
      for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, { type: 'REFRESH_MY_STATS' }).catch(() => {});
      }
    });
  }
});

browser.runtime.onInstalled.addListener(() => {});
