"""Hamiltonian path generation via snake fill + backbite randomization."""

from __future__ import annotations

import math
import random
from typing import Dict, List, Optional, Tuple

from .grid import DIR_LIST, build_index_grid, in_bounds

Cell = Tuple[int, int]


def make_snake_path(rows: int, cols: int) -> List[Cell]:
    """Boustrophedon fill. Coordinates are (row, col)."""
    path: List[Cell] = []
    for col in range(cols):
        if col % 2 == 0:
            for row in range(rows):
                path.append((row, col))
        else:
            for row in range(rows - 1, -1, -1):
                path.append((row, col))
    return path


def attempt_move(
    path: List[Cell],
    index_grid: List[List[int]],
    end: str,
    direction: Tuple[int, int],
    rows: int,
    cols: int,
) -> Optional[List[Cell]]:
    """Apply one backbite (or growth) move. Returns new path or None."""
    length = len(path)
    end_pos = path[-1] if end == "tail" else path[0]
    nrow = end_pos[0] + direction[0]
    ncol = end_pos[1] + direction[1]
    if not in_bounds(nrow, ncol, rows, cols):
        return None

    k = index_grid[nrow][ncol]
    if k == -1:
        if end == "tail":
            return path + [(nrow, ncol)]
        return [(nrow, ncol)] + path

    if end == "tail":
        if k >= length - 2:
            return None
        return path[: k + 1] + list(reversed(path[k + 1 :]))
    if k <= 1:
        return None
    return list(reversed(path[:k])) + path[k:]


def count_turns(path: List[Cell]) -> int:
    """Count direction changes along the path."""
    if len(path) < 3:
        return 0
    turns = 0
    for index in range(1, len(path) - 1):
        d1 = (path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1])
        d2 = (path[index + 1][0] - path[index][0], path[index + 1][1] - path[index][1])
        if d1 != d2:
            turns += 1
    return turns


def max_straight_run(path: List[Cell]) -> int:
    """Longest run of consecutive steps in the same direction."""
    if len(path) < 2:
        return len(path)
    best = 1
    run = 1
    prev = (path[1][0] - path[0][0], path[1][1] - path[0][1])
    for index in range(2, len(path)):
        direction = (
            path[index][0] - path[index - 1][0],
            path[index][1] - path[index - 1][1],
        )
        if direction == prev:
            run += 1
        else:
            best = max(best, run)
            run = 1
            prev = direction
    return max(best, run)


def score_path_against_targets(path: List[Cell], targets: Dict) -> Tuple[float, int, int]:
    """
    Higher is better. Rewards turn count near target_turns and respects
    the max_straight cap from path_complexity.
    """
    turns = count_turns(path)
    straight = max_straight_run(path)
    target_turns = int(targets["target_turns"])
    max_straight = int(targets["max_straight"])
    turn_tol = max(2, int(round(target_turns * 0.2)))

    turn_error = abs(turns - target_turns)
    straight_over = max(0, straight - max_straight)
    # Prefer using the allowed straight budget at low complexity (avoid tiny runs).
    straight_under = max(0, max_straight - straight) if targets["path_complexity"] < 40 else 0

    score = -turn_error * 4 - straight_over * 10 - straight_under * 0.5
    matched = turn_error <= turn_tol and straight_over == 0
    if matched:
        score += 1000
    if turn_error == 0 and straight_over == 0:
        score += 200
    return score, turns, straight


