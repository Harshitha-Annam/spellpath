"""Orchestrates path generation, milestones, walls, and validation."""

from __future__ import annotations

import random
import uuid
from typing import Dict, List, Optional, Set, Tuple

from .config import get_random_word, resolve_grid_size
from .difficulty import DifficultyEvaluator
from .grid import Cell, EdgeKey, sanitize_word, walls_set_to_list
from .milestones import MilestonePlacer
from .path_generator import HamiltonianPathGenerator
from .solver import UniquenessSolver
from .walls import WallPlacer

Milestone = Dict


class PuzzleEngine:
    """
    Path-first puzzle builder:
      1. Generate Hamiltonian path (backbite)
      2. Place word milestones along the path
      3. Add walls iteratively with uniqueness validation
    """

    def __init__(
        self,
        rows: int,
        cols: int,
        preset: Dict,
        difficulty: str,
    ):
        self.rows = rows
        self.cols = cols
        self.preset = preset
        self.difficulty = difficulty
        self.size = rows

    @classmethod
    def from_params(
        cls,
        difficulty: str = "medium",
        grid_size: Optional[int] = None,
    ) -> "PuzzleEngine":
        size, difficulty, preset = resolve_grid_size(difficulty, grid_size)
        return cls(size, size, preset, difficulty)

    def build(
        self,
        word: Optional[str] = None,
        no_walls: bool = False,
        circuits_only: bool = False,
        no_walls_max_attempts: int = 100,
    ) -> Dict:
        preset = self.preset
        qf = float(preset["qf"])
        tdiff = float(preset["target_diff"])
        iters = int(preset["iterations"])
        nbudget = int(preset["node_budget"])
        vbudget = int(preset["validate_budget"])
        mfixes = int(preset["max_fixes"])
        trust_forced = bool(preset["trust_forced_during_refine"])
        skip_validate_if_forced = bool(preset["skip_validate_if_forced"])
        wall_count_min = int(preset.get("wall_count_min", 0))
        wall_count_max = int(preset.get("wall_count_max", 0))
        no_walls_max_attempts = max(1, int(no_walls_max_attempts))

        word = self._resolve_word(word, no_walls)
        path_generator = HamiltonianPathGenerator(self.rows, self.cols, qf)

        if no_walls:
            path, milestones, nowall_meta = self._find_unique_no_wall_path(
                word,
                path_generator,
                vbudget,
                no_walls_max_attempts,
                circuits_only,
            )
            walls: Set[EdgeKey] = set()
            evaluator = DifficultyEvaluator(self.rows, self.cols, nbudget)
            final_eval = evaluator.evaluate(path, walls, milestones, tdiff, trust_forced=True)
            return self._format_puzzle(
                path,
                milestones,
                walls,
                word,
                final_eval,
                {
                    "uniqueness": nowall_meta["status"],
                    "validate_nodes": nowall_meta["nodes"],
                    "walls_added_by_fix": 0,
                    "alt_solutions_blocked": 0,
                    "validate_skipped": False,
                    "growth_forced": False,
                    "refine_accepted": 0,
                    "no_wall_attempts": nowall_meta["attempts"],
                },
            )

        path = path_generator.generate(circuits_only=circuits_only)
        milestones = MilestonePlacer.place(path, word)

        wall_placer = WallPlacer(
            self.rows,
            self.cols,
            nbudget,
            tdiff,
            trust_forced=trust_forced,
        )
        walls, wall_meta = wall_placer.generate(
            path,
            milestones,
            iterations=iters,
            wall_count_min=wall_count_min,
            wall_count_max=wall_count_max,
        )

        fully_forced = bool(wall_meta.get("growth_forced")) or (
            wall_meta.get("eval") and wall_meta["eval"].get("fully_forced")
        )

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
            walls, validate_meta = wall_placer.validate_and_fix(
                path,
                walls,
                vbudget,
                max_fixes=mfixes,
                max_walls=wall_count_max,
            )
            validate_meta["skipped"] = False

        if wall_count_max >= 0 and len(walls) > wall_count_max:
            extras = list(walls)
            random.shuffle(extras)
            walls = set(extras[:wall_count_max])
            if not self._path_valid_with_walls(path, walls):
                walls, wall_meta = wall_placer.generate(
                    path,
                    milestones,
                    iterations=iters,
                    wall_count_min=wall_count_min,
                    wall_count_max=wall_count_max,
                )

        evaluator = DifficultyEvaluator(self.rows, self.cols, nbudget)
        final_eval = evaluator.evaluate(path, walls, milestones, tdiff, trust_forced=True)

        return self._format_puzzle(
            path,
            milestones,
            walls,
            word,
            final_eval,
            {
                "uniqueness": validate_meta["status"],
                "validate_nodes": validate_meta["nodes"],
                "walls_added_by_fix": validate_meta["fixes_applied"],
                "alt_solutions_blocked": validate_meta["alt_solutions_blocked"],
                "validate_skipped": validate_meta.get("skipped", False),
                "growth_forced": wall_meta.get("growth_forced"),
                "refine_accepted": wall_meta.get("refine_accepted"),
                "no_wall_attempts": 0,
            },
        )

    def _resolve_word(self, word: Optional[str], no_walls: bool) -> str:
        from .config import WORD_BANK

        if word is None:
            if no_walls:
                available = sorted(WORD_BANK.keys())
                min_len = max(self.preset["word_lengths"])
                candidates = [
                    length
                    for length in available
                    if min_len <= length <= min(self.rows * self.cols, max(available))
                ]
                if not candidates:
                    candidates = [length for length in available if length <= self.rows * self.cols]
                word_len = random.choice(candidates) if candidates else min(self.rows * self.cols, 8)
            else:
                word_len = random.choice(self.preset["word_lengths"])
            word_len = min(word_len, self.rows * self.cols)
            return get_random_word(word_len)

        word = sanitize_word(word)
        if not word:
            raise ValueError("Word must contain at least one alphanumeric character")
        if len(word) > self.rows * self.cols:
            raise ValueError(f"Word length {len(word)} exceeds grid capacity {self.rows * self.cols}")
        return word

    def _find_unique_no_wall_path(
        self,
        word: str,
        path_generator: HamiltonianPathGenerator,
        node_budget: int,
        max_attempts: int,
        circuits_only: bool,
    ) -> Tuple[List[Cell], List[Milestone], Dict]:
        solver = UniquenessSolver(self.rows, self.cols, node_budget)
        last_reason = "no attempts made"

        for attempt in range(1, max_attempts + 1):
            path = path_generator.generate(circuits_only=circuits_only)
            milestones = MilestonePlacer.place(path, word)
            result = solver.solve_with_milestones(path, set(), milestones)

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
            f"attempts on a {self.rows}x{self.cols} grid (last reason: {last_reason})."
        )

    @staticmethod
    def _path_valid_with_walls(path: List[Cell], walls: Set[EdgeKey]) -> bool:
        from .grid import check_intended_valid

        return check_intended_valid(path, walls)

    def _format_puzzle(
        self,
        path: List[Cell],
        milestones: List[Milestone],
        walls: Set[EdgeKey],
        word: str,
        final_eval: Dict,
        stats_extra: Dict,
    ) -> Dict:
        public_milestones = [
            {"index": m["index"], "character": m["character"], "cell": m["cell"]}
            for m in milestones
        ]
        start = path[0]
        end = path[-1]

        return {
            "id": f"puzzle_{self.difficulty}_{uuid.uuid4().hex[:10]}",
            "difficulty": self.difficulty,
            "grid_size": self.size,
            "rows": self.rows,
            "cols": self.cols,
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
                **stats_extra,
            },
        }


def build_puzzle(
    difficulty: str = "medium",
    grid_size: Optional[int] = None,
    word: Optional[str] = None,
    no_walls: bool = False,
) -> Dict:
    """Convenience entry point for the puzzle-building engine."""
    engine = PuzzleEngine.from_params(difficulty=difficulty, grid_size=grid_size)
    return engine.build(word=word, no_walls=no_walls)
