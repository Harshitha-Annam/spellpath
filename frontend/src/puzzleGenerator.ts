import { Difficulty, PuzzleData, CellData, Wall, GridPos } from './types';

const EASY_WORDS = [
  'SPELLPATH',
  'TREASURE',
  'JOURNEY',
  'RAINBOW',
  'DIAMOND',
  'STARLIGHT',
  'MAGICAL',
  'EXPLORE',
];

const MEDIUM_WORDS = [
  'EXTRAORDINARY',
  'ALPHABETSOUP',
  'THUNDERSTORM',
  'CONSTELLATION',
  'ARCHITECTURE',
  'AUTHENTICITY',
  'KNOWLEDGEABLE',
];

const HARD_WORDS = [
  'UNCHARACTERISTICALLY',
  'SUPERCALIFRAGILISTIC',
  'ENVIRONMENTALLY',
  'INCOMPREHENSIBILITY',
  'COUNTERPRODUCTIVE',
  'MULTIDIMENSIONAL',
];

export function getWallKey(r1: number, c1: number, r2: number, c2: number): string {
  const p1 = r1 * 1000 + c1;
  const p2 = r2 * 1000 + c2;
  return p1 < p2 ? `${r1}_${c1}_${r2}_${c2}` : `${r2}_${c2}_${r1}_${c1}`;
}

export function generatePuzzle(difficulty: Difficulty): PuzzleData {
  let gridSize = 5;
  let words = EASY_WORDS;
  let numWalls = 0;

  if (difficulty === 'easy') {
    gridSize = 5;
    words = EASY_WORDS;
    numWalls = 0;
  } else if (difficulty === 'medium') {
    gridSize = 7;
    words = MEDIUM_WORDS;
    numWalls = 4 + Math.floor(Math.random() * 2); // 4–5
  } else {
    gridSize = 9;
    words = HARD_WORDS;
    numWalls = 6 + Math.floor(Math.random() * 3); // 6–8
  }

  // Pick target word
  const targetWord = words[Math.floor(Math.random() * words.length)].toUpperCase();

  // Try to generate a valid snake path for the word
  let attempts = 0;
  let path: GridPos[] = [];
  
  while (attempts < 100) {
    attempts++;
    path = generateSnakePath(gridSize, targetWord.length);
    if (path.length === targetWord.length) {
      break;
    }
  }

  // Fallback linear layout if random snake failed
  if (path.length < targetWord.length) {
    path = [];
    let r = 0, c = 0, dir = 1;
    for (let i = 0; i < targetWord.length; i++) {
      path.push({ row: r, col: c });
      c += dir;
      if (c >= gridSize || c < 0) {
        dir = -dir;
        c += dir;
        r++;
      }
    }
  }

  // Build grid matrix
  const gridLetters: string[][] = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill('')
  );

  // Fill snake path with target word letters (milestones only)
  for (let i = 0; i < targetWord.length; i++) {
    const pos = path[i];
    gridLetters[pos.row][pos.col] = targetWord[i];
  }

  // Non-milestone cells stay empty — only the target word letters are placed.

  // Set of path edges to avoid putting walls on path steps
  const pathEdgeSet = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    pathEdgeSet.add(getWallKey(p1.row, p1.col, p2.row, p2.col));
  }

  // Generate walls for medium/hard
  const walls: Wall[] = [];
  const wallSet = new Set<string>();

  if (numWalls > 0) {
    let wallAttempts = 0;
    while (walls.length < numWalls && wallAttempts < 500) {
      wallAttempts++;
      const r = Math.floor(Math.random() * gridSize);
      const c = Math.floor(Math.random() * gridSize);
      const isVert = Math.random() > 0.5;

      const r2 = isVert ? r : r + 1;
      const c2 = isVert ? c + 1 : c;

      if (r2 < gridSize && c2 < gridSize) {
        const key = getWallKey(r, c, r2, c2);
        if (!pathEdgeSet.has(key) && !wallSet.has(key)) {
          wallSet.add(key);
          walls.push({ row1: r, col1: c, row2: r2, col2: c2 });
        }
      }
    }
  }

  const startPos = path[0];
  const endPos = path[path.length - 1];

  const cells: CellData[][] = [];
  for (let r = 0; r < gridSize; r++) {
    const rowCells: CellData[] = [];
    for (let c = 0; c < gridSize; c++) {
      const letter = gridLetters[r][c];
      const isStart = r === startPos.row && c === startPos.col;
      rowCells.push({
        row: r,
        col: c,
        letter,
        isStart,
        isMilestone: letter.length > 0,
      });
    }
    cells.push(rowCells);
  }

  const milestones = path.map((pos, index) => ({
    index,
    character: targetWord[index],
    cell: pos,
  }));

  return {
    id: `puzzle_${difficulty}_${Date.now()}`,
    difficulty,
    gridSize,
    targetWord,
    startCell: startPos,
    endCell: endPos,
    cells,
    walls,
    milestones,
    // Local generator only places the word snake (not a full Hamiltonian path).
    solutionPath: path.map((p) => ({ row: p.row, col: p.col })),
  };
}

function generateSnakePath(gridSize: number, length: number): GridPos[] {
  const startR = Math.floor(Math.random() * gridSize);
  const startC = Math.floor(Math.random() * gridSize);
  
  const path: GridPos[] = [{ row: startR, col: startC }];
  const visited = new Set<string>();
  visited.add(`${startR}_${startC}`);

  const dirs = [
    { r: -1, c: 0 },
    { r: 1, c: 0 },
    { r: 0, c: -1 },
    { r: 0, c: 1 },
  ];

  for (let step = 1; step < length; step++) {
    const curr = path[path.length - 1];
    // shuffle dirs
    const shuffledDirs = [...dirs].sort(() => Math.random() - 0.5);
    let moved = false;

    for (const d of shuffledDirs) {
      const nr = curr.row + d.r;
      const nc = curr.col + d.c;
      const key = `${nr}_${nc}`;

      if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize && !visited.has(key)) {
        visited.add(key);
        path.push({ row: nr, col: nc });
        moved = true;
        break;
      }
    }

    if (!moved) {
      break; // Dead end
    }
  }

  return path;
}
