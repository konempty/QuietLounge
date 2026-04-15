// QuietLounge — Popup UI

const STORAGE_KEY = 'quiet_lounge_data';
const FILTER_MODE_KEY = 'quiet_lounge_filter_mode';

// 푸터 버전 표시 (manifest.json의 version)
try {
  const manifest = chrome.runtime.getManifest();
  const versionEl = document.getElementById('app-version');
  if (versionEl && manifest?.version) {
    versionEl.textContent = `v${manifest.version}`;
  }
} catch {
  // 무시
}

function createEmptyData() {
  return {
    version: 2,
    blockedUsers: {},
    nicknameOnlyBlocks: [],
    personaCache: {},
  };
}

let blockData = createEmptyData();

// ── 데이터 로드/저장 ──
async function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (result[STORAGE_KEY]) {
        try {
          blockData = JSON.parse(result[STORAGE_KEY]);
        } catch {
          blockData = createEmptyData();
        }
      }
      resolve();
    });
  });
}

async function saveData() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(blockData) }, resolve);
  });
}

// ── UI 렌더링 ──
function render() {
  const personaBlocked = Object.values(blockData.blockedUsers);
  const nicknameBlocked = blockData.nicknameOnlyBlocks;
  const total = personaBlocked.length + nicknameBlocked.length;

  document.getElementById('blocked-count').textContent = total;
  document.getElementById('persona-count').textContent = personaBlocked.length;
  document.getElementById('nickname-count').textContent = nicknameBlocked.length;

  const container = document.getElementById('block-list-container');

  if (total === 0) {
    container.innerHTML = '<p class="empty-message">차단된 유저가 없습니다</p>';
    return;
  }

  let html = '';

  // personaId 차단 유저
  personaBlocked
    .sort((a, b) => new Date(b.blockedAt) - new Date(a.blockedAt))
    .forEach((user) => {
      const date = new Date(user.blockedAt).toLocaleDateString('ko-KR');
      html += `
        <div class="block-item">
          <div class="block-item-info">
            <div class="block-item-nickname">${escapeHtml(user.nickname)}</div>
            <div class="block-item-meta">
              <span class="block-item-id">${user.personaId}</span> · ${date}
            </div>
            ${user.reason ? `<div class="block-item-reason">${escapeHtml(user.reason)}</div>` : ''}
          </div>
          <button class="btn-unblock" data-type="persona" data-id="${user.personaId}">해제</button>
        </div>
      `;
    });

  // 닉네임만 차단
  nicknameBlocked
    .sort((a, b) => new Date(b.blockedAt) - new Date(a.blockedAt))
    .forEach((block) => {
      const date = new Date(block.blockedAt).toLocaleDateString('ko-KR');
      html += `
        <div class="block-item">
          <div class="block-item-info">
            <div class="block-item-nickname">${escapeHtml(block.nickname)}</div>
            <div class="block-item-meta">닉네임만 · ${date}</div>
            ${block.reason ? `<div class="block-item-reason">${escapeHtml(block.reason)}</div>` : ''}
          </div>
          <button class="btn-unblock" data-type="nickname" data-nickname="${escapeHtml(block.nickname)}">해제</button>
        </div>
      `;
    });

  container.innerHTML = html;

  // 해제 버튼 이벤트
  container.querySelectorAll('.btn-unblock').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      if (type === 'persona') {
        delete blockData.blockedUsers[btn.dataset.id];
      } else {
        blockData.nicknameOnlyBlocks = blockData.nicknameOnlyBlocks.filter(
          (b) => b.nickname !== btn.dataset.nickname,
        );
      }
      await saveData();
      render();
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Export/Import ──
document.getElementById('btn-export').addEventListener('click', async () => {
  const alertResult = await new Promise((resolve) => {
    chrome.storage.local.get([KEYWORD_ALERTS_KEY, ALERT_INTERVAL_KEY], resolve);
  });

  // personaCache 는 런타임 캐시 — README 및 다른 플랫폼과 일치시키기 위해 export 에서 제외
  const { personaCache: _cache, ...exportData } = blockData;
  // keywordAlerts 는 길이와 무관하게 항상 포함 — 빈 배열도 "전부 해제" 라는 유효한 상태.
  exportData.keywordAlerts = alertResult[KEYWORD_ALERTS_KEY] ? JSON.parse(alertResult[KEYWORD_ALERTS_KEY]) : [];
  const interval = alertResult[ALERT_INTERVAL_KEY];
  if (interval) {
    exportData.alertInterval = interval;
  }

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quiet-lounge-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('file-import').click();
});

document.getElementById('file-import').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed.version !== 2) {
      alert('지원하지 않는 형식입니다.');
      return;
    }

    // 키워드 알림 데이터 분리 후 복원
    const importedAlerts = parsed.keywordAlerts;
    const importedInterval = parsed.alertInterval;
    delete parsed.keywordAlerts;
    delete parsed.alertInterval;

    blockData = parsed;
    await saveData();
    render();

    // keywordAlerts 필드가 존재하면 길이와 무관하게 반영 (빈 배열 = 전체 해제 의도)
    // 필드가 없으면 기존 알림 유지
    if (Array.isArray(importedAlerts)) {
      keywordAlerts = importedAlerts;
      await saveKeywordAlerts();
      renderKeywordAlerts();
    }
    if (typeof importedInterval === 'number' && Number.isFinite(importedInterval)) {
      // README 문서상 허용 범위 1~60 분. 외부 백업이 9999 같은 값을 넣어도 폴링이 멈추지 않도록 clamp.
      const clamped = Math.min(60, Math.max(1, Math.round(importedInterval)));
      document.getElementById('alert-interval').value = clamped;
      updateIntervalWarning(clamped);
      chrome.storage.local.set({ [ALERT_INTERVAL_KEY]: clamped });
    }

    alert('데이터를 가져왔습니다.');
  } catch {
    alert('올바른 JSON 파일이 아닙니다.');
  }
  e.target.value = '';
});

