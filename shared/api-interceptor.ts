// API 인터셉터 — fetch monkey-patch로 postId → personaId 매핑 수집

export type PersonaMapUpdateCallback = (
  postMappings: Map<string, string>,
  personaCache: Map<string, { nickname: string }>,
) => void;

export class ApiInterceptor {
  personaMap: Map<string, string>; // postId → personaId
  personaCache: Map<string, { nickname: string }>; // personaId → { nickname }
  private onUpdate?: PersonaMapUpdateCallback;

  constructor(onUpdate?: PersonaMapUpdateCallback) {
    this.personaMap = new Map();
    this.personaCache = new Map();
    this.onUpdate = onUpdate;
  }

  install(): void {
    this._patchFetch();
    this._parseInitialData();
  }

  private _patchFetch(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const originalFetch = window.fetch;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';

      try {
        if (self._isFeedApi(url)) {
          const cloned = response.clone();
          const data = await cloned.json();
          self._extractMappings(data);
        }
      } catch {
        // 파싱 실패 시 무시
      }

      return response;
    };
  }

  private _parseInitialData(): void {
    const scripts = document.querySelectorAll('script');
    scripts.forEach((script) => {
      const text = script.textContent;
      if (!text) return;

      // postId → personaId 매핑 (escaped JSON 포함)
      const postPattern = /\\?"postId\\?":\\?"([^"\\]+)\\?",\\?"personaId\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(postPattern)) {
        this.personaMap.set(m[1], m[2]);
      }

      // personaId → nickname 매핑
      const personaPattern =
        /\\?"personaId\\?":\\?"([^"\\]+)\\?",\\?"nickname\\?":\\?"([^"\\]+)\\?"/g;
      for (const m of text.matchAll(personaPattern)) {
        this.personaCache.set(m[1], { nickname: m[2] });
      }
    });

    if (this.personaMap.size > 0 || this.personaCache.size > 0) {
      this.onUpdate?.(this.personaMap, this.personaCache);
    }
  }

  private _isFeedApi(url: string): boolean {
    return url.includes('api.lounge.naver.com') && url.includes('/feed/');
  }

  private _extractMappings(data: unknown): void {
    if (!data || typeof data !== 'object') return;

    const walk = (obj: unknown): void => {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }

      const record = obj as Record<string, unknown>;

      if (typeof record.postId === 'string' && typeof record.personaId === 'string') {
        this.personaMap.set(record.postId, record.personaId);
      }

      if (typeof record.personaId === 'string' && typeof record.nickname === 'string') {
        this.personaCache.set(record.personaId, { nickname: record.nickname });
      }

      Object.values(record).forEach(walk);
    };

    walk(data);
    this.onUpdate?.(this.personaMap, this.personaCache);
  }

  getPersonaId(postId: string): string | undefined {
    return this.personaMap.get(postId);
  }

  getNickname(personaId: string): string | undefined {
    return this.personaCache.get(personaId)?.nickname;
  }
}
