import { GridPos, PuzzleData, Wall } from './types';

export const BACKTRACK_PENALTY = 0.1;
export const MISS_PENALTY = 0.25;

export const DIFFICULTY_BASE_POINTS: Record<PuzzleData['difficulty'], number> = {
  easy: 5,
  medium: 7,
  hard: 9,
};

export interface ScoreBreakdown {
  solved: boolean;
  reason: string;
  score: number | null;
  base_points: number;
  misses: number;
  backtracks: number;
  miss_penalty: number;
  backtrack_penalty: number;
}

function cellKey(cell: GridPos): string {
  return `${cell.row},${cell.col}`;
}

function wallKey(a: GridPos, b: GridPos): string {
  const left = a.row * 1000 + a.col;
  const right = b.row * 1000 + b.col;
  return left < right
    ? `${a.row}_${a.col}_${b.row}_${b.col}`
    : `${b.row}_${b.col}_${a.row}_${a.col}`;
}

function wallSet(walls: Wall[]): Set<string> {
  const set = new Set<string>();
  for (const wall of walls) {
    set.add(
      wallKey(
        { row: wall.row1, col: wall.col1 },
        { row: wall.row2, col: wall.col2 },
      ),
    );
  }
  return set;
}

export function basePointsForPuzzle(puzzle: PuzzleData): number {
  return DIFFICULTY_BASE_POINTS[puzzle.difficulty] ?? puzzle.gridSize;
}

/** True when milestone letters appear along the path in index order. */
export function areMilestonesSequential(
  milestones: PuzzleData['milestones'],
  path: GridPos[],
): boolean {
  const ordered = [...milestones].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) {
    return false;
  }

  const milestoneAt = new Map<string, number>();
  for (const milestone of ordered) {
    milestoneAt.set(cellKey(milestone.cell), milestone.index);
  }

  let nextIdx = 0;
  for (let i = 0; i < path.length; i++) {
    const idx = milestoneAt.get(cellKey(path[i]));
    if (idx === undefined) {
      continue;
    }
    if (idx !== nextIdx) {
      return false;
    }
    if (idx === ordered.length - 1 && i !== path.length - 1) {
      return false;
    }
    nextIdx += 1;
  }

  return nextIdx === ordered.length;
}

export function computeScoreBreakdown(
  basePoints: number,
  misses: number,
  backtracks: number,
): Pick<
  ScoreBreakdown,
  'base_points' | 'misses' | 'backtracks' | 'miss_penalty' | 'backtrack_penalty' | 'score'
> {
  const missCount = Math.max(0, Math.floor(misses) || 0);
  const backtrackCount = Math.max(0, Math.floor(backtracks) || 0);
  const missPenalty = Math.round(MISS_PENALTY * missCount * 100) / 100;
  const backtrackPenalty = Math.round(BACKTRACK_PENALTY * backtrackCount * 100) / 100;
  const score =
    Math.round((basePoints - missPenalty - backtrackPenalty) * 100) / 100;
  return {
    base_points: basePoints,
    misses: missCount,
    backtracks: backtrackCount,
    miss_penalty: missPenalty,
    backtrack_penalty: backtrackPenalty,
    score,
  };
}

/**
 * A successful solve visits every cell once, traces milestones in order,
 * starts on the first milestone, and ends on the last milestone.
 */
export function validateSolutionPath(
  puzzle: PuzzleData,
  path: GridPos[],
): { ok: boolean; reason: string } {
  const { gridSize, walls, milestones } = puzzle;
  const expectedLen = gridSize * gridSize;
  if (path.length !== expectedLen) {
    return {
      ok: false,
      reason: `path must visit every cell once (expected ${expectedLen}, got ${path.length})`,
    };
  }

  const seen = new Set<string>();
  for (const cell of path) {
    if (
      cell.row < 0 ||
      cell.col < 0 ||
      cell.row >= gridSize ||
      cell.col >= gridSize
    ) {
      return { ok: false, reason: `cell ${cellKey(cell)} is outside the grid` };
    }
    const key = cellKey(cell);
    if (seen.has(key)) {
      return { ok: false, reason: `cell ${key} is visited more than once` };
    }
    seen.add(key);
  }

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    if (Math.abs(curr.row - prev.row) + Math.abs(curr.col - prev.col) !== 1) {
      return {
        ok: false,
        reason: `non-orthogonal step from ${cellKey(prev)} to ${cellKey(curr)}`,
      };
    }
  }

  const blocked = wallSet(walls);
  for (let i = 1; i < path.length; i++) {
    if (blocked.has(wallKey(path[i - 1], path[i]))) {
      return {
        ok: false,
        reason: `path crosses a wall between ${cellKey(path[i - 1])} and ${cellKey(path[i])}`,
      };
    }
  }

  const ordered = [...milestones].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) {
    return { ok: false, reason: 'puzzle has no milestones' };
  }

  const first = ordered[0].cell;
  const last = ordered[ordered.length - 1].cell;
  if (path[0].row !== first.row || path[0].col !== first.col) {
    return { ok: false, reason: 'path must start on the first milestone' };
  }
  if (
    path[path.length - 1].row !== last.row ||
    path[path.length - 1].col !== last.col
  ) {
    return { ok: false, reason: 'path must end on the last milestone' };
  }

  if (!areMilestonesSequential(milestones, path)) {
    return {
      ok: false,
      reason: 'milestones must be visited in order',
    };
  }

  return { ok: true, reason: 'ok' };
}

export function isSuccessfulSolve(puzzle: PuzzleData, path: GridPos[]): boolean {
  return validateSolutionPath(puzzle, path).ok;
}

export function scoreLocalSolve(
  puzzle: PuzzleData,
  path: GridPos[],
  misses: number,
  backtracks: number,
): ScoreBreakdown {
  const check = validateSolutionPath(puzzle, path);
  const breakdown = computeScoreBreakdown(
    basePointsForPuzzle(puzzle),
    misses,
    backtracks,
  );
  if (!check.ok) {
    return { ...breakdown, solved: false, reason: check.reason, score: null };
  }
  return { ...breakdown, solved: true, reason: 'ok' };
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}