class HamiltonianPathGenerator:
    """Generates random Hamiltonian paths using the backbite algorithm."""

    def __init__(self, rows: int, cols: int, quality_factor: float = 1.0):
        self.rows = rows
        self.cols = cols
        self.quality_factor = max(0.0, float(quality_factor))

    def generate(self, circuits_only: bool = False) -> List[Cell]:
        path = make_snake_path(self.rows, self.cols)
        index_grid = build_index_grid(path, self.rows, self.cols)

        n = max(self.rows, self.cols)
        log2n = math.log2(max(2, n))
        total_moves = max(0, int(round(self.quality_factor * 20 * self.rows * self.cols * log2n)))

        for _ in range(total_moves):
            end = "head" if random.random() < 0.5 else "tail"
            direction = random.choice(DIR_LIST)
            new_path = attempt_move(path, index_grid, end, direction, self.rows, self.cols)
            if new_path is not None:
                path = new_path
                index_grid = build_index_grid(path, self.rows, self.cols)

        if circuits_only:
            for _ in range(200_000):
                head_row, head_col = path[0]
                tail_row, tail_col = path[-1]
                if abs(head_row - tail_row) + abs(head_col - tail_col) == 1:
                    break
                direction = random.choice(DIR_LIST)
                new_path = attempt_move(path, index_grid, "tail", direction, self.rows, self.cols)
                if new_path is not None:
                    path = new_path
                    index_grid = build_index_grid(path, self.rows, self.cols)

        return path

    def _light_mix(self, successful_moves: int) -> List[Cell]:
        """Start from snake and apply a small number of successful backbite moves."""
        path = make_snake_path(self.rows, self.cols)
        index_grid = build_index_grid(path, self.rows, self.cols)
        applied = 0
        for _ in range(successful_moves * 40):
            if applied >= successful_moves:
                break
            end = "head" if random.random() < 0.5 else "tail"
            direction = random.choice(DIR_LIST)
            new_path = attempt_move(path, index_grid, end, direction, self.rows, self.cols)
            if new_path is not None:
                path = new_path
                index_grid = build_index_grid(path, self.rows, self.cols)
                applied += 1
        return path

    def generate_for_complexity(
        self,
        targets: Dict,
        attempts: int = 24,
        circuits_only: bool = False,
    ) -> Tuple[List[Cell], Dict]:
        """
        Generate several candidate paths and keep the one closest to the
        path-complexity targets (turns / max straight).

        path_complexity == 0 always returns the pure column zig-zag snake.
        """
        complexity = float(targets["path_complexity"])
        meta_base = {
            "target_turns": int(targets["target_turns"]),
            "min_turns": int(targets["min_turns"]),
            "target_max_straight": int(targets["max_straight"]),
            "path_complexity": complexity,
        }

        # Hard lock: zero complexity must be the unmodified snake path.
        if complexity <= 0.0:
            path = make_snake_path(self.rows, self.cols)
            return path, {
                **meta_base,
                "turns": count_turns(path),
                "max_straight": max_straight_run(path),
                "score": 0.0,
                "attempts": 0,
                "matched_band": True,
            }

        attempts = max(1, int(attempts))
        best_path: Optional[List[Cell]] = None
        best_score = float("-inf")
        best_meta: Dict = {}

        base_qf = self.quality_factor
        scaled_qf = max(0.0, base_qf * float(targets.get("qf_scale", 1.0)))
        turn_tol = max(2, int(round(int(targets["target_turns"]) * 0.2)))

        def consider(path: List[Cell], attempt: int) -> bool:
            nonlocal best_path, best_score, best_meta
            score, turns, straight = score_path_against_targets(path, targets)
            matched = (
                abs(turns - int(targets["target_turns"])) <= turn_tol
                and straight <= int(targets["max_straight"])
            )
            if score > best_score:
                best_score = score
                best_path = path
                best_meta = {
                    "turns": turns,
                    "max_straight": straight,
                    "score": score,
                    "attempts": attempt,
                    "matched_band": matched,
                }
            return (
                matched
                and abs(turns - int(targets["target_turns"])) <= max(1, turn_tol // 2)
            )

        try:
            # Slight complexity: a few successful backbite moves off the snake.
            if complexity <= 20:
                consider(make_snake_path(self.rows, self.cols), 0)
                for attempt in range(1, max(attempts, 12) + 1):
                    moves = 1 if attempt <= 4 else (2 if attempt <= 8 else 3)
                    if consider(self._light_mix(moves), attempt):
                        break
            else:
                for attempt in range(1, attempts + 1):
                    frac = attempt / attempts
                    self.quality_factor = max(0.05, scaled_qf * (0.35 + 1.1 * frac))
                    path = self.generate(circuits_only=circuits_only)
                    if consider(path, attempt):
                        break
        finally:
            self.quality_factor = base_qf

        assert best_path is not None
        return best_path, {**meta_base, **best_meta}
