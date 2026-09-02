"""REST routes for async spellpath combat (shared 6-puzzle gauntlet)."""

from typing import Optional

from fastapi import APIRouter, Query

from spell_path.controllers import async_duels as async_duels_controller
from spell_path.validators.async_duels import (
    CreateDuelBody,
    CreatePlayerBody,
    StartAttemptBody,
    SubmitDuelPuzzleBody,
)

router = APIRouter(tags=["async-duels"])


@router.post("/players")
def create_player(body: CreatePlayerBody):
    return async_duels_controller.create_player(body)


@router.get("/players/{player_id}")
def get_player(player_id: str):
    return async_duels_controller.get_player(player_id)


@router.post("/duels")
def create_duel(body: CreateDuelBody):
    return async_duels_controller.create_duel(body)


@router.get("/duels/{id_or_code}")
def get_duel(id_or_code: str):
    return async_duels_controller.get_duel(id_or_code)


@router.get("/duels/{id_or_code}/puzzles")
def get_duel_puzzles(id_or_code: str):
    return async_duels_controller.get_duel_puzzles(id_or_code)


@router.get("/duels/{id_or_code}/leaderboard")
def get_duel_leaderboard(
    id_or_code: str,
    attempt_id: Optional[str] = Query(None, description="Center neighborhood on this attempt"),
):
    return async_duels_controller.get_duel_leaderboard(id_or_code, attempt_id)


@router.post("/duels/{id_or_code}/attempts")
def start_duel_attempt(id_or_code: str, body: StartAttemptBody):
    return async_duels_controller.start_duel_attempt(id_or_code, body)


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str):
    return async_duels_controller.get_attempt(attempt_id)


@router.get("/attempts/{attempt_id}/revealed-puzzles")
def get_revealed_puzzles(attempt_id: str):
    """Solutions are only revealed after the attempt is fully submitted."""
    return async_duels_controller.get_revealed_puzzles(attempt_id)


@router.post("/attempts/{attempt_id}/puzzles/{puzzle_index}/submit")
def submit_duel_puzzle(attempt_id: str, puzzle_index: int, body: SubmitDuelPuzzleBody):
    return async_duels_controller.submit_duel_puzzle(attempt_id, puzzle_index, body)