// ── 스토리지 변경 감지 ──
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    try {
      blockData = JSON.parse(changes[STORAGE_KEY].newValue);
    } catch {
      blockData = createEmptyData();
    }
    render();
  }
});

// ── 필터 모드 토글 ──
const filterToggle = document.getElementById('filter-mode-toggle');
const filterDesc = document.getElementById('filter-mode-desc');

function updateFilterModeUI(mode) {
  filterToggle.checked = mode === 'blur';
  filterDesc.textContent =
    mode === 'blur' ? '차단된 글을 흐리게 표시합니다' : '차단된 글을 완전히 숨깁니다';
}

filterToggle.addEventListener('change', () => {
  const mode = filterToggle.checked ? 'blur' : 'hide';
  chrome.storage.local.set({ [FILTER_MODE_KEY]: mode });
  updateFilterModeUI(mode);
});

// ── 내 활동 통계 ──
// content script가 storage에 저장한 통계를 읽어서 표시
function loadMyStats() {
  const section = document.getElementById('my-stats-section');
  const hint = document.getElementById('my-stats-hint');

  chrome.storage.local.get('quiet_lounge_my_stats', (result) => {
    const raw = result.quiet_lounge_my_stats;
    section.style.display = 'block';

    if (!raw) {
      hint.textContent = '라운지에 접속하면 통계가 자동으로 갱신됩니다';
      return;
    }

    try {
      const stats = JSON.parse(raw);
      document.getElementById('my-total-posts').textContent = stats.totalPosts ?? '-';
      document.getElementById('my-total-comments').textContent = stats.totalComments ?? '-';
      const mpEl = document.getElementById('my-monthly-posts');
      const mcEl = document.getElementById('my-monthly-comments');
      if (stats.monthlyPosts === '...') {
        mpEl.innerHTML = '<span class="ql-spinner"></span>';
      } else {
        mpEl.textContent = stats.monthlyPosts ?? '-';
      }
      if (stats.monthlyComments === '...') {
        mcEl.innerHTML = '<span class="ql-spinner"></span>';
      } else {
        mcEl.textContent = stats.monthlyComments ?? '-';
      }
      hint.textContent = '';
    } catch {
      hint.textContent = '통계를 불러올 수 없습니다';
    }
  });
}

// storage 변경 시 팝업 자동 갱신
chrome.storage.onChanged.addListener((changes) => {
  if (changes.quiet_lounge_my_stats) {
    loadMyStats();
  }
});

