"""Business logic for async spellpath combat (shared 6-puzzle gauntlet)."""

from __future__ import annotations

import time
from typing import Optional

from core.exceptions import (
    AttemptNotCompleted,
    AttemptNotFound,
    BadRequestError,
    DuelNotFound,
    DuelPackFailed,
    DuelPreparing,
    DuelPuzzleNotFound,
    PlayerNotFound,
    RevealedPuzzlesNotFound,
)
from spell_path.repositories import async_duels as async_duel_repo
from spell_path.services.async_duels.pack import prepare_duel_pack, score_duel_submission
from spell_path.services.async_duels.persistence import (
    build_leaderboard,
    build_puzzle_slots,
    fetch_duel_puzzles,
    fetch_public_duel,
    fetch_raw_puzzle,
    fetch_revealed_puzzles,
    maybe_crown_champion,
    to_public_attempt,
    to_public_player,
)
from spell_path.validators.async_duels import (
    CreateDuelBody,
    CreatePlayerBody,
    StartAttemptBody,
    SubmitDuelPuzzleBody,
)


def create_player(body: CreatePlayerBody):
    cleaned = " ".join((body.name or "").strip().split())
    if not cleaned:
        raise BadRequestError("Name is required")
    if len(cleaned) > 24:
        raise BadRequestError("Name must be 24 characters or fewer")

    player = async_duel_repo.insert_player(
        {
            "id": async_duel_repo.new_id("player"),
            "name": cleaned,
            "created_at": time.time(),
        }
    )
    return to_public_player(player)


def get_player(player_id: str):
    player = async_duel_repo.fetch_player(player_id)
    if not player:
        raise PlayerNotFound()
    return to_public_player(player)


def create_duel(body: CreateDuelBody):
    if not async_duel_repo.player_exists(body.player_id):
        raise BadRequestError("Unknown player")

    code = async_duel_repo.new_short_code()
    while async_duel_repo.code_exists(code):
        code = async_duel_repo.new_short_code()

    duel = async_duel_repo.insert_duel(
        {
            "id": async_duel_repo.new_id("duel"),
            "code": code,
            "creator_id": body.player_id,
            "status": "preparing",
            "puzzles": [],
            "puzzle_count": 6,
            "prepared_count": 0,
            "error": None,
            "champion_attempt_id": None,
            "created_at": time.time(),
            "ready_at": None,
        }
    )
    prepare_duel_pack(duel["id"])
    return fetch_public_duel(duel["id"])


def get_duel(id_or_code: str):
    duel = fetch_public_duel(id_or_code)
    if not duel:
        raise DuelNotFound()
    return duel


def get_duel_puzzles(id_or_code: str):
    duel = fetch_public_duel(id_or_code)
    if not duel:
        raise DuelNotFound()
    if duel["status"] == "preparing":
        raise DuelPreparing(duel["prepared_count"], duel["puzzle_count"])
    if duel["status"] == "failed":
        raise DuelPackFailed(duel.get("error") or "Spellpath combat pack failed")
    puzzles = fetch_duel_puzzles(id_or_code, include_solutions=False)
    return {"duel_id": duel["id"], "code": duel["code"], "puzzles": puzzles}


def get_duel_leaderboard(id_or_code: str, attempt_id: Optional[str] = None):
    duel = fetch_public_duel(id_or_code)
    if not duel:
        raise DuelNotFound()
    board = build_leaderboard(duel["id"], around_attempt_id=attempt_id)
    return {"duel": duel, **board}


def start_duel_attempt(id_or_code: str, body: StartAttemptBody):
    duel_id = async_duel_repo.fetch_duel_id(id_or_code)
    if not duel_id:
        raise DuelNotFound()

    duel = async_duel_repo.fetch_duel_by_id(duel_id)
    if not duel:
        raise DuelNotFound()
    if duel["status"] != "ready":
        raise BadRequestError("Spellpath combat puzzles are not ready yet")
    if not async_duel_repo.player_exists(body.player_id):
        raise BadRequestError("Unknown player")

    existing = async_duel_repo.fetch_in_progress_attempt(duel_id, body.player_id)
    if existing:
        return to_public_attempt(existing)

    attempt = async_duel_repo.insert_attempt(
        {
            "id": async_duel_repo.new_id("attempt"),
            "duel_id": duel_id,
            "player_id": body.player_id,
            "status": "in_progress",
            "current_index": 0,
            "puzzle_results": build_puzzle_slots(duel),
            "total_score": 0.0,
            "total_time_ms": 0,
            "started_at": time.time(),
            "completed_at": None,
            "beat_champion": False,
            "became_champion": False,
        }
    )
    return to_public_attempt(attempt)


