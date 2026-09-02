import { NativeModules } from 'react-native';

const STATS_KEY = 'spellpath_live_duel_stats';
const MAX_HISTORY = 20;

export interface LiveDuelHistoryEntry {
  opponentName: string;
  myScore: number;
  opponentScore: number;
  won: boolean | null;
  puzzlesSolved: number;
  playedAt: number;
}

export interface LiveDuelStats {
  wins: number;
  losses: number;
  ties: number;
  currentStreak: number;
  bestStreak: number;
  history: LiveDuelHistoryEntry[];
}

const DEFAULT_STATS: LiveDuelStats = {
  wins: 0,
  losses: 0,
  ties: 0,
  currentStreak: 0,
  bestStreak: 0,
  history: [],
};

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

export async function loadLiveDuelStats(): Promise<LiveDuelStats> {
  try {
    const raw = await storage.getItem(STATS_KEY);
    if (!raw) {
      return { ...DEFAULT_STATS, history: [] };
    }
    const parsed = JSON.parse(raw) as LiveDuelStats;
    return {
      ...DEFAULT_STATS,
      ...parsed,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { ...DEFAULT_STATS, history: [] };
  }
}

export async function recordLiveDuelResult(opts: {
  opponentName: string;
  myScore: number;
  opponentScore: number;
  won: boolean | null;
  puzzlesSolved: number;
}): Promise<LiveDuelStats> {
  const stats = await loadLiveDuelStats();

  if (opts.won === true) {
    stats.wins += 1;
    stats.currentStreak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
  } else if (opts.won === false) {
    stats.losses += 1;
    stats.currentStreak = 0;
  } else {
    stats.ties += 1;
    stats.currentStreak = 0;
  }

  stats.history = [
    {
      opponentName: opts.opponentName,
      myScore: opts.myScore,
      opponentScore: opts.opponentScore,
      won: opts.won,
      puzzlesSolved: opts.puzzlesSolved,
      playedAt: Date.now(),
    },
    ...stats.history,
  ].slice(0, MAX_HISTORY);

  await storage.setItem(STATS_KEY, JSON.stringify(stats));
  return stats;
}