// 갱신 버튼 — 라운지 탭의 content script에 갱신 요청
document.getElementById('btn-refresh-stats').addEventListener('click', () => {
  document.getElementById('my-stats-hint').textContent = '갱신 중...';
  chrome.tabs.query({ url: 'https://lounge.naver.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'REFRESH_MY_STATS' });
    } else {
      document.getElementById('my-stats-hint').textContent =
        '라운지 탭이 열려있어야 갱신할 수 있습니다';
    }
  });
});

// ── QR 모달 ──
document.getElementById('btn-support').addEventListener('click', () => {
  document.getElementById('qr-modal').classList.add('active');
});
document.getElementById('qr-modal-close').addEventListener('click', () => {
  document.getElementById('qr-modal').classList.remove('active');
});
document.getElementById('qr-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('active');
  }
});

// ── 키워드 알림 ──
const KEYWORD_ALERTS_KEY = 'quiet_lounge_keyword_alerts';
const ALERT_INTERVAL_KEY = 'quiet_lounge_alert_interval';

let keywordAlerts = [];
let pendingKeywords = [];
let selectedChannel = null;

async function loadKeywordAlerts() {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEYWORD_ALERTS_KEY, ALERT_INTERVAL_KEY], (result) => {
      keywordAlerts = result[KEYWORD_ALERTS_KEY] ? JSON.parse(result[KEYWORD_ALERTS_KEY]) : [];
      const interval = result[ALERT_INTERVAL_KEY] || 5;
      document.getElementById('alert-interval').value = interval;
      updateIntervalWarning(interval);
      resolve();
    });
  });
}

async function saveKeywordAlerts() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [KEYWORD_ALERTS_KEY]: JSON.stringify(keywordAlerts) }, resolve);
  });
}

