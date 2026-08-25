import os
import random
import json
import re
import uuid
import logging
import time
from pathlib import Path
from typing import List, Dict, Tuple, Set, Optional

from dotenv import load_dotenv
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek

_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env")

logger = logging.getLogger("puzzle_logic")

DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro"


def _load_system_prompt() -> str:
    prompt_path = _BACKEND_DIR / "system_prompt.txt"
    try:
        return prompt_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as e:
        raise RuntimeError(f"System prompt file not found: {prompt_path}") from e


PERMANENT_SYSTEM_PROMPT = _load_system_prompt()

WORD_BANK = {
    3: ["CAT", "DOG", "ZIP", "MAP", "SUN", "RUN", "FOX", "BOX", "KEY", "TOY", "ICE", "FLY", "JET", "SEA", "SKY"],
    4: ["WORD", "GAME", "MAZE", "PATH", "GOLD", "STAR", "BLUE", "FIRE", "WIND", "LAND", "MIND", "LION", "TIME", "SOUL", "FLOW"],
    5: ["BOARD", "LIGHT", "WATER", "EARTH", "TRAIL", "SHARK", "CROWN", "CLOCK", "STONE", "SPACE", "PLANT", "SHINE", "DREAM", "FLAME", "STORM"],
    6: ["PUZZLE", "MATRIX", "ZIGZAG", "FOREST", "CASTLE", "SHADOW", "BRIDGE", "STREAM", "KNIGHT", "WIZARD", "DRAGON", "CANYON", "GLACIER", "VALLEY", "TEMPLE"],
    7: ["JOURNEY", "MYSTERY", "PHANTOM", "THUNDER", "CRYSTAL", "COMPASS", "MONSTER", "LANTERN", "WEATHER", "JOURNAL", "VICTORY", "HARVEST", "BREEZE", "OASIS", "ELEMENT"],
    8: ["MOUNTAIN", "SKELETON", "BLIZZARD", "TREASURE", "VOLCANO", "DOMINATE", "FRONTIER", "PYRAMID", "UNIVERSE", "INFINITY", "WILDNESS", "FORTRESS", "SPARKLE", "WINDMILL", "CAROUSEL"]
}

def get_random_word(length: int) -> str:
    words = WORD_BANK.get(length, WORD_BANK[4])
    return random.choice(words)

