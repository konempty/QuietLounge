// QuietLounge — Popup UI

const STORAGE_KEY = 'quiet_lounge_data';

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
          (b) => b.nickname !== btn.dataset.nickname
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
document.getElementById('btn-export').addEventListener('click', () => {
  const json = JSON.stringify(blockData, null, 2);
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

// ── 초기화 ──
loadData().then(render);
