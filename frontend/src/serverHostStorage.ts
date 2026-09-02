import { NativeModules } from 'react-native';

const SERVER_HOST_KEY = 'spellpath_api_host';

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const memoryStore = new Map<string, string>();

const memoryStorage: StorageLike = {
  getItem: async (key) => memoryStore.get(key) ?? null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: async (key) => {
    memoryStore.delete(key);
  },
};

function resolveStorage(): StorageLike {
  if (!NativeModules.RNEncryptedStorage) {
    return memoryStorage;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-encrypted-storage');
    const storage = mod?.default ?? mod;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function'
    ) {
      return storage as StorageLike;
    }
  } catch {
    // fall through
  }
  return memoryStorage;
}

const storage = resolveStorage();

export async function loadCustomApiHost(): Promise<string | null> {
  try {
    const raw = await storage.getItem(SERVER_HOST_KEY);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function saveCustomApiHost(host: string): Promise<void> {
  await storage.setItem(SERVER_HOST_KEY, host.trim());
}

export async function clearCustomApiHost(): Promise<void> {
  try {
    await storage.removeItem(SERVER_HOST_KEY);
  } catch {
    // no-op
  }
}
