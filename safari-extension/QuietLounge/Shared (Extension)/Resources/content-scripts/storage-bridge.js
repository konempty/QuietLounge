// QuietLounge — Storage Bridge (Safari Web Extension)
// 모든 storage I/O를 background service-worker → SafariWebExtensionHandler →
// App Group(group.kr.konempty.quietlounge) UserDefaults로 위임한다.
// content script는 sendNativeMessage 직접 호출이 불가능하므로 background를 거친다.

(function () {
  const browser = globalThis.browser || globalThis.chrome;
  if (!browser?.runtime?.sendMessage) {
    return; // 환경 미지원
  }

  // 오버라이드 직전의 원본 storage.local 메서드 — legacy 마이그레이션용
  const originalGet = browser.storage?.local?.get?.bind(browser.storage.local);
  const originalRemove = browser.storage?.local?.remove?.bind(browser.storage.local);

  function sendBg(payload) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const handle = (response) => {
        if (settled) return;
        settled = true;
        if (!response || response.ok === false) {
          reject(new Error(response?.error || 'no response'));
          return;
        }
        resolve(response.response || {});
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      try {
        const maybe = browser.runtime.sendMessage(payload, (response) => {
          const err = browser.runtime.lastError;
          if (err) {
            fail(err);
            return;
          }
          handle(response);
        });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(handle, fail);
        }
      } catch (e) {
        fail(e);
      }
    });
  }

  function normalizeKeys(keys) {
    if (keys === null || keys === undefined) return [];
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys.slice();
    if (typeof keys === 'object') return Object.keys(keys);
    return [];
  }

  function applyDefaults(keys, result) {
    if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
      for (const k of Object.keys(keys)) {
        if (!(k in result)) result[k] = keys[k];
      }
    }
    return result;
  }

  const changeListeners = new Set();
  const lastSnapshot = {};

  function notifyChange(changes) {
    for (const fn of changeListeners) {
      try {
        fn(changes, 'local');
      } catch {
        // listener 에러는 무시
      }
    }
  }

  async function bridgedGet(keys) {
    const normalized = normalizeKeys(keys);
    if (normalized.length === 0) return {};
    try {
      const response = await sendBg({ type: 'QL_STORAGE_GET', keys: normalized });
      const data = response?.data || {};
      for (const k of normalized) {
        if (k in data) lastSnapshot[k] = data[k];
      }
      return applyDefaults(keys, { ...data });
    } catch {
      return applyDefaults(keys, {});
    }
  }

  async function bridgedSet(items) {
    if (!items || typeof items !== 'object') return;
    try {
      await sendBg({ type: 'QL_STORAGE_SET', items });
    } catch {
      return;
    }
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { newValue: v, oldValue: lastSnapshot[k] };
      lastSnapshot[k] = v;
    }
    notifyChange(changes);
  }

  async function bridgedRemove(keys) {
    const normalized = normalizeKeys(keys);
    if (normalized.length === 0) return;
    try {
      await sendBg({ type: 'QL_STORAGE_REMOVE', keys: normalized });
    } catch {
      return;
    }
    const changes = {};
    for (const k of normalized) {
      changes[k] = { oldValue: lastSnapshot[k] };
      delete lastSnapshot[k];
    }
    notifyChange(changes);
  }

  // ── 1) 명시적 헬퍼 노출 ──
  const helper = {
    get: bridgedGet,
    set: bridgedSet,
    remove: bridgedRemove,
    onChanged: {
      addListener: (fn) => {
        changeListeners.add(fn);
      },
      removeListener: (fn) => {
        changeListeners.delete(fn);
      },
      hasListener: (fn) => changeListeners.has(fn),
    },
    _ready: true,
  };

  try {
    Object.defineProperty(globalThis, '__QL_storage', {
      value: helper,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {
    globalThis.__QL_storage = helper;
  }

  // ── 2) browser.storage.local 오버라이드 시도 (호환성) ──
  try {
    if (browser.storage && browser.storage.local) {
      try {
        browser.storage.local.get = bridgedGet;
        browser.storage.local.set = bridgedSet;
        browser.storage.local.remove = bridgedRemove;
        browser.storage.local.clear = async () => {};
      } catch {
        // 오버라이드 실패해도 __QL_storage로 동작
      }
      try {
        browser.storage.onChanged = helper.onChanged;
      } catch {
        // 오버라이드 실패해도 __QL_storage로 동작
      }
    }
  } catch {
    // 오버라이드 실패해도 __QL_storage로 동작
  }

  // ── 3) 레거시 browser.storage.local 데이터 1회 마이그레이션 ──
  (async function migrateLegacy() {
    const MIGRATION_KEY = '__ql_legacy_storage_migrated_v1';
    const LEGACY_KEYS = [
      'quiet_lounge_data',
      'quiet_lounge_filter_mode',
      'quiet_lounge_my_stats',
      'quiet_lounge_my_persona_id',
    ];
    try {
      const flag = await sendBg({ type: 'QL_STORAGE_GET', keys: [MIGRATION_KEY] });
      if (flag?.data?.[MIGRATION_KEY]) return;

      if (!originalGet) {
        await sendBg({ type: 'QL_STORAGE_SET', items: { [MIGRATION_KEY]: true } });
        return;
      }
      const legacy = await originalGet(LEGACY_KEYS);
      const items = {};
      for (const key of LEGACY_KEYS) {
        if (legacy && legacy[key] !== undefined) items[key] = legacy[key];
      }
      if (Object.keys(items).length > 0) {
        const existing = await sendBg({ type: 'QL_STORAGE_GET', keys: Object.keys(items) });
        const toWrite = {};
        for (const [k, v] of Object.entries(items)) {
          if (!(k in (existing?.data || {}))) toWrite[k] = v;
        }
        if (Object.keys(toWrite).length > 0) {
          await sendBg({ type: 'QL_STORAGE_SET', items: toWrite });
        }
        if (originalRemove) {
          try {
            await originalRemove(LEGACY_KEYS);
          } catch {
            // 레거시 삭제 실패 무시
          }
        }
      }
      await sendBg({ type: 'QL_STORAGE_SET', items: { [MIGRATION_KEY]: true } });
    } catch {
      // 마이그레이션 실패 무시
    }
  })();
})();