def get_attempt(attempt_id: str):
    attempt = async_duel_repo.fetch_attempt(attempt_id)
    if not attempt:
        raise AttemptNotFound()
    return to_public_attempt(attempt)


def get_revealed_puzzles(attempt_id: str):
    attempt = async_duel_repo.fetch_attempt(attempt_id)
    if not attempt:
        raise AttemptNotFound()
    if attempt["status"] != "completed":
        raise AttemptNotCompleted()
    puzzles = fetch_revealed_puzzles(attempt_id)
    if puzzles is None:
        raise RevealedPuzzlesNotFound()
    return {"attempt_id": attempt_id, "puzzles": puzzles}


def submit_duel_puzzle(attempt_id: str, puzzle_index: int, body: SubmitDuelPuzzleBody):
    attempt = async_duel_repo.fetch_attempt(attempt_id)
    if not attempt:
        raise AttemptNotFound()

    puzzle = fetch_raw_puzzle(attempt["duel_id"], puzzle_index)
    if not puzzle:
        raise DuelPuzzleNotFound()

    if attempt["status"] != "in_progress":
        raise BadRequestError("Attempt is already completed")
    if puzzle_index != attempt["current_index"]:
        raise BadRequestError(
            f"Expected puzzle index {attempt['current_index']}, got {puzzle_index}"
        )

    slot = attempt["puzzle_results"][puzzle_index]
    if slot["submitted_at"] is not None:
        raise BadRequestError("This puzzle was already submitted")

    try:
        if body.skipped:
            score_result = {
                "solved": False,
                "reason": "skipped",
                "score": None,
                "base_points": 0,
                "misses": body.misses,
                "backtracks": body.backtracks,
                "miss_penalty": 0.0,
                "backtrack_penalty": 0.0,
            }
            awarded = 0.0
            was_solved = False
        else:
            score_result = score_duel_submission(
                puzzle=puzzle,
                path=body.path,
                misses=body.misses,
                backtracks=body.backtracks,
            )
            was_solved = bool(score_result.get("solved"))
            raw_score = score_result.get("score")
            awarded = float(raw_score) if was_solved and isinstance(raw_score, (int, float)) else 0.0

        elapsed = max(0, int(body.time_ms))
        slot.update(
            {
                "solved": was_solved,
                "skipped": body.skipped,
                "score": awarded if was_solved else 0.0,
                "time_ms": elapsed,
                "misses": max(0, int(body.misses)),
                "backtracks": max(0, int(body.backtracks)),
                "submitted_at": time.time(),
            }
        )

        duel = async_duel_repo.fetch_duel_by_id(attempt["duel_id"])
        if not duel:
            raise DuelNotFound()

        total_score = round(attempt["total_score"] + (awarded if was_solved else 0.0), 2)
        total_time_ms = int(attempt["total_time_ms"]) + elapsed
        completed = puzzle_index + 1 >= len(duel["puzzles"])
        updates = {
            "puzzle_results": attempt["puzzle_results"],
            "total_score": total_score,
            "total_time_ms": total_time_ms,
            "current_index": puzzle_index if completed else puzzle_index + 1,
        }
        if completed:
            updates["status"] = "completed"
            updates["completed_at"] = time.time()

        updated = async_duel_repo.update_attempt(attempt_id, **updates)
        if not updated:
            raise AttemptNotFound()

        if completed:
            maybe_crown_champion(updated)
            updated = async_duel_repo.fetch_attempt(attempt_id) or updated

        public_attempt = to_public_attempt(updated)
        duel_public = fetch_public_duel(updated["duel_id"])
        board = None
        revealed = None
        if updated["status"] == "completed":
            board = build_leaderboard(updated["duel_id"], around_attempt_id=updated["id"])
            revealed = fetch_revealed_puzzles(updated["id"])

        return {
            "score_result": score_result,
            "attempt": public_attempt,
            "duel": duel_public,
            "leaderboard": board,
            "revealed_puzzles": revealed,
        }
    except ValueError as exc:
        raise BadRequestError(str(exc)) from exc
