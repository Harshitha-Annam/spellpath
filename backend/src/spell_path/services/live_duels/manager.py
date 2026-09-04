"""Live duel matchmaking and lifecycle business logic."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Dict, List, Optional

from spell_path.repositories import live_duels as live_duel_repo
from spell_path.schemas.live_duels import Duel, DuelStatus, PlayerState, QueueEntry

logger = logging.getLogger("live_duels.manager")

QUEUE_TIMEOUT_SEC = 30
STALE_DUEL_SEC = 60
FINISHED_RETAIN_SEC = 60
CLEANUP_INTERVAL_SEC = 10
DISCONNECT_FORFEIT_SEC = 30
REMATCH_TIMEOUT_SEC = 45
BOT_USER_ID = "__live_duel_bot__"
BOT_DISPLAY_NAME = "Bot"


def _resolve_winner(duel: Duel, forfeit_user_id: Optional[str] = None) -> Optional[str]:
    player_ids = list(duel.players.keys())
    if len(player_ids) != 2:
        return None

    if forfeit_user_id and forfeit_user_id in duel.players:
        for uid in player_ids:
            if uid != forfeit_user_id:
                return uid
        return None

    a, b = player_ids
    scores = {uid: duel.players[uid].score for uid in player_ids}
    if scores[a] > scores[b]:
        return a
    if scores[b] > scores[a]:
        return b

    solved_a = duel.players[a].puzzles_solved
    solved_b = duel.players[b].puzzles_solved
    if solved_a > solved_b:
        return a
    if solved_b > solved_a:
        return b

    wrong_a = duel.players[a].wrong_attempts
    wrong_b = duel.players[b].wrong_attempts
    if wrong_a < wrong_b:
        return a
    if wrong_b < wrong_a:
        return b
    return None


def _opponent_name(duel: Duel, user_id: str) -> Optional[str]:
    if user_id not in duel.players:
        return None
    for uid, player in duel.players.items():
        if uid != user_id:
            return player.display_name
    return None


async def _create_duel(
    user_a_id: str,
    user_a_name: str,
    user_b_id: str,
    user_b_name: str,
    *,
    is_bot_duel: bool = False,
) -> Duel:
    duel_id = str(uuid.uuid4())
    now = time.time()
    duel = Duel(
        id=duel_id,
        created_at=now,
        is_bot_duel=is_bot_duel,
        players={
            user_a_id: PlayerState(user_id=user_a_id, display_name=user_a_name),
            user_b_id: PlayerState(user_id=user_b_id, display_name=user_b_name),
        },
    )
    await live_duel_repo.save_duel(duel)
    await live_duel_repo.save_user_duel_mapping(user_a_id, duel_id)
    await live_duel_repo.save_user_duel_mapping(user_b_id, duel_id)
    logger.info("Live duel created id=%s players=%s vs %s", duel_id, user_a_name, user_b_name)
    return duel


async def join_queue(user_id: str, display_name: str) -> Optional[str]:
    existing_duel_id = await live_duel_repo.fetch_user_duel_id(user_id)
    if existing_duel_id:
        return existing_duel_id

    queue = await live_duel_repo.fetch_queue()
    queue = [entry for entry in queue if entry.user_id != user_id]

    if queue:
        opponent = queue.pop(0)
        duel = await _create_duel(
            user_a_id=user_id,
            user_a_name=display_name,
            user_b_id=opponent.user_id,
            user_b_name=opponent.display_name,
        )
        opponent.matched_duel_id = duel.id
        await live_duel_repo.save_queue(queue)
        return duel.id

    queue.append(
        QueueEntry(
            user_id=user_id,
            display_name=display_name.strip() or "Player",
            queued_at=time.time(),
        )
    )
    await live_duel_repo.save_queue(queue)
    return None


async def leave_queue(user_id: str) -> None:
    queue = await live_duel_repo.fetch_queue()
    queue = [entry for entry in queue if entry.user_id != user_id]
    await live_duel_repo.save_queue(queue)


async def join_bot_duel(user_id: str, display_name: str) -> str:
    existing_duel_id = await live_duel_repo.fetch_user_duel_id(user_id)
    if existing_duel_id:
        return existing_duel_id

    queue = await live_duel_repo.fetch_queue()
    queue = [entry for entry in queue if entry.user_id != user_id]
    await live_duel_repo.save_queue(queue)

    bot_id = f"{BOT_USER_ID}:{uuid.uuid4().hex[:8]}"
    duel = await _create_duel(
        user_a_id=user_id,
        user_a_name=display_name,
        user_b_id=bot_id,
        user_b_name=BOT_DISPLAY_NAME,
        is_bot_duel=True,
    )
    duel.players[bot_id].connected = True
    await live_duel_repo.save_duel(duel)
    return duel.id


async def request_rematch(
    user_id: str,
    opponent_id: str,
    previous_duel_id: str,
    display_name: str,
    opponent_name: str,
) -> dict:
    pair_key = "_".join(sorted([user_id, opponent_id]))
    pending_rematches = await live_duel_repo.fetch_pending_rematches()
    pending = pending_rematches.get(pair_key)
    if not pending or pending.get("previous_duel_id") != previous_duel_id:
        pending = {
            "previous_duel_id": previous_duel_id,
            "players": {user_id: False, opponent_id: False},
            "display_names": {user_id: display_name, opponent_id: opponent_name},
            "created_at": time.time(),
            "duel_id": None,
        }
        await live_duel_repo.save_pending_rematch(pair_key, pending)

    pending["players"][user_id] = True
    accepted = all(pending["players"].values())

    if accepted and pending.get("duel_id") is None:
        if await live_duel_repo.fetch_user_duel_id(user_id) or await live_duel_repo.fetch_user_duel_id(
            opponent_id
        ):
            return {"status": "busy", "duel_id": None}

        names = pending.get("display_names") or {}
        duel = await _create_duel(
            user_a_id=user_id,
            user_a_name=names.get(user_id, display_name),
            user_b_id=opponent_id,
            user_b_name=names.get(opponent_id, opponent_name),
        )
        pending["duel_id"] = duel.id
        await live_duel_repo.save_pending_rematch(pair_key, pending)
        return {"status": "matched", "duel_id": duel.id}

    if pending.get("duel_id"):
        return {"status": "matched", "duel_id": pending["duel_id"]}

    await live_duel_repo.save_pending_rematch(pair_key, pending)
    return {"status": "waiting", "duel_id": None}


async def forfeit_duel(duel_id: str, user_id: str, reason: str = "forfeit") -> Optional[Duel]:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or duel.ended or user_id not in duel.players:
        return None

    # Pre-start exits are aborts (no scoreboard); mid-match exits are forfeits.
    if reason == "forfeit" and duel.status in (DuelStatus.WAITING, DuelStatus.COUNTDOWN):
        reason = "abort"

    if duel.countdown_task and not duel.countdown_task.done():
        duel.countdown_task.cancel()
        duel.countdown_task = None
    if duel.finish_task and not duel.finish_task.done():
        duel.finish_task.cancel()
        duel.finish_task = None

    duel.players[user_id].forfeited = True
    duel.end_reason = reason
    duel.status = DuelStatus.FINISHED
    duel.ended = True
    duel.winner_id = None if reason == "abort" else _resolve_winner(duel, forfeit_user_id=user_id)
    await live_duel_repo.remove_user_mappings(list(duel.players.keys()))
    await live_duel_repo.save_duel(duel)
    logger.info(
        "Live duel forfeited id=%s user=%s reason=%s winner=%s",
        duel_id,
        user_id,
        reason,
        duel.winner_id,
    )
    return duel


async def abort_duel(duel_id: str, user_id: str) -> Optional[Duel]:
    """Cancel a duel before it becomes active (queue matched / countdown)."""
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or duel.ended or user_id not in duel.players:
        return None
    if duel.status == DuelStatus.ACTIVE:
        return None
    return await forfeit_duel(duel_id, user_id, reason="abort")


async def opponent_display_name(duel_id: str, user_id: str) -> Optional[str]:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel:
        return None
    return _opponent_name(duel, user_id)


async def queue_status(user_id: str) -> dict:
    duel_id = await live_duel_repo.fetch_user_duel_id(user_id)
    if duel_id:
        duel = await live_duel_repo.fetch_duel(duel_id)
        opponent_name = _opponent_name(duel, user_id) if duel else None
        return {
            "in_queue": False,
            "matched": True,
            "duel_id": duel_id,
            "opponent_name": opponent_name,
        }

    for entry in await live_duel_repo.fetch_queue():
        if entry.user_id != user_id:
            continue
        if entry.matched_duel_id:
            duel = await live_duel_repo.fetch_duel(entry.matched_duel_id)
            opponent_name = _opponent_name(duel, user_id) if duel else None
            return {
                "in_queue": False,
                "matched": True,
                "duel_id": entry.matched_duel_id,
                "opponent_name": opponent_name,
            }
        return {"in_queue": True, "matched": False, "duel_id": None}

    return {"in_queue": False, "matched": False, "duel_id": None}


async def get_duel(duel_id: str) -> Optional[Duel]:
    return await live_duel_repo.fetch_duel(duel_id)


async def attach_player(duel_id: str, user_id: str, ws) -> Optional[Duel]:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or user_id not in duel.players:
        return None
    player = duel.players[user_id]
    player.ws = ws
    player.connected = True
    player.disconnected_at = None
    await live_duel_repo.save_duel(duel)
    return duel


async def detach_player(duel_id: str, user_id: str) -> None:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or user_id not in duel.players:
        return
    player = duel.players[user_id]
    player.connected = False
    player.ws = None
    if duel.status == DuelStatus.ACTIVE and not duel.ended:
        player.disconnected_at = time.time()
    await live_duel_repo.save_duel(duel)


async def both_connected(duel: Duel) -> bool:
    fresh = await live_duel_repo.fetch_duel(duel.id)
    if not fresh:
        return False
    return all(player.connected for player in fresh.players.values())


async def set_countdown(duel_id: str, start_at: float) -> Optional[Duel]:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or duel.status != DuelStatus.WAITING:
        return None
    duel.status = DuelStatus.COUNTDOWN
    duel.countdown_start_at = start_at
    await live_duel_repo.save_duel(duel)
    return duel


async def set_active(duel_id: str, start_at: float) -> Optional[Duel]:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or duel.status not in (DuelStatus.WAITING, DuelStatus.COUNTDOWN):
        return None
    duel.status = DuelStatus.ACTIVE
    duel.duel_start_at = start_at
    await live_duel_repo.save_duel(duel)
    return duel


async def finish_duel(duel_id: str) -> Optional[Duel]:
    duel = await live_duel_repo.fetch_duel(duel_id)
    if not duel or duel.ended:
        return None
    duel.status = DuelStatus.FINISHED
    duel.ended = True
    if not duel.end_reason:
        duel.end_reason = "timer"
    duel.winner_id = _resolve_winner(duel)
    await live_duel_repo.remove_user_mappings(list(duel.players.keys()))
    await live_duel_repo.save_duel(duel)
    scores = {uid: player.score for uid, player in duel.players.items()}
    logger.info(
        "Live duel finished id=%s winner=%s scores=%s reason=%s",
        duel_id,
        duel.winner_id,
        scores,
        duel.end_reason,
    )
    return duel


async def check_disconnect_forfeits() -> List[Duel]:
    now = time.time()
    to_forfeit: List[tuple[str, str]] = []
    for duel_id, duel in (await live_duel_repo.list_duels()).items():
        if duel.status != DuelStatus.ACTIVE or duel.ended or duel.is_bot_duel:
            continue
        connected = [player for player in duel.players.values() if player.connected]
        disconnected = [player for player in duel.players.values() if not player.connected]
        if len(connected) != 1 or len(disconnected) != 1:
            continue
        dc = disconnected[0]
        if dc.disconnected_at is None:
            continue
        if now - dc.disconnected_at >= DISCONNECT_FORFEIT_SEC:
            to_forfeit.append((duel_id, dc.user_id))

    finished: List[Duel] = []
    for duel_id, user_id in to_forfeit:
        duel = await forfeit_duel(duel_id, user_id, reason="disconnect")
        if duel:
            finished.append(duel)
    return finished


async def cleanup_once() -> List[Duel]:
    now = time.time()
    queue = await live_duel_repo.fetch_queue()
    queue = [
        entry
        for entry in queue
        if now - entry.queued_at < QUEUE_TIMEOUT_SEC and not entry.matched_duel_id
    ]
    await live_duel_repo.save_queue(queue)

    pending_rematches = await live_duel_repo.fetch_pending_rematches()
    stale_rematch_keys = [
        key
        for key, pending in pending_rematches.items()
        if now - pending.get("created_at", now) > REMATCH_TIMEOUT_SEC
    ]
    await live_duel_repo.delete_pending_rematches(stale_rematch_keys)

    to_delete: List[str] = []
    for duel_id, duel in (await live_duel_repo.list_duels()).items():
        age = now - duel.created_at
        if duel.status in (DuelStatus.WAITING, DuelStatus.COUNTDOWN):
            if age > STALE_DUEL_SEC:
                all_disconnected = not any(player.connected for player in duel.players.values())
                if all_disconnected or age > STALE_DUEL_SEC * 2:
                    to_delete.append(duel_id)
                    await live_duel_repo.remove_user_mappings(list(duel.players.keys()))
        if duel.status == DuelStatus.FINISHED and age > FINISHED_RETAIN_SEC + duel.duration_sec:
            to_delete.append(duel_id)

    for duel_id in to_delete:
        await live_duel_repo.delete_duel(duel_id)
        logger.info("Cleaned up live duel %s", duel_id)

    overdue: List[str] = []
    for duel_id, duel in (await live_duel_repo.list_duels()).items():
        if (
            duel.status == DuelStatus.ACTIVE
            and duel.duel_start_at is not None
            and not duel.ended
            and now > duel.duel_start_at + duel.duration_sec + 5
        ):
            overdue.append(duel_id)

    finished: List[Duel] = []
    for duel_id in overdue:
        duel = await finish_duel(duel_id)
        if duel:
            finished.append(duel)
    return finished


async def cleanup_loop() -> None:
    while True:
        try:
            await cleanup_once()
        except Exception:
            logger.exception("Live duel cleanup loop error")
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)


async def ensure_initial_puzzles(duel: Duel) -> None:
    from spell_path.services.live_duels.puzzles import ensure_puzzle_at_index, schedule_prefetch

    await ensure_puzzle_at_index(duel, 0)
    schedule_prefetch(duel, 0)
