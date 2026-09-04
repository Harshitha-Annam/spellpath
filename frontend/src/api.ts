import {
  CellData,
  Difficulty,
  DuelAttempt,
  DuelInfo,
  DuelLeaderboard,
  DuelSubmitResponse,
  GridPos,
  Milestone,
  PlayerProfile,
  PuzzleData,
  ScoreResult,
  Wall,
  LiveDuelJoinResponse,
  LiveDuelEndPayload,
  LiveDuelQueueStatus,
} from './types';

function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

interface ApiMilestone {
  index: number;
  character: string;
  cell: [number, number];
}

interface ApiWall {
  cell_a: [number, number];
  cell_b: [number, number];
}

/** Puzzle JSON shape returned by `/get-puzzle`. */
interface ApiPuzzleResponse {
  id?: string;
  difficulty?: Difficulty | string;
  grid_size: number;
  word?: string;
  clue?: string;
  start_cell?: [number, number];
  end_cell?: [number, number];
  milestones: ApiMilestone[];
  walls?: ApiWall[];
  solution_path?: [number, number][];
  difficulty_analysis?: {
    classified_difficulty?: string;
  };
}

/** Hosted Spell Path API root (Render). */
export const SPELLPATH_API_URL = 'https://st-games.onrender.com/api/spellpath';
/** API origin used for health checks and as the fetch base URL. */
export const PRODUCTION_API_ORIGIN = 'https://st-games.onrender.com';

const API_PREFIX = '/api';
/** Spell Path REST + WebSocket routes under `/api/spellpath`. */
export const SPELLPATH_API_PREFIX = `${API_PREFIX}/spellpath`;

function spellpathPath(path: string): string {
  return `${SPELLPATH_API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
}

const HEALTH_TIMEOUT_MS = 5000;
/** DeepSeek via backend can take several minutes. */
const GET_PUZZLE_TIMEOUT_MS = 600000;
/** Procedural engine is local — short timeout. */
const BUILD_PUZZLE_TIMEOUT_MS = 60000;
const SCORE_PUZZLE_TIMEOUT_MS = 10000;
/** General duel API calls (lobby, status, etc.). */
const DUEL_TIMEOUT_MS = 60000;
/** Submitting a solved/skipped puzzle — keep generous for flaky mobile Wi‑Fi. */
const DUEL_SUBMIT_TIMEOUT_MS = 120000;
/** Six DeepSeek puzzles can take several minutes each — allow a long wait. */
const DUEL_PREPARE_POLL_MS = 40 * 60 * 1000;
/** Reuse a known-good API base so mid-run submits don't re-probe every host. */
const API_BASE_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedApiBase: { url: string; checkedAt: number } | null = null;

function invalidateApiBaseCache(): void {
  cachedApiBase = null;
}

function rememberApiBase(url: string): void {
  cachedApiBase = { url, checkedAt: Date.now() };
}

function normalizeDifficulty(
  value: string | undefined,
  fallback: Difficulty,
): Difficulty {
  if (value === 'easy' || value === 'medium' || value === 'hard') {
    return value;
  }
  if (value === 'very_hard') {
    return 'hard';
  }
  return fallback;
}

/** Keep only a valid orthogonal no-revisit path; drop illegal solution data. */
function sanitizeSolutionPath(path: GridPos[], gridSize: number): GridPos[] {
  if (path.length !== gridSize * gridSize) {
    return [];
  }
  const seen = new Set<string>();
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    if (
      cell.row < 0 ||
      cell.col < 0 ||
      cell.row >= gridSize ||
      cell.col >= gridSize
    ) {
      return [];
    }
    const key = `${cell.row},${cell.col}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    if (i > 0) {
      const prev = path[i - 1];
      const manhattan =
        Math.abs(cell.row - prev.row) + Math.abs(cell.col - prev.col);
      if (manhattan !== 1) {
        return [];
      }
    }
  }
  return path;
}

