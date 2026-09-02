"""
Legacy standalone Hamiltonian path puzzle generator (not used by the API).

The live /build-puzzle pipeline uses services/puzzles/engine/ instead.
Kept for reference and offline experimentation.

Hamiltonian path puzzle generator using the backbite Monte Carlo method
(Oberdorf, Ferguson, Jacobsen & Kondev / Clisby).

Pipeline:
  1. Snake-fill the grid, then randomize with backbite moves
  2. Place word milestones evenly along the path
  3. Grow walls until the intended path is forced, then refine / auto-fix uniqueness
"""

from __future__ import annotations

import math
import random
import re
import uuid
from typing import Dict, List, Optional, Set, Tuple

DIR_LIST = [(-1, 0), (1, 0), (0, -1), (0, 1)]  # (drow, dcol)

# Only these square sizes are supported.
ALLOWED_SIZES = (5, 7, 9)

# Difficulty → fixed board size
DIFFICULTY_TO_SIZE = {
    "easy": 5,
    "medium": 7,
    "hard": 9,
}

# Per-size tunables. Wall counts are capped by difficulty so boards stay
# challenging (too many walls over-constrain the path and make puzzles trivial).
SIZE_PRESETS = {
    5: {
        "difficulty": "easy",
        "target_diff": 20,
        "qf": 1.0,
        "iterations": 40,
        "node_budget": 8000,
        "validate_budget": 40000,
        "max_fixes": 0,
        "word_lengths": (4, 5, 6),
        "wall_count_min": 0,
        "wall_count_max": 0,
        "trust_forced_during_refine": False,
        "skip_validate_if_forced": True,
    },
    7: {
        "difficulty": "medium",
        "target_diff": 45,
        "qf": 0.7,
        "iterations": 40,
        "node_budget": 6000,
        "validate_budget": 30000,
        "max_fixes": 0,
        "word_lengths": (5, 6, 7, 8),
        "wall_count_min": 4,
        "wall_count_max": 5,
        "trust_forced_during_refine": True,
        "skip_validate_if_forced": True,
    },
    9: {
        "difficulty": "hard",
        "target_diff": 60,
        "qf": 0.35,
        "iterations": 30,
        "node_budget": 3000,
        "validate_budget": 20000,
        "max_fixes": 0,
        "word_lengths": (7, 8, 9, 10),
        "wall_count_min": 6,
        "wall_count_max": 8,
        "trust_forced_during_refine": True,
        "skip_validate_if_forced": True,
    },
}

WORD_BANK = {
    3: ["CAT", "DOG", "ZIP", "MAP", "SUN", "RUN", "FOX", "BOX", "KEY", "TOY"],
    4: ["WORD", "GAME", "MAZE", "PATH", "GOLD", "STAR", "BLUE", "FIRE", "WIND", "LAND"],
    5: ["BOARD", "LIGHT", "WATER", "EARTH", "TRAIL", "SHARK", "CROWN", "CLOCK", "STONE", "SPACE"],
    6: ["PUZZLE", "MATRIX", "FOREST", "CASTLE", "SHADOW", "BRIDGE", "STREAM", "KNIGHT", "WIZARD", "DRAGON"],
    7: ["JOURNEY", "MYSTERY", "PHANTOM", "THUNDER", "CRYSTAL", "COMPASS", "MONSTER", "LANTERN", "VICTORY", "HARVEST"],
    8: ["MOUNTAIN", "TREASURE", "VOLCANO", "FRONTIER", "PYRAMID", "UNIVERSE", "FORTRESS", "SPARKLE", "WINDMILL", "CAROUSEL"],
    9: ["ADVENTURE", "LIGHTNING", "WONDERLAND", "LABYRINTH", "STARLIGHT", "MOONLIGHT", "FIRELIGHT", "WHIRLPOOL", "DAYBREAK", "NIGHTFALL"],
    10: ["SPELLBOUND", "STORMCLOUD", "MASTERMIND", "CROSSROADS", "AFTERGLOW", "PATHFINDER", "BRIGHTNESS", "SNOWFLAKE", "WATERFALL", "CANDLELIGHT"],
}


# ---------- helpers ----------

