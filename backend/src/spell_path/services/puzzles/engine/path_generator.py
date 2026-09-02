"""Hamiltonian path generation via snake fill + backbite randomization."""

from __future__ import annotations

import math
import random
from typing import List, Optional, Tuple

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
        total_moves = max(1, int(round(self.quality_factor * 20 * self.rows * self.cols * log2n)))

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
