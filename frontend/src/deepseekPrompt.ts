import { Difficulty, GridPos } from './types';
import { SYSTEM_PROMPT } from './systemPrompt';

export { SYSTEM_PROMPT };

const WORD_POOL: Record<Difficulty, string[]> = {
  easy: [
    'CAT',
    'DOG',
    'BIRD',
    'TREE',
    'STAR',
    'MOON',
    'FISH',
    'BOOK',
    'BOARD',
    'LIGHT',
    'WATER',
    'STONE',
  ],
  medium: [
    'PLANET',
    'GARDEN',
    'BRIDGE',
    'CASTLE',
    'ORANGE',
    'WINTER',
    'PUZZLE',
    'MATRIX',
    'FOREST',
    'SHADOW',
    'KNIGHT',
    'DRAGON',
  ],
  hard: [
    'HORIZON',
    'CRYSTAL',
    'JOURNEY',
    'MYSTERY',
    'THUNDER',
    'GALAXY',
    'COMPASS',
    'LANTERN',
    'MOUNTAIN',
    'TREASURE',
    'VOLCANO',
    'FRONTIER',
  ],
};

const DIFFICULTY_GUIDELINES: Record<Difficulty, string> = {
  easy: `- Relatively high proportion of forced moves.
- Few major decision points.
- Wrong branches should fail relatively quickly (max depth 1-2).
- Milestone constraints should provide strong guidance.
- 0 walls for easy.
- Avoid deceptive structures.`,
  medium: `- Moderate forced movement.
- Several meaningful decision points.
- Some plausible wrong branches.
- Wrong branches should sometimes survive several moves (max depth 3-5).
- Place about 4-5 strategically useful walls.
- Walls should create ambiguity without becoming confusing.
- Milestones should provide useful but incomplete guidance.`,
  hard: `- Moderate-to-low forced movement.
- Multiple meaningful decision points.
- Several plausible wrong branches.
- Some wrong branches should survive many moves (depth > 5).
- Place about 6-8 strategically useful walls.
- Milestones and walls should interact strongly.
- Avoid visually obvious corridors.
- Require reasoning across multiple constraints.
- Maintain at least one valid global solution; extra valid solutions are OK.
- Avoid pure guessing.`,
};

export function gridSizeForDifficulty(difficulty: Difficulty): number {
  if (difficulty === 'easy') {
    return 5;
  }
  if (difficulty === 'medium') {
    return 7;
  }
  return 9;
}

export function pickTargetWord(difficulty: Difficulty): string {
  const pool = WORD_POOL[difficulty];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Warnsdorff-style DFS Hamiltonian path over an N×N grid.
 * Returns null if no path is found within the attempt budget.
 */
export function generateHamiltonianPath(gridSize: number): GridPos[] | null {
  const total = gridSize * gridSize;
  const starts: GridPos[] = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      starts.push({ row: r, col: c });
    }
  }
  // Shuffle starts
  for (let i = starts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [starts[i], starts[j]] = [starts[j], starts[i]];
  }

  const dirs = [
    { r: -1, c: 0 },
    { r: 1, c: 0 },
    { r: 0, c: -1 },
    { r: 0, c: 1 },
  ];

  for (const start of starts.slice(0, Math.min(12, starts.length))) {
    const path: GridPos[] = [start];
    const visited = new Set<string>([`${start.row},${start.col}`]);

    const neighborDegree = (row: number, col: number) => {
      let count = 0;
      for (const d of dirs) {
        const nr = row + d.r;
        const nc = col + d.c;
        if (
          nr >= 0 &&
          nr < gridSize &&
          nc >= 0 &&
          nc < gridSize &&
          !visited.has(`${nr},${nc}`)
        ) {
          count++;
        }
      }
      return count;
    };

    const dfs = (): boolean => {
      if (path.length === total) {
        return true;
      }
      const curr = path[path.length - 1];
      const neighbors: GridPos[] = [];
      for (const d of dirs) {
        const nr = curr.row + d.r;
        const nc = curr.col + d.c;
        if (
          nr >= 0 &&
          nr < gridSize &&
          nc >= 0 &&
          nc < gridSize &&
          !visited.has(`${nr},${nc}`)
        ) {
          neighbors.push({ row: nr, col: nc });
        }
      }
      neighbors.sort(
        (a, b) => neighborDegree(a.row, a.col) - neighborDegree(b.row, b.col),
      );

      for (const n of neighbors) {
        path.push(n);
        visited.add(`${n.row},${n.col}`);
        if (dfs()) {
          return true;
        }
        visited.delete(`${n.row},${n.col}`);
        path.pop();
      }
      return false;
    };

    if (dfs()) {
      return path;
    }
  }

  return null;
}

