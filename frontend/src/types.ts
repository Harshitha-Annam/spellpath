export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GridPos {
  row: number;
  col: number;
}

export interface Wall {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

export interface Milestone {
  index: number;
  character: string;
  cell: GridPos;
}

export interface CellData {
  row: number;
  col: number;
  letter: string;
  isStart?: boolean;
  isMilestone?: boolean;
}

export interface PuzzleData {
  id: string;
  difficulty: Difficulty;
  gridSize: number;
  targetWord: string;
  startCell: GridPos;
  endCell: GridPos;
  cells: CellData[][];
  walls: Wall[];
  milestones: Milestone[];
  /** Intended solution path (every cell for API puzzles). Used by debug Show Solution. */
  solutionPath: GridPos[];
}

export interface ScoreResult {
  solved: boolean;
  reason: string;
  score: number | null;
  base_points: number;
  misses: number;
  backtracks: number;
  miss_penalty: number;
  backtrack_penalty: number;
}

export type AppMode = 'solo' | 'duel' | 'liveDuel';

export interface PlayerProfile {
  id: string;
  name: string;
  created_at?: number;
}

export interface DuelChampionPuzzleResult {
  index: number;
  difficulty: Difficulty | string;
  score: number | null;
  time_ms: number | null;
  solved: boolean;
  skipped?: boolean;
}

export interface DuelChampion {
  attempt_id: string;
  player_id: string;
  player_name: string;
  total_score: number;
  total_time_ms: number;
  puzzle_results: DuelChampionPuzzleResult[];
}

export interface DuelInfo {
  id: string;
  code: string;
  creator_id: string;
  creator_name?: string;
  status: 'preparing' | 'ready' | 'failed';
  puzzle_count: number;
  prepared_count: number;
  error?: string | null;
  created_at: number;
  ready_at?: number | null;
  champion: DuelChampion | null;
  attempt_count: number;
}

export interface DuelPuzzleResult {
  index: number;
  difficulty: Difficulty | string;
  puzzle_id: string;
  solved: boolean;
  skipped: boolean;
  score: number | null;
  time_ms: number | null;
  misses: number | null;
  backtracks: number | null;
  submitted_at?: number | null;
}

export interface DuelAttempt {
  id: string;
  duel_id: string;
  player_id: string;
  player_name?: string;
  status: 'in_progress' | 'completed';
  current_index: number;
  puzzle_results: DuelPuzzleResult[];
  total_score: number;
  total_time_ms: number;
  started_at: number;
  completed_at?: number | null;
  beat_champion: boolean;
  became_champion: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  attempt_id: string;
  player_id: string;
  player_name: string;
  total_score: number;
  total_time_ms: number;
  completed_at?: number | null;
}

export interface DuelLeaderboard {
  duel: DuelInfo;
  champion: LeaderboardEntry | null;
  entries: LeaderboardEntry[];
  neighborhood: LeaderboardEntry[];
  your_rank: number | null;
  total_attempts: number;
}

export interface DuelSubmitResponse {
  score_result: ScoreResult;
  attempt: DuelAttempt;
  duel: DuelInfo | null;
  leaderboard: DuelLeaderboard | null;
  revealed_puzzles?: unknown[] | null;
}

export type LiveDuelPhase = 'queue' | 'countdown' | 'playing' | 'result';

export interface LiveDuelQueueStatus {
  in_queue: boolean;
  matched: boolean;
  duel_id: string | null;
  opponent_name?: string | null;
}

export interface LiveDuelJoinResponse {
  matched: boolean;
  duel_id: string | null;
  opponent_name?: string | null;
  is_bot?: boolean;
}

export interface LiveDuelOpponentProgress {
  solved: number;
  score: number;
  displayName?: string;
}

export interface LiveDuelPuzzleResult {
  index: number;
  puzzle_id?: string;
  word?: string;
  difficulty?: string;
  grid_size?: number;
  solved: boolean;
  score: number | null;
  base_points: number;
  misses: number;
  backtracks: number;
  miss_penalty: number;
  backtrack_penalty: number;
}

export interface LiveDuelScoreBreakdown {
  base_points: number;
  misses: number;
  backtracks: number;
  miss_penalty: number;
  backtrack_penalty: number;
  score: number | null;
}

export interface LiveDuelEndPayload {
  scores: Record<string, number>;
  winner_id: string | null;
  puzzles_solved: Record<string, number>;
  player_names?: Record<string, string>;
  puzzle_results?: Record<string, LiveDuelPuzzleResult[]>;
  end_reason?: string | null;
}

export type LiveDuelRematchStatus = 'idle' | 'waiting' | 'offer' | 'matched' | 'unavailable';
