"""Controllers for async spellpath combat (shared 6-puzzle gauntlet)."""

from typing import Optional

from spell_path.services import async_duels as async_duels_service
from spell_path.validators.async_duels import (
    CreateDuelBody,
    CreatePlayerBody,
    StartAttemptBody,
    SubmitDuelPuzzleBody,
)


def create_player(body: CreatePlayerBody):
    return async_duels_service.create_player(body)


def get_player(player_id: str):
    return async_duels_service.get_player(player_id)


def create_duel(body: CreateDuelBody):
    return async_duels_service.create_duel(body)


def get_duel(id_or_code: str):
    return async_duels_service.get_duel(id_or_code)


def get_duel_puzzles(id_or_code: str):
    return async_duels_service.get_duel_puzzles(id_or_code)


def get_duel_leaderboard(id_or_code: str, attempt_id: Optional[str] = None):
    return async_duels_service.get_duel_leaderboard(id_or_code, attempt_id)


def start_duel_attempt(id_or_code: str, body: StartAttemptBody):
    return async_duels_service.start_duel_attempt(id_or_code, body)


def get_attempt(attempt_id: str):
    return async_duels_service.get_attempt(attempt_id)


def get_revealed_puzzles(attempt_id: str):
    return async_duels_service.get_revealed_puzzles(attempt_id)


def submit_duel_puzzle(attempt_id: str, puzzle_index: int, body: SubmitDuelPuzzleBody):
    return async_duels_service.submit_duel_puzzle(attempt_id, puzzle_index, body)
