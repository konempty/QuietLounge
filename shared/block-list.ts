import type { BlockListData, BlockedUser, NicknameOnlyBlock } from './types';

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const STORAGE_KEY = 'quiet_lounge_data';

function createEmptyData(): BlockListData {
  return {
    version: 2,
    blockedUsers: {},
    nicknameOnlyBlocks: [],
    personaCache: {},
  };
}

export class BlockList {
  private data: BlockListData;
  private storage: StorageAdapter;
  private onUpdate?: (data: BlockListData) => void;

  constructor(storage: StorageAdapter, onUpdate?: (data: BlockListData) => void) {
    this.data = createEmptyData();
    this.storage = storage;
    this.onUpdate = onUpdate;
  }

  async load(): Promise<void> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (raw) {
      try {
        this.data = JSON.parse(raw);
      } catch {
        this.data = createEmptyData();
      }
    }
  }

  private async save(): Promise<void> {
    await this.storage.set(STORAGE_KEY, JSON.stringify(this.data));
    this.onUpdate?.(this.data);
  }

  getData(): BlockListData {
    return this.data;
  }

  setData(data: BlockListData): void {
    this.data = data;
  }

  async blockByPersonaId(personaId: string, nickname: string, reason = ''): Promise<void> {
    const existing = this.data.blockedUsers[personaId];
    const previousNicknames = existing?.previousNicknames ?? [];
    if (existing && existing.nickname !== nickname) {
      previousNicknames.push(existing.nickname);
    }

    this.data.blockedUsers[personaId] = {
      personaId,
      nickname,
      previousNicknames,
      blockedAt: existing?.blockedAt ?? new Date().toISOString(),
      reason: reason || existing?.reason || '',
    };

    // nicknameOnlyBlocks에서 해당 닉네임 제거 (승격)
    this.data.nicknameOnlyBlocks = this.data.nicknameOnlyBlocks.filter(
      (b) => b.nickname !== nickname,
    );

    await this.save();
  }

  async blockByNickname(nickname: string, reason = ''): Promise<void> {
    const alreadyBlocked = Object.values(this.data.blockedUsers).some(
      (u) => u.nickname === nickname,
    );
    if (alreadyBlocked) return;

    if (this.data.nicknameOnlyBlocks.some((b) => b.nickname === nickname)) return;

    this.data.nicknameOnlyBlocks.push({
      nickname,
      blockedAt: new Date().toISOString(),
      reason,
    });
    await this.save();
  }

  async unblock(personaId: string): Promise<void> {
    delete this.data.blockedUsers[personaId];
    await this.save();
  }

  async unblockByNickname(nickname: string): Promise<void> {
    this.data.nicknameOnlyBlocks = this.data.nicknameOnlyBlocks.filter(
      (b) => b.nickname !== nickname,
    );
    await this.save();
  }

  isBlockedByPersonaId(personaId: string): boolean {
    return personaId in this.data.blockedUsers;
  }

  isBlockedByNickname(nickname: string): boolean {
    const byPersona = Object.values(this.data.blockedUsers).some((u) => u.nickname === nickname);
    const byNickname = this.data.nicknameOnlyBlocks.some((b) => b.nickname === nickname);
    return byPersona || byNickname;
  }

  // personaCache 업데이트 + nicknameOnlyBlocks 자동 승격
  async updatePersonaCache(personaId: string, nickname: string): Promise<void> {
    const cached = this.data.personaCache[personaId];
    const nicknameChanged = cached && cached.nickname !== nickname;

    this.data.personaCache[personaId] = {
      nickname,
      lastSeen: new Date().toISOString(),
    };

    // 닉네임 차단 → personaId 차단 자동 승격
    const nicknameBlock = this.data.nicknameOnlyBlocks.find(
      (b) => b.nickname === nickname || (nicknameChanged && b.nickname === cached.nickname),
    );
    if (nicknameBlock) {
      await this.blockByPersonaId(personaId, nickname, nicknameBlock.reason);
      return;
    }

    // 차단된 유저 닉네임 변경 추적
    if (nicknameChanged && this.data.blockedUsers[personaId]) {
      const user = this.data.blockedUsers[personaId];
      if (user.nickname !== nickname) {
        user.previousNicknames.push(user.nickname);
        user.nickname = nickname;
        await this.save();
      }
    }
  }

  getAllBlocked(): { byPersona: BlockedUser[]; byNickname: NicknameOnlyBlock[] } {
    return {
      byPersona: Object.values(this.data.blockedUsers),
      byNickname: [...this.data.nicknameOnlyBlocks],
    };
  }

  exportJSON(): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { personaCache: _cache, ...rest } = this.data;
    return JSON.stringify(rest, null, 2);
  }

  async importJSON(json: string): Promise<void> {
    const parsed: BlockListData = JSON.parse(json);
    if (parsed.version !== 2) {
      throw new Error('Unsupported block list version');
    }
    // 기존 personaCache 유지, 차단 목록만 덮어쓰기
    parsed.personaCache = this.data.personaCache;
    this.data = parsed;
    await this.save();
  }
}
