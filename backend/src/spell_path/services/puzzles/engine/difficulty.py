"""Difficulty metrics and wall-set evaluation."""

from __future__ import annotations

from typing import Dict, List, Set

from .grid import Cell, EdgeKey, cell_key, open_neighbors
from .solver import UniquenessSolver

Milestone = Dict


def compute_extra_profile(
    path: List[Cell],
    rows: int,
    cols: int,
    wall_set: Set[EdgeKey],
) -> Dict:
    length = len(path)
    visited = {cell_key(path[0][0], path[0][1])}
    extra_at = [0] * length
    total_extra = 0
    branch_points = 0
    for index in range(length - 1):
        row, col = path[index]
        neighbors = [
            (nr, nc)
            for nr, nc in open_neighbors(row, col, rows, cols, wall_set)
            if cell_key(nr, nc) not in visited
        ]
        extra = max(0, len(neighbors) - 1)
        extra_at[index] = extra
        if extra > 0:
            branch_points += 1
        total_extra += extra
        visited.add(cell_key(path[index + 1][0], path[index + 1][1]))
    return {"extra_at": extra_at, "total_extra": total_extra, "branch_points": branch_points}


def compute_branch_profile(path: List[Cell], profile: Dict) -> Dict:
    length = len(path)
    early = [0, 0]
    mid = [0, 0]
    late = [0, 0]
    for index, extra in enumerate(profile["extra_at"]):
        bucket = early if index < length / 3 else (mid if index < 2 * length / 3 else late)
        bucket[0] += 1 if extra > 0 else 0
        bucket[1] += extra
    return {
        "total_extra": profile["total_extra"],
        "branch_points": profile["branch_points"],
        "profile": {"early": early, "mid": mid, "late": late},
    }


def compute_corridor_stats(path: List[Cell], rows: int, cols: int, wall_set: Set[EdgeKey]) -> Dict:
    corridors = 0
    funnels = 0
    total = rows * cols
    start_key = cell_key(*path[0])
    end_key = cell_key(*path[-1])
    for row in range(rows):
        for col in range(cols):
            degree = len(open_neighbors(row, col, rows, cols, wall_set))
            key = cell_key(row, col)
            if degree == 2:
                corridors += 1
            elif degree == 1 and key not in (start_key, end_key):
                funnels += 1
    return {"corridor_ratio": corridors / total, "funnel_ratio": funnels / total}


def compute_checkpoint_score(path: List[Cell], milestones: List[Milestone], profile: Dict) -> float:
    if not milestones:
        return 0.0
    score = 0.0
    for milestone in milestones:
        path_index = milestone["path_index"]
        extra = profile["extra_at"][path_index] if path_index < len(profile["extra_at"]) else 0
        if extra == 0:
            score += 1
        else:
            score -= extra
    return score


class DifficultyEvaluator:
    """Scores wall placements against a target difficulty."""

    def __init__(self, rows: int, cols: int, node_budget: int):
        self.rows = rows
        self.cols = cols
        self.node_budget = node_budget
        self._solver = UniquenessSolver(rows, cols, node_budget)

    def evaluate(
        self,
        path: List[Cell],
        wall_set: Set[EdgeKey],
        milestones: List[Milestone],
        target_difficulty: float,
        trust_forced: bool = False,
    ) -> Dict:
        from .grid import check_intended_valid

        if not check_intended_valid(path, wall_set):
            return {"ok": False, "reason": "intended path no longer valid"}

        profile = compute_extra_profile(path, self.rows, self.cols, wall_set)

        for milestone in milestones:
            path_index = milestone["path_index"]
            if path_index < len(path) - 1 and profile["extra_at"][path_index] > 0:
                return {
                    "ok": False,
                    "reason": f'milestone "{milestone["character"]}" ambiguous — another route reaches it',
                }

        fully_forced = profile["total_extra"] == 0
        if fully_forced and trust_forced:
            solve = {"unique": True, "exhausted": True, "nodes": 0}
        else:
            solve = self._solver.solve(path, wall_set)
            if not solve["exhausted"]:
                return {"ok": False, "reason": "search budget exceeded — uniqueness unconfirmed"}
            if not solve["unique"]:
                return {"ok": False, "reason": "ambiguous — a second solution exists"}

        branch = compute_branch_profile(path, profile)
        corridor = compute_corridor_stats(path, self.rows, self.cols, wall_set)
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
