"""Grid coordinates, edges, and neighbor utilities."""

from __future__ import annotations

from typing import Dict, List, Set, Tuple

Cell = Tuple[int, int]
EdgeKey = str

DIR_LIST: List[Tuple[int, int]] = [(-1, 0), (1, 0), (0, -1), (0, 1)]


def clamp_int(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def cell_key(row: int, col: int) -> str:
    return f"{row},{col}"


def edge_key(row1: int, col1: int, row2: int, col2: int) -> EdgeKey:
    if row1 > row2 or (row1 == row2 and col1 > col2):
        row1, col1, row2, col2 = row2, col2, row1, col1
    return f"{row1},{col1}|{row2},{col2}"


def parse_edge_key(key: EdgeKey) -> Tuple[Cell, Cell]:
    a, b = key.split("|")
    r1, c1 = map(int, a.split(","))
    r2, c2 = map(int, b.split(","))
    return (r1, c1), (r2, c2)


def in_bounds(row: int, col: int, rows: int, cols: int) -> bool:
    return 0 <= row < rows and 0 <= col < cols


def build_index_grid(path: List[Cell], rows: int, cols: int) -> List[List[int]]:
    grid = [[-1] * cols for _ in range(rows)]
    for index, (row, col) in enumerate(path):
        grid[row][col] = index
    return grid


def open_neighbors(
    row: int,
    col: int,
    rows: int,
    cols: int,
    wall_set: Set[EdgeKey],
) -> List[Cell]:
    neighbors: List[Cell] = []
    for drow, dcol in DIR_LIST:
        nrow, ncol = row + drow, col + dcol
        if not in_bounds(nrow, ncol, rows, cols):
            continue
        if edge_key(row, col, nrow, ncol) in wall_set:
            continue
        neighbors.append((nrow, ncol))
    return neighbors


def rebuild_path_edge_set(path: List[Cell]) -> Set[EdgeKey]:
    edges: Set[EdgeKey] = set()
    for index in range(len(path) - 1):
        r1, c1 = path[index]
        r2, c2 = path[index + 1]
        edges.add(edge_key(r1, c1, r2, c2))
    return edges


def all_candidate_edges(
    rows: int,
    cols: int,
    path_edge_set: Set[EdgeKey],
) -> List[EdgeKey]:
    candidates: List[EdgeKey] = []
    for row in range(rows):
        for col in range(cols):
            for drow, dcol in ((0, 1), (1, 0)):
                nrow, ncol = row + drow, col + dcol
                if not in_bounds(nrow, ncol, rows, cols):
                    continue
                key = edge_key(row, col, nrow, ncol)
                if key not in path_edge_set:
                    candidates.append(key)
    return candidates


def check_intended_valid(path: List[Cell], wall_set: Set[EdgeKey]) -> bool:
    for index in range(len(path) - 1):
        r1, c1 = path[index]
        r2, c2 = path[index + 1]
        if edge_key(r1, c1, r2, c2) in wall_set:
            return False
    return True


def walls_set_to_list(wall_set: Set[EdgeKey]) -> List[Dict]:
    walls: List[Dict] = []
    for key in sorted(wall_set):
        (r1, c1), (r2, c2) = parse_edge_key(key)
        walls.append({"cell_a": [r1, c1], "cell_b": [r2, c2]})
    return walls


def sanitize_word(word: str) -> str:
    import re

    return re.sub(r"[^A-Z0-9]", "", word.upper())
