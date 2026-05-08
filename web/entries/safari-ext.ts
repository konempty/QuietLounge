// @ts-nocheck
// QuietLounge — Content Script (Safari Web Extension, iOS + macOS)
//
// 이 파일은 esbuild 가 IIFE 로 번들해
// safari-extension/QuietLounge/Shared (Extension)/Resources/content-scripts/main.js 산출물을 만든다.
// manifest.json 의 content_scripts 가 직접 가리키며 Xcode "Copy Bundle Resources" 가 .appex 에 복사.
// 핵심 inject 로직은 web/core, 이 entry 는 Safari 고유 로직 (qlConfirm DOM modal /
// storage-bridge / bfcache liveButtons / macOS 알림 권한 배너 등) 만 담당.

import { STORAGE_KEY, FILTER_MODE_KEY, DONT_SHOW_FILTER_HINT_KEY } from '../core/storage-keys';
import { isActivePage } from '../core/pages';
import { isBlocked as sharedIsBlocked } from '../core/block-check';
import { runFilterPass } from '../core/filter-engine';
import { injectBlockButtons, findPersonaId as sharedFindPersonaId } from '../core/inject-buttons';
import {
  injectProfileStats as sharedInjectProfileStats,
  resetProfileStatsCache as sharedResetProfileStatsCache,
  fetchAndStoreMyStats as sharedFetchAndStoreMyStats,
  isProfilePage as sharedIsProfilePage,
} from '../core/profile-stats';
import type { InjectButtonsAdapter, ProfileStatsAdapter } from '../platform/adapter';

