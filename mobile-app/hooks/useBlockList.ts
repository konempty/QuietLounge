import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlockList, StorageAdapter } from '../shared/block-list';
import type { BlockListData, BlockedUser, NicknameOnlyBlock } from '../shared/types';

// AsyncStorage 기반 StorageAdapter
const asyncStorageAdapter: StorageAdapter = {
  async get(key: string) {
    return AsyncStorage.getItem(key);
  },
  async set(key: string, value: string) {
    await AsyncStorage.setItem(key, value);
  },
};

export interface BlockListContextType {
  blockData: BlockListData;
  blockUser: (personaId: string | undefined, nickname: string) => Promise<void>;
  unblockByPersonaId: (personaId: string) => Promise<void>;
  unblockByNickname: (nickname: string) => Promise<void>;
  updatePersonaCache: (personaId: string, nickname: string) => Promise<void>;
  importJSON: (json: string) => Promise<void>;
  exportJSON: () => string;
  clearAll: () => Promise<void>;
  allBlocked: { byPersona: BlockedUser[]; byNickname: NicknameOnlyBlock[] };
}

export const BlockListContext = createContext<BlockListContextType | null>(null);

export function useBlockList(): BlockListContextType {
  const ctx = useContext(BlockListContext);
  if (!ctx) throw new Error('useBlockList must be used within BlockListProvider');
  return ctx;
}

export function useBlockListProvider(): BlockListContextType {
  const [blockData, setBlockData] = useState<BlockListData>({
    version: 2,
    blockedUsers: {},
    nicknameOnlyBlocks: [],
    personaCache: {},
  });

  const blockListRef = useRef<BlockList | null>(null);

  useEffect(() => {
    const bl = new BlockList(asyncStorageAdapter, (data) => {
      setBlockData({ ...data });
    });
    blockListRef.current = bl;
    bl.load().then(() => {
      setBlockData({ ...bl.getData() });
    });
  }, []);

  const blockUser = useCallback(async (personaId: string | undefined, nickname: string) => {
    const bl = blockListRef.current;
    if (!bl) return;
    if (personaId) {
      await bl.blockByPersonaId(personaId, nickname);
    } else {
      await bl.blockByNickname(nickname);
    }
  }, []);

  const unblockByPersonaId = useCallback(async (personaId: string) => {
    const bl = blockListRef.current;
    if (!bl) return;
    await bl.unblock(personaId);
  }, []);

  const unblockByNickname = useCallback(async (nickname: string) => {
    const bl = blockListRef.current;
    if (!bl) return;
    await bl.unblockByNickname(nickname);
  }, []);

  const updatePersonaCache = useCallback(async (personaId: string, nickname: string) => {
    const bl = blockListRef.current;
    if (!bl) return;
    await bl.updatePersonaCache(personaId, nickname);
  }, []);

  const importJSON = useCallback(async (json: string) => {
    const bl = blockListRef.current;
    if (!bl) return;
    await bl.importJSON(json);
  }, []);

  const exportJSON = useCallback(() => {
    const bl = blockListRef.current;
    if (!bl) return '{}';
    return bl.exportJSON();
  }, []);

  const clearAll = useCallback(async () => {
    const bl = blockListRef.current;
    if (!bl) return;
    bl.setData({
      version: 2,
      blockedUsers: {},
      nicknameOnlyBlocks: [],
      personaCache: {},
    });
    await AsyncStorage.setItem('quiet_lounge_data', JSON.stringify(bl.getData()));
    setBlockData({ ...bl.getData() });
  }, []);

  const allBlocked = {
    byPersona: Object.values(blockData.blockedUsers),
    byNickname: [...blockData.nicknameOnlyBlocks],
  };

  return {
    blockData,
    blockUser,
    unblockByPersonaId,
    unblockByNickname,
    updatePersonaCache,
    importJSON,
    exportJSON,
    clearAll,
    allBlocked,
  };
}
