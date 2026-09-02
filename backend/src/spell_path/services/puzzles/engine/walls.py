"""Iterative wall placement with solver validation."""

from __future__ import annotations

import random
from typing import Dict, List, Optional, Set, Tuple

from .difficulty import DifficultyEvaluator, compute_extra_profile
from .grid import (
    Cell,
    EdgeKey,
    all_candidate_edges,
    check_intended_valid,
    edge_key,
    open_neighbors,
    rebuild_path_edge_set,
)
from .solver import UniquenessSolver, find_divergence_edge

Milestone = Dict


class WallPlacer:
    """Adds barriers off the solution path while preserving uniqueness."""

    def __init__(
        self,
        rows: int,
        cols: int,
        node_budget: int,
        target_difficulty: float,
        trust_forced: bool = False,
    ):
        self.rows = rows
        self.cols = cols
        self.node_budget = node_budget
        self.target_difficulty = target_difficulty
        self.trust_forced = trust_forced
        self._evaluator = DifficultyEvaluator(rows, cols, node_budget)
        self._solver = UniquenessSolver(rows, cols, node_budget)

    def _grow_for_determinism(
        self,
        path: List[Cell],
        current: Set[EdgeKey],
        milestones: List[Milestone],
        max_adds: int,
    ) -> Dict:
        added = 0
        while added < max_adds:
            profile = compute_extra_profile(path, self.rows, self.cols, current)
            target_idx = -1

            for milestone in milestones:
                idx = milestone["path_index"]
                if idx < len(path) - 1 and profile["extra_at"][idx] > 0:
                    target_idx = idx
                    break

            if target_idx == -1:
                for index, extra in enumerate(profile["extra_at"]):
                    if extra > 0:
                        target_idx = index
                        break

            if target_idx == -1:
                break

            row, col = path[target_idx]
            next_cell = path[target_idx + 1]
            visited_up_to = {f"{pr},{pc}" for pr, pc in path[: target_idx + 1]}
            neighbors = [
                (nr, nc)
                for nr, nc in open_neighbors(row, col, self.rows, self.cols, current)
                if f"{nr},{nc}" not in visited_up_to and (nr, nc) != next_cell
            ]
            if not neighbors:
                break
            nr, nc = random.choice(neighbors)
            current.add(edge_key(row, col, nr, nc))
            added += 1

        forced = compute_extra_profile(path, self.rows, self.cols, current)["total_extra"] == 0
        return {"added": added, "forced": forced}

    def generate(
        self,
        path: List[Cell],
        milestones: List[Milestone],
        iterations: int = 120,
        seed_walls: Optional[Set[EdgeKey]] = None,
        wall_count_min: Optional[int] = None,
        wall_count_max: Optional[int] = None,
    ) -> Tuple[Set[EdgeKey], Dict]:
        path_edge_set = rebuild_path_edge_set(path)
        cand_base = all_candidate_edges(self.rows, self.cols, path_edge_set)

        current: Set[EdgeKey] = set()
        if seed_walls and check_intended_valid(path, seed_walls):
            current = set(seed_walls)

        count_capped = wall_count_min is not None and wall_count_max is not None
        if count_capped:
            lo = max(0, int(wall_count_min))
            hi = max(lo, int(wall_count_max))
            target_count = random.randint(lo, hi)
        else:
            lo = hi = target_count = None

        growth_budget = target_count if target_count is not None else len(cand_base)
        growth = self._grow_for_determinism(path, current, milestones, growth_budget)

        if target_count is not None:
            while len(current) > target_count:
                current.discard(random.choice(list(current)))

            pool = [k for k in cand_base if k not in current]
            random.shuffle(pool)
            for pick in pool:
                if len(current) >= target_count:
                    break
                tentative = set(current)
                tentative.add(pick)
                if check_intended_valid(path, tentative):
                    current = tentative

            current_eval = self._evaluator.evaluate(
                path, current, milestones, self.target_difficulty, self.trust_forced
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
                evaluation = self._evaluator.evaluate(
                    path, tentative, milestones, self.target_difficulty, self.trust_forced
                )
                if not evaluation.get("ok"):
                    continue
                if evaluation["score"] > current_score:
                    current = tentative
                    current_score = evaluation["score"]
                    current_eval = evaluation
                    accepted += 1

            return current, {
                "growth_added": growth["added"],
                "growth_forced": growth["forced"],
                "refine_accepted": accepted,
                "refine_iterations": iterations,
                "target_wall_count": target_count,
                "wall_count_min": lo,
                "wall_count_max": hi,
                "eval": current_eval if current_eval.get("ok") else None,
            }

        current_eval = self._evaluator.evaluate(
            path, current, milestones, self.target_difficulty, self.trust_forced
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

            evaluation = self._evaluator.evaluate(
                path, tentative, milestones, self.target_difficulty, self.trust_forced
            )
            if not evaluation.get("ok"):
                continue
            if evaluation["score"] > current_score:
                current = tentative
                current_score = evaluation["score"]
                current_eval = evaluation
                accepted += 1

        return current, {
            "growth_added": growth["added"],
            "growth_forced": growth["forced"],
            "refine_accepted": accepted,
            "refine_iterations": iterations,
            "target_wall_count": None,
            "wall_count_min": None,
            "wall_count_max": None,
            "eval": current_eval if current_eval.get("ok") else None,
        }

    def validate_and_fix(
        self,
        path: List[Cell],
        wall_set: Set[EdgeKey],
        validate_budget: int,
        max_fixes: int = 60,
        max_walls: Optional[int] = None,
    ) -> Tuple[Set[EdgeKey], Dict]:
        path_edge_set = rebuild_path_edge_set(path)
        current = set(wall_set) if check_intended_valid(path, wall_set) else set()
        fixes = 0
        blocked = 0
        last_nodes = 0
        status = "unconfirmed"
        solver = UniquenessSolver(self.rows, self.cols, validate_budget)

        for iteration in range(max_fixes + 1):
            result = solver.solve(path, current, return_alt=True)
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
