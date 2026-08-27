import { NativeModules } from 'react-native';
import { PlayerProfile } from './types';

const PLAYER_KEY = 'spellpath_player_profile';

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

export async function loadPlayerProfile(): Promise<PlayerProfile | null> {
  try {
    const raw = await storage.getItem(PLAYER_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PlayerProfile;
    if (!parsed?.id || !parsed?.name) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePlayerProfile(profile: PlayerProfile): Promise<void> {
  await storage.setItem(PLAYER_KEY, JSON.stringify(profile));
}

export async function clearPlayerProfile(): Promise<void> {
  try {
    await storage.removeItem(PLAYER_KEY);
  } catch {
    // no-op
  }
}
