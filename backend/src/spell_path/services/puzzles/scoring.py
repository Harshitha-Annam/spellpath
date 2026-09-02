"""Puzzle scoring: award grid-size points on a valid Hamiltonian solve.

A successful solve is a path that:
- visits every cell exactly once
- moves only orthogonally (no diagonals, no skips)
- does not cross walls
- starts on the first milestone
- visits milestones in index order
- ends on the last milestone

Score = base_points - 0.1 * backtracks - 0.25 * misses
Base points equal the puzzle size: easy/5x5 = 5, medium/7x7 = 7, hard/9x9 = 9.
The total is not clamped and may go below zero.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

BACKTRACK_PENALTY = Decimal("0.1")
MISS_PENALTY = Decimal("0.25")

DIFFICULTY_BASE_POINTS = {
    "easy": 5,
    "medium": 7,
    "hard": 9,
    "very_hard": 9,
}

GRID_SIZE_BASE_POINTS = {
    5: 5,
    7: 7,
    9: 9,
}

Cell = Tuple[int, int]


def _as_int(value: Any) -> int:
    return int(value)


def as_cell(value: Any) -> Cell:
    """Normalize [r, c], (r, c), or {row, col} into (row, col)."""
    if isinstance(value, dict):
        if "row" in value and "col" in value:
            return (_as_int(value["row"]), _as_int(value["col"]))
        if "cell" in value:
            return as_cell(value["cell"])
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return (_as_int(value[0]), _as_int(value[1]))
    raise ValueError(f"Invalid cell: {value!r}")


def base_points(difficulty: Optional[str] = None, grid_size: Optional[int] = None) -> int:
    """Points equal to puzzle size (easy=5, medium=7, hard=9)."""
    if difficulty:
        mapped = DIFFICULTY_BASE_POINTS.get(str(difficulty).strip().lower())
        if mapped is not None:
            return mapped
    if grid_size in GRID_SIZE_BASE_POINTS:
        return GRID_SIZE_BASE_POINTS[grid_size]
    if grid_size is not None:
        return int(grid_size)
    return 5


def compute_score(base: int, misses: int, backtracks: int) -> Dict[str, Any]:
    """Apply miss/backtrack penalties. Result is not floored at zero."""
    miss_count = max(0, int(misses))
    backtrack_count = max(0, int(backtracks))
    miss_penalty = MISS_PENALTY * miss_count
    backtrack_penalty = BACKTRACK_PENALTY * backtrack_count
    total = Decimal(base) - miss_penalty - backtrack_penalty
    return {
        "base_points": int(base),
        "misses": miss_count,
        "backtracks": backtrack_count,
        "miss_penalty": float(miss_penalty),
        "backtrack_penalty": float(backtrack_penalty),
        "score": float(total),
    }


def _wall_set(walls: Sequence[Dict]) -> set:
    edges = set()
    for wall in walls or []:
        try:
            if "cell_a" in wall and "cell_b" in wall:
                a = as_cell(wall["cell_a"])
                b = as_cell(wall["cell_b"])
            else:
                a = (_as_int(wall["row1"]), _as_int(wall["col1"]))
                b = (_as_int(wall["row2"]), _as_int(wall["col2"]))
        except (KeyError, TypeError, ValueError):
            continue
        edges.add(frozenset({a, b}))
    return edges


def _sorted_milestones(milestones: Sequence[Dict]) -> List[Tuple[int, Cell]]:
    parsed: List[Tuple[int, Cell]] = []
    for milestone in milestones or []:
        idx = _as_int(milestone["index"])
        parsed.append((idx, as_cell(milestone["cell"])))
    parsed.sort(key=lambda item: item[0])
    return parsed


def validate_solution_path(
    grid_size: int,
    milestones: Sequence[Dict],
    walls: Sequence[Dict],
    path: Sequence[Any],
) -> Tuple[bool, str]:
    """Return (ok, reason). ok is True only for a successful Hamiltonian solve."""
    if grid_size < 1:
        return False, "grid_size must be at least 1"

    try:
        cells = [as_cell(step) for step in path]
    except (TypeError, ValueError) as exc:
        return False, f"invalid path cell: {exc}"

    num_cells = grid_size * grid_size
    if len(cells) != num_cells:
        return False, (
            f"path must visit every cell once "
            f"(expected {num_cells} cells, got {len(cells)})"
        )

    seen = set()
    for row, col in cells:
        if not (0 <= row < grid_size and 0 <= col < grid_size):
            return False, f"cell {(row, col)} is outside the grid"
        if (row, col) in seen:
            return False, f"cell {(row, col)} is visited more than once"
        seen.add((row, col))

    for prev, curr in zip(cells, cells[1:]):
        if abs(curr[0] - prev[0]) + abs(curr[1] - prev[1]) != 1:
            return False, f"non-orthogonal step from {prev} to {curr}"

    blocked = _wall_set(walls)
    for prev, curr in zip(cells, cells[1:]):
        if frozenset({prev, curr}) in blocked:
            return False, f"path crosses a wall between {prev} and {curr}"

    ordered = _sorted_milestones(milestones)
    if not ordered:
        return False, "puzzle has no milestones"

    expected_indices = [idx for idx, _ in ordered]
    if expected_indices != list(range(len(ordered))):
        return False, "milestone indices must be contiguous starting at 0"

    first_cell = ordered[0][1]
    last_cell = ordered[-1][1]
    if cells[0] != first_cell:
        return False, f"path must start on the first milestone {first_cell}"
    if cells[-1] != last_cell:
        return False, f"path must end on the last milestone {last_cell}"

    milestone_at = {cell: idx for idx, cell in ordered}
    next_idx = 0
    for step_i, cell in enumerate(cells):
        if cell not in milestone_at:
            continue
        idx = milestone_at[cell]
        if idx != next_idx:
            return False, (
                f"milestones must be visited in order "
                f"(expected {next_idx} at {cell}, got {idx})"
            )
        if idx == len(ordered) - 1 and step_i != len(cells) - 1:
            return False, "last milestone may only be visited as the final cell"
        next_idx += 1

    if next_idx != len(ordered):
        return False, "path does not visit every milestone"

    return True, "ok"


def score_puzzle(
    *,
    difficulty: Optional[str],
    grid_size: int,
    milestones: Sequence[Dict],
    walls: Sequence[Dict],
    path: Sequence[Any],
    misses: int,
    backtracks: int,
) -> Dict[str, Any]:
    """Validate a submitted path and score it if it is a successful solve."""
    base = base_points(difficulty, grid_size)
    breakdown = compute_score(base, misses, backtracks)
    ok, reason = validate_solution_path(grid_size, milestones, walls, path)
    result = {
        "solved": ok,
        "reason": reason if not ok else "ok",
        **breakdown,
    }
    if not ok:
        result["score"] = None
    return result