export function buildUserPrompt(
  difficulty: Difficulty,
  gridSize: number,
  word: string,
  solutionPath: GridPos[],
): string {
  const wordLen = word.length;
  const gridSizeSq = gridSize * gridSize;

  const intendedPathSteps = solutionPath
    .map((cell, idx) => `Step ${idx}: [${cell.row}, ${cell.col}]`)
    .join('\n');

  const intendedPathJson = JSON.stringify(
    solutionPath.map((c) => [c.row, c.col]),
  );

  const lastCell = solutionPath[solutionPath.length - 1];

  const milestoneSpecs = Array.from({ length: wordLen }, (_, idx) => {
    if (idx === 0) {
      return `- Milestone index 0: 'index'=0, 'character'='${word[0]}', 'cell' must be [${solutionPath[0].row}, ${solutionPath[0].col}] (Step 0 / PATH START)`;
    }
    if (idx === wordLen - 1) {
      return `- Milestone index ${idx}: 'index'=${idx}, 'character'='${word[idx]}', 'cell' must be [${lastCell.row}, ${lastCell.col}] (Step ${gridSizeSq - 1} / PATH END)`;
    }
    return `- Milestone index ${idx}: 'index'=${idx}, 'character'='${word[idx]}', 'cell' must be chosen from one of the steps after Milestone ${idx - 1} and before the final milestone`;
  }).join('\n');

  const milestonePlaceholders = Array.from({ length: wordLen }, (_, idx) => {
    if (idx === 0) {
      return `    { "index": 0, "character": "${word[0]}", "cell": [${solutionPath[0].row}, ${solutionPath[0].col}] }`;
    }
    if (idx === wordLen - 1) {
      return `    { "index": ${idx}, "character": "${word[idx]}", "cell": [${lastCell.row}, ${lastCell.col}] }`;
    }
    return `    { "index": ${idx}, "character": "${word[idx]}", "cell": [row, column] }`;
  }).join(',\n');

  return `You are generating ONE Word Zip puzzle using the permanent Word Zip system instructions.


==================================================
PREVIOUS ATTEMPT
==================================================

None


==================================================
EXTERNAL SOLVER FEEDBACK
==================================================

This is a fresh generation.


==================================================
REVISION INSTRUCTIONS
==================================================

This is a fresh generation. Construct a new candidate.


==================================================
PUZZLE PARAMETERS
==================================================
Grid Size: ${gridSize}
Target Word: ${word}
Target Difficulty: ${difficulty}

Here is the Intended Hamiltonian Path (Immutable):
${intendedPathSteps}

Instructions:
1. Place milestones. There must be exactly ${wordLen} milestones.
You must map each milestone index to one of the steps along the Intended Hamiltonian Path.
Specifically, your output JSON must contain exactly these milestones:
${milestoneSpecs}

You must select the cell coordinates for each milestone cell_i corresponding to a step index k_i along the Intended Hamiltonian Path.
To ensure the milestones are visited in the correct order, the step indices you select MUST be strictly increasing:
0 = k_0 < k_1 < k_2 < ... < k_${wordLen - 1} = ${gridSizeSq - 1}.

Hard start/end rule:
- Milestone 0 MUST be the first cell of solution_path.
- Milestone ${wordLen - 1} MUST be the last cell of solution_path.

2. Place walls. Place walls between adjacent cells to create interesting constraints.
- Multiple valid solution paths are allowed, but EVERY valid path must be a full Hamiltonian path, must not pass through walls, must not form a cycle, must start on the first milestone, and must end on the final milestone.
- Do not place walls between cells that are adjacent in the Intended Hamiltonian Path. Doing so would break the intended solution.
- Place walls between other adjacent cells that could allow illegal shortcuts or invalid routes.
3. For ${difficulty} difficulty:
${DIFFICULTY_GUIDELINES[difficulty]}


==================================================
OUTPUT FORMAT
==================================================

Return ONLY valid JSON matching this structure:

{
  "grid_size": ${gridSize},

  "word": "${word}",

  "milestones": [
${milestonePlaceholders}
  ],

  "solution_path": ${intendedPathJson},

  "walls": [
    {
      "cell_a": [row, column],
      "cell_b": [row, column]
    }
  ]
}

Do not include additional text or Markdown wrapping. Return raw JSON.`;
}