(function () {
  'use strict';

  const browser = globalThis.browser || globalThis.chrome;

  // QuietLounge 브랜드 컬러 — 다크 모드에선 어두운 배경 위 시인성을 위해 한 톤 밝게 사용.
  // 네이버 라운지 페이지 렌더 시점에 한번 계산 — 시스템 테마 전환은 재로드 후 반영.
  const QL_PRIMARY =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? '#6A86F8'
      : '#4A6CF7';

  // Safari Web Extension에서는 storage-bridge.js가 __QL_storage를 노출.
  // 있으면 그쪽을 우선 사용 (App Group 공유), 없으면 기본 storage 사용.
  const QLStorage =
    typeof globalThis.__QL_storage !== 'undefined' && globalThis.__QL_storage._ready
      ? globalThis.__QL_storage
      : browser.storage.local;

  // ── 유틸 ──
  function debounce(fn, delay) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  // ── 차단 목록 관리 ──
  function createEmptyData() {
    return {
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
    };
  }

  let blockData = createEmptyData();
  let filterMode = 'hide'; // 'hide' or 'blur'
  let dontShowFilterHint = false;

  // Safari quota 버그 대응: 기존 키 삭제 후 저장
  async function safariSet(data) {
    try {
      await QLStorage.remove(Object.keys(data));
      await QLStorage.set(data);
    } catch {
      // 저장 실패 무시
    }
  }

  async function loadBlockData() {
    try {
      const result = await QLStorage.get([STORAGE_KEY, FILTER_MODE_KEY, DONT_SHOW_FILTER_HINT_KEY]);
      if (result[STORAGE_KEY]) {
        blockData = JSON.parse(result[STORAGE_KEY]);
      }
      if (result[FILTER_MODE_KEY]) {
        filterMode = result[FILTER_MODE_KEY];
      }
      dontShowFilterHint = !!result[DONT_SHOW_FILTER_HINT_KEY];
    } catch {
      blockData = createEmptyData();
    }
  }

  async function saveBlockData() {
    const toSave = {
      version: blockData.version || 2,
      blockedUsers: blockData.blockedUsers || {},
      nicknameOnlyBlocks: blockData.nicknameOnlyBlocks || [],
      personaCache: {},
    };
    await safariSet({ [STORAGE_KEY]: JSON.stringify(toSave) });
  }

  // closure 캡쳐된 blockData 를 shared isBlocked 에 위임 — 4 플랫폼 동일 시맨틱.
  function isBlocked(personaId, nickname) {
    return sharedIsBlocked(blockData, personaId, nickname);
  }

  async function blockUser(personaId, nickname) {
    if (personaId) {
      const existing = blockData.blockedUsers[personaId];
      blockData.blockedUsers[personaId] = {
        personaId,
        nickname,
        blockedAt: existing?.blockedAt ?? new Date().toISOString(),
      };
      blockData.nicknameOnlyBlocks = blockData.nicknameOnlyBlocks.filter(
        (b) => b.nickname !== nickname,
      );
    } else {
      if (isBlocked(undefined, nickname)) return;
      blockData.nicknameOnlyBlocks.push({
        nickname,
        blockedAt: new Date().toISOString(),
      });
    }
    await saveBlockData();
  }

  // ── 차단 직후 "흐림 처리 모드 안내" Hint 다이얼로그 ──
  // 사용자가 매 차단마다 안내를 받게 됨 (HIDE 모드 + "다시 보지 않기" 미선택 한정).
  // qlConfirm 과 같은 DOM modal 패턴 — 두 버튼 (확인 / 다시 보지 않기).
  function qlFilterHintDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;' +
        'display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText =
        'background:#1a1a1a;color:#e0e0e0;border-radius:14px;padding:20px;' +
        'max-width:340px;width:90%;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
        'box-shadow:0 4px 24px rgba(0,0,0,0.4);';

      const title = document.createElement('p');
      title.textContent = '팁: 흐림 처리 모드';
      title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 10px;';

      const msg = document.createElement('p');
      msg.textContent =
        "차단된 글을 완전히 숨기는 대신 흐리게만 처리할 수도 있어요. 익스텐션 팝업의 '흐림 처리' 토글에서 켤 수 있습니다.";
      msg.style.cssText = 'font-size:14px;margin:0 0 18px;line-height:1.5;color:#bbb;';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;';

      const dontBtn = document.createElement('button');
      dontBtn.textContent = '다시 보지 않기';
      dontBtn.style.cssText =
        'flex:1;padding:10px;border:1px solid #444;background:transparent;color:#aaa;' +
        'border-radius:8px;font-size:13px;cursor:pointer;';

      const okBtn = document.createElement('button');
      okBtn.textContent = '확인';
      okBtn.style.cssText =
        'flex:1;padding:10px;border:none;background:#4A6CF7;color:#fff;' +
        'border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      dontBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        close('dontShow');
      });
      okBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        close('confirm');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close('confirm');
      });

      btnRow.appendChild(dontBtn);
      btnRow.appendChild(okBtn);
      dialog.appendChild(title);
      dialog.appendChild(msg);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  /**
   * 차단 직후 호출 — HIDE 모드 + 안내 안 끔이면 hint 표시.
   * iOS QuietLoungeCore.shouldShowFilterModeHint /
   * Android WebViewToolbarLogic.shouldShowFilterModeHint 와 동일 시맨틱.
   */
  async function maybeShowFilterModeHint() {
    if (filterMode === 'blur') return;
    if (dontShowFilterHint) return;
    const result = await qlFilterHintDialog();
    if (result === 'dontShow') {
      dontShowFilterHint = true;
      try {
        await safariSet({ [DONT_SHOW_FILTER_HINT_KEY]: true });
      } catch {
        // 저장 실패 무시
      }
    }
  }

  // ── API 인터셉터 (MAIN world에서 수신) ──
  // api-interceptor.js가 MAIN world에서 fetch를 patch하고,
  // postMessage로 personaMap/personaCache를 전달함
  const personaMap = new Map(); // postId → personaId
  const personaCache = new Map(); // personaId → { nickname }

  function installApiInterceptor() {
    // MAIN world(api-interceptor.js)에서 보내는 매핑 데이터 수신
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'QUIET_LOUNGE_API_DATA') return;

      const mapData = event.data.personaMap;
      const cacheData = event.data.personaCache;

      if (mapData && typeof mapData === 'object') {
        for (const [postId, personaId] of Object.entries(mapData)) {
          personaMap.set(postId, personaId);
        }
      }
      if (cacheData && typeof cacheData === 'object') {
        for (const [personaId, nickname] of Object.entries(cacheData)) {
          personaCache.set(personaId, { nickname });
        }
      }

      filterAll();
      autoPromoteBlocks();
    });

    // MAIN world에 현재 수집된 데이터 요청 (이미 수집된 게 있을 수 있음)
    window.postMessage({ type: 'QUIET_LOUNGE_REQUEST_DATA' }, '*');
  }

  async function autoPromoteBlocks() {
    let changed = false;
    for (const [pid, { nickname }] of personaCache) {
      const idx = blockData.nicknameOnlyBlocks.findIndex((b) => b.nickname === nickname);
      if (idx !== -1) {
        const block = blockData.nicknameOnlyBlocks.splice(idx, 1)[0];
        blockData.blockedUsers[pid] = {
          personaId: pid,
          nickname,
          blockedAt: block.blockedAt,
        };
        changed = true;
      }
      if (blockData.blockedUsers[pid] && blockData.blockedUsers[pid].nickname !== nickname) {
        // 닉네임 갱신만 — 옛 닉네임 추적은 더 이상 안 함.
        blockData.blockedUsers[pid].nickname = nickname;
        changed = true;
      }
    }
    if (changed) await saveBlockData();
  }

  // ── 필터 엔진 ──
  // 핵심 로직은 web/core/filter-engine.ts 의 runFilterPass — 4 플랫폼 동일.
  // Safari ext 도 차단 카운트를 badge 로 노출하므로 entry 가 후처리.
  function filterAll() {
    if (!isActivePage()) return;
    const totalBlocked = runFilterPass({
      blockData,
      filterMode,
      personaIdForPost: (id) => personaMap.get(id),
    });
    browser.runtime.sendMessage({ type: 'UPDATE_BADGE', count: totalBlocked });
  }

  // ── UI Injector (차단 버튼) ──
  // findPersonaId 와 path A / path B 분기는 web/core/inject-buttons.ts. Safari ext 책임은
  // (a) qlConfirm DOM modal (Safari 의 confirm 봉쇄 우회 + iOS tap-through 가드) (b) bfcache 의
  // liveButtons WeakSet 가드 — 두 가지가 다른 플랫폼 entry 와 다른 부분.

  // ── 커스텀 확인 다이얼로그 (iOS Safari에서 confirm() 억제 대응) ──
  // iOS Safari 의 tap-through 가드: 사용자가 X 버튼을 탭하면 touchend 직후 synthetic click 이
  // 발생하는데, 그 click 이 새로 등장한 다이얼로그의 차단/취소 버튼 위에 떨어지면 의도치 않은
  // 즉시 confirm/dismiss 가 일어난다 (X 버튼 ≈ 다이얼로그 차단 버튼이 화면 우측에 위치할 때).
  // 다이얼로그 표시 직후 짧은 시간 동안 클릭을 무시해 synthetic click 한 번을 흘려보낸다.
  const QL_TAP_THROUGH_GUARD_MS = 350;

  function qlConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText =
        'background:#1a1a1a;color:#e0e0e0;border-radius:14px;padding:20px;max-width:300px;width:90%;text-align:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.4);';

      const msg = document.createElement('p');
      msg.textContent = message;
      msg.style.cssText = 'font-size:15px;margin:0 0 18px;line-height:1.4;';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '취소';
      cancelBtn.style.cssText =
        'flex:1;padding:10px;border:1px solid #444;background:transparent;color:#aaa;border-radius:8px;font-size:14px;cursor:pointer;';

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '차단';
      confirmBtn.style.cssText =
        'flex:1;padding:10px;border:none;background:#e74c3c;color:#fff;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';

      let armed = false;
      setTimeout(() => {
        armed = true;
      }, QL_TAP_THROUGH_GUARD_MS);

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      cancelBtn.addEventListener('click', (e) => {
        if (!armed) return;
        e.stopPropagation();
        close(false);
      });
      confirmBtn.addEventListener('click', (e) => {
        if (!armed) return;
        e.stopPropagation();
        close(true);
      });
      overlay.addEventListener('click', (e) => {
        if (!armed) return;
        if (e.target === overlay) close(false);
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      dialog.appendChild(msg);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  // 살아있는 핸들러가 있는 버튼 추적 (bfcache 복원 시 WeakSet 은 초기화됨 — 죽은 버튼은 제거 후 새로 등록).
  const liveButtons = new WeakSet();

  const injectButtonsAdapter: InjectButtonsAdapter = {
    buttonClassName: 'quiet-lounge-btn',
    pathBMissingPidStrategy: 'show-error',

    createButton() {
      const btn = document.createElement('button');
      btn.className = 'quiet-lounge-btn';
      btn.textContent = '✕';
      btn.title = '이 유저 차단';
      btn.style.cssText =
        'margin-left:6px;cursor:pointer;opacity:0.6;font-size:12px;border:1px solid rgba(255,80,80,0.3);background:rgba(255,80,80,0.08);padding:1px 5px;line-height:1.2;color:#ff5050;border-radius:4px;vertical-align:middle;transition:all 0.15s;position:relative;z-index:10;';

      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
        btn.style.background = 'rgba(255,80,80,0.2)';
        btn.style.borderColor = 'rgba(255,80,80,0.6)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.6';
        btn.style.background = 'rgba(255,80,80,0.08)';
        btn.style.borderColor = 'rgba(255,80,80,0.3)';
      });
      btn.addEventListener(
        'mousedown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        },
        true,
      );
      btn.addEventListener(
        'pointerdown',
        (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
        },
        true,
      );

      return btn;
    },

    shouldSkipExistingButton(existing) {
      // bfcache 복원 시 WeakSet 은 비어 있어 false → 죽은 버튼 제거 후 새로 등록.
      return liveButtons.has(existing);
    },

    onButtonAttached(btn) {
      liveButtons.add(btn);
    },

    async onBlockClick(personaId, nickname) {
      if (!(await qlConfirm(`"${nickname}" 유저를 차단하시겠습니까?`))) return;
      await blockUser(personaId, nickname);
      filterAll();
      runInjectBlockButtons();
      await maybeShowFilterModeHint();
    },

    async onMissingPersonaId() {
      await qlConfirm('personaId를 찾을 수 없습니다. 글 상세 페이지에서 차단해주세요.');
    },
  };

  function runInjectBlockButtons() {
    injectBlockButtons(injectButtonsAdapter, {
      findPersonaId: (container) => sharedFindPersonaId(container, (id) => personaMap.get(id)),
      nicknameForPersonaId: (pid) => personaCache.get(pid)?.nickname,
    });
  }

  // ── SPA 네비게이션 감지 ──
  // Next.js SPA이므로 URL 변경 시 재필터링 필요
  let lastPath = window.location.pathname;

  function watchNavigation() {
    // popstate (뒤로/앞으로)
    window.addEventListener('popstate', onNavigate);

    // bfcache 복원 감지 (iOS Safari)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        lastPath = '';
        onNavigate();
      }
    });

    // pushState / replaceState 감시
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      origPushState.apply(this, args);
      onNavigate();
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      onNavigate();
    };
  }

  function onNavigate() {
    const newPath = window.location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;

    // 페이지 전환 시 프로필 통계 캐시 리셋
    sharedResetProfileStatsCache();

    if (isActivePage()) {
      setTimeout(() => {
        filterAll();
        runInjectBlockButtons();
      }, 500);
    }
    if (sharedIsProfilePage()) {
      setTimeout(() => sharedInjectProfileStats(profileStatsAdapter), 500);
    }
  }

  // ── 스토리지 변경 감지 (popup에서 해제 시 반영) ──
  browser.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) {
      try {
        blockData = JSON.parse(changes[STORAGE_KEY].newValue);
      } catch {
        blockData = createEmptyData();
      }
      filterAll();
    }
    if (changes[FILTER_MODE_KEY]) {
      filterMode = changes[FILTER_MODE_KEY].newValue || 'hide';
      filterAll();
    }
    if (changes[DONT_SHOW_FILTER_HINT_KEY]) {
      dontShowFilterHint = !!changes[DONT_SHOW_FILTER_HINT_KEY].newValue;
    }
  });

  // ── 프로필 통계 (web/core/profile-stats 로 이전. 어댑터만 entry 에 둠) ──
  const profileStatsAdapter: ProfileStatsAdapter = {
    qlPrimaryColor: QL_PRIMARY,
    saveOwnerPersonaId(personaId) {
      safariSet({ quiet_lounge_my_persona_id: personaId });
    },
    saveMyStats(stats) {
      safariSet({ quiet_lounge_my_stats: JSON.stringify(stats) });
    },
    removeMyStats() {
      QLStorage.remove('quiet_lounge_my_stats');
    },
  };

  // 아래는 마이그레이션 전 inline 구현. 다음 sed 에서 통째 제거.

  // ── 키워드 알림 (macOS Safari 전용) ──
  // Safari Web Extension은 browser.notifications API 미구현, popup origin은
  // Notification.requestPermission()을 거부. 대신 lounge.naver.com (HTTPS top-level)
  // origin에서 Web Notification API를 사용한다. 권한도 여기서 받는다.
  const QL_UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const QL_MAX_TOUCH = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;
  const QL_IS_IOS = /iPhone|iPad|iPod/.test(QL_UA) || (/Mac/.test(QL_UA) && QL_MAX_TOUCH > 1);
  const QL_IS_MAC = /Macintosh/.test(QL_UA) && !QL_IS_IOS;
  const NOTIF_BANNER_DISMISSED_KEY = 'quiet_lounge_notif_banner_dismissed';
  const KEYWORD_ALERTS_KEY_CS = 'quiet_lounge_keyword_alerts';

  function showNotificationFromContent(payload) {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') {
      // 권한 없으면 배너를 띄워서 사용자에게 다음 기회 제공
      maybeShowPermissionBanner(true);
      return false;
    }
    try {
      const tag = `ql_kw_${payload.postId}_${Date.now()}`;
      const url = `https://lounge.naver.com/posts/${payload.postId}`;
      const title = payload.titleB64 ? base64ToUtf8(payload.titleB64) : payload.title || '';
      const body = payload.bodyB64 ? base64ToUtf8(payload.bodyB64) : payload.body || '';
      const n = new Notification(title, {
        body,
        icon: payload.icon,
        tag,
        requireInteraction: true,
      });
      n.onclick = () => {
        try {
          window.focus();
          window.open(url, '_blank');
        } catch {
          // 무시
        }
        n.close();
      };
      return true;
    } catch (e) {
      console.warn('[QL][cs] notification create failed', e);
      return false;
    }
  }

  function base64ToUtf8(b64) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch {
      return '';
    }
  }

  async function maybeShowPermissionBanner(force) {
    if (!QL_IS_MAC) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') return;

    if (!force) {
      try {
        const result = await QLStorage.get([KEYWORD_ALERTS_KEY_CS, NOTIF_BANNER_DISMISSED_KEY]);
        if (result[NOTIF_BANNER_DISMISSED_KEY]) return;
        const alerts = result[KEYWORD_ALERTS_KEY_CS]
          ? JSON.parse(result[KEYWORD_ALERTS_KEY_CS])
          : [];
        if (!alerts.some((a) => a.enabled)) return;
      } catch {
        return;
      }
    }

    // 이미 떠 있으면 새로 안 만듦
    const existing = document.getElementById('ql-notif-banner');
    if (existing) existing.remove();

    const isDenied = Notification.permission === 'denied';
    const banner = document.createElement('div');
    banner.id = 'ql-notif-banner';
    banner.style.cssText = [
      'position:fixed',
      'top:16px',
      'right:16px',
      'z-index:2147483647',
      `background:${QL_PRIMARY}`,
      'color:#fff',
      'padding:12px 16px',
      'border-radius:8px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'font-size:13px',
      'max-width:340px',
      'display:flex',
      'gap:12px',
      'align-items:center',
    ].join(';');

    const message = isDenied
      ? 'QuietLounge 키워드 알림 권한이 거부되었습니다. 사파리 설정 → 웹사이트 → 알림에서 lounge.naver.com을 허용으로 바꾸세요.'
      : 'QuietLounge 키워드 알림을 받으려면 알림 권한을 허용해 주세요.';
    const allowLabel = '허용';
    const closeLabel = '닫기';

    const msgSpan = document.createElement('span');
    msgSpan.style.cssText = 'flex:1';
    msgSpan.textContent = message;
    const allowBtn = document.createElement('button');
    allowBtn.id = 'ql-notif-allow';
    allowBtn.style.cssText = `background:#fff;color:${QL_PRIMARY};border:none;padding:6px 12px;border-radius:4px;font-weight:600;cursor:pointer`;
    allowBtn.textContent = allowLabel;
    if (isDenied) allowBtn.style.display = 'none';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'ql-notif-dismiss';
    closeBtn.style.cssText =
      'background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:6px 10px;border-radius:4px;cursor:pointer';
    closeBtn.textContent = closeLabel;

    banner.appendChild(msgSpan);
    banner.appendChild(allowBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);

    allowBtn.addEventListener('click', () => {
      try {
        const ret = Notification.requestPermission((perm) => {
          handlePermResult(perm);
        });
        if (ret && typeof ret.then === 'function') {
          ret.then(handlePermResult).catch(() => {});
        }
      } catch {
        // 무시
      }
    });
    closeBtn.addEventListener('click', () => {
      banner.remove();
      QLStorage.set({ [NOTIF_BANNER_DISMISSED_KEY]: true });
    });

    function handlePermResult(perm) {
      if (perm === 'granted') {
        try {
          // "키워드 알림이 활성화되었습니다"
          new Notification('QuietLounge', {
            body: '키워드 알림이 활성화되었습니다.',
          });
        } catch {
          // 무시
        }
      }
      banner.remove();
      QLStorage.set({ [NOTIF_BANNER_DISMISSED_KEY]: true });
    }
  }

  // 팝업 갱신 + 키워드 알림 메시지 수신
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'REFRESH_MY_STATS') {
      sharedFetchAndStoreMyStats(profileStatsAdapter);
      return;
    }
    if (message.type === 'QL_SHOW_NOTIFICATION') {
      const ok = showNotificationFromContent(message.payload || {});
      sendResponse({ ok });
      return true;
    }
    if (message.type === 'QL_PROMPT_NOTIF_PERM') {
      // 키워드 등록 직후 background가 강제 트리거 — dismissed flag 무시하고 표시
      // dismissed flag도 함께 클리어해서 user가 다시 볼 수 있게.
      QLStorage.remove(NOTIF_BANNER_DISMISSED_KEY).then(() => {
        maybeShowPermissionBanner(true);
      });
      sendResponse({
        ok: true,
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      });
      return true;
    }
  });

  // iOS Safari 대응: storage.onChanged가 동작하지 않으므로 폴링으로 변경 감지
  let lastBlockDataHash = JSON.stringify(blockData);
  let pollTimer = null;

  function startBlockDataPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const result = await QLStorage.get([
          STORAGE_KEY,
          FILTER_MODE_KEY,
          'quiet_lounge_refresh_stats',
        ]);

        // 차단 목록 변경 감지
        const raw = result[STORAGE_KEY] || '';
        if (raw && raw !== lastBlockDataHash) {
          lastBlockDataHash = raw;
          blockData = JSON.parse(raw);
          if (isActivePage()) filterAll();
        }

        // 필터 모드 변경 감지 (네이티브 앱이 바꾼 경우)
        const newMode = result[FILTER_MODE_KEY];
        if (newMode && newMode !== filterMode) {
          filterMode = newMode;
          if (isActivePage()) filterAll();
        }

        // 통계 갱신 요청 감지
        if (result.quiet_lounge_refresh_stats) {
          await QLStorage.remove('quiet_lounge_refresh_stats');
          sharedFetchAndStoreMyStats(profileStatsAdapter);
        }
      } catch {
        // 조회 실패 무시
      }
    }, 3000);
  }

  function stopBlockDataPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startBlockDataPolling();
    else stopBlockDataPolling();
  });

  if (document.visibilityState === 'visible') startBlockDataPolling();

  // ── 초기화 ──
  async function init() {
    await loadBlockData();

    // 내 통계 자동 갱신 (라운지 접속 시마다)
    sharedFetchAndStoreMyStats(profileStatsAdapter);

    // API 인터셉터는 모든 페이지에서 설치 (personaId 수집은 어디서든)
    installApiInterceptor();

    // SPA 네비게이션 감시
    watchNavigation();

    // 현재 페이지가 활성 경로이면 필터링 시작
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  function start() {
    if (isActivePage()) {
      filterAll();
      runInjectBlockButtons();
    }
    sharedInjectProfileStats(profileStatsAdapter);
    maybeShowPermissionBanner();

    // MutationObserver는 항상 설치 (SPA 전환 후 DOM 변경 대응).
    // SEL.scrollContainer 는 SPA 전환 시 detach 되어 observer 가 끊길 수 있어 document.body 사용.
    const debouncedUpdate = debounce(() => {
      if (isActivePage()) {
        filterAll();
        runInjectBlockButtons();
      }
      sharedInjectProfileStats(profileStatsAdapter);
    }, 200);

    const observer = new MutationObserver(debouncedUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