export function mapApiPuzzle(
  data: ApiPuzzleResponse,
  requestedDifficulty: Difficulty = 'medium',
): PuzzleData {
  const gridSize = data.grid_size;
  const solutionPathCoords: [number, number][] =
    data.solution_path && data.solution_path.length > 0
      ? data.solution_path
      : [];

  const startTuple: [number, number] =
    data.start_cell ??
    solutionPathCoords[0] ??
    data.milestones?.[0]?.cell ??
    [0, 0];
  const endTuple: [number, number] =
    data.end_cell ??
    solutionPathCoords[solutionPathCoords.length - 1] ??
    startTuple;

  const startCell = { row: startTuple[0], col: startTuple[1] };
  const endCell = { row: endTuple[0], col: endTuple[1] };

  const milestones: Milestone[] = (data.milestones ?? []).map((m) => ({
    index: m.index,
    character: m.character,
    cell: { row: m.cell[0], col: m.cell[1] },
  }));

  const letterByCell = new Map<string, string>();
  for (const m of milestones) {
    letterByCell.set(`${m.cell.row},${m.cell.col}`, m.character);
  }

  const cells: CellData[][] = [];
  for (let r = 0; r < gridSize; r++) {
    const rowCells: CellData[] = [];
    for (let c = 0; c < gridSize; c++) {
      const letter = letterByCell.get(`${r},${c}`) ?? '';
      rowCells.push({
        row: r,
        col: c,
        letter,
        isStart: r === startCell.row && c === startCell.col,
        isMilestone: letter.length > 0,
      });
    }
    cells.push(rowCells);
  }

  const walls: Wall[] = (data.walls ?? []).map((w) => ({
    row1: w.cell_a[0],
    col1: w.cell_a[1],
    row2: w.cell_b[0],
    col2: w.cell_b[1],
  }));

  const solutionPath: GridPos[] =
    solutionPathCoords.length === gridSize * gridSize
      ? solutionPathCoords.map(([row, col]) => ({ row, col }))
      : [];

  // Never fall back to milestone-only paths — that draws illegal diagonal jumps.
  const sanitizedSolution = sanitizeSolutionPath(solutionPath, gridSize);

  const difficulty = normalizeDifficulty(
    data.difficulty ?? data.difficulty_analysis?.classified_difficulty,
    requestedDifficulty,
  );

  return {
    id: data.id ?? `puzzle_${difficulty}_${Date.now()}`,
    difficulty,
    gridSize,
    targetWord: (data.word ?? '').toUpperCase(),
    clue: data.clue?.trim() || undefined,
    startCell,
    endCell,
    cells,
    walls,
    milestones,
    solutionPath: sanitizedSolution,
  };
}

