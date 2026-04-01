// QuietLounge — Popup UI

const STORAGE_KEY = 'quiet_lounge_data';
const FILTER_MODE_KEY = 'quiet_lounge_filter_mode';

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
    const result = await browser.storage.local.get(STORAGE_KEY);
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
  await browser.storage.local.remove(STORAGE_KEY);
  await browser.storage.local.set({ [STORAGE_KEY]: value });
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
  const json = JSON.stringify(blockData, null, 2);
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
    blockData = parsed;
    await saveData();
    render();
    alert('차단 목록을 가져왔습니다.');
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
  browser.storage.local.set({ [FILTER_MODE_KEY]: mode });
  updateFilterModeUI(mode);
});

// ── 내 활동 통계 ──
// content script가 storage에 저장한 통계를 읽어서 표시
function loadMyStats() {
  const section = document.getElementById('my-stats-section');
  const hint = document.getElementById('my-stats-hint');

  browser.storage.local.get('quiet_lounge_my_stats', (result) => {
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
  const check = await browser.storage.local.get('quiet_lounge_my_stats');
  if (!check.quiet_lounge_my_stats) {
    hint.textContent = '라운지에 접속하면 통계가 자동으로 갱신됩니다';
    return;
  }
  hint.textContent = '갱신 중...';
  await browser.storage.local.remove('quiet_lounge_refresh_stats');
  await browser.storage.local.set({ quiet_lounge_refresh_stats: Date.now() });

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

// ── 초기화 ──
// 내 통계는 독립적으로 즉시 로드
loadMyStats();

loadData().then(() => {
  render();
  browser.storage.local.get(FILTER_MODE_KEY, (result) => {
    updateFilterModeUI(result[FILTER_MODE_KEY] || 'hide');
  });
});
