"""
Minimal DeepSeek proxy for /get-puzzle.

Builds a difficulty-scaled woven Hamiltonian path (never a row-serpentine),
asks DeepSeek mainly for trap walls, returns playable JSON.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env")

logger = logging.getLogger("get_puzzle")

DEFAULT_GET_PUZZLE_MODEL = "deepseek-chat"
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_TIMEOUT_S = 300.0

DIFFICULTY_TO_SIZE = {
    "easy": 5,
    "medium": 7,
    "hard": 9,
    "very_hard": 9,
}

DIFFICULTY_PROFILE = {
    "easy": {"max_straight": 3, "min_turn_ratio": 2.0, "walls": (0, 1), "flips": 40},
    "medium": {"max_straight": 2, "min_turn_ratio": 3.0, "walls": (4, 5), "flips": 120},
    "hard": {"max_straight": 2, "min_turn_ratio": 4.0, "walls": (6, 8), "flips": 200},
    "very_hard": {"max_straight": 2, "min_turn_ratio": 4.5, "walls": (7, 10), "flips": 240},
}

WALL_HINTS = {
    "easy": "Prefer 0 walls. At most 1 wall only if it creates a real fork near a turn.",
    "medium": (
        "Place 4 or 5 trap walls on tempting wrong exits at turns/milestones. "
        "Never draw a corridor along the solution."
    ),
    "hard": "Place 6 to 8 trap walls that create deep multi-step wrong branches.",
    "very_hard": "Place 7 to 10 trap walls with late-revealed dead ends.",
}

WORD_LENGTHS = {
    "easy": (4, 5),
    "medium": (5, 6),
    "hard": (6, 7),
    "very_hard": (7, 8),
}

WORD_BANK = {
    4: ["WORD", "GAME", "MAZE", "PATH", "GOLD", "STAR", "BLUE", "FIRE", "WIND", "LAND"],
    5: ["BOARD", "LIGHT", "WATER", "EARTH", "TRAIL", "CROWN", "STONE", "SPACE", "DREAM", "FLAME"],
    6: ["PUZZLE", "MATRIX", "FOREST", "CASTLE", "SHADOW", "BRIDGE", "STREAM", "KNIGHT", "DRAGON", "TEMPLE"],
    7: ["JOURNEY", "MYSTERY", "THUNDER", "CRYSTAL", "COMPASS", "LANTERN", "VICTORY", "HARVEST", "ELEMENT"],
    8: ["MOUNTAIN", "TREASURE", "VOLCANO", "FRONTIER", "UNIVERSE", "FORTRESS"],
}


def _load_system_prompt() -> str:
    path = _BACKEND_DIR / "system_prompt.txt"
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as e:
        raise RuntimeError(f"System prompt file not found: {path}") from e


SYSTEM_PROMPT = _load_system_prompt()


# ---------------------------------------------------------------------------
# Hamiltonian path: woven 2-column ladders (never row-serpentine)
# ---------------------------------------------------------------------------


def _count_turns(path: List[Tuple[int, int]]) -> int:
    turns = 0
    for i in range(1, len(path) - 1):
        d1 = (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
        d2 = (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
        if d1 != d2:
            turns += 1
    return turns


def _max_straight_run(path: List[Tuple[int, int]]) -> int:
    if len(path) < 2:
        return 0
    best = run = 1
    prev = (path[1][0] - path[0][0], path[1][1] - path[0][1])
    for i in range(2, len(path)):
        d = (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
        if d == prev:
            run += 1
        else:
            best = max(best, run)
            run = 1
            prev = d
    return max(best, run)


def _full_row_sweeps(path: List[Tuple[int, int]], n: int) -> int:
    sweeps = 0
    i = 0
    while i < len(path) - 1:
        dr = path[i + 1][0] - path[i][0]
        dc = path[i + 1][1] - path[i][1]
        run = 1
        j = i
        while j + 1 < len(path):
            d2 = (path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1])
            if d2 != (dr, dc):
                break
            run += 1
            j += 1
        if run >= n:
            sweeps += 1
        i = max(j, i + 1)
    return sweeps


def _ladder_strip(
    n_rows: int, c0: int, c1: int, top_to_bottom: bool, phase: int
) -> List[Tuple[int, int]]:
    rows = range(n_rows) if top_to_bottom else range(n_rows - 1, -1, -1)
    path: List[Tuple[int, int]] = []
    for ri, r in enumerate(rows):
        if ((ri + phase) % 2) == 0:
            path.extend([(r, c0), (r, c1)])
        else:
            path.extend([(r, c1), (r, c0)])
    return path


def _dfs_fill(
    cells: List[Tuple[int, int]],
    start: Tuple[int, int],
    max_straight: int,
    deadline: float,
) -> Optional[List[Tuple[int, int]]]:
    """Hamiltonian path on an arbitrary small cell set (e.g. n×3 strip)."""
    cell_set = set(cells)
    if start not in cell_set:
        return None
    target = len(cells)
    path = [start]
    visited = {start}

    def neighbors(r: int, c: int) -> List[Tuple[int, int]]:
        out = []
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nxt = (r + dr, c + dc)
            if nxt in cell_set and nxt not in visited:
                out.append(nxt)
        return out

    def straight_ok(nr: int, nc: int) -> bool:
        if len(path) < 2:
            return True
        # length of current straight run if we step to (nr,nc)
        run = 1
        dr = nr - path[-1][0]
        dc = nc - path[-1][1]
        i = len(path) - 1
        while i > 0:
            pdr = path[i][0] - path[i - 1][0]
            pdc = path[i][1] - path[i - 1][1]
            if (pdr, pdc) != (dr, dc):
                break
            run += 1
            i -= 1
        return run < max_straight

    def dfs(r: int, c: int) -> bool:
        if len(path) == target:
            return True
        if time.perf_counter() > deadline:
            return False
        opts = neighbors(r, c)
        random.shuffle(opts)
        # Prefer turning / low degree
        if len(path) >= 2:
            pr, pc = path[-2]
            incoming = (r - pr, c - pc)

            def key(pos: Tuple[int, int]) -> Tuple[int, int]:
                turns = 0 if (pos[0] - r, pos[1] - c) == incoming else 1
                return (len(neighbors(pos[0], pos[1])), -turns)

            opts.sort(key=key)

        for nr, nc in opts:
            if not straight_ok(nr, nc):
                continue
            path.append((nr, nc))
            visited.add((nr, nc))
            if dfs(nr, nc):
                return True
            visited.remove((nr, nc))
            path.pop()
        return False

    if dfs(start[0], start[1]):
        return path
    return None


def _forced_ladder(n: int, phase: int, transpose: bool, max_straight: int = 2) -> List[Tuple[int, int]]:
    """
    High-turn path: 2-column ladders, then a constrained fill of the final
    3-column block when n is odd (avoids a full-height straight leftover column).
    """
    raw: List[Tuple[int, int]] = []
    top_to_bottom = True
    c = 0
    # Leave 3 columns at the end when odd so we never snake one long column.
    limit = n - 3 if (n % 2 == 1 and n >= 5) else n
    if limit % 2 == 1:
        limit -= 1
    limit = max(0, limit)

    while c + 1 < limit:
        raw.extend(_ladder_strip(n, c, c + 1, top_to_bottom, phase))
        top_to_bottom = not top_to_bottom
        c += 2

    remaining_cols = list(range(c, n))
    if remaining_cols:
        cells = [(r, cc) for cc in remaining_cols for r in range(n)]
        if raw:
            end = raw[-1]
            starts = [
                cell
                for cell in cells
                if abs(cell[0] - end[0]) + abs(cell[1] - end[1]) == 1
            ]
        else:
            starts = cells[:]
        random.shuffle(starts)
        filled = None
        deadline = time.perf_counter() + 0.25
        for start in starts[:12]:
            # Relax straight limit slightly if needed for solvability.
            for ms in (max_straight, max_straight + 1, max_straight + 2, n):
                filled = _dfs_fill(cells, start, ms, deadline)
                if filled:
                    break
            if filled:
                break
        if not filled:
            # Last resort: vertical zigzag on remaining columns (still better than row snake).
            filled = []
            for i, cc in enumerate(remaining_cols):
                rows = range(n) if i % 2 == 0 else range(n - 1, -1, -1)
                if filled and abs(filled[-1][0] - (0 if i % 2 == 0 else n - 1)) + abs(
                    filled[-1][1] - cc
                ) != 1:
                    rows = range(n - 1, -1, -1) if i % 2 == 0 else range(n)
                filled.extend((r, cc) for r in rows)
        raw.extend(filled)

    path = [(col, row) if transpose else (row, col) for row, col in raw]
    if not _path_ok(path, n):
        # Absolute fallback: classic 2-col ladders + vertical odd col.
        raw = []
        top_to_bottom = True
        c = 0
        while c + 1 < n:
            raw.extend(_ladder_strip(n, c, c + 1, top_to_bottom, phase))
            top_to_bottom = not top_to_bottom
            c += 2
        if c < n:
            end_r = raw[-1][0]
            seq = range(n - 1, -1, -1) if end_r == n - 1 else range(n)
            raw.extend((r, c) for r in seq)
        path = [(col, row) if transpose else (row, col) for row, col in raw]
    return path


def _path_ok(path: List[Tuple[int, int]], n: int) -> bool:
    if len(path) != n * n or len(set(path)) != n * n:
        return False
    return all(
        abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1 for a, b in zip(path, path[1:])
    )


def _apply_random_2x2_flips(
    path: List[Tuple[int, int]], n: int, rounds: int
) -> List[Tuple[int, int]]:
    path = list(path)
    index = {cell: i for i, cell in enumerate(path)}

    def adjacent(a: Tuple[int, int], b: Tuple[int, int]) -> bool:
        return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1

    for _ in range(rounds):
        r = random.randrange(n - 1)
        c = random.randrange(n - 1)
        square = [(r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)]
        idxs = sorted(index[cell] for cell in square)
        if idxs[-1] - idxs[0] != 3 or set(idxs) != set(range(idxs[0], idxs[0] + 4)):
            continue
        i0 = idxs[0]
        segment = path[i0 : i0 + 4]
        start, end = segment[0], segment[3]
        middles = [cell for cell in square if cell != start and cell != end]
        if len(middles) != 2:
            continue
        alts = [
            [start, middles[0], middles[1], end],
            [start, middles[1], middles[0], end],
        ]
        candidates = [
            alt
            for alt in alts
            if alt != segment and all(adjacent(u, v) for u, v in zip(alt, alt[1:]))
        ]
        if not candidates:
            continue
        new_seg = random.choice(candidates)
        path[i0 : i0 + 4] = new_seg
        for offset, cell in enumerate(new_seg):
            index[cell] = i0 + offset
    return path


def make_trap_walls(
    path: List[Tuple[int, int]], n: int, count: int
) -> List[Dict]:
    if count <= 0:
        return []
    path_edges = {frozenset({path[i], path[i + 1]}) for i in range(len(path) - 1)}
    turn_cells = []
    for i in range(1, len(path) - 1):
        d1 = (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
        d2 = (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
        if d1 != d2:
            turn_cells.append(path[i])

    candidates = []
    seen = set()
    for r, c in turn_cells + path[:: max(1, len(path) // 12)]:
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < n and 0 <= nc < n):
                continue
            edge = frozenset({(r, c), (nr, nc)})
            if edge in path_edges or edge in seen:
                continue
            seen.add(edge)
            candidates.append(((r, c), (nr, nc)))
    random.shuffle(candidates)
    return [
        {"cell_a": [a[0], a[1]], "cell_b": [b[0], b[1]]}
        for a, b in candidates[:count]
    ]


def make_maze_hamiltonian_path(
    grid_size: int, difficulty: str = "medium"
) -> List[List[int]]:
    profile = DIFFICULTY_PROFILE.get(difficulty, DIFFICULTY_PROFILE["medium"])
    max_straight = int(profile["max_straight"])
    min_turns = max(8, int(grid_size * float(profile["min_turn_ratio"])))
    flips = int(profile["flips"])

    best: Optional[List[Tuple[int, int]]] = None
    best_score = -10**9

    for _ in range(20):
        path = _forced_ladder(
            grid_size,
            random.randint(0, 1),
            random.random() < 0.5,
            max_straight=max_straight,
        )
        if random.random() < 0.5:
            path = list(reversed(path))
        path = _apply_random_2x2_flips(path, grid_size, flips)
        if not _path_ok(path, grid_size):
            continue
        if _full_row_sweeps(path, grid_size) >= max(2, grid_size // 2):
            continue

        turns = _count_turns(path)
        straight = _max_straight_run(path)
        score = turns * 3 - max(0, straight - max_straight) * 10
        if turns >= min_turns and straight <= max_straight + 1:
            score += 5000
        if score > best_score:
            best = path
            best_score = score
        if score >= 5000 + min_turns * 3:
            break

    if best is None:
        best = _forced_ladder(grid_size, 0, False, max_straight=max_straight)

    logger.info(
        "get_puzzle: scaffold difficulty=%s size=%s turns=%s max_straight=%s sweeps=%s start=%s end=%s",
        difficulty,
        grid_size,
        _count_turns(best),
        _max_straight_run(best),
        _full_row_sweeps(best, grid_size),
        best[0],
        best[-1],
    )
    return [[r, c] for r, c in best]


def suggest_milestone_path_indices(
    word_len: int,
    path_len: int,
    path: Optional[List[Tuple[int, int]]] = None,
) -> List[int]:
    if word_len <= 1:
        return [0]
    if word_len == 2:
        return [0, path_len - 1]

    turn_set = set()
    if path and len(path) == path_len:
        for i in range(1, path_len - 1):
            d1 = (path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
            d2 = (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
            if d1 != d2:
                turn_set.add(i)

    indices = [0]
    usable = path_len - 2
    raw_gaps = [random.uniform(0.65, 1.55) for _ in range(word_len - 1)]
    total = sum(raw_gaps)
    pos = 0.0
    for g in raw_gaps[:-1]:
        pos += g / total * usable
        idx = int(round(pos)) + 1
        min_gap = max(2, path_len // (word_len * 2))
        idx = max(indices[-1] + min_gap, idx)
        idx = min(idx, path_len - (word_len - len(indices)))
        if turn_set:
            window = range(
                max(indices[-1] + min_gap, idx - 2), min(path_len - 2, idx + 3)
            )
            near = [t for t in window if t in turn_set]
            if near:
                idx = min(near, key=lambda t: abs(t - idx))
        indices.append(idx)
    indices.append(path_len - 1)

    fixed = [0]
    for i, idx in enumerate(indices[1:-1], start=1):
        lo = fixed[-1] + 1
        hi = path_len - 1 - (word_len - 1 - i)
        fixed.append(min(max(idx, lo), hi))
    fixed.append(path_len - 1)
    return fixed


def pick_word(difficulty: str, word: Optional[str] = None) -> str:
    if word:
        cleaned = re.sub(r"[^A-Z0-9]", "", word.upper())
        if cleaned:
            return cleaned
    lo, hi = WORD_LENGTHS.get(difficulty, (5, 6))
    length = random.randint(lo, hi)
    bank = WORD_BANK.get(length) or WORD_BANK[5]
    return random.choice(bank)


def build_user_prompt(
    difficulty: str,
    grid_size: int,
    word: str,
    solution_path: List[List[int]],
    trap_wall_count: int,
) -> str:
    n2 = grid_size * grid_size
    ui_diff = difficulty if difficulty in ("easy", "medium", "hard") else "hard"
    wall_line = WALL_HINTS.get(difficulty, WALL_HINTS["medium"])
    path_tuples = [tuple(p) for p in solution_path]
    turns = _count_turns(path_tuples)
    max_straight = _max_straight_run(path_tuples)
    suggested_idx = suggest_milestone_path_indices(len(word), n2, path_tuples)
    milestones_fixed = [
        {"index": i, "character": ch, "cell": solution_path[idx]}
        for i, (ch, idx) in enumerate(zip(word, suggested_idx))
    ]
    milestones_json = json.dumps(milestones_fixed, separators=(",", ":"))
    path_json = json.dumps(solution_path, separators=(",", ":"))
    gap_note = ", ".join(
        f"{suggested_idx[i]}→{suggested_idx[i+1]} ({suggested_idx[i+1]-suggested_idx[i]} cells)"
        for i in range(len(suggested_idx) - 1)
    )
    blurb = {
        "easy": "light traps; winding but recoverable mistakes",
        "medium": "frequent turns + several deep forks",
        "hard": "dense turns + many trap walls; mistakes should be common",
        "very_hard": "maximum winding + late-fail branches",
    }.get(difficulty, "match stated difficulty")

    return f"""Generate ONE Word Zip puzzle. Difficulty MUST match "{difficulty}" ({blurb}).