async function fetchWithTimeout(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const timeoutController = new AbortController();
  const onAbort = () => timeoutController.abort();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    return await fetch(url, {
      method: 'GET',
      ...init,
      signal: timeoutController.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function probeApiBase(base: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchWithTimeout(`${base}${API_PREFIX}/health`, signal, HEALTH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return base;
}

async function resolveLiveApiBase(signal?: AbortSignal): Promise<string> {
  const now = Date.now();
  if (
    cachedApiBase &&
    now - cachedApiBase.checkedAt < API_BASE_CACHE_TTL_MS
  ) {
    try {
      await probeApiBase(cachedApiBase.url, signal);
      rememberApiBase(cachedApiBase.url);
      return cachedApiBase.url;
    } catch (err) {
      if (signal?.aborted) {
        throw err instanceof Error
          ? err
          : createAbortError();
      }
      invalidateApiBaseCache();
    }
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  try {
    await probeApiBase(PRODUCTION_API_ORIGIN, signal);
    rememberApiBase(PRODUCTION_API_ORIGIN);
    return PRODUCTION_API_ORIGIN;
  } catch (err) {
    if (signal?.aborted) {
      throw err instanceof Error ? err : createAbortError();
    }
    invalidateApiBaseCache();
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the puzzle server at ${SPELLPATH_API_URL} (${detail}).`,
    );
  }
}

/**
 * Calls backend `/get-puzzle`, which proxies DeepSeek with prompts/system_prompt.txt.
 */
export async function fetchGeneratedPuzzle(
  difficulty: Difficulty,
  signal?: AbortSignal,
): Promise<PuzzleData> {
  const base = await resolveLiveApiBase(signal);
  const params = new URLSearchParams({ difficulty });
  const url = `${base}${spellpathPath('/get-puzzle')}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, signal, GET_PUZZLE_TIMEOUT_MS);
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      if (signal?.aborted) {
        throw err instanceof Error
          ? err
          : createAbortError();
      }
      throw new Error(
        `Puzzle generation timed out at ${base}/get-puzzle. The backend may still be waiting on DeepSeek — check the server terminal logs.`,
      );
    }
    throw err;
  }

  if (!response.ok) {
    let detail = `Failed to get puzzle (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) {
        detail =
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      // keep status message
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as ApiPuzzleResponse;
  if (!data?.milestones?.length || typeof data.grid_size !== 'number') {
    throw new Error('Backend /get-puzzle returned an incomplete puzzle object');
  }

  return mapApiPuzzle(data, difficulty);
}

/**
 * Calls backend `/build-puzzle`, which uses the procedural puzzle engine.
 */
export async function fetchBuiltPuzzle(
  difficulty: Difficulty,
  signal?: AbortSignal,
): Promise<PuzzleData> {
  const base = await resolveLiveApiBase(signal);
  const params = new URLSearchParams({ difficulty });
  const url = `${base}${spellpathPath('/build-puzzle')}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, signal, BUILD_PUZZLE_TIMEOUT_MS);
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      if (signal?.aborted) {
        throw err instanceof Error
          ? err
          : createAbortError();
      }
      throw new Error(
        `Puzzle build timed out at ${base}/build-puzzle. Check the server terminal logs.`,
      );
    }
    throw err;
  }

  if (!response.ok) {
    let detail = `Failed to build puzzle (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) {
        detail =
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      // keep status message
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as ApiPuzzleResponse;
  if (!data?.milestones?.length || typeof data.grid_size !== 'number') {
    throw new Error('Backend /build-puzzle returned an incomplete puzzle object');
  }

  return mapApiPuzzle(data, difficulty);
}

export interface ScorePuzzlePayload {
  puzzle: PuzzleData;
  path: GridPos[];
  misses: number;
  backtracks: number;
}

function puzzleToScoreBody(payload: ScorePuzzlePayload) {
  const { puzzle, path, misses, backtracks } = payload;
  return {
    difficulty: puzzle.difficulty,
    grid_size: puzzle.gridSize,
    milestones: puzzle.milestones.map((m) => ({
      index: m.index,
      character: m.character,
      cell: [m.cell.row, m.cell.col],
    })),
    walls: puzzle.walls.map((w) => ({
      cell_a: [w.row1, w.col1],
      cell_b: [w.row2, w.col2],
    })),
    path: path.map((p) => [p.row, p.col]),
    misses,
    backtracks,
  };
}

/**
 * Asks the backend to validate a traced path and return the score.
 * Successful solve only: full Hamiltonian path, sequential milestones,
 * start on first milestone, end on last milestone.
 */
export async function scorePuzzleSolve(
  payload: ScorePuzzlePayload,
  signal?: AbortSignal,
): Promise<ScoreResult> {
  const base = await resolveLiveApiBase(signal);
  const url = `${base}${spellpathPath('/score-puzzle')}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, signal, SCORE_PUZZLE_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(puzzleToScoreBody(payload)),
    });
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw err instanceof Error
        ? err
        : createAbortError();
    }
    throw err;
  }

  if (!response.ok) {
    let detail = `Failed to score puzzle (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) {
        detail =
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      // keep status message
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as ScoreResult;
  if (typeof data?.solved !== 'boolean') {
    throw new Error('Backend /score-puzzle returned an incomplete score object');
  }
  return data;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isTimeoutLikeError(err: unknown): boolean {
  if (!err) {
    return false;
  }
  if (isAbortError(err)) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network request failed')
  );
}

async function parseErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (body?.detail) {
      return typeof body.detail === 'string'
        ? body.detail
        : JSON.stringify(body.detail);
    }
  } catch {
    // keep fallback
  }
  return fallback;
}

async function apiJson<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
  timeoutMs: number = DUEL_TIMEOUT_MS,
): Promise<T> {
  const base = await resolveLiveApiBase(signal);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${base}${path}`, signal, timeoutMs, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    });
  } catch (err) {
    invalidateApiBaseCache();
    if (signal?.aborted) {
      throw err instanceof Error
        ? err
        : createAbortError();
    }
    if (isTimeoutLikeError(err)) {
      throw new Error(
        `Request timed out talking to ${base}${path}. Check that the backend is still running, then try again.`,
      );
    }
    throw err;
  }
  if (!response.ok) {
    if (response.status >= 500) {
      invalidateApiBaseCache();
    }
    throw new Error(
      await parseErrorDetail(response, `Request failed (${response.status})`),
    );
  }
  return (await response.json()) as T;
}

