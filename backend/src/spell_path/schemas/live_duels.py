from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket


class DuelStatus(str, Enum):
    WAITING = "waiting"
    COUNTDOWN = "countdown"
    ACTIVE = "active"
    FINISHED = "finished"


@dataclass
class PlayerState:
    user_id: str
    display_name: str
    ws: Optional[WebSocket] = None
    connected: bool = False
    score: float = 0.0
    current_index: int = 0
    puzzles_solved: int = 0
    wrong_attempts: int = 0
    puzzle_results: List[Dict[str, Any]] = field(default_factory=list)
    disconnected_at: Optional[float] = None
    forfeited: bool = False


@dataclass
class Duel:
    id: str
    puzzle_sequence: List[Dict[str, Any]] = field(default_factory=list)
    used_words: Set[str] = field(default_factory=set)
    players: Dict[str, PlayerState] = field(default_factory=dict)
    status: DuelStatus = DuelStatus.WAITING
    created_at: float = 0.0
    countdown_start_at: Optional[float] = None
    duel_start_at: Optional[float] = None
    duration_sec: int = 60
    winner_id: Optional[str] = None
    ended: bool = False
    end_reason: Optional[str] = None
    is_bot_duel: bool = False
    generation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    finish_task: Optional[asyncio.Task] = None
    countdown_task: Optional[asyncio.Task] = None


@dataclass
class QueueEntry:
    user_id: str
    display_name: str
    queued_at: float
    matched_duel_id: Optional[str] = None