function renderKeywordAlerts() {
  const container = document.getElementById('keyword-alerts-list');

  if (keywordAlerts.length === 0) {
    container.innerHTML = '<p class="empty-message">등록된 키워드 알림이 없습니다</p>';
    return;
  }

  let html = '';
  keywordAlerts.forEach((alert, idx) => {
    html += `
      <div class="alert-item ${alert.enabled ? '' : 'alert-disabled'}">
        <div class="alert-item-info">
          <div class="alert-item-channel">${escapeHtml(alert.channelName)}</div>
          <div class="alert-item-keywords">${alert.keywords.map((k) => `<span class="alert-keyword-tag">${escapeHtml(k)}</span>`).join('')}</div>
        </div>
        <div class="alert-item-actions">
          <label class="toggle toggle-sm">
            <input type="checkbox" class="alert-toggle" data-idx="${idx}" ${alert.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-delete-alert" data-idx="${idx}" title="삭제">&times;</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // 토글 이벤트
  container.querySelectorAll('.alert-toggle').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      const idx = parseInt(toggle.dataset.idx);
      keywordAlerts[idx].enabled = toggle.checked;
      await saveKeywordAlerts();
      renderKeywordAlerts();
    });
  });

  // 삭제 이벤트
  container.querySelectorAll('.btn-delete-alert').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      keywordAlerts.splice(idx, 1);
      await saveKeywordAlerts();
      renderKeywordAlerts();
    });
  });
}

// 주기 설정
const intervalInput = document.getElementById('alert-interval');
const intervalWarning = document.getElementById('interval-warning');

function updateIntervalWarning(val) {
  intervalWarning.style.display = val < 3 ? 'block' : 'none';
}

intervalInput.addEventListener('change', () => {
  let val = parseInt(intervalInput.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 60) val = 60;
  intervalInput.value = val;
  updateIntervalWarning(val);
  chrome.storage.local.set({ [ALERT_INTERVAL_KEY]: val });
});

// ── 알림 추가 모달 ──
const alertModal = document.getElementById('alert-modal');
const stepCategory = document.getElementById('step-category');
const stepChannel = document.getElementById('step-channel');
const stepKeywords = document.getElementById('step-keywords');

function openAlertModal() {
  alertModal.classList.add('active');
  showStep('category');
  loadCategories();
}

function closeAlertModal() {
  alertModal.classList.remove('active');
  pendingKeywords = [];
  selectedChannel = null;
}

function showStep(step) {
  stepCategory.style.display = step === 'category' ? 'block' : 'none';
  stepChannel.style.display = step === 'channel' ? 'block' : 'none';
  stepKeywords.style.display = step === 'keywords' ? 'block' : 'none';

  const titles = { category: '카테고리 선택', channel: '채널 선택', keywords: '키워드 입력' };
  document.getElementById('alert-modal-title').textContent = titles[step];
}

// 카테고리 로드
function loadCategories() {
  const list = document.getElementById('category-list');
  list.innerHTML = '<p class="loading-message">불러오는 중...</p>';

  chrome.runtime.sendMessage({ type: 'FETCH_CATEGORIES' }, (resp) => {
    if (resp?.error || !resp?.data) {
      list.innerHTML = '<p class="error-message">불러오기 실패</p>';
      return;
    }

    const items = resp.data.items || [];
    window.__qlCategories = items;
    renderCategoryList(items);
  });
}

function renderCategoryList(items) {
  const list = document.getElementById('category-list');
  if (items.length === 0) {
    list.innerHTML = '<p class="empty-message">카테고리가 없습니다</p>';
    return;
  }

  list.innerHTML = items
    .map(
      (c) => `
      <div class="select-item" data-category-id="${c.categoryId}">
        <span class="select-item-name">${escapeHtml(c.name)}</span>
      </div>
    `,
    )
    .join('');

  list.querySelectorAll('.select-item').forEach((el) => {
    el.addEventListener('click', () => {
      const catId = el.dataset.categoryId;
      const catName = el.querySelector('.select-item-name').textContent;
      showStep('channel');
      loadChannels(catId, catName);
    });
  });
}

// 카테고리 검색
document.getElementById('category-search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const items = (window.__qlCategories || []).filter((c) => c.name.toLowerCase().includes(query));
  renderCategoryList(items);
});

// 채널 로드
function loadChannels(categoryId) {
  const list = document.getElementById('channel-list');
  list.innerHTML = '<p class="loading-message">불러오는 중...</p>';

  chrome.runtime.sendMessage({ type: 'FETCH_CHANNELS', categoryId }, (resp) => {
    if (resp?.error || !resp?.data) {
      list.innerHTML = '<p class="error-message">불러오기 실패</p>';
      return;
    }

    window.__qlChannels = resp.data;
    renderChannelList(resp.data);
  });
}

function renderChannelList(items) {
  const list = document.getElementById('channel-list');
  if (items.length === 0) {
    list.innerHTML = '<p class="empty-message">채널이 없습니다</p>';
    return;
  }

  list.innerHTML = items
    .map(
      (ch) => `
      <div class="select-item" data-channel-id="${ch.finalChannelId}" data-channel-name="${escapeHtml(ch.name)}">
        <span class="select-item-name">${escapeHtml(ch.name)}</span>
      </div>
    `,
    )
    .join('');

  list.querySelectorAll('.select-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectedChannel = {
        channelId: el.dataset.channelId,
        channelName: el.dataset.channelName,
      };
      document.getElementById('selected-channel-info').textContent = selectedChannel.channelName;
      pendingKeywords = [];
      renderPendingKeywords();
      document.getElementById('btn-save-alert').disabled = true;
      showStep('keywords');
    });
  });
}

// 채널 검색
document.getElementById('channel-search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const items = (window.__qlChannels || []).filter((c) => c.name.toLowerCase().includes(query));
  renderChannelList(items);
});

// 키워드 입력
const keywordInput = document.getElementById('keyword-input');
const btnAddKeyword = document.getElementById('btn-add-keyword');

function addPendingKeyword() {
  const kw = keywordInput.value.trim();
  if (!kw) return;
  if (pendingKeywords.includes(kw)) {
    keywordInput.value = '';
    return;
  }
  pendingKeywords.push(kw);
  keywordInput.value = '';
  renderPendingKeywords();
  document.getElementById('btn-save-alert').disabled = pendingKeywords.length === 0;
}

keywordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addPendingKeyword();
  }
});
btnAddKeyword.addEventListener('click', addPendingKeyword);

function renderPendingKeywords() {
  const container = document.getElementById('keyword-tags');
  container.innerHTML = pendingKeywords
    .map(
      (kw, i) =>
        `<span class="keyword-tag">${escapeHtml(kw)}<button class="keyword-tag-remove" data-idx="${i}">&times;</button></span>`,
    )
    .join('');

  container.querySelectorAll('.keyword-tag-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingKeywords.splice(parseInt(btn.dataset.idx), 1);
      renderPendingKeywords();
      document.getElementById('btn-save-alert').disabled = pendingKeywords.length === 0;
    });
  });
}

// 알림 저장
const PENDING_ALERT_KEY = 'quiet_lounge_pending_alert';

async function saveAlertEntry() {
  keywordAlerts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    channelId: selectedChannel.channelId,
    channelName: selectedChannel.channelName,
    keywords: [...pendingKeywords],
    enabled: true,
    createdAt: new Date().toISOString(),
  });
  await saveKeywordAlerts();
  renderKeywordAlerts();
  closeAlertModal();
}

document.getElementById('btn-save-alert').addEventListener('click', async () => {
  if (!selectedChannel || pendingKeywords.length === 0) return;

  const hasPermission = await new Promise((resolve) => {
    chrome.permissions.contains({ permissions: ['notifications'] }, resolve);
  });

  if (hasPermission) {
    await saveAlertEntry();
    return;
  }

  // 권한 요청 시 팝업이 닫힐 수 있으므로, 임시 저장 후 요청
  const pendingAlert = {
    channelId: selectedChannel.channelId,
    channelName: selectedChannel.channelName,
    keywords: [...pendingKeywords],
  };
  await new Promise((resolve) => {
    chrome.storage.local.set({ [PENDING_ALERT_KEY]: JSON.stringify(pendingAlert) }, resolve);
  });

  chrome.permissions.request({ permissions: ['notifications'] }, async (granted) => {
    // 팝업이 안 닫힌 경우 여기로 옴
    await chrome.storage.local.remove(PENDING_ALERT_KEY);
    if (granted) {
      await saveAlertEntry();
    } else {
      alert('알림 권한이 필요합니다. 권한을 허용해 주세요.');
    }
  });
});

// 팝업 열릴 때 임시 저장된 알림이 있으면 자동 완료
async function finalizePendingAlert() {
  const result = await new Promise((resolve) => {
    chrome.storage.local.get(PENDING_ALERT_KEY, resolve);
  });
  const raw = result[PENDING_ALERT_KEY];
  if (!raw) return;

  const hasPermission = await new Promise((resolve) => {
    chrome.permissions.contains({ permissions: ['notifications'] }, resolve);
  });

  await chrome.storage.local.remove(PENDING_ALERT_KEY);

  if (!hasPermission) return;

  const pending = JSON.parse(raw);
  keywordAlerts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    channelId: pending.channelId,
    channelName: pending.channelName,
    keywords: pending.keywords,
    enabled: true,
    createdAt: new Date().toISOString(),
  });
  await saveKeywordAlerts();
  renderKeywordAlerts();
}

// 모달 버튼 이벤트
document.getElementById('btn-add-alert').addEventListener('click', openAlertModal);
document.getElementById('alert-modal-close').addEventListener('click', closeAlertModal);
alertModal.addEventListener('click', (e) => {
  if (e.target === alertModal) closeAlertModal();
});

document.getElementById('btn-back-category').addEventListener('click', () => {
  showStep('category');
  document.getElementById('channel-search').value = '';
});
document.getElementById('btn-back-channel').addEventListener('click', () => {
  showStep('channel');
  document.getElementById('keyword-input').value = '';
});

// 스토리지 변경 감지
chrome.storage.onChanged.addListener((changes) => {
  if (changes[KEYWORD_ALERTS_KEY]) {
    keywordAlerts = changes[KEYWORD_ALERTS_KEY].newValue
      ? JSON.parse(changes[KEYWORD_ALERTS_KEY].newValue)
      : [];
    renderKeywordAlerts();
  }
});

// ── 초기화 ──
// 내 통계는 독립적으로 즉시 로드
loadMyStats();

loadData().then(() => {
  render();
  chrome.storage.local.get(FILTER_MODE_KEY, (result) => {
    updateFilterModeUI(result[FILTER_MODE_KEY] || 'hide');
  });
});

loadKeywordAlerts().then(async () => {
  renderKeywordAlerts();
  await finalizePendingAlert();
});