async function apiJsonWithRetry<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
  timeoutMs: number = DUEL_TIMEOUT_MS,
): Promise<T> {
  try {
    return await apiJson<T>(path, init, signal, timeoutMs);
  } catch (err) {
    if (signal?.aborted || !isTimeoutLikeError(err)) {
      throw err;
    }
    invalidateApiBaseCache();
    // One automatic retry after a brief pause (common after phone Wi‑Fi sleep).
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    if (signal?.aborted) {
      throw createAbortError();
    }
    return apiJson<T>(path, init, signal, timeoutMs);
  }
}

export async function createPlayer(
  name: string,
  signal?: AbortSignal,
): Promise<PlayerProfile> {
  return apiJson<PlayerProfile>(
    spellpathPath('/players'),
    { method: 'POST', body: JSON.stringify({ name }) },
    signal,
  );
}

export async function fetchPlayer(
  playerId: string,
  signal?: AbortSignal,
): Promise<PlayerProfile> {
  return apiJson<PlayerProfile>(spellpathPath(`/players/${encodeURIComponent(playerId)}`), undefined, signal);
}

export async function createDuel(
  playerId: string,
  signal?: AbortSignal,
): Promise<DuelInfo> {
  return apiJson<DuelInfo>(
    spellpathPath('/duels'),
    { method: 'POST', body: JSON.stringify({ player_id: playerId }) },
    signal,
  );
}

export async function fetchDuel(
  idOrCode: string,
  signal?: AbortSignal,
): Promise<DuelInfo> {
  return apiJson<DuelInfo>(
    spellpathPath(`/duels/${encodeURIComponent(idOrCode.trim())}`),
    undefined,
    signal,
  );
}

export async function waitForDuelReady(
  idOrCode: string,
  signal?: AbortSignal,
  onProgress?: (duel: DuelInfo) => void,
): Promise<DuelInfo> {
  const started = Date.now();
  while (true) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    const duel = await fetchDuel(idOrCode, signal);
    onProgress?.(duel);
    if (duel.status === 'ready') {
      return duel;
    }
    if (duel.status === 'failed') {
      throw new Error(duel.error || 'Spellpath combat puzzle pack failed to generate');
    }
    if (Date.now() - started > DUEL_PREPARE_POLL_MS) {
      throw new Error(
        'Timed out waiting for DeepSeek to finish the spellpath combat pack. Try again in a bit.',
      );
    }
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(createAbortError());
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, 1200);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(createAbortError());
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

