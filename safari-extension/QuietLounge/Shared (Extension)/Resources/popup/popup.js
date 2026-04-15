// QuietLounge — Popup UI

const STORAGE_KEY = 'quiet_lounge_data';
const FILTER_MODE_KEY = 'quiet_lounge_filter_mode';

// 푸터 버전 표시 (manifest.json의 version)
try {
  const manifest = browser.runtime.getManifest();
  const versionEl = document.getElementById('app-version');
  if (versionEl && manifest?.version) {
    versionEl.textContent = `v${manifest.version}`;
  }
} catch {
  // 무시
}

// Safari Web Extension에서는 storage-bridge.js가 __QL_storage를 노출.
// 있으면 그쪽을 우선 사용 (App Group 공유), 없으면 기본 storage 사용.
const QLStorage =
  typeof globalThis.__QL_storage !== 'undefined' && globalThis.__QL_storage._ready
    ? globalThis.__QL_storage
    : browser.storage.local;

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
  try {
    const result = await QLStorage.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      blockData = JSON.parse(result[STORAGE_KEY]);
    }
  } catch {
    blockData = createEmptyData();
  }
}

async function saveData() {
  // personaCache는 용량이 크고 content script에서 재구축되므로 저장에서 제외
  const toSave = {
    version: blockData.version || 2,
    blockedUsers: blockData.blockedUsers || {},
    nicknameOnlyBlocks: blockData.nicknameOnlyBlocks || [],
    personaCache: {},
  };
  const value = JSON.stringify(toSave);
  // Safari quota 버그 대응: 기존 키 삭제 후 저장
  await QLStorage.remove(STORAGE_KEY);
  await QLStorage.set({ [STORAGE_KEY]: value });
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
  // 차단 목록 + 키워드 알림 설정까지 포함한 통합 백업 (Chrome 과 동일 스키마)
  const stored = await QLStorage.get([KEYWORD_ALERTS_KEY, ALERT_INTERVAL_KEY]);
  // personaCache 는 런타임 캐시 — 백업 제외
  const { personaCache: _cache, ...exportData } = blockData;
  // keywordAlerts 는 길이와 무관하게 항상 포함 — 빈 배열도 "전부 해제" 라는 유효한 상태.
  let alerts = [];
  if (stored[KEYWORD_ALERTS_KEY]) {
    try {
      const parsed = JSON.parse(stored[KEYWORD_ALERTS_KEY]);
      if (Array.isArray(parsed)) alerts = parsed;
    } catch {
      // 손상된 데이터는 빈 배열로 대체
    }
  }
  exportData.keywordAlerts = alerts;
  if (stored[ALERT_INTERVAL_KEY]) {
    exportData.alertInterval = stored[ALERT_INTERVAL_KEY];
  }

  const json = JSON.stringify(exportData, null, 2);
  const fileName = `quiet-lounge-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], fileName, { type: 'application/json' });

  try {
    await navigator.share({ files: [file] });
  } catch {
    // 사용자 취소 등 무시
  }
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

    // 키워드 알림 설정을 분리 (필드 존재 여부로 판정 — 빈 배열 = 전체 해제 의도)
    const importedAlerts = parsed.keywordAlerts;
    const importedInterval = parsed.alertInterval;
    delete parsed.keywordAlerts;
    delete parsed.alertInterval;

    blockData = parsed;
    await saveData();

    if (Array.isArray(importedAlerts)) {
      keywordAlerts = importedAlerts;
      await QLStorage.set({ [KEYWORD_ALERTS_KEY]: JSON.stringify(keywordAlerts) });
      renderKeywordAlerts();
    }
    if (typeof importedInterval === 'number' && Number.isFinite(importedInterval)) {
      // README 문서상 허용 범위 1~60 분. 외부 백업의 비정상 값으로 폴링이 멈추지 않도록 clamp.
      const clamped = Math.min(60, Math.max(1, Math.round(importedInterval)));
      await QLStorage.set({ [ALERT_INTERVAL_KEY]: clamped });
      const intervalInput = document.getElementById('alert-interval');
      if (intervalInput) {
        intervalInput.value = String(clamped);
        updateIntervalWarning(clamped);
      }
    }

    render();
    alert('데이터를 가져왔습니다.');
  } catch {
    alert('올바른 JSON 파일이 아닙니다.');
  }
  e.target.value = '';
});

// ── 스토리지 변경 감지 ──
browser.storage.onChanged.addListener((changes) => {
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
  QLStorage.set({ [FILTER_MODE_KEY]: mode });
  updateFilterModeUI(mode);
});

// ── 내 활동 통계 ──
// content script가 storage에 저장한 통계를 읽어서 표시
function loadMyStats() {
  const section = document.getElementById('my-stats-section');
  const hint = document.getElementById('my-stats-hint');

  Promise.resolve(QLStorage.get('quiet_lounge_my_stats')).then((result) => {
    const raw = result.quiet_lounge_my_stats;
    section.style.display = 'block';

    if (!raw) {
      // 갱신 중이면 메시지 유지 (remove→set 사이 빈 상태 무시)
      if (!refreshPollTimer) {
        hint.textContent = '라운지에 접속하면 통계가 자동으로 갱신됩니다';
      }
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

// storage 변경 시 팝업 자동 갱신 (macOS Safari에서 동작)
browser.storage.onChanged.addListener((changes) => {
  if (changes.quiet_lounge_my_stats) {
    loadMyStats();
  }
});

// 갱신 버튼 — storage에 갱신 요청 플래그 저장 (content script 폴링이 감지)
let refreshPollTimer = null;
document.getElementById('btn-refresh-stats').addEventListener('click', async () => {
  const hint = document.getElementById('my-stats-hint');
  // 기존 통계가 없으면 갱신 불가
  const check = await QLStorage.get('quiet_lounge_my_stats');
  if (!check.quiet_lounge_my_stats) {
    hint.textContent = '라운지에 접속하면 통계가 자동으로 갱신됩니다';
    return;
  }
  hint.textContent = '갱신 중...';
  await QLStorage.remove('quiet_lounge_refresh_stats');
  await QLStorage.set({ quiet_lounge_refresh_stats: Date.now() });

  // iOS Safari 대응: onChanged가 안 되므로 폴링으로 결과 감지
  if (refreshPollTimer) clearInterval(refreshPollTimer);
  let attempts = 0;
  refreshPollTimer = setInterval(async () => {
    attempts++;
    loadMyStats();
    // 10회(30초) 시도 후 중지
    if (attempts >= 10) {
      clearInterval(refreshPollTimer);
      refreshPollTimer = null;
    }
  }, 3000);
});

// ── 키워드 알림 ──
const KEYWORD_ALERTS_KEY = 'quiet_lounge_keyword_alerts';
const ALERT_INTERVAL_KEY = 'quiet_lounge_alert_interval';

let keywordAlerts = [];
let pendingKeywords = [];
let selectedChannel = null;

// 플랫폼별 키워드 알림 동작:
// - iOS: storage bridge → App Group → iOS 네이티브 KeywordAlertManager
// - macOS: background page의 browser.alarms + browser.notifications (self-contained)
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isMac = /Macintosh/.test(navigator.userAgent) && !isIOS;

const keywordHintEl = document.getElementById('keyword-alerts-hint');
if (keywordHintEl) {
  if (isIOS) {
    keywordHintEl.textContent = 'iOS 앱이 포그라운드에 있을 때만 알림이 동작합니다.';
  } else if (isMac) {
    keywordHintEl.textContent =
      '라운지 탭이 열려 있어야 알림이 동작합니다. 알림이 자동으로 사라지면 시스템 설정 → 알림 → Safari에서 스타일을 "알림"으로 바꿔주세요.';
  } else {
    keywordHintEl.style.display = 'none';
  }
}

async function loadKeywordAlerts() {
  try {
    const result = await QLStorage.get([KEYWORD_ALERTS_KEY, ALERT_INTERVAL_KEY]);
    const raw = result[KEYWORD_ALERTS_KEY];
    keywordAlerts = raw ? JSON.parse(raw) : [];
    const interval = result[ALERT_INTERVAL_KEY] || 5;
    document.getElementById('alert-interval').value = interval;
    updateIntervalWarning(interval);
  } catch {
    keywordAlerts = [];
  }
}

async function saveKeywordAlerts() {
  await QLStorage.set({ [KEYWORD_ALERTS_KEY]: JSON.stringify(keywordAlerts) });
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

  container.querySelectorAll('.alert-toggle').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      const idx = parseInt(toggle.dataset.idx);
      keywordAlerts[idx].enabled = toggle.checked;
      await saveKeywordAlerts();
      renderKeywordAlerts();
    });
  });

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

intervalInput.addEventListener('change', async () => {
  let val = parseInt(intervalInput.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 60) val = 60;
  intervalInput.value = val;
  updateIntervalWarning(val);
  await QLStorage.set({ [ALERT_INTERVAL_KEY]: val });
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

// ── 카테고리/채널 fetch (popup이 host_permissions로 직접 호출) ──
async function loadCategories() {
  const list = document.getElementById('category-list');
  list.innerHTML = '<p class="loading-message">불러오는 중...</p>';
  try {
    const resp = await fetch('https://api.lounge.naver.com/content-api/v1/categories?depth=2');
    if (!resp.ok) throw new Error('http ' + resp.status);
    const json = await resp.json();
    const items = json.data?.items || [];
    window.__qlCategories = items;
    renderCategoryList(items);
  } catch {
    list.innerHTML = '<p class="error-message">불러오기 실패</p>';
  }
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
      showStep('channel');
      loadChannels(catId);
    });
  });
}

document.getElementById('category-search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const items = (window.__qlCategories || []).filter((c) => c.name.toLowerCase().includes(query));
  renderCategoryList(items);
});

async function fetchAllChannels(categoryId) {
  const channels = [];
  let page = 1;
  const size = 50;
  let hasMore = true;
  while (hasMore) {
    const url = `https://api.lounge.naver.com/content-api/v1/channels?categoryId=${categoryId}&page=${page}&size=${size}`;
    const resp = await fetch(url);
    if (!resp.ok) break;
    const json = await resp.json();
    const items = json.data?.items || [];
    channels.push(...items);
    const pageInfo = json.data?.page;
    if (!pageInfo || page * size >= pageInfo.totalElements) {
      hasMore = false;
    } else {
      page++;
    }
  }
  return channels;
}