PUZZLE PARAMETERS
- Difficulty: {difficulty}
- Grid: {grid_size}x{grid_size} ({n2} cells)
- Word: "{word}" (exact)
- Walls: {wall_line} Target ~{trap_wall_count} walls.
- Path stats: ~{turns} turns, max straight {max_straight}. This is NOT a row-serpentine snake.

FIXED SOLUTION PATH (Hamiltonian PATH, no cycles, no repeats — use exactly)
{path_json}

FIXED MILESTONES (use exactly)
{milestones_json}
Gaps: {gap_note}

WALL DESIGN — enable real mistakes
1. Orthogonal adjacent walls only; never block consecutive solution steps.
2. Place ~{trap_wall_count} walls on tempting wrong exits at turns/milestones.
3. Wrong branches must look legal for several moves, then fail.
4. Forbidden: corridor walls along the solution; forbidden: surrounding the path.
5. Higher difficulty ⇒ more/deeper traps.

ABSOLUTE DON'Ts FOR THE PATH (already satisfied by FIXED SOLUTION PATH — never violate)
- DO NOT use diagonal moves (corners do not count as adjacent).
- DO NOT revisit any cell / vertex.
- DO NOT create loops or cycles (no closed rings; do not return to start).
- DO NOT skip cells between steps (every step Manhattan distance must be 1).
- DO NOT replace the fixed path with a milestone-only shortcut path.