export async function fetchDuelPuzzles(
  idOrCode: string,
  signal?: AbortSignal,
): Promise<PuzzleData[]> {
  const data = await apiJson<{ puzzles: ApiPuzzleResponse[] }>(
    spellpathPath(`/duels/${encodeURIComponent(idOrCode.trim())}/puzzles`),
    undefined,
    signal,
  );
  return (data.puzzles || []).map((p, index) => {
    const difficulty =
      p.difficulty === 'easy' || p.difficulty === 'medium' || p.difficulty === 'hard'
        ? p.difficulty
        : index < 2
          ? 'easy'
          : index < 4
            ? 'medium'
            : 'hard';
    return mapApiPuzzle(p, difficulty);
  });
}

export async function startDuelAttempt(
  idOrCode: string,
  playerId: string,
  signal?: AbortSignal,
): Promise<DuelAttempt> {
  return apiJson<DuelAttempt>(
    spellpathPath(`/duels/${encodeURIComponent(idOrCode.trim())}/attempts`),
    { method: 'POST', body: JSON.stringify({ player_id: playerId }) },
    signal,
  );
}

export async function fetchDuelLeaderboard(
  idOrCode: string,
  attemptId?: string,
  signal?: AbortSignal,
): Promise<DuelLeaderboard> {
  const params = new URLSearchParams();
  if (attemptId) {
    params.set('attempt_id', attemptId);
  }
  const qs = params.toString();
  return apiJson<DuelLeaderboard>(
    spellpathPath(`/duels/${encodeURIComponent(idOrCode.trim())}/leaderboard${qs ? `?${qs}` : ''}`),
    undefined,
    signal,
  );
}

export async function submitDuelPuzzle(
  attemptId: string,
  puzzleIndex: number,
  payload: {
    path: GridPos[];
    misses: number;
    backtracks: number;
    time_ms: number;
    skipped?: boolean;
  },
  signal?: AbortSignal,
): Promise<DuelSubmitResponse> {
  return apiJsonWithRetry<DuelSubmitResponse>(
    spellpathPath(`/attempts/${encodeURIComponent(attemptId)}/puzzles/${puzzleIndex}/submit`),
    {
      method: 'POST',
      body: JSON.stringify({
        path: payload.path.map((p) => [p.row, p.col]),
        misses: payload.misses,
        backtracks: payload.backtracks,
        time_ms: payload.time_ms,
        skipped: Boolean(payload.skipped),
      }),
    },
    signal,
    DUEL_SUBMIT_TIMEOUT_MS,
  );
}

export async function fetchRevealedDuelPuzzles(
  attemptId: string,
  signal?: AbortSignal,
): Promise<PuzzleData[]> {
  const data = await apiJson<{ puzzles: ApiPuzzleResponse[] }>(
    spellpathPath(`/attempts/${encodeURIComponent(attemptId)}/revealed-puzzles`),
    undefined,
    signal,
  );
  return (data.puzzles || []).map((p, index) => {
    const difficulty =
      p.difficulty === 'easy' || p.difficulty === 'medium' || p.difficulty === 'hard'
        ? p.difficulty
        : index < 2
          ? 'easy'
          : index < 4
            ? 'medium'
            : 'hard';
    return mapApiPuzzle(p, difficulty);
  });
}

// ---------------------------------------------------------------------------
// Live 1v1 duel (matchmaking queue + WebSocket)
// ---------------------------------------------------------------------------

export async function joinLiveDuelQueue(
  userId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<LiveDuelJoinResponse> {
  return apiJson<LiveDuelJoinResponse>(
    spellpathPath('/duels/queue'),
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, display_name: displayName }),
    },
    signal,
  );
}

export async function joinLiveDuelBot(
  userId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<LiveDuelJoinResponse> {
  return apiJson<LiveDuelJoinResponse>(
    spellpathPath('/duels/queue/bot'),
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, display_name: displayName }),
    },
    signal,
  );
}

export async function leaveLiveDuelQueue(
  userId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  return apiJson<{ ok: boolean }>(
    spellpathPath('/duels/queue/leave'),
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    },
    signal,
  );
}

export async function forfeitLiveDuel(
  duelId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<LiveDuelEndPayload> {
  return apiJsonWithRetry<LiveDuelEndPayload>(
    spellpathPath(`/duels/${encodeURIComponent(duelId)}/forfeit`),
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    },
    signal,
  );
}