async function loadChannels(categoryId) {
  const list = document.getElementById('channel-list');
  list.innerHTML = '<p class="loading-message">불러오는 중...</p>';
  try {
    const channels = await fetchAllChannels(categoryId);
    window.__qlChannels = channels;
    renderChannelList(channels);
  } catch {
    list.innerHTML = '<p class="error-message">불러오기 실패</p>';
  }
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

document.getElementById('channel-search').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const items = (window.__qlChannels || []).filter((c) => c.name.toLowerCase().includes(query));
  renderChannelList(items);
});

// ── 키워드 입력 ──
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

// 알림 등록
document.getElementById('btn-save-alert').addEventListener('click', async () => {
  if (!selectedChannel || pendingKeywords.length === 0) return;

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

  // macOS Safari: 등록 직후 즉시 한 번 체크 (interval 안 기다리고)
  // + 라운지 탭에 권한 요청 배너 강제 표시 (첫 알림이 가야할 시점에 권한 받지 못하는
  //   문제 회피)
  if (isMac) {
    try {
      browser.runtime.sendMessage({ type: 'QL_KEYWORD_CHECK_NOW' }, (resp) => {
        console.log('[QL][popup] CHECK_NOW response', resp, browser.runtime.lastError);
      });
    } catch (e) {
      console.warn('[QL][popup] CHECK_NOW failed', e);
    }
    try {
      browser.runtime.sendMessage({ type: 'QL_PROMPT_NOTIF_PERM' }, (resp) => {
        console.log('[QL][popup] PROMPT_NOTIF_PERM response', resp);
        if (resp && resp.ok && resp.tabCount === 0) {
          alert(
            '키워드 알림을 사용하려면 lounge.naver.com 페이지에서 알림 권한을 한 번 허용해야 합니다.\n라운지 탭을 열고 다시 시도해 주세요.',
          );
        }
      });
    } catch (e) {
      console.warn('[QL][popup] PROMPT_NOTIF_PERM failed', e);
    }
  }
});

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

// ── iOS 감지 ──
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
  const mobileLink = document.getElementById('qr-modal-mobile-link');
  if (mobileLink) mobileLink.style.display = '';
}

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

// ── 초기화 / 재활성화 시 재로드 ──
async function refreshAll() {
  await loadData();
  render();
  try {
    const result = await QLStorage.get(FILTER_MODE_KEY);
    updateFilterModeUI(result[FILTER_MODE_KEY] || 'hide');
  } catch {
    // 로드 실패 무시
  }
  await loadKeywordAlerts();
  renderKeywordAlerts();
  loadMyStats();
}

// 팝업이 백그라운드(다른 앱으로 전환) 상태였다가 다시 보일 때 강제 재로드.
// iOS Safari extension에서는 visibilitychange / pageshow / focus 중 하나가 발생.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAll();
});
window.addEventListener('pageshow', () => {
  refreshAll();
});
window.addEventListener('focus', () => {
  refreshAll();
});

// 최초 진입
refreshAll();