Return ONLY valid json (omit solution_path if possible):
{{
  "grid_size": {grid_size},
  "word": "{word}",
  "difficulty": "{ui_diff}",
  "milestones": {milestones_json},
  "walls": [{{"cell_a":[row,column],"cell_b":[row,column]}}],
  "start_cell": {json.dumps(solution_path[0])},
  "end_cell": {json.dumps(solution_path[-1])}
}}
"""


def _normalize_json_text(text: str) -> str:
    t = text.strip()
    t = (
        t.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )
    t = re.sub(r"\((\s*-?\d+\s*),(\s*-?\d+\s*)\)", r"[\1,\2]", t)
    t = re.sub(r",(\s*[}\]])", r"\1", t)
    t = re.sub(r",?\s*\.\.\.\s*", "", t)
    return t


def parse_puzzle_json(text: str) -> Optional[Dict]:
    candidates: List[str] = []
    trimmed = text.strip()
    if trimmed:
        candidates.append(trimmed)
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", trimmed, re.IGNORECASE)
    if fenced:
        candidates.append(fenced.group(1).strip())
    start, end = trimmed.find("{"), trimmed.rfind("}")
    if start != -1 and end > start:
        candidates.append(trimmed[start : end + 1])

    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        for variant in (candidate, _normalize_json_text(candidate)):
            try:
                parsed = json.loads(variant)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue
    return None


def _max_tokens_for_grid(grid_size: int) -> int:
    if grid_size >= 9:
        return 8000
    if grid_size >= 7:
        return 6000
    return 4000


def call_deepseek(
    system_prompt: str,
    user_prompt: str,
    model_name: str,
    max_tokens: int,
    *,
    use_json_object: bool = False,
) -> Tuple[str, Optional[str]]:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not set. Add it to backend/.env")

    payload: Dict = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.35,
    }
    if use_json_object:
        payload["response_format"] = {"type": "json_object"}

    logger.info(
        "get_puzzle: calling DeepSeek model=%s system_chars=%s user_chars=%s",
        model_name,
        len(system_prompt),
        len(user_prompt),
    )
    t0 = time.perf_counter()
    with httpx.Client(timeout=DEEPSEEK_TIMEOUT_S) as client:
        response = client.post(
            DEEPSEEK_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=payload,
        )
    elapsed = time.perf_counter() - t0
    body = response.json()
    if response.status_code >= 400:
        err = body.get("error") if isinstance(body, dict) else None
        detail = err.get("message") if isinstance(err, dict) else str(err)
        raise RuntimeError(detail or f"DeepSeek HTTP {response.status_code}")

    choice = (body.get("choices") or [{}])[0]
    content = (choice.get("message") or {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("DeepSeek response had no message content")
    logger.info(
        "get_puzzle: DeepSeek returned chars=%s finish_reason=%s (%.2fs)",
        len(content),
        choice.get("finish_reason"),
        elapsed,
    )
    return content, choice.get("finish_reason")


def call_deepseek_with_fallback(
    system_prompt: str, user_prompt: str, model_name: str, max_tokens: int
) -> Tuple[str, Optional[str]]:
    return call_deepseek(
        system_prompt, user_prompt, model_name, max_tokens, use_json_object=False
    )


def _merge_walls(
    seeded: List[Dict],
    model_walls: List,
    path: List[Tuple[int, int]],
    target_count: int,
) -> List[Dict]:
    path_edges = {frozenset({path[i], path[i + 1]}) for i in range(len(path) - 1)}
    n = int(max(max(p) for p in path)) + 1 if path else 0

    def normalize(w: Dict) -> Optional[Dict]:
        try:
            a = w.get("cell_a") or w.get("a")
            b = w.get("cell_b") or w.get("b")
            a_t, b_t = (int(a[0]), int(a[1])), (int(b[0]), int(b[1]))
        except (TypeError, ValueError, IndexError, AttributeError):
            return None
        if abs(a_t[0] - b_t[0]) + abs(a_t[1] - b_t[1]) != 1:
            return None
        if not (
            0 <= a_t[0] < n
            and 0 <= a_t[1] < n
            and 0 <= b_t[0] < n
            and 0 <= b_t[1] < n
        ):
            return None
        if frozenset({a_t, b_t}) in path_edges:
            return None
        return {"cell_a": [a_t[0], a_t[1]], "cell_b": [b_t[0], b_t[1]]}

    merged: List[Dict] = []
    seen = set()
    for src in list(seeded) + list(model_walls):
        if not isinstance(src, dict):
            continue
        w = normalize(src)
        if not w:
            continue
        key = frozenset(
            {
                (w["cell_a"][0], w["cell_a"][1]),
                (w["cell_b"][0], w["cell_b"][1]),
            }
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(w)
        if len(merged) >= max(target_count, len(seeded)):
            break
    return merged


def get_puzzle(
    difficulty: str = "medium",
    grid_size: Optional[int] = None,
    word: Optional[str] = None,
    model_name: str = DEFAULT_GET_PUZZLE_MODEL,
) -> Dict:
    diff = difficulty if difficulty in DIFFICULTY_TO_SIZE else "medium"
    size = grid_size if grid_size in (5, 7, 9) else DIFFICULTY_TO_SIZE[diff]
    profile = DIFFICULTY_PROFILE.get(diff, DIFFICULTY_PROFILE["medium"])
    wall_lo, wall_hi = profile["walls"]
    trap_wall_count = random.randint(int(wall_lo), int(wall_hi))

    target_word = pick_word(diff, word)
    solution_path = make_maze_hamiltonian_path(size, diff)
    path_tuples = [tuple(p) for p in solution_path]
    milestone_indices = suggest_milestone_path_indices(
        len(target_word), size * size, path_tuples
    )
    fixed_milestones = [
        {"index": i, "character": ch, "cell": solution_path[idx]}
        for i, (ch, idx) in enumerate(zip(target_word, milestone_indices))
    ]
    seeded_walls = make_trap_walls(path_tuples, size, trap_wall_count)

    user_prompt = build_user_prompt(
        diff, size, target_word, solution_path, trap_wall_count
    )
    max_tokens = _max_tokens_for_grid(size)

    raw, finish_reason = call_deepseek_with_fallback(
        SYSTEM_PROMPT, user_prompt, model_name, max_tokens
    )
    parsed = parse_puzzle_json(raw)

    if parsed is None or finish_reason == "length":
        logger.warning("get_puzzle: repair pass (finish_reason=%s)", finish_reason)
        repair_prompt = (
            f"Return ONLY valid json for a {size}x{size} {diff} puzzle.\n"
            f'Word "{target_word}". Milestones: {json.dumps(fixed_milestones)}.\n'
            f"About {trap_wall_count} trap walls at turns. Omit solution_path."
        )
        raw, finish_reason = call_deepseek_with_fallback(
            SYSTEM_PROMPT, repair_prompt, model_name, max_tokens
        )
        parsed = parse_puzzle_json(raw)

    if not parsed or not isinstance(parsed, dict):
        # Still return a playable puzzle from scaffold if model fails.
        logger.warning("get_puzzle: model JSON failed; returning scaffold + trap walls")
        parsed = {}

    model_walls = parsed.get("walls") if isinstance(parsed.get("walls"), list) else []
    walls = _merge_walls(seeded_walls, model_walls, path_tuples, trap_wall_count)

    # Final hard check — never return a diagonal / looping / incomplete path.
    if not _path_ok(path_tuples, size):
        raise ValueError(
            "Internal scaffold path failed orthogonal Hamiltonian checks "
            "(no diagonals, no revisits, no cycles)."
        )

    return {
        "grid_size": size,
        "word": target_word,
        "difficulty": diff if diff in ("easy", "medium", "hard") else "hard",
        "milestones": fixed_milestones,
        "walls": walls,
        "solution_path": solution_path,
        "start_cell": solution_path[0],
        "end_cell": solution_path[-1],
    }
