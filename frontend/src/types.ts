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