def generate_hamiltonian_path(grid_size: int) -> Optional[List[Tuple[int, int]]]:
    """Generates a Hamiltonian path on a grid of size grid_size x grid_size."""
    start_positions = [(r, c) for r in range(grid_size) for c in range(grid_size)]
    random.shuffle(start_positions)
    for start_row, start_col in start_positions:
        path = [(start_row, start_col)]
        visited = set(path)
        
        def get_valid_neighbors(r, c):
            res = []
            for dr, dc in [(-1,0), (1,0), (0,-1), (0,1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < grid_size and 0 <= nc < grid_size and (nr, nc) not in visited:
                    res.append((nr, nc))
            return res

        def dfs(r, c):
            if len(path) == grid_size * grid_size:
                return True
            neighbors = get_valid_neighbors(r, c)
            if not neighbors:
                return False
            
            random.shuffle(neighbors)
            
            def neighbor_degree(pos):
                nr, nc = pos
                count = 0
                for dr, dc in [(-1,0), (1,0), (0,-1), (0,1)]:
                    nnr, nnc = nr + dr, nc + dc
                    if 0 <= nnr < grid_size and 0 <= nnc < grid_size and (nnr, nnc) not in visited:
                        count += 1
                return count

            neighbors.sort(key=neighbor_degree)
            
            for nr, nc in neighbors:
                path.append((nr, nc))
                visited.add((nr, nc))
                if dfs(nr, nc):
                    return True
                visited.remove((nr, nc))
                path.pop()
            return False
            
        if dfs(start_row, start_col):
            return path
    return None

def count_solutions(grid_size: int, milestones: List[Dict], walls: List[Dict]) -> Tuple[int, List[List[Tuple[int, int]]]]:
    """Finds up to 2 valid Hamiltonian solutions (start=first milestone, end=last)."""
    milestone_map = {tuple(m["cell"]): m["index"] for m in milestones}
    
    wall_set = set()
    for w in walls:
        cell_a = tuple(w["cell_a"])
        cell_b = tuple(w["cell_b"])
        wall_set.add(frozenset({cell_a, cell_b}))
        
    start_cell = None
    end_cell = None
    last_idx = len(milestones) - 1
    for m in milestones:
        if m["index"] == 0:
            start_cell = tuple(m["cell"])
        if m["index"] == last_idx:
            end_cell = tuple(m["cell"])
            
    if start_cell is None or end_cell is None:
        return 0, []
        
    solutions = []
    max_solutions = 2
    
    visited = {start_cell}
    path = [start_cell]
    num_cells = grid_size * grid_size
    
    # Single-cell / single-milestone edge case
    if num_cells == 1:
        if start_cell == end_cell and last_idx == 0:
            return 1, [[start_cell]]
        return 0, []

    if last_idx == 0 and num_cells > 1:
        # One milestone cannot be both start and end on a multi-cell board.
        return 0, []
    
    def backtrack(r, c, next_milestone_idx):
        if len(solutions) >= max_solutions:
            return
            
        if len(path) == num_cells:
            if next_milestone_idx == len(milestones) and path[-1] == end_cell:
                solutions.append(list(path))
            return
            
        for dr, dc in [(-1,0), (1,0), (0,-1), (0,1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < grid_size and 0 <= nc < grid_size:
                neighbor = (nr, nc)
                if neighbor not in visited:
                    if frozenset({(r, c), neighbor}) in wall_set:
                        continue
                        
                    is_milestone = neighbor in milestone_map
                    if is_milestone:
                        m_idx = milestone_map[neighbor]
                        if m_idx != next_milestone_idx:
                            continue
                        # Final milestone may only be visited as the last cell.
                        if m_idx == len(milestones) - 1 and len(path) + 1 != num_cells:
                            continue
                        new_next_idx = next_milestone_idx + 1
                    else:
                        new_next_idx = next_milestone_idx
                        
                    path.append(neighbor)
                    visited.add(neighbor)
                    backtrack(nr, nc, new_next_idx)
                    visited.remove(neighbor)
                    path.pop()
                    
    backtrack(start_cell[0], start_cell[1], 1)
    return len(solutions), solutions

def analyze_difficulty(grid_size: int, milestones: List[Dict], walls: List[Dict], solution_path: List[Tuple[int, int]]) -> Dict:
    """Analyzes the generated puzzle difficulty quantitatively."""
    milestone_map = {tuple(m["cell"]): m["index"] for m in milestones}
    
    wall_set = set()
    for w in walls:
        cell_a = tuple(w["cell_a"])
        cell_b = tuple(w["cell_b"])
        wall_set.add(frozenset({cell_a, cell_b}))
        
    visited = set()
    forced_moves = 0
    decision_points = 0
    wrong_branch_depths = []
    
    for i in range(len(solution_path) - 1):
        curr = tuple(solution_path[i])
        visited.add(curr)
        
        visited_milestones_count = sum(1 for idx in range(i + 1) if tuple(solution_path[idx]) in milestone_map)
        next_milestone_idx = visited_milestones_count
        
        r, c = curr
        valid_neighbors = []
        for dr, dc in [(-1,0), (1,0), (0,-1), (0,1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < grid_size and 0 <= nc < grid_size:
                neighbor = (nr, nc)
                if neighbor not in visited:
                    if frozenset({curr, neighbor}) in wall_set:
                        continue
                    if neighbor in milestone_map:
                        if milestone_map[neighbor] != next_milestone_idx:
                            continue
                    valid_neighbors.append(neighbor)
                    
        next_cell = tuple(solution_path[i+1])
        if next_cell not in valid_neighbors:
            continue
            
        if len(valid_neighbors) == 1:
            forced_moves += 1
        elif len(valid_neighbors) > 1:
            decision_points += 1
            for alt in valid_neighbors:
                if alt == next_cell:
                    continue
                    
                max_depth = [0]
                
                def dfs_wrong_branch(r_w, c_w, w_visited, w_next_idx, current_depth):
                    max_depth[0] = max(max_depth[0], current_depth)
                    curr_w = (r_w, c_w)
                    for dr_w, dc_w in [(-1,0), (1,0), (0,-1), (0,1)]:
                        nr_w, nc_w = r_w + dr_w, c_w + dc_w
                        if 0 <= nr_w < grid_size and 0 <= nc_w < grid_size:
                            neighbor_w = (nr_w, nc_w)
                            if neighbor_w not in w_visited:
                                if frozenset({curr_w, neighbor_w}) in wall_set:
                                    continue
                                if neighbor_w in milestone_map:
                                    if milestone_map[neighbor_w] != w_next_idx:
                                        continue
                                    new_w_next_idx = w_next_idx + 1
                                else:
                                    new_w_next_idx = w_next_idx
                                    
                                w_visited.add(neighbor_w)
                                dfs_wrong_branch(nr_w, nc_w, w_visited, new_w_next_idx, current_depth + 1)
                                w_visited.remove(neighbor_w)
                                
                w_visited = set(visited)
                w_visited.add(alt)
                alt_next_idx = next_milestone_idx
                if alt in milestone_map:
                    alt_next_idx += 1
                dfs_wrong_branch(alt[0], alt[1], w_visited, alt_next_idx, 1)
                wrong_branch_depths.append(max_depth[0])
                
    total_moves = len(solution_path) - 1
    forced_ratio = forced_moves / total_moves if total_moves > 0 else 1.0
    max_wrong_depth = max(wrong_branch_depths) if wrong_branch_depths else 0
    avg_wrong_depth = sum(wrong_branch_depths) / len(wrong_branch_depths) if wrong_branch_depths else 0
    
    if forced_ratio > 0.6 and decision_points <= 2 and max_wrong_depth <= 2:
        classified = "easy"
    elif forced_ratio > 0.3 and max_wrong_depth <= 5:
        classified = "medium"
    elif forced_ratio > 0.15 and max_wrong_depth <= 8:
        classified = "hard"
    else:
        classified = "very_hard"
        
    return {
        "forced_moves": forced_moves,
        "decision_points": decision_points,
        "max_wrong_branch_depth": max_wrong_depth,
        "avg_wrong_branch_depth": avg_wrong_depth,
        "forced_ratio": forced_ratio,
        "classified_difficulty": classified
    }

def clean_and_parse_json(text: str) -> Optional[Dict]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
        
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
            
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass
            
    return None

def _message_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text", "")))
        return "".join(parts)
    return str(content)

def validate_schema(data: Dict, grid_size: int, word: str, solution_path: List[Tuple[int, int]]) -> Optional[str]:
    for field in ["milestones", "walls"]:
        if field not in data:
            return f"Missing required field '{field}'"
            
    milestones = data["milestones"]
    if not isinstance(milestones, list):
        return "'milestones' must be a list"
        
    if len(milestones) != len(word):
        return f"Number of milestones ({len(milestones)}) must match target word length ({len(word)})"
        
    seen_indices = set()
    seen_cells = set()
    for m in milestones:
        for f in ["index", "character", "cell"]:
            if f not in m:
                return f"Milestone is missing field '{f}': {m}"
        idx = m["index"]
        char = m["character"]
        cell = m["cell"]
        
        if not isinstance(cell, list) or len(cell) != 2:
            return f"Milestone cell must be a [row, col] list: {cell}"
            
        r, c = cell
        if not (0 <= r < grid_size and 0 <= c < grid_size):
            return f"Milestone cell coordinate out of bounds: {cell}"
            
        if idx in seen_indices:
            return f"Duplicate milestone index: {idx}"
        seen_indices.add(idx)
        
        cell_t = tuple(cell)
        if cell_t in seen_cells:
            return f"Duplicate milestone cell: {cell}"
        seen_cells.add(cell_t)
        
        if idx < 0 or idx >= len(word):
            return f"Milestone index {idx} out of range for word '{word}'"
            
        if word[idx] != char.upper():
            return f"Milestone character at index {idx} should be '{word[idx]}', got '{char}'"
            
    if len(seen_indices) != len(word):
        return f"Milestones must cover all character indices from 0 to {len(word)-1}"
        
    m0_cell = None
    for m in milestones:
        if m["index"] == 0:
            m0_cell = tuple(m["cell"])
            break
    if m0_cell != solution_path[0]:
        return f"Milestone 0 must be at start cell of the path {solution_path[0]}, got {m0_cell}"

    m_last_cell = None
    last_idx = len(word) - 1
    for m in milestones:
        if m["index"] == last_idx:
            m_last_cell = tuple(m["cell"])
            break
    if m_last_cell != solution_path[-1]:
        return (
            f"Final milestone (index {last_idx}) must be at end cell of the path "
            f"{solution_path[-1]}, got {m_last_cell}"
        )
        
    pos_map = {cell: idx for idx, cell in enumerate(solution_path)}
    milestone_positions = []
    for m in milestones:
        cell = tuple(m["cell"])
        path_idx = pos_map.get(cell)
        if path_idx is None:
            return f"Milestone cell {cell} is not in the solution path"
        milestone_positions.append((m["index"], path_idx))
        
    milestone_positions.sort()
    for i in range(len(milestone_positions) - 1):
        idx_a, p_a = milestone_positions[i]
        idx_b, p_b = milestone_positions[i+1]
        if p_a >= p_b:
            return f"Milestones out of order along the solution path: milestone {idx_a} is at path step {p_a}, milestone {idx_b} is at path step {p_b} (must be strictly increasing)"
            
    walls = data["walls"]
    if not isinstance(walls, list):
        return "'walls' must be a list"
        
    solution_edges = set()
    for i in range(len(solution_path) - 1):
        solution_edges.add(frozenset({solution_path[i], solution_path[i+1]}))
        
    for w in walls:
        for f in ["cell_a", "cell_b"]:
            if f not in w:
                return f"Wall is missing field '{f}': {w}"
        cell_a = w["cell_a"]
        cell_b = w["cell_b"]
        
        if not isinstance(cell_a, list) or len(cell_a) != 2 or not isinstance(cell_b, list) or len(cell_b) != 2:
            return f"Wall cells must be [row, col] lists: {w}"
            
        ra, ca = cell_a
        rb, cb = cell_b
        
        if not (0 <= ra < grid_size and 0 <= ca < grid_size) or not (0 <= rb < grid_size and 0 <= cb < grid_size):
            return f"Wall coordinates out of bounds: {w}"
            
        if abs(ra - rb) + abs(ca - cb) != 1:
            return f"Wall must be between adjacent cells: {w}"
            
        cell_a_t = tuple(cell_a)
        cell_b_t = tuple(cell_b)
        if frozenset({cell_a_t, cell_b_t}) in solution_edges:
            return f"Wall conflicts with the intended solution path: {cell_a_t} to {cell_b_t}"
            
    return None

DYNAMIC_USER_PROMPT = """You are generating ONE Word Zip puzzle using the permanent Word Zip


==================================================
PREVIOUS ATTEMPT
==================================================

{PREVIOUS_ATTEMPT}


==================================================
EXTERNAL SOLVER FEEDBACK
==================================================

{SOLVER_FEEDBACK}


==================================================
REVISION INSTRUCTIONS
==================================================

If this is a revision:

- preserve the requested grid size
- preserve the target word
- preserve all explicitly protected milestones
- preserve the intended path if marked immutable
- address the solver/design feedback
- do not introduce new validity problems while fixing another problem

If this is a fresh generation, construct a new candidate.


==================================================
PUZZLE PARAMETERS
==================================================
Grid Size: {GRID_SIZE}
Target Word: {WORD}
Target Difficulty: {DIFFICULTY}

Here is the Intended Hamiltonian Path (Immutable):
{INTENDED_PATH_STEPS}

Instructions:
1. Place milestones. There must be exactly {WORD_LEN} milestones.
You must map each milestone index to one of the steps along the Intended Hamiltonian Path.
Specifically, your output JSON must contain exactly these milestones:
{MILESTONE_SPECS}

You must select the cell coordinates for each milestone cell_i corresponding to a step index k_i along the Intended Hamiltonian Path.
To ensure the milestones are visited in the correct order, the step indices you select MUST be strictly increasing:
0 = k_0 < k_1 < k_2 < ... < k_{WORD_LEN_MINUS_1} = {GRID_SIZE_SQ_MINUS_1}.

Hard start/end rule:
- Milestone 0 MUST be the first cell of solution_path.
- Milestone {WORD_LEN_MINUS_1} MUST be the last cell of solution_path.

2. Place walls. Place walls between adjacent cells to create interesting constraints.
- Multiple valid solution paths are allowed, but EVERY valid path must be a full Hamiltonian path, must not pass through walls, must not form a cycle, must start on the first milestone, and must end on the final milestone.
- Do not place walls between cells that are adjacent in the Intended Hamiltonian Path. Doing so would break the intended solution.
- Place walls between other adjacent cells that could allow illegal shortcuts or invalid routes.
3. For {DIFFICULTY} difficulty:
{DIFFICULTY_GUIDELINES}


==================================================
OUTPUT FORMAT
==================================================

Return ONLY valid JSON matching this structure:

{{
  "grid_size": {GRID_SIZE},

  "word": "{WORD}",

  "milestones": [
{MILESTONE_PLACEHOLDERS}
  ],

  "solution_path": {INTENDED_PATH},

  "walls": [
    {{
      "cell_a": [row, column],
      "cell_b": [row, column]
    }}
  ]
}}

Do not include additional text or Markdown wrapping. Return raw JSON.
"""

DIFFICULTY_GUIDELINES = {
    "easy": """- Relatively high proportion of forced moves.
- Few major decision points.
- Wrong branches should fail relatively quickly (max depth 1-2).
- Milestone constraints should provide strong guidance.
- Walls should be relatively simple.
- Avoid deceptive structures.""",
    "medium": """- Moderate forced movement.
- Several meaningful decision points.
- Some plausible wrong branches.
- Wrong branches should sometimes survive several moves (max depth 3-5).
- Walls should create ambiguity without becoming confusing.
- Milestones should provide useful but incomplete guidance.""",
    "hard": """- Moderate-to-low forced movement.
- Multiple meaningful decision points.
- Several plausible wrong branches.
- Some wrong branches should survive many moves (depth > 5).
- Milestones and walls should interact strongly.
- Avoid visually obvious corridors.
- Require reasoning across multiple constraints.
- Maintain exactly one global solution.
- Avoid pure guessing.""",
    "very_hard": """- High structural ambiguity.
- Deep wrong branches.
- Sophisticated interaction between milestones and walls.
- Fewer immediately forced moves.
- Multiple competing local hypotheses.
- Contradictions should emerge only after deeper reasoning.
- Solution must still be logically discoverable.
- Avoid arbitrary trial-and-error."""
}

def find_blocking_walls(intended_path: List[Tuple[int, int]], alt_path: List[List[int]]) -> List[Tuple[Tuple[int, int], Tuple[int, int]]]:
    intended_edges = set()
    for i in range(len(intended_path) - 1):
        intended_edges.add(frozenset({intended_path[i], intended_path[i+1]}))
        
    blocking_candidates = []
    for i in range(len(alt_path) - 1):
        edge = frozenset({tuple(alt_path[i]), tuple(alt_path[i+1])})
        if edge not in intended_edges:
            cell_a, cell_b = list(edge)
            blocking_candidates.append((cell_a, cell_b))
    return blocking_candidates

def make_puzzle_unique(grid_size: int, milestones: List[Dict], walls: List[Dict], solution_path: List[Tuple[int, int]]) -> List[Dict]:
    """
    Soft pass only. Multiple valid solutions are allowed, so we do not add walls
    just to force uniqueness. Returns the input walls unchanged.
    """
    num_solutions, _ = count_solutions(grid_size, milestones, walls)
    logger.debug(
        "make_puzzle_unique: soft pass grid=%s walls=%s solutions=%s (uniqueness not required)",
        grid_size,
        len(walls),
        num_solutions,
    )
    return list(walls)

def create_puzzle_flow(difficulty: str, grid_size: Optional[int] = None, word: Optional[str] = None, model_name: str = DEFAULT_DEEPSEEK_MODEL) -> Dict:
    flow_t0 = time.perf_counter()
    logger.info(
        "create_puzzle_flow: START difficulty=%r grid_size=%r word=%r model_name=%r",
        difficulty,
        grid_size,
        word,
        model_name,
    )

    if difficulty not in ["easy", "medium", "hard", "very_hard"]:
        logger.warning(
            "create_puzzle_flow: invalid difficulty %r; defaulting to 'medium'",
            difficulty,
        )
        difficulty = "medium"
        
    if grid_size is None:
        # Align with system_prompt.txt supported boards: 5×5 / 7×7 / 9×9
        if difficulty == "easy":
            grid_size = 5
        elif difficulty == "medium":
            grid_size = 7
        else:
            grid_size = 9
        logger.debug(
            "create_puzzle_flow: grid_size unset; mapped difficulty=%s -> %s",
            difficulty,
            grid_size,
        )
            
    if word is None:
        if difficulty == "easy":
            word_len = random.choice([4, 5, 6])
        elif difficulty == "medium":
            word_len = random.choice([5, 6, 7])
        else:
            word_len = random.choice([6, 7, 8])
        word = get_random_word(word_len)
        logger.debug(
            "create_puzzle_flow: word unset; chose length=%s word=%s",
            word_len,
            word,
        )
    else:
        word = word.upper()
        word_len = len(word)
        logger.debug("create_puzzle_flow: using provided word=%s len=%s", word, word_len)
        
    logger.info(
        "create_puzzle_flow: resolved params difficulty=%s grid_size=%s word=%s",
        difficulty,
        grid_size,
        word,
    )

    path_t0 = time.perf_counter()
    solution_path = generate_hamiltonian_path(grid_size)
    if not solution_path:
        logger.error(
            "create_puzzle_flow: Hamiltonian path generation failed for grid_size=%s",
            grid_size,
        )
        raise ValueError(f"Failed to generate a Hamiltonian path for grid size {grid_size}")
    logger.info(
        "create_puzzle_flow: Hamiltonian path ready cells=%s start=%s end=%s (%.2fs)",
        len(solution_path),
        list(solution_path[0]),
        list(solution_path[-1]),
        time.perf_counter() - path_t0,
    )
        
    deepseek_api_key = os.getenv("DEEPSEEK_API_KEY")
    if not deepseek_api_key:
        logger.error("create_puzzle_flow: DEEPSEEK_API_KEY is not set")
        raise RuntimeError("DEEPSEEK_API_KEY is not set. Add it to backend/.env")
    logger.debug("create_puzzle_flow: DEEPSEEK_API_KEY present (len=%s)", len(deepseek_api_key))

    try:
        llm = ChatDeepSeek(
            model=model_name,
            temperature=0.7,
            api_key=deepseek_api_key,
            max_retries=1,
            timeout=180,
        )
        logger.info("create_puzzle_flow: ChatDeepSeek initialized model=%s", model_name)
    except Exception as e:
        logger.exception("create_puzzle_flow: ChatDeepSeek init failed model=%s", model_name)
        raise RuntimeError(f"Failed to initialize ChatDeepSeek with model {model_name}: {e}")
        
    previous_attempt = "None"
    solver_feedback = "This is a fresh generation."
    
    for attempt in range(4):
        attempt_t0 = time.perf_counter()
        logger.info(
            "create_puzzle_flow: attempt %s/4 starting (feedback=%r)",
            attempt + 1,
            solver_feedback[:200] if isinstance(solver_feedback, str) else solver_feedback,
        )

        if attempt > 0 and attempt % 3 == 0:
            logger.info(
                "create_puzzle_flow: attempt %s — regenerating Hamiltonian path",
                attempt + 1,
            )
            solution_path = generate_hamiltonian_path(grid_size)
            if not solution_path:
                logger.error(
                    "create_puzzle_flow: Hamiltonian path regen failed for grid_size=%s",
                    grid_size,
                )
                raise ValueError(f"Failed to generate a Hamiltonian path for grid size {grid_size}")
            previous_attempt = "None"
            solver_feedback = "This is a fresh generation on a newly generated intended Hamiltonian path."
            logger.debug(
                "create_puzzle_flow: new path start=%s end=%s",
                list(solution_path[0]),
                list(solution_path[-1]),
            )

        # Generate milestone specs
        milestone_specs_list = []
        for idx in range(len(word)):
            if idx == 0:
                milestone_specs_list.append(f"- Milestone index 0: 'index'=0, 'character'='{word[0]}', 'cell' must be {list(solution_path[0])} (Step 0 / PATH START)")
            elif idx == len(word) - 1:
                milestone_specs_list.append(
                    f"- Milestone index {idx}: 'index'={idx}, 'character'='{word[idx]}', "
                    f"'cell' must be {list(solution_path[-1])} (Step {len(solution_path) - 1} / PATH END)"
                )
            else:
                milestone_specs_list.append(f"- Milestone index {idx}: 'index'={idx}, 'character'='{word[idx]}', 'cell' must be chosen from one of the steps after Milestone {idx-1} and before the final milestone")
        milestone_specs_str = "\n".join(milestone_specs_list)
        
        # Generate intended path steps
        intended_path_steps_list = []
        for idx, cell in enumerate(solution_path):
            intended_path_steps_list.append(f"Step {idx}: {list(cell)}")
        intended_path_steps_str = "\n".join(intended_path_steps_list)

        # Generate milestone placeholders
        milestone_placeholders = []
        for idx in range(len(word)):
            if idx == 0:
                milestone_placeholders.append(f'    {{"index": 0, "character": "{word[0]}", "cell": {list(solution_path[0])}}}')
            elif idx == len(word) - 1:
                milestone_placeholders.append(
                    f'    {{"index": {idx}, "character": "{word[idx]}", "cell": {list(solution_path[-1])}}}'
                )
            else:
                milestone_placeholders.append(f'    {{"index": {idx}, "character": "{word[idx]}", "cell": [row, column]}}')
        milestone_placeholders_str = ",\n".join(milestone_placeholders)

        user_prompt = DYNAMIC_USER_PROMPT.format(
            PREVIOUS_ATTEMPT=previous_attempt,
            SOLVER_FEEDBACK=solver_feedback,
            GRID_SIZE=grid_size,
            GRID_SIZE_SQ=grid_size * grid_size,
            GRID_SIZE_SQ_MINUS_1=grid_size * grid_size - 1,
            WORD=word,
            WORD_LEN=len(word),
            WORD_LEN_MINUS_1=len(word) - 1,
            CHAR_0=word[0],
            START_CELL=list(solution_path[0]),
            INTENDED_PATH=[list(cell) for cell in solution_path],
            INTENDED_PATH_STEPS=intended_path_steps_str,
            MILESTONE_SPECS=milestone_specs_str,
            MILESTONE_PLACEHOLDERS=milestone_placeholders_str,
            DIFFICULTY=difficulty,
            DIFFICULTY_GUIDELINES=DIFFICULTY_GUIDELINES.get(difficulty, DIFFICULTY_GUIDELINES["medium"])
        )
        logger.debug(
            "create_puzzle_flow: attempt %s prompt sizes system=%s user=%s previous_attempt_chars=%s",
            attempt + 1,
            len(PERMANENT_SYSTEM_PROMPT),
            len(user_prompt),
            len(previous_attempt) if isinstance(previous_attempt, str) else 0,
        )
        
        messages = [
            SystemMessage(content=PERMANENT_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt)
        ]
        
        try:
            logger.info("create_puzzle_flow: attempt %s calling DeepSeek LLM...", attempt + 1)
            llm_t0 = time.perf_counter()
            response = llm.invoke(messages)
            raw_content = _message_text(response.content)
            logger.info(
                "create_puzzle_flow: attempt %s LLM returned chars=%s (%.2fs)",
                attempt + 1,
                len(raw_content),
                time.perf_counter() - llm_t0,
            )
            logger.debug(
                "create_puzzle_flow: attempt %s raw response preview: %s",
                attempt + 1,
                raw_content[:500].replace("\n", "\\n"),
            )
        except Exception as e:
            solver_feedback = f"Error communicating with DeepSeek: {str(e)}"
            logger.exception(
                "create_puzzle_flow: attempt %s DeepSeek invoke failed: %s",
                attempt + 1,
                e,
            )
            continue
            
        parsed_json = clean_and_parse_json(raw_content)
        if not parsed_json:
            previous_attempt = raw_content
            solver_feedback = "Invalid JSON. Output must be a single raw JSON object matching the requested schema. Do not include markdown formatting or explanations."
            logger.warning(
                "create_puzzle_flow: attempt %s JSON parse failed (raw_chars=%s)",
                attempt + 1,
                len(raw_content),
            )
            continue

        logger.debug(
            "create_puzzle_flow: attempt %s parsed keys=%s milestones=%s walls=%s",
            attempt + 1,
            list(parsed_json.keys()) if isinstance(parsed_json, dict) else type(parsed_json),
            len(parsed_json.get("milestones", [])) if isinstance(parsed_json, dict) else None,
            len(parsed_json.get("walls", [])) if isinstance(parsed_json, dict) else None,
        )
            
        # Silently discard any walls that block the intended solution path
        if isinstance(parsed_json, dict) and "walls" in parsed_json and isinstance(parsed_json["walls"], list):
            solution_edges = set()
            for i in range(len(solution_path) - 1):
                solution_edges.add(frozenset({solution_path[i], solution_path[i+1]}))
            
            walls_before = len(parsed_json["walls"])
            filtered_walls = []
            discarded = 0
            for w in parsed_json["walls"]:
                try:
                    cell_a = tuple(w["cell_a"])
                    cell_b = tuple(w["cell_b"])
                    if frozenset({cell_a, cell_b}) not in solution_edges:
                        filtered_walls.append(w)
                    else:
                        discarded += 1
                except Exception:
                    filtered_walls.append(w)

            logger.debug(
                "create_puzzle_flow: attempt %s wall filter in=%s kept=%s discarded_solution_conflicts=%s",
                attempt + 1,
                walls_before,
                len(filtered_walls),
                discarded,
            )
            
            # Soft uniqueness pass: optional wall growth, but multiple valid solutions are OK.
            final_walls = make_puzzle_unique(grid_size, parsed_json["milestones"], filtered_walls, solution_path)
            parsed_json["walls"] = final_walls
            logger.info(
                "create_puzzle_flow: attempt %s walls after optional uniqueness pass=%s",
                attempt + 1,
                len(final_walls),
            )

        validation_err = validate_schema(parsed_json, grid_size, word, solution_path)
        if validation_err:
            previous_attempt = json.dumps(parsed_json)
            solver_feedback = f"Schema validation error: {validation_err}"
            logger.warning(
                "create_puzzle_flow: attempt %s schema validation failed: %s",
                attempt + 1,
                validation_err,
            )
            continue
            
        logger.debug("create_puzzle_flow: attempt %s schema OK; counting solutions...", attempt + 1)
        num_solutions, sol_paths = count_solutions(grid_size, parsed_json["milestones"], parsed_json["walls"])
        logger.info(
            "create_puzzle_flow: attempt %s solver found num_solutions=%s",
            attempt + 1,
            num_solutions,
        )
        
        if num_solutions == 0:
            previous_attempt = json.dumps(parsed_json)
            solver_feedback = "The puzzle has zero solutions! Verify that you did not place a wall that blocks the Intended Hamiltonian Path, that milestones are reachable in order, and that the path starts on the first letter and ends on the last letter."
            logger.warning(
                "create_puzzle_flow: attempt %s zero solutions (%.2fs)",
                attempt + 1,
                time.perf_counter() - attempt_t0,
            )
            continue
        elif num_solutions > 1:
            # Multiple valid Hamiltonian solutions are allowed.
            logger.info(
                "create_puzzle_flow: attempt %s accepted with %s valid solutions",
                attempt + 1,
                num_solutions,
            )

        analysis = analyze_difficulty(grid_size, parsed_json["milestones"], parsed_json["walls"], solution_path)
        start = solution_path[0]
        end = solution_path[-1]
        ui_difficulty = difficulty if difficulty in ("easy", "medium", "hard") else "hard"
        puzzle_id = f"puzzle_{ui_difficulty}_{uuid.uuid4().hex[:10]}"

        logger.info(
            "create_puzzle_flow: SUCCESS id=%s attempt=%s classified=%s walls=%s milestones=%s total=%.2fs",
            puzzle_id,
            attempt + 1,
            analysis.get("classified_difficulty"),
            len(parsed_json["walls"]),
            len(parsed_json["milestones"]),
            time.perf_counter() - flow_t0,
        )
        logger.debug("create_puzzle_flow: difficulty_analysis=%s", analysis)

        return {
            "id": puzzle_id,
            "difficulty": ui_difficulty,
            "grid_size": grid_size,
            "word": word,
            "start_cell": [start[0], start[1]],
            "end_cell": [end[0], end[1]],
            "milestones": parsed_json["milestones"],
            "solution_path": [list(c) for c in solution_path],
            "walls": parsed_json["walls"],
            "difficulty_analysis": analysis,
        }
        
    logger.error(
        "create_puzzle_flow: FAILED after 4 attempts last_feedback=%r total=%.2fs",
        solver_feedback,
        time.perf_counter() - flow_t0,
    )
    raise ValueError(f"Failed to generate a valid puzzle after 4 attempts. Last feedback: {solver_feedback}")

