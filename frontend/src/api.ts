import { NativeModules, Platform } from 'react-native';
import {
  CellData,
  Difficulty,
  GridPos,
  Milestone,
  PuzzleData,
  Wall,
} from './types';

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
  word: string;
  start_cell?: [number, number];
  end_cell?: [number, number];
  milestones: ApiMilestone[];
  walls?: ApiWall[];
  solution_path?: [number, number][];
  difficulty_analysis?: {
    classified_difficulty?: string;
  };
}

/** Dev machine LAN IP — update if your PC IP changes (`ipconfig`). */
const DEV_LAN_HOST = '192.168.70.22';

const HEALTH_TIMEOUT_MS = 2500;
/** DeepSeek via backend can take several minutes. */
const GET_PUZZLE_TIMEOUT_MS = 600000;

function getCandidateBaseUrls(): string[] {
  const urls: string[] = [];
  const push = (url: string) => {
    if (!urls.includes(url)) {
      urls.push(url);
    }
  };

  const sourceCode = NativeModules.SourceCode as { scriptURL?: string } | undefined;
  const scriptURL = sourceCode?.scriptURL;
  const match = scriptURL?.match(/https?:\/\/([^:/]+)/);
  const metroHost = match?.[1];

  if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1') {
    push(`http://${metroHost}:8000`);
  }

  push(`http://${DEV_LAN_HOST}:8000`);

  if (Platform.OS === 'android') {
    push('http://10.0.2.2:8000');
  }

  push('http://127.0.0.1:8000');
  push('http://localhost:8000');

  return urls;
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
    targetWord: data.word.toUpperCase(),
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
      signal: timeoutController.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function resolveLiveApiBase(signal?: AbortSignal): Promise<string> {
  const candidates = getCandidateBaseUrls();
  const errors: string[] = [];

  for (const base of candidates) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const response = await fetchWithTimeout(`${base}/`, signal, HEALTH_TIMEOUT_MS);
      if (response.ok) {
        return base;
      }
      errors.push(`${base} → HTTP ${response.status}`);
    } catch (err) {
      if (signal?.aborted) {
        throw err instanceof Error
          ? err
          : new DOMException('Aborted', 'AbortError');
      }
      const message = err instanceof Error ? err.message : String(err);
      const timedOut =
        (err instanceof Error && err.name === 'AbortError') ||
        message.toLowerCase().includes('timeout') ||
        message.toLowerCase().includes('timed out');
      errors.push(`${base} → ${timedOut ? 'timeout' : message}`);
    }
  }

  throw new Error(
    `Could not reach the puzzle server. Tried:\n${errors.join('\n')}`,
  );
}

/**
 * Calls backend `/get-puzzle`, which proxies DeepSeek with system_prompt.txt.
 */
export async function fetchGeneratedPuzzle(
  difficulty: Difficulty,
  signal?: AbortSignal,
): Promise<PuzzleData> {
  const base = await resolveLiveApiBase(signal);
  const params = new URLSearchParams({ difficulty });
  const url = `${base}/get-puzzle?${params.toString()}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, signal, GET_PUZZLE_TIMEOUT_MS);
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      if (signal?.aborted) {
        throw err instanceof Error
          ? err
          : new DOMException('Aborted', 'AbortError');
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
