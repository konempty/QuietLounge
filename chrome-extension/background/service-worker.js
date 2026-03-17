// QuietLounge — Background Service Worker

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'UPDATE_BADGE') {
    const count = message.count;
    const text = count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ text, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: sender.tab?.id });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[QuietLounge] 확장 프로그램 설치됨');
});
