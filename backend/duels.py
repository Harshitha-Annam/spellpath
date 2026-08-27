"""Async duel pack generation and scoring helpers."""

from __future__ import annotations

import logging
import threading
import uuid
from typing import Any, Dict, List

from duel_store import store
from get_puzzle import DEFAULT_GET_PUZZLE_MODEL, get_puzzle
from scoring import score_puzzle

logger = logging.getLogger("duels")

# Fixed gauntlet: 2 easy → 2 medium → 2 hard (shared board for fair comparison).
DUEL_DIFFICULTIES = ["easy", "easy", "medium", "medium", "hard", "hard"]


def _strip_internal(puzzle: Dict[str, Any], difficulty: str) -> Dict[str, Any]:
    """Keep the fields the client/API need; ensure every puzzle has a stable id."""
    puzzle_id = puzzle.get("id") or f"puzzle_{difficulty}_{uuid.uuid4().hex[:10]}"
    return {
        "id": puzzle_id,
        "difficulty": puzzle.get("difficulty") or difficulty,
        "grid_size": puzzle["grid_size"],
        "word": puzzle["word"],
        "start_cell": puzzle["start_cell"],
        "end_cell": puzzle["end_cell"],
        "milestones": puzzle["milestones"],
        "walls": puzzle.get("walls") or [],
        "solution_path": puzzle.get("solution_path") or [],
    }


def prepare_duel_pack(duel_id: str) -> None:
    """Generate the 6-puzzle pack via DeepSeek (same pipeline as /get-puzzle)."""

    def _run() -> None:
        puzzles: List[Dict[str, Any]] = []
        try:
            for i, difficulty in enumerate(DUEL_DIFFICULTIES):
                logger.info(
                    "duel %s DeepSeek generating puzzle %s/%s (%s)",
                    duel_id,
                    i + 1,
                    len(DUEL_DIFFICULTIES),
                    difficulty,
                )
                print(
                    f"\n>>> Duel {duel_id}: generating puzzle {i + 1}/"
                    f"{len(DUEL_DIFFICULTIES)} ({difficulty}) via DeepSeek…",
                    flush=True,
                )
                raw = get_puzzle(
                    difficulty=difficulty,
                    model_name=DEFAULT_GET_PUZZLE_MODEL,
                )
                puzzles.append(_strip_internal(raw, difficulty))
                store.set_duel_progress(duel_id, i + 1)
            store.set_duel_ready(duel_id, puzzles)
            logger.info("duel %s ready with %s DeepSeek puzzles", duel_id, len(puzzles))
        except Exception as exc:
            logger.exception("duel %s pack generation failed: %s", duel_id, exc)
            store.set_duel_failed(duel_id, str(exc))

    thread = threading.Thread(target=_run, name=f"duel-pack-{duel_id}", daemon=True)
    thread.start()


def score_duel_submission(
    *,
    puzzle: Dict[str, Any],
    path: List[Any],
    misses: int,
    backtracks: int,
) -> Dict[str, Any]:
    return score_puzzle(
        difficulty=puzzle.get("difficulty"),
        grid_size=int(puzzle["grid_size"]),
        milestones=puzzle.get("milestones") or [],
        walls=puzzle.get("walls") or [],
        path=path,
        misses=misses,
        backtracks=backtracks,
    )
