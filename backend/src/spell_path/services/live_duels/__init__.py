"""Live duel matchmaking and real-time duel business logic."""

from spell_path.schemas.live_duels import Duel, DuelStatus, PlayerState, QueueEntry

from . import manager
from .manager import BOT_DISPLAY_NAME, BOT_USER_ID, CLEANUP_INTERVAL_SEC
from .puzzles import (
    build_live_duel_puzzle,
    difficulty_for_index,
    ensure_puzzle_at_index,
    path_complexity_for_index,
    public_puzzle,
    schedule_prefetch,
)
from .service import (
    abort_live_duel,
    forfeit_live_duel,
    join_bot_duel,
    join_queue,
    leave_queue,
    queue_status,
)

__all__ = [
    "BOT_DISPLAY_NAME",
    "BOT_USER_ID",
    "CLEANUP_INTERVAL_SEC",
    "Duel",
    "DuelStatus",
    "PlayerState",
    "QueueEntry",
    "abort_live_duel",
    "build_live_duel_puzzle",
    "difficulty_for_index",
    "ensure_puzzle_at_index",
    "forfeit_live_duel",
    "join_bot_duel",
    "join_queue",
    "leave_queue",
    "manager",
    "path_complexity_for_index",
    "public_puzzle",
    "queue_status",
    "schedule_prefetch",
]
