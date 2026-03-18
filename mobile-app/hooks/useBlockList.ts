import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlockList, StorageAdapter } from '../shared/block-list';
import type { BlockListData, BlockedUser, NicknameOnlyBlock, FilterMode } from '../shared/types';

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
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => Promise<void>;
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
  const [filterMode, setFilterModeState] = useState<FilterMode>('hide');

  const blockListRef = useRef<BlockList | null>(null);

  useEffect(() => {
    const bl = new BlockList(asyncStorageAdapter, (data) => {
      setBlockData({ ...data });
    });
    blockListRef.current = bl;
    bl.load().then(() => {
      setBlockData({ ...bl.getData() });
    });

    AsyncStorage.getItem('quiet_lounge_filter_mode').then((val) => {
      if (val === 'blur' || val === 'hide') setFilterModeState(val);
    });
  }, []);

  const setFilterMode = useCallback(async (mode: FilterMode) => {
    setFilterModeState(mode);
    await AsyncStorage.setItem('quiet_lounge_filter_mode', mode);
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
    filterMode,
    setFilterMode,
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
