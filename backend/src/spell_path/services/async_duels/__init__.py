"""Async spellpath combat business logic."""

from .pack import prepare_duel_pack, score_duel_submission
from .service import (
    create_duel,
    create_player,
    get_attempt,
    get_duel,
    get_duel_leaderboard,
    get_duel_puzzles,
    get_player,
    get_revealed_puzzles,
    start_duel_attempt,
    submit_duel_puzzle,
)

__all__ = [
    "create_duel",
    "create_player",
    "get_attempt",
    "get_duel",
    "get_duel_leaderboard",
    "get_duel_puzzles",
    "get_player",
    "get_revealed_puzzles",
    "prepare_duel_pack",
    "score_duel_submission",
    "start_duel_attempt",
    "submit_duel_puzzle",
]
