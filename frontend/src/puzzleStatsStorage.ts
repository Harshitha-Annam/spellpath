import { NativeModules } from 'react-native';

export interface PuzzleRunStats {
  puzzleId: string;
  misses: number;
  backtracks: number;
}

const STORAGE_KEY = 'spellpath_current_puzzle_stats';

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** Session fallback when the native encrypted module is not linked yet. */
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

/**
 * Only require react-native-encrypted-storage when the native module exists.
 * Importing the package while unlinked throws "RNEncryptedStorage is undefined".
 */
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

export async function loadPuzzleStats(
  puzzleId: string,
): Promise<PuzzleRunStats> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) {
      return { puzzleId, misses: 0, backtracks: 0 };
    }
    const parsed = JSON.parse(raw) as PuzzleRunStats;
    if (parsed?.puzzleId !== puzzleId) {
      return { puzzleId, misses: 0, backtracks: 0 };
    }
    return {
      puzzleId,
      misses: Math.max(0, Number(parsed.misses) || 0),
      backtracks: Math.max(0, Number(parsed.backtracks) || 0),
    };
  } catch {
    return { puzzleId, misses: 0, backtracks: 0 };
  }
}

export async function savePuzzleStats(stats: PuzzleRunStats): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Ignore storage failures — in-memory counts still work for the session.
  }
}

/** Replace stored stats with a fresh run for this puzzle only. */
export async function resetPuzzleStats(
  puzzleId: string,
): Promise<PuzzleRunStats> {
  const fresh: PuzzleRunStats = { puzzleId, misses: 0, backtracks: 0 };
  await savePuzzleStats(fresh);
  return fresh;
}

export async function clearPuzzleStats(): Promise<void> {
  try {
    await storage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

const SESSION_SCORE_KEY = 'spellpath_session_score';
const AWARDED_SCORES_KEY = 'spellpath_awarded_puzzle_scores';

export async function loadSessionScore(): Promise<number> {
  try {
    const raw = await storage.getItem(SESSION_SCORE_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export async function saveSessionScore(total: number): Promise<void> {
  try {
    await storage.setItem(SESSION_SCORE_KEY, String(total));
  } catch {
    // Ignore storage failures — in-memory total still works for the session.
  }
}

async function loadAwardedScores(): Promise<Record<string, number>> {
  try {
    const raw = await storage.getItem(AWARDED_SCORES_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Add a puzzle score once. Repeat awards for the same puzzle are ignored. */
export async function awardPuzzleScore(
  puzzleId: string,
  score: number,
): Promise<number> {
  const awarded = await loadAwardedScores();
  if (Object.prototype.hasOwnProperty.call(awarded, puzzleId)) {
    return loadSessionScore();
  }
  awarded[puzzleId] = score;
  try {
    await storage.setItem(AWARDED_SCORES_KEY, JSON.stringify(awarded));
  } catch {
    // still update the running total for this session
  }
  return addSessionScore(score);
}

/** Add a puzzle score to the running total (may go below zero). */
export async function addSessionScore(delta: number): Promise<number> {
  const current = await loadSessionScore();
  const next = Math.round((current + delta) * 100) / 100;
  await saveSessionScore(next);
  return next;
}
