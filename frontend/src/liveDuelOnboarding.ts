import { NativeModules } from 'react-native';

const ONBOARDING_KEY = 'spellpath_live_duel_onboarding_seen';

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const memoryStore = new Map<string, string>();

const memoryStorage: StorageLike = {
  getItem: async (key) => memoryStore.get(key) ?? null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
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
    if (storage && typeof storage.getItem === 'function') {
      return storage as StorageLike;
    }
  } catch {
    // fall through
  }
  return memoryStorage;
}

const storage = resolveStorage();

export async function hasSeenLiveDuelOnboarding(): Promise<boolean> {
  try {
    const raw = await storage.getItem(ONBOARDING_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

export async function markLiveDuelOnboardingSeen(): Promise<void> {
  await storage.setItem(ONBOARDING_KEY, '1');
}