def clamp_int(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def edge_key(r1: int, c1: int, r2: int, c2: int) -> str:
    if r1 > r2 or (r1 == r2 and c1 > c2):
        r1, c1, r2, c2 = r2, c2, r1, c1
    return f"{r1},{c1}|{r2},{c2}"


def parse_edge_key(key: str) -> Tuple[Tuple[int, int], Tuple[int, int]]:
    a, b = key.split("|")
    r1, c1 = map(int, a.split(","))
    r2, c2 = map(int, b.split(","))
    return (r1, c1), (r2, c2)


def cell_key(r: int, c: int) -> str:
    return f"{r},{c}"


def get_random_word(length: int) -> str:
    words = WORD_BANK.get(length)
    if words:
        return random.choice(words)
    available = sorted(WORD_BANK.keys())
    closest = min(available, key=lambda L: abs(L - length))
    return random.choice(WORD_BANK[closest])


def sanitize_word(word: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", word.upper())


# ---------- path generation (backbite) ----------

def make_snake_path(rows: int, cols: int) -> List[Tuple[int, int]]:
    """Boustrophedon fill. Coordinates are (row, col)."""
    path: List[Tuple[int, int]] = []
    for c in range(cols):
        if c % 2 == 0:
            for r in range(rows):
                path.append((r, c))
        else:
            for r in range(rows - 1, -1, -1):
                path.append((r, c))
    return path


def build_index_grid(path: List[Tuple[int, int]], rows: int, cols: int) -> List[List[int]]:
    grid = [[-1] * cols for _ in range(rows)]
    for i, (r, c) in enumerate(path):
        grid[r][c] = i
    return grid


def in_bounds(r: int, c: int, rows: int, cols: int) -> bool:
    return 0 <= r < rows and 0 <= c < cols


def attempt_move(
    path: List[Tuple[int, int]],
    index_grid: List[List[int]],
    end: str,
    direction: Tuple[int, int],
    rows: int,
    cols: int,
) -> Optional[List[Tuple[int, int]]]:
    """Apply one backbite (or growth) move. Returns new path or None."""
    n = len(path)
    end_pos = path[-1] if end == "tail" else path[0]
    nr = end_pos[0] + direction[0]
    nc = end_pos[1] + direction[1]
    if not in_bounds(nr, nc, rows, cols):
        return None

    k = index_grid[nr][nc]
    if k == -1:
        if end == "tail":
            return path + [(nr, nc)]
        return [(nr, nc)] + path

    if end == "tail":
        if k >= n - 2:
            return None
        return path[: k + 1] + list(reversed(path[k + 1 :]))
    if k <= 1:
        return None
    return list(reversed(path[:k])) + path[k:]


def generate_hamiltonian_path(
    rows: int,
    cols: int,
    quality_factor: float = 1.0,
    circuits_only: bool = False,
) -> List[Tuple[int, int]]:
    """Generate a full Hamiltonian path via snake fill + backbite randomization."""
    path = make_snake_path(rows, cols)
    index_grid = build_index_grid(path, rows, cols)

    n = max(rows, cols)
    log2n = math.log2(max(2, n))
    total_moves = max(1, int(round(quality_factor * 20 * rows * cols * log2n)))

    for _ in range(total_moves):
        end = "head" if random.random() < 0.5 else "tail"
        direction = random.choice(DIR_LIST)
        new_path = attempt_move(path, index_grid, end, direction, rows, cols)
        if new_path is not None:
            path = new_path
            index_grid = build_index_grid(path, rows, cols)

    if circuits_only:
        for _ in range(200_000):
            hr, hc = path[0]
            tr, tc = path[-1]
            if abs(hr - tr) + abs(hc - tc) == 1:
                break
            direction = random.choice(DIR_LIST)
            new_path = attempt_move(path, index_grid, "tail", direction, rows, cols)
            if new_path is not None:
                path = new_path
                index_grid = build_index_grid(path, rows, cols)

    return path


# ---------- milestones ----------

def compute_milestones(
    path: List[Tuple[int, int]], word: str
) -> List[Dict]:
    """
    Pin first letter to path start and last letter to path end;
    space remaining letters evenly between.
    """
    word = sanitize_word(word)
    L = len(word)
    N = len(path)
    if L == 0 or L > N:
        raise ValueError(f"Word length {L} must be between 1 and path length {N}")

    milestones = []
    for i in range(L):
        end = 0 if L == 1 else round(i * (N - 1) / (L - 1))
        milestones.append({
            "index": i,
            "character": word[i],
            "cell": [path[end][0], path[end][1]],
            "path_index": end,
        })
    return milestones


# ---------- walls ----------

def rebuild_path_edge_set(path: List[Tuple[int, int]]) -> Set[str]:
    edges: Set[str] = set()
    for i in range(len(path) - 1):
        r1, c1 = path[i]
        r2, c2 = path[i + 1]
        edges.add(edge_key(r1, c1, r2, c2))
    return edges


def open_neighbors(
    r: int, c: int, rows: int, cols: int, wall_set: Set[str]
) -> List[Tuple[int, int]]:
    out = []
    for dr, dc in DIR_LIST:
        nr, nc = r + dr, c + dc
        if not in_bounds(nr, nc, rows, cols):
            continue
        if edge_key(r, c, nr, nc) in wall_set:
            continue
        out.append((nr, nc))
    return out


def check_intended_valid(path: List[Tuple[int, int]], wall_set: Set[str]) -> bool:
    for i in range(len(path) - 1):
        r1, c1 = path[i]
        r2, c2 = path[i + 1]
        if edge_key(r1, c1, r2, c2) in wall_set:
            return False
    return True


def compute_extra_profile(
    path: List[Tuple[int, int]], rows: int, cols: int, wall_set: Set[str]
) -> Dict:
    n = len(path)
    visited = {cell_key(path[0][0], path[0][1])}
    extra_at = [0] * n
    total_extra = 0
    branch_points = 0
    for i in range(n - 1):
        r, c = path[i]
        nbrs = [
            (nr, nc)
            for nr, nc in open_neighbors(r, c, rows, cols, wall_set)
            if cell_key(nr, nc) not in visited
        ]
        extra = max(0, len(nbrs) - 1)
        extra_at[i] = extra
        if extra > 0:
            branch_points += 1
        total_extra += extra
        visited.add(cell_key(path[i + 1][0], path[i + 1][1]))
    return {"extra_at": extra_at, "total_extra": total_extra, "branch_points": branch_points}


def solve_uniqueness(
    path: List[Tuple[int, int]],
    rows: int,
    cols: int,
    wall_set: Set[str],
    node_budget: int,
    return_alt: bool = False,
) -> Dict:
    """
    Exhaustive DFS uniqueness check with flood-fill pruning.
    Short-circuits when a second distinct full solution is found.
    """
    n = len(path)
    start = path[0]
    end = path[-1]
    start_key = cell_key(*start)
    intended_keys = [cell_key(r, c) for r, c in path]

    visited: Set[str] = set()
    order: List[str] = []
    nodes = 0
    found_other = False
    alt_order: Optional[List[str]] = None
    budget_hit = False

    def flood_reaches(from_r: int, from_c: int, must_cover: List[str]) -> bool:
        seen = {cell_key(from_r, from_c)}
        stack = [(from_r, from_c)]
        while stack:
            cr, cc = stack.pop()
            for nr, nc in open_neighbors(cr, cc, rows, cols, wall_set):
                k = cell_key(nr, nc)
                if k in seen:
                    continue
                if k in visited and not (nr == end[0] and nc == end[1]):
                    continue
                seen.add(k)
                stack.append((nr, nc))
        return all(k in seen for k in must_cover)

    def step(r: int, c: int, count: int) -> None:
        nonlocal nodes, found_other, alt_order, budget_hit
        if found_other or budget_hit:
            return
        nodes += 1
        if nodes > node_budget:
            budget_hit = True
            return
        if count == n:
            if r == end[0] and c == end[1]:
                same = order == intended_keys
                if not same:
                    found_other = True
                    if return_alt:
                        alt_order = list(order)
            return

        remaining = [
            cell_key(gr, gc)
            for gr in range(rows)
            for gc in range(cols)
            if cell_key(gr, gc) not in visited
        ]
        if remaining and not flood_reaches(r, c, remaining):
            return

        nbrs = [
            (nr, nc)
            for nr, nc in open_neighbors(r, c, rows, cols, wall_set)
            if cell_key(nr, nc) not in visited
        ]
        nbrs_scored = []
        for nr, nc in nbrs:
            deg = sum(
                1
                for x2, y2 in open_neighbors(nr, nc, rows, cols, wall_set)
                if cell_key(x2, y2) not in visited
            )
            nbrs_scored.append(((nr, nc), deg))
        nbrs_scored.sort(key=lambda t: t[1])

        for (nr, nc), _ in nbrs_scored:
            if found_other or budget_hit:
                return
            nk = cell_key(nr, nc)
            visited.add(nk)
            order.append(nk)
            step(nr, nc, count + 1)
            order.pop()
            visited.remove(nk)

    visited.add(start_key)
    order.append(start_key)
    step(start[0], start[1], 1)

    result = {
        "unique": not found_other,
        "exhausted": not budget_hit,
        "nodes": nodes,
    }
    if return_alt:
        alt_path = None
        if alt_order:
            alt_path = [tuple(map(int, k.split(","))) for k in alt_order]
        result["alt_path"] = alt_path
    return result


def find_divergence_edge(
    intended: List[Tuple[int, int]], alt: List[Tuple[int, int]]
) -> Optional[str]:
    n = min(len(intended), len(alt))
    for i in range(1, n):
        if intended[i] != alt[i]:
            ar, ac = alt[i - 1]
            br, bc = alt[i]
            return edge_key(ar, ac, br, bc)
    return None


def compute_branch_profile(path: List[Tuple[int, int]], profile: Dict) -> Dict:
    n = len(path)
    early = [0, 0]
    mid = [0, 0]
    late = [0, 0]
    for i, extra in enumerate(profile["extra_at"]):
        bucket = early if i < n / 3 else (mid if i < 2 * n / 3 else late)
        bucket[0] += 1 if extra > 0 else 0
        bucket[1] += extra
    return {
        "total_extra": profile["total_extra"],
        "branch_points": profile["branch_points"],
        "profile": {"early": early, "mid": mid, "late": late},
    }


def compute_corridor_stats(
    path: List[Tuple[int, int]], rows: int, cols: int, wall_set: Set[str]
) -> Dict:
    corridors = 0
    funnels = 0
    total = rows * cols
    start_key = cell_key(*path[0])
    end_key = cell_key(*path[-1])
    for r in range(rows):
        for c in range(cols):
            deg = len(open_neighbors(r, c, rows, cols, wall_set))
            key = cell_key(r, c)
            if deg == 2:
                corridors += 1
            elif deg == 1 and key not in (start_key, end_key):
                funnels += 1
    return {"corridor_ratio": corridors / total, "funnel_ratio": funnels / total}


def compute_checkpoint_score(
    path: List[Tuple[int, int]], milestones: List[Dict], profile: Dict
) -> float:
    if not milestones:
        return 0.0
    score = 0.0
    for m in milestones:
        e = profile["extra_at"][m["path_index"]] if m["path_index"] < len(profile["extra_at"]) else 0
        if e == 0:
            score += 1
        else:
            score -= e
    return score


def evaluate_wall_set(
    path: List[Tuple[int, int]],
    rows: int,
    cols: int,
    wall_set: Set[str],
    milestones: List[Dict],
    target_difficulty: float,
    node_budget: int,
    trust_forced: bool = False,
) -> Dict:
    if not check_intended_valid(path, wall_set):
        return {"ok": False, "reason": "intended path no longer valid"}

    profile = compute_extra_profile(path, rows, cols, wall_set)

    # Milestone cells must be forced (exactly one legal next step)
    for m in milestones:
        idx = m["path_index"]
        if idx < len(path) - 1 and profile["extra_at"][idx] > 0:
            return {
                "ok": False,
                "reason": f'milestone "{m["character"]}" ambiguous — another route reaches it',
            }

    fully_forced = profile["total_extra"] == 0
    # A fully forced path has no alternate choices → uniquely determined.
    # Skip expensive DFS on larger boards when trust_forced is enabled.
    if fully_forced and trust_forced:
        solve = {"unique": True, "exhausted": True, "nodes": 0}
    else:
        solve = solve_uniqueness(path, rows, cols, wall_set, node_budget)
        if not solve["exhausted"]:
            return {"ok": False, "reason": "search budget exceeded — uniqueness unconfirmed"}
        if not solve["unique"]:
            return {"ok": False, "reason": "ambiguous — a second solution exists"}

    branch = compute_branch_profile(path, profile)
    corridor = compute_corridor_stats(path, rows, cols, wall_set)
    checkpoint_score = compute_checkpoint_score(path, milestones, profile)

    difficulty_raw = (
        branch["total_extra"] * 3
        + branch["branch_points"] * 2
        - corridor["corridor_ratio"] * 40
        - corridor["funnel_ratio"] * 60
        + len(wall_set) * 0.3
    )
    difficulty = max(0.0, min(100.0, difficulty_raw))

    structural_penalty = 0.0
    if corridor["corridor_ratio"] > 0.55:
        structural_penalty += (corridor["corridor_ratio"] - 0.55) * 20
    if corridor["funnel_ratio"] > 0.2:
        structural_penalty += (corridor["funnel_ratio"] - 0.2) * 20

    score = (
        -abs(difficulty - target_difficulty) * 2
        + checkpoint_score * 3
        - len(wall_set) * 0.05
        - structural_penalty
    )

    return {
        "ok": True,
        "difficulty": difficulty,
        "score": score,
        "branch": branch,
        "corridor": corridor,
        "checkpoint_score": checkpoint_score,
        "solve_exhausted": solve["exhausted"],
        "fully_forced": fully_forced,
    }


def grow_walls_for_determinism(
    path: List[Tuple[int, int]],
    rows: int,
    cols: int,
    current: Set[str],
    milestones: List[Dict],
    max_adds: int,
) -> Dict:
    """Wall off ambiguous branches until the intended path is fully forced."""
    added = 0
    while added < max_adds:
        profile = compute_extra_profile(path, rows, cols, current)
        target_idx = -1

        for m in milestones:
            idx = m["path_index"]
            if idx < len(path) - 1 and profile["extra_at"][idx] > 0:
                target_idx = idx
                break

        if target_idx == -1:
            for i, e in enumerate(profile["extra_at"]):
                if e > 0:
                    target_idx = i
                    break

        if target_idx == -1:
            break

        r, c = path[target_idx]
        next_cell = path[target_idx + 1]
        visited_up_to = {cell_key(pr, pc) for pr, pc in path[: target_idx + 1]}
        nbrs = [
            (nr, nc)
            for nr, nc in open_neighbors(r, c, rows, cols, current)
            if cell_key(nr, nc) not in visited_up_to and (nr, nc) != next_cell
        ]
        if not nbrs:
            break
        nr, nc = random.choice(nbrs)
        current.add(edge_key(r, c, nr, nc))
        added += 1

    forced = compute_extra_profile(path, rows, cols, current)["total_extra"] == 0
    return {"added": added, "forced": forced}


def all_candidate_edges(
    path: List[Tuple[int, int]], rows: int, cols: int, path_edge_set: Set[str]
) -> List[str]:
    cand = []
    for r in range(rows):
        for c in range(cols):
            for dr, dc in [(0, 1), (1, 0)]:
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc, rows, cols):
                    continue
                k = edge_key(r, c, nr, nc)
                if k not in path_edge_set:
                    cand.append(k)
    return cand


def walls_set_to_list(wall_set: Set[str]) -> List[Dict]:
    walls = []
    for key in sorted(wall_set):
        (r1, c1), (r2, c2) = parse_edge_key(key)
        walls.append({"cell_a": [r1, c1], "cell_b": [r2, c2]})
    return walls


def generate_walls(
    path: List[Tuple[int, int]],
    rows: int,
    cols: int,
    milestones: List[Dict],
    target_difficulty: float = 50.0,
    iterations: int = 120,
    node_budget: int = 6000,
    seed_walls: Optional[Set[str]] = None,
    trust_forced: bool = False,
    wall_count_min: Optional[int] = None,
    wall_count_max: Optional[int] = None,
) -> Tuple[Set[str], Dict]:
    """
    Place walls that never cut the intended path.

    When wall_count_min/max are set, the final wall count is clamped to that
    range (easy→0, medium→4–5, hard→6–8). Prefer walls that block ambiguous
    branches first, then fill randomly if still under the target.
    """
    path_edge_set = rebuild_path_edge_set(path)
    cand_base = all_candidate_edges(path, rows, cols, path_edge_set)

    current: Set[str] = set()
    if seed_walls and check_intended_valid(path, seed_walls):
        current = set(seed_walls)

    count_capped = wall_count_min is not None and wall_count_max is not None
    if count_capped:
        lo = max(0, int(wall_count_min))
        hi = max(lo, int(wall_count_max))
        target_count = random.randint(lo, hi)
    else:
        target_count = None

    # Prefer determinism walls (block alternate exits), but never exceed target.
    growth_budget = target_count if target_count is not None else len(cand_base)
    growth = grow_walls_for_determinism(
        path, rows, cols, current, milestones, growth_budget
    )

    if target_count is not None:
        # Trim if somehow over (should not happen with growth_budget).
        while len(current) > target_count:
            current.discard(random.choice(list(current)))

        # Top up with random non-path walls that keep the intended path valid.
        pool = [k for k in cand_base if k not in current]
        random.shuffle(pool)
        for pick in pool:
            if len(current) >= target_count:
                break
            tentative = set(current)
            tentative.add(pick)
            if check_intended_valid(path, tentative):
                current = tentative

        # Soft refine: swap walls within the fixed count if score improves.
        current_eval = evaluate_wall_set(
            path, rows, cols, current, milestones, target_difficulty, node_budget,
            trust_forced=trust_forced,
        )
        current_score = current_eval["score"] if current_eval.get("ok") else float("-inf")
        accepted = 0
        for _ in range(max(0, iterations)):
            if not current or not cand_base:
                break
            remove_pick = random.choice(list(current))
            add_pool = [k for k in cand_base if k not in current]
            if not add_pool:
                break
            add_pick = random.choice(add_pool)
            tentative = set(current)
            tentative.discard(remove_pick)
            tentative.add(add_pick)
            if len(tentative) != target_count:
                continue
            if not check_intended_valid(path, tentative):
                continue
            ev = evaluate_wall_set(
                path, rows, cols, tentative, milestones, target_difficulty, node_budget,
                trust_forced=trust_forced,
            )
            if not ev.get("ok"):
                continue
            if ev["score"] > current_score:
                current = tentative
                current_score = ev["score"]
                current_eval = ev
                accepted += 1

        meta = {
            "growth_added": growth["added"],
            "growth_forced": growth["forced"],
            "refine_accepted": accepted,
            "refine_iterations": iterations,
            "target_wall_count": target_count,
            "wall_count_min": lo,
            "wall_count_max": hi,
            "eval": current_eval if current_eval.get("ok") else None,
        }
        return current, meta

    # Legacy uncapped mode (used only if callers omit wall_count bounds).
    current_eval = evaluate_wall_set(
        path, rows, cols, current, milestones, target_difficulty, node_budget,
        trust_forced=trust_forced,
    )
    current_score = current_eval["score"] if current_eval.get("ok") else float("-inf")

    accepted = 0
    for _ in range(iterations):
        add_move = random.random() < 0.5
        if add_move:
            pool = [k for k in cand_base if k not in current]
            if not pool:
                continue
            pick = random.choice(pool)
            tentative = set(current)
            tentative.add(pick)
        else:
            if not current:
                continue
            pick = random.choice(list(current))
            tentative = set(current)
            tentative.discard(pick)

        ev = evaluate_wall_set(
            path, rows, cols, tentative, milestones, target_difficulty, node_budget,
            trust_forced=trust_forced,
        )
        if not ev.get("ok"):
            continue
        if ev["score"] > current_score:
            current = tentative
            current_score = ev["score"]
            current_eval = ev
            accepted += 1

    meta = {
        "growth_added": growth["added"],
        "growth_forced": growth["forced"],
        "refine_accepted": accepted,
        "refine_iterations": iterations,
        "target_wall_count": None,
        "wall_count_min": None,
        "wall_count_max": None,
        "eval": current_eval if current_eval.get("ok") else None,
    }
    return current, meta


def validate_and_fix(
    path: List[Tuple[int, int]],
    rows: int,
    cols: int,
    wall_set: Set[str],
    node_budget: int = 30000,
    max_fixes: int = 60,
    max_walls: Optional[int] = None,
) -> Tuple[Set[str], Dict]:
    """
    Exhaustively check uniqueness; whenever a second solution is found,
    wall off the divergence edge and re-check.

    If max_walls is set, stop adding fix walls once that count is reached.
    """
    path_edge_set = rebuild_path_edge_set(path)
    current = set(wall_set) if check_intended_valid(path, wall_set) else set()
    fixes = 0
    blocked = 0
    last_nodes = 0
    status = "unconfirmed"

    for iteration in range(max_fixes + 1):
        result = solve_uniqueness(
            path, rows, cols, current, node_budget, return_alt=True
        )
        last_nodes = result["nodes"]

        if not result["exhausted"]:
            status = "budget_exceeded"
            break

        if result["unique"]:
            status = "unique"
            break

        if max_walls is not None and len(current) >= max_walls:
            status = "wall_cap_reached"
            break

        edge = find_divergence_edge(path, result["alt_path"]) if result.get("alt_path") else None
        if not edge or edge in current or edge in path_edge_set:
            status = "stuck"
            break

        current.add(edge)
        fixes += 1
        blocked += 1

        if max_walls is not None and len(current) > max_walls:
            # Should not exceed; discard the last add if somehow over.
            current.discard(edge)
            fixes -= 1
            blocked -= 1
            status = "wall_cap_reached"
            break

        if iteration == max_fixes:
            status = "max_fixes_reached"
            break

    return current, {
        "status": status,
        "nodes": last_nodes,
        "fixes_applied": fixes,
        "alt_solutions_blocked": blocked,
    }


# ---------- no-walls uniqueness search ----------

def solve_uniqueness_with_milestones(
    path: List[Tuple[int, int]],
    rows: int,
    cols: int,
    wall_set: Set[str],
    milestones: List[Dict],
    node_budget: int,
) -> Dict:
    """
    Like solve_uniqueness, but legal walks must visit milestone cells in order
    (Word Zip rule). Needed for no-walls mode: an open grid almost never has a
    unique bare Hamiltonian path, but milestones can still force uniqueness.
    """
    n = len(path)
    start = path[0]
    end = path[-1]
    start_key = cell_key(*start)
    intended_keys = [cell_key(r, c) for r, c in path]

    milestone_map: Dict[Tuple[int, int], int] = {}
    for m in milestones:
        milestone_map[(m["cell"][0], m["cell"][1])] = m["index"]

    visited: Set[str] = set()
    order: List[str] = []
    nodes = 0
    found_other = False
    budget_hit = False

    def flood_reaches(from_r: int, from_c: int, must_cover: List[str]) -> bool:
        seen = {cell_key(from_r, from_c)}
        stack = [(from_r, from_c)]
        while stack:
            cr, cc = stack.pop()
            for nr, nc in open_neighbors(cr, cc, rows, cols, wall_set):
                k = cell_key(nr, nc)
                if k in seen:
                    continue
                if k in visited and not (nr == end[0] and nc == end[1]):
                    continue
                seen.add(k)
                stack.append((nr, nc))
        return all(k in seen for k in must_cover)

    def step(r: int, c: int, count: int, next_m: int) -> None:
        nonlocal nodes, found_other, budget_hit
        if found_other or budget_hit:
            return
        nodes += 1
        if nodes > node_budget:
            budget_hit = True
            return
        if count == n:
            if r == end[0] and c == end[1] and next_m == len(milestones):
                if order != intended_keys:
                    found_other = True
            return

        remaining = [
            cell_key(gr, gc)
            for gr in range(rows)
            for gc in range(cols)
            if cell_key(gr, gc) not in visited
        ]
        if remaining and not flood_reaches(r, c, remaining):
            return

        nbrs = [
            (nr, nc)
            for nr, nc in open_neighbors(r, c, rows, cols, wall_set)
            if cell_key(nr, nc) not in visited
        ]
        nbrs_scored = []
        for nr, nc in nbrs:
            cell = (nr, nc)
            if cell in milestone_map and milestone_map[cell] != next_m:
                continue
            deg = sum(
                1
                for x2, y2 in open_neighbors(nr, nc, rows, cols, wall_set)
                if cell_key(x2, y2) not in visited
            )
            nbrs_scored.append(((nr, nc), deg))
        nbrs_scored.sort(key=lambda t: t[1])

        for (nr, nc), _ in nbrs_scored:
            if found_other or budget_hit:
                return
            nk = cell_key(nr, nc)
            new_next = next_m + 1 if (nr, nc) in milestone_map else next_m
            visited.add(nk)
            order.append(nk)
            step(nr, nc, count + 1, new_next)
            order.pop()
            visited.remove(nk)

    # Start cell is always milestone 0
    visited.add(start_key)
    order.append(start_key)
    step(start[0], start[1], 1, 1)

    return {
        "unique": not found_other,
        "exhausted": not budget_hit,
        "nodes": nodes,
    }


def find_unique_no_wall_path(
    rows: int,
    cols: int,
    word: str,
    quality_factor: float,
    node_budget: int,
    max_attempts: int = 100,
    circuits_only: bool = False,
) -> Tuple[List[Tuple[int, int]], List[Dict], Dict]:
    """
    Repeatedly generate fresh Hamiltonian paths (no walls) until the empty
    grid has exactly one Hamiltonian path that visits the milestones in order
    and matches the intended path. Lets a puzzle be solvable from milestones alone.
    """
    last_reason = "no attempts made"

    for attempt in range(1, max_attempts + 1):
        path = generate_hamiltonian_path(
            rows, cols, quality_factor=quality_factor, circuits_only=circuits_only
        )
        milestones = compute_milestones(path, word)

        result = solve_uniqueness_with_milestones(
            path, rows, cols, set(), milestones, node_budget
        )

        if not result["exhausted"]:
            last_reason = "search budget exceeded — uniqueness unconfirmed"
            continue
        if not result["unique"]:
            last_reason = "ambiguous — a second milestone-respecting solution exists with no walls"
            continue

        return path, milestones, {
            "status": "unique",
            "attempts": attempt,
            "nodes": result["nodes"],
        }

    raise RuntimeError(
        f"Could not find a uniquely solvable no-wall path after {max_attempts} "
        f"attempts on a {rows}x{cols} grid (last reason: {last_reason}). "
        f"Try a smaller grid, a longer word (more milestones), or raise "
        f"max_attempts/node_budget. no_walls is most reliable on 5×5."
    )


# ---------- public API ----------

def resolve_grid_size(
    difficulty: str,
    grid_size: Optional[int],
) -> Tuple[int, str, Dict]:
    """
    Resolve to one of ALLOWED_SIZES (5, 7, 9).
    Explicit grid_size wins; otherwise difficulty maps to size.
    """
    if grid_size is not None:
        if grid_size not in ALLOWED_SIZES:
            raise ValueError(
                f"grid_size must be one of {ALLOWED_SIZES} (got {grid_size})"
            )
        size = grid_size
        # Keep difficulty label consistent with size when caller only passed size
        difficulty = next(
            (d for d, s in DIFFICULTY_TO_SIZE.items() if s == size),
            difficulty if difficulty in DIFFICULTY_TO_SIZE else "medium",
        )
    else:
        if difficulty not in DIFFICULTY_TO_SIZE:
            difficulty = "medium"
        size = DIFFICULTY_TO_SIZE[difficulty]

    return size, difficulty, SIZE_PRESETS[size]


def generate_puzzle(
    difficulty: str = "medium",
    grid_size: Optional[int] = None,
    rows: Optional[int] = None,
    cols: Optional[int] = None,
    word: Optional[str] = None,
    quality_factor: Optional[float] = None,
    target_difficulty: Optional[float] = None,
    iterations: Optional[int] = None,
    node_budget: Optional[int] = None,
    validate_budget: Optional[int] = None,
    max_fixes: Optional[int] = None,
    circuits_only: bool = False,
    no_walls: bool = False,
    no_walls_max_attempts: int = 100,
) -> Dict:
    """
    Full pipeline: Hamiltonian path → milestones → walls → uniqueness fix.
    Boards are always square 5×5, 7×7, or 9×9.

    When no_walls=True, skips wall generation and instead keeps regenerating
    paths until the empty grid already has a unique Hamiltonian path
    (milestones-only mode). Expensive — most reliable on 5×5.
    """
    # Allow rows/cols only when they agree and match an allowed size
    if rows is not None or cols is not None:
        if rows is None:
            rows = cols
        if cols is None:
            cols = rows
        if rows != cols:
            raise ValueError("Only square grids are supported (5×5, 7×7, 9×9)")
        if grid_size is None:
            grid_size = rows
        elif grid_size != rows:
            raise ValueError(
                f"grid_size ({grid_size}) conflicts with rows/cols ({rows}×{cols})"
            )

    size, difficulty, preset = resolve_grid_size(difficulty, grid_size)
    rows = cols = size

    qf = quality_factor if quality_factor is not None else preset["qf"]
    qf = max(0.0, float(qf))
    tdiff = target_difficulty if target_difficulty is not None else preset["target_diff"]
    tdiff = max(0.0, min(100.0, float(tdiff)))
    iters = iterations if iterations is not None else preset["iterations"]
    nbudget = node_budget if node_budget is not None else preset["node_budget"]
    vbudget = validate_budget if validate_budget is not None else preset["validate_budget"]
    mfixes = max_fixes if max_fixes is not None else preset["max_fixes"]
    trust_forced = bool(preset["trust_forced_during_refine"])
    skip_validate_if_forced = bool(preset["skip_validate_if_forced"])
    no_walls_max_attempts = max(1, int(no_walls_max_attempts))
    wall_count_min = int(preset.get("wall_count_min", 0))
    wall_count_max = int(preset.get("wall_count_max", 0))

    if word is None:
        if no_walls:
            # Denser milestones are required for uniqueness on an open grid.
            available = sorted(WORD_BANK.keys())
            min_len = max(preset["word_lengths"])
            candidates = [
                L for L in available
                if min_len <= L <= min(rows * cols, max(available))
            ]
            if not candidates:
                candidates = [L for L in available if L <= rows * cols]
            word_len = random.choice(candidates) if candidates else min(rows * cols, 8)
        else:
            word_len = random.choice(preset["word_lengths"])
        word_len = min(word_len, rows * cols)
        word = get_random_word(word_len)
    else:
        word = sanitize_word(word)
        if not word:
            raise ValueError("Word must contain at least one alphanumeric character")
        if len(word) > rows * cols:
            raise ValueError(f"Word length {len(word)} exceeds grid capacity {rows * cols}")

    # ---- milestones-only mode: empty wall set must already be unique ----
    if no_walls:
        path, milestones, nowall_meta = find_unique_no_wall_path(
            rows,
            cols,
            word,
            quality_factor=qf,
            node_budget=vbudget,
            max_attempts=no_walls_max_attempts,
            circuits_only=circuits_only,
        )
        walls: Set[str] = set()

        final_eval = evaluate_wall_set(
            path, rows, cols, walls, milestones, tdiff, nbudget, trust_forced=True
        )

        public_milestones = [
            {"index": m["index"], "character": m["character"], "cell": m["cell"]}
            for m in milestones
        ]
        start = path[0]
        end = path[-1]

        return {
            "id": f"puzzle_{difficulty}_{uuid.uuid4().hex[:10]}",
            "difficulty": difficulty,
            "grid_size": size,
            "rows": rows,
            "cols": cols,
            "word": word,
            "start_cell": [start[0], start[1]],
            "end_cell": [end[0], end[1]],
            "milestones": public_milestones,
            "solution_path": [[r, c] for r, c in path],
            "walls": [],
            "stats": {
                "wall_count": 0,
                "path_length": len(path),
                "fill_percent": 100,
                "estimated_difficulty": final_eval.get("difficulty") if final_eval.get("ok") else None,
                "score": final_eval.get("score") if final_eval.get("ok") else None,
                "uniqueness": nowall_meta["status"],
                "validate_nodes": nowall_meta["nodes"],
                "walls_added_by_fix": 0,
                "alt_solutions_blocked": 0,
                "validate_skipped": False,
                "growth_forced": False,
                "refine_accepted": 0,
                "no_wall_attempts": nowall_meta["attempts"],
            },
        }

    # ---- default: path → milestones → walls → uniqueness fix ----
    path = generate_hamiltonian_path(rows, cols, quality_factor=qf, circuits_only=circuits_only)
    milestones = compute_milestones(path, word)

    walls, wall_meta = generate_walls(
        path,
        rows,
        cols,
        milestones,
        target_difficulty=tdiff,
        iterations=iters,
        node_budget=nbudget,
        trust_forced=trust_forced,
        wall_count_min=wall_count_min,
        wall_count_max=wall_count_max,
    )

    fully_forced = bool(wall_meta.get("growth_forced")) or (
        wall_meta.get("eval") and wall_meta["eval"].get("fully_forced")
    )
    # Never let uniqueness fixes push past the difficulty wall cap.
    if mfixes <= 0 or (skip_validate_if_forced and fully_forced):
        validate_meta = {
            "status": "unique" if fully_forced else "unconfirmed",
            "nodes": 0,
            "fixes_applied": 0,
            "alt_solutions_blocked": 0,
            "skipped": True,
            "reason": (
                "wall-count capped by difficulty — skipping uniqueness wall growth"
                if mfixes <= 0
                else "path fully forced — uniqueness guaranteed without exhaustive search"
            ),
        }
    else:
        walls, validate_meta = validate_and_fix(
            path,
            rows,
            cols,
            walls,
            node_budget=vbudget,
            max_fixes=mfixes,
            max_walls=wall_count_max,
        )
        validate_meta["skipped"] = False

    # Final safety clamp in case anything drifted above the difficulty max.
    if wall_count_max >= 0 and len(walls) > wall_count_max:
        extras = list(walls)
        random.shuffle(extras)
        walls = set(extras[:wall_count_max])
        if not check_intended_valid(path, walls):
            # Restore a valid subset by rebuilding within the cap.
            walls, wall_meta = generate_walls(
                path,
                rows,
                cols,
                milestones,
                target_difficulty=tdiff,
                iterations=iters,
                node_budget=nbudget,
                trust_forced=trust_forced,
                wall_count_min=wall_count_min,
                wall_count_max=wall_count_max,
            )

    final_eval = evaluate_wall_set(
        path, rows, cols, walls, milestones, tdiff, nbudget, trust_forced=True
    )

    public_milestones = [
        {"index": m["index"], "character": m["character"], "cell": m["cell"]}
        for m in milestones
    ]

    start = path[0]
    end = path[-1]

    return {
        "id": f"puzzle_{difficulty}_{uuid.uuid4().hex[:10]}",
        "difficulty": difficulty,
        "grid_size": size,
        "rows": rows,
        "cols": cols,
        "word": word,
        "start_cell": [start[0], start[1]],
        "end_cell": [end[0], end[1]],
        "milestones": public_milestones,
        "solution_path": [[r, c] for r, c in path],
        "walls": walls_set_to_list(walls),
        "stats": {
            "wall_count": len(walls),
            "path_length": len(path),
            "fill_percent": 100,
            "estimated_difficulty": final_eval.get("difficulty") if final_eval.get("ok") else None,
            "score": final_eval.get("score") if final_eval.get("ok") else None,
            "uniqueness": validate_meta["status"],
            "validate_nodes": validate_meta["nodes"],
            "walls_added_by_fix": validate_meta["fixes_applied"],
            "alt_solutions_blocked": validate_meta["alt_solutions_blocked"],
            "validate_skipped": validate_meta.get("skipped", False),
            "growth_forced": wall_meta.get("growth_forced"),
            "refine_accepted": wall_meta.get("refine_accepted"),
            "no_wall_attempts": 0,
        },
    }