export async function abortLiveDuel(
  duelId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<LiveDuelEndPayload> {
  return apiJsonWithRetry<LiveDuelEndPayload>(
    spellpathPath(`/duels/${encodeURIComponent(duelId)}/abort`),
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    },
    signal,
  );
}

export async function fetchLiveDuelQueueStatus(
  userId: string,
  signal?: AbortSignal,
): Promise<LiveDuelQueueStatus> {
  const params = new URLSearchParams({ user_id: userId });
  return apiJson<LiveDuelQueueStatus>(
    spellpathPath(`/duels/queue/status?${params.toString()}`),
    undefined,
    signal,
  );
}

export async function resolveLiveDuelWsUrl(
  duelId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<string> {
  const base = await resolveLiveApiBase(signal);
  const wsBase = base.replace(/^http/i, 'ws');
  const params = new URLSearchParams({ user_id: userId });
  return `${wsBase}${spellpathPath(`/ws/duel/${encodeURIComponent(duelId)}`)}?${params.toString()}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) {
    return `${s}s`;
  }
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** Wordle-style share card for viral async challenges. */
export function buildDuelShareMessage(opts: {
  code: string;
  playerName: string;
  totalScore: number;
  totalTimeMs: number;
  becameChampion: boolean;
  beatChampion: boolean;
  championName?: string | null;
  championScore?: number | null;
  puzzleResults: {
    difficulty: string;
    score: number | null;
    solved: boolean;
    skipped?: boolean;
  }[];
}): string {
  const lines = [
    `Spellpath Combat ${opts.code}`,
    `${opts.playerName} · ${opts.totalScore.toFixed(2)} pts · ${formatDuration(opts.totalTimeMs)}`,
  ];

  if (opts.becameChampion) {
    lines.push('New champion!');
  } else if (opts.beatChampion && opts.championName) {
    lines.push(`Beat ${opts.championName}'s record`);
  } else if (opts.championName != null && opts.championScore != null) {
    const delta = Math.round((opts.championScore - opts.totalScore) * 100) / 100;
    lines.push(`${delta.toFixed(2)} pts behind ${opts.championName}`);
  }

  const icons = opts.puzzleResults
    .map((r) => {
      if (r.skipped || !r.solved) {
        return '⬛';
      }
      if (r.difficulty === 'hard' || r.difficulty === 'very_hard') {
        return '🟥';
      }
      if (r.difficulty === 'medium') {
        return '🟧';
      }
      return '🟩';
    })
    .join('');
  lines.push(icons);
  lines.push(`Challenge code: ${opts.code}`);
  return lines.join('\n');
}

/** Wordle-style share card for live 1v1 duel results. */
export function buildLiveDuelShareMessage(opts: {
  playerName: string;
  opponentName: string;
  myScore: number;
  opponentScore: number;
  won: boolean | null;
  puzzlesSolved: number;
  puzzleResults: {
    difficulty?: string;
    solved: boolean;
    score: number | null;
  }[];
}): string {
  const outcome =
    opts.won === true ? 'Won' : opts.won === false ? 'Lost' : 'Tied';
  const lines = [
    `⚡ Live Duel — ${outcome} vs ${opts.opponentName}`,
    `${opts.playerName} ${opts.myScore.toFixed(2)} – ${opts.opponentScore.toFixed(2)} ${opts.opponentName}`,
    `${opts.puzzlesSolved} puzzles solved`,
  ];

  const icons = opts.puzzleResults
    .map((r) => {
      if (!r.solved) {
        return '⬛';
      }
      if (r.difficulty === 'hard' || r.difficulty === 'very_hard') {
        return '🟥';
      }
      if (r.difficulty === 'medium') {
        return '🟧';
      }
      return '🟩';
    })
    .join('');
  if (icons) {
    lines.push(icons);
  }
  lines.push('Race opponents in Live Duel — Spellpath');
  return lines.join('\n');
}
