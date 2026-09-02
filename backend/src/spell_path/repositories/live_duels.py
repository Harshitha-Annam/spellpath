"""CRUD functions for the live duel in-memory database."""

from __future__ import annotations

import asyncio
from typing import Dict, List, Optional

from spell_path.schemas.live_duels import Duel, QueueEntry

_lock = asyncio.Lock()
_duels: Dict[str, Duel] = {}
_queue: List[QueueEntry] = []
_user_to_duel: Dict[str, str] = {}
_pending_rematches: Dict[str, dict] = {}


async def fetch_duel(duel_id: str) -> Optional[Duel]:
    async with _lock:
        return _duels.get(duel_id)


async def save_duel(duel: Duel) -> Duel:
    async with _lock:
        _duels[duel.id] = duel
        return duel


async def delete_duel(duel_id: str) -> None:
    async with _lock:
        _duels.pop(duel_id, None)


async def list_duels() -> Dict[str, Duel]:
    async with _lock:
        return dict(_duels)


async def fetch_user_duel_id(user_id: str) -> Optional[str]:
    async with _lock:
        return _user_to_duel.get(user_id)


async def save_user_duel_mapping(user_id: str, duel_id: str) -> None:
    async with _lock:
        _user_to_duel[user_id] = duel_id


async def remove_user_duel_mapping(user_id: str) -> None:
    async with _lock:
        _user_to_duel.pop(user_id, None)


async def remove_user_mappings(user_ids: List[str]) -> None:
    async with _lock:
        for user_id in user_ids:
            _user_to_duel.pop(user_id, None)


async def fetch_queue() -> List[QueueEntry]:
    async with _lock:
        return list(_queue)


async def save_queue(queue: List[QueueEntry]) -> None:
    async with _lock:
        _queue.clear()
        _queue.extend(queue)


async def fetch_pending_rematches() -> Dict[str, dict]:
    async with _lock:
        return dict(_pending_rematches)


async def save_pending_rematch(key: str, value: dict) -> None:
    async with _lock:
        _pending_rematches[key] = value


async def delete_pending_rematch(key: str) -> None:
    async with _lock:
        _pending_rematches.pop(key, None)


async def delete_pending_rematches(keys: List[str]) -> None:
    async with _lock:
        for key in keys:
            _pending_rematches.pop(key, None)
