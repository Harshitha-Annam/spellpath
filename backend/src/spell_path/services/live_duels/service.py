"""Business logic for live duel matchmaking."""

from __future__ import annotations

from core.exceptions import ForfeitConflict, LiveDuelNotFound
from spell_path.services.live_duels import manager as live_duel_manager
from spell_path.validators.live_duels import BotDuelBody, ForfeitBody, QueueJoinBody, QueueLeaveBody


async def forfeit_live_duel(duel_id: str, body: ForfeitBody):
    from spell_path.ws_handlers.live_duels import duel_end_payload, notify_duel_end

    duel = await live_duel_manager.get_duel(duel_id)
    if not duel or body.user_id not in duel.players:
        raise LiveDuelNotFound()

    if duel.ended:
        payload = duel_end_payload(duel)
        payload.pop("type", None)
        return payload

    finished = await live_duel_manager.forfeit_duel(duel_id, body.user_id, reason="forfeit")
    if not finished:
        raise ForfeitConflict()

    await notify_duel_end(finished)
    payload = duel_end_payload(finished)
    payload.pop("type", None)
    return payload


async def join_bot_duel(body: BotDuelBody):
    duel_id = await live_duel_manager.join_bot_duel(body.user_id, body.display_name)
    return {
        "matched": True,
        "duel_id": duel_id,
        "opponent_name": "Bot",
        "is_bot": True,
    }


async def join_queue(body: QueueJoinBody):
    duel_id = await live_duel_manager.join_queue(body.user_id, body.display_name)
    if duel_id:
        opponent_name = await live_duel_manager.opponent_display_name(duel_id, body.user_id)
        return {"matched": True, "duel_id": duel_id, "opponent_name": opponent_name}
    return {"matched": False, "duel_id": None}


async def leave_queue(body: QueueLeaveBody):
    await live_duel_manager.leave_queue(body.user_id)
    return {"ok": True}


async def queue_status(user_id: str):
    return await live_duel_manager.queue_status(user_id)
