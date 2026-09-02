"""CRUD functions for the async duel in-memory database."""

from __future__ import annotations

import threading
import uuid
from typing import Any, Dict, List, Optional

from spell_path.schemas.async_duels import AsyncDuelRecord, AttemptRecord, PlayerRecord

_lock = threading.RLock()
_players: Dict[str, PlayerRecord] = {}
_duels: Dict[str, AsyncDuelRecord] = {}
_duels_by_code: Dict[str, str] = {}
_attempts: Dict[str, AttemptRecord] = {}


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def new_short_code(length: int = 6) -> str:
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    seed = uuid.uuid4().hex
    return "".join(alphabet[int(seed[i : i + 2], 16) % len(alphabet)] for i in range(0, length * 2, 2))


# ---- players ----


def insert_player(player: PlayerRecord) -> PlayerRecord:
    with _lock:
        _players[player["id"]] = dict(player)
        return dict(player)


def fetch_player(player_id: str) -> Optional[PlayerRecord]:
    with _lock:
        player = _players.get(player_id)
        return dict(player) if player else None


def player_exists(player_id: str) -> bool:
    with _lock:
        return player_id in _players


# ---- duels ----


def insert_duel(duel: AsyncDuelRecord) -> AsyncDuelRecord:
    with _lock:
        _duels[duel["id"]] = dict(duel)
        _duels_by_code[duel["code"]] = duel["id"]
        return dict(duel)


def fetch_duel_by_id(duel_id: str) -> Optional[AsyncDuelRecord]:
    with _lock:
        duel = _duels.get(duel_id)
        return dict(duel) if duel else None


def fetch_duel_id(id_or_code: str) -> Optional[str]:
    key = (id_or_code or "").strip()
    if not key:
        return None
    with _lock:
        if key in _duels:
            return key
        return _duels_by_code.get(key.upper())


def update_duel(duel_id: str, **fields: Any) -> Optional[AsyncDuelRecord]:
    with _lock:
        duel = _duels.get(duel_id)
        if not duel:
            return None
        duel.update(fields)
        return dict(duel)


def code_exists(code: str) -> bool:
    with _lock:
        return code in _duels_by_code


# ---- attempts ----


def insert_attempt(attempt: AttemptRecord) -> AttemptRecord:
    with _lock:
        _attempts[attempt["id"]] = dict(attempt)
        return dict(attempt)


def fetch_attempt(attempt_id: str) -> Optional[AttemptRecord]:
    with _lock:
        attempt = _attempts.get(attempt_id)
        return dict(attempt) if attempt else None


def update_attempt(attempt_id: str, **fields: Any) -> Optional[AttemptRecord]:
    with _lock:
        attempt = _attempts.get(attempt_id)
        if not attempt:
            return None
        attempt.update(fields)
        return dict(attempt)


def fetch_in_progress_attempt(duel_id: str, player_id: str) -> Optional[AttemptRecord]:
    with _lock:
        for attempt in _attempts.values():
            if (
                attempt["duel_id"] == duel_id
                and attempt["player_id"] == player_id
                and attempt["status"] == "in_progress"
            ):
                return dict(attempt)
        return None


def list_attempts_for_duel(duel_id: str, *, status: Optional[str] = None) -> List[AttemptRecord]:
    with _lock:
        items = [
            dict(attempt)
            for attempt in _attempts.values()
            if attempt["duel_id"] == duel_id and (status is None or attempt["status"] == status)
        ]
        return items


def count_completed_attempts_for_duel(duel_id: str) -> int:
    with _lock:
        return sum(
            1
            for attempt in _attempts.values()
            if attempt["duel_id"] == duel_id and attempt["status"] == "completed"
        )
