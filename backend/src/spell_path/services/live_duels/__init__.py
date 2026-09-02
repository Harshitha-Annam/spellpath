"""Live duel matchmaking and real-time duel business logic."""

from spell_path.schemas.live_duels import Duel, DuelStatus, PlayerState, QueueEntry

from . import manager
from .manager import BOT_DISPLAY_NAME, BOT_USER_ID, CLEANUP_INTERVAL_SEC
from .puzzles import (
    build_live_duel_puzzle,
    difficulty_for_index,
    ensure_puzzle_at_index,
    public_puzzle,
    schedule_prefetch,
)
from .service import forfeit_live_duel, join_bot_duel, join_queue, leave_queue, queue_status

__all__ = [
    "BOT_DISPLAY_NAME",
    "BOT_USER_ID",
    "CLEANUP_INTERVAL_SEC",
    "Duel",
    "DuelStatus",
    "PlayerState",
    "QueueEntry",
    "build_live_duel_puzzle",
    "difficulty_for_index",
    "ensure_puzzle_at_index",
    "forfeit_live_duel",
    "join_bot_duel",
    "join_queue",
    "leave_queue",
    "manager",
    "public_puzzle",
    "queue_status",
    "schedule_prefetch",
]
