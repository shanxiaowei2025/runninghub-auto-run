import { create } from 'zustand';
import * as idbKeyval from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';

interface ClientState {
  clientId: string | null;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  setClientId: (id: string) => void;
  generateClientId: () => Promise<string>;
  init: () => Promise<void>;
}

const CLIENT_ID_KEY = 'runninghub-client-id';

export const useClientStore = create<ClientState>()((set, get) => ({
  clientId: null,
  isLoading: false,
  error: null,
  initialized: false,

  setClientId: (id: string) => {
    set({ clientId: id });
    // 同时保存到 indexedDB
    set({ isLoading: true });
    
    // 异步保存到IndexedDB
    (async () => {
      try {
        await idbKeyval.set(CLIENT_ID_KEY, id);
        set({ isLoading: false, error: null });
      } catch (error) {
        console.error('保存客户端ID失败:', error);
        set({ 
          isLoading: false, 
          error: error instanceof Error ? error.message : '保存客户端ID失败' 
        });
      }
    })();
  },

  generateClientId: async () => {
    const newClientId = uuidv4();
    get().setClientId(newClientId);
    return newClientId;
  },

  init: async () => {
    set({ isLoading: true });
    try {
      // 从 indexedDB 读取客户端ID
      const savedClientId = await idbKeyval.get<string>(CLIENT_ID_KEY);
      
      if (savedClientId) {
        set({ 
          clientId: savedClientId, 
          isLoading: false, 
          initialized: true 
        });
      } else {
        // 如果不存在，则生成新的ID
        const newClientId = uuidv4();
        await idbKeyval.set(CLIENT_ID_KEY, newClientId);
        
        set({ 
          clientId: newClientId, 
          isLoading: false, 
          initialized: true 
        });
      }
    } catch (error) {
      console.error('初始化客户端ID时出错:', error);
      // 出错时也生成一个新的ID
      const newClientId = uuidv4();
      
      set({ 
        clientId: newClientId,
        isLoading: false, 
        error: error instanceof Error ? error.message : '初始化客户端ID失败',
        initialized: true
      });
    }
  }
}));

// 导出一个便捷获取客户端ID的函数
export const getClientId = (): string | null => {
  return useClientStore.getState().clientId;
}; 