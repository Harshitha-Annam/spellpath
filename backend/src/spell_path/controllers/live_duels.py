"""Controllers for live duel matchmaking."""

from __future__ import annotations

from spell_path.services import live_duels as live_duels_service
from spell_path.validators.live_duels import BotDuelBody, ForfeitBody, QueueJoinBody, QueueLeaveBody


async def forfeit_live_duel(duel_id: str, body: ForfeitBody):
    return await live_duels_service.forfeit_live_duel(duel_id, body)


async def join_bot_duel(body: BotDuelBody):
    return await live_duels_service.join_bot_duel(body)


async def join_queue(body: QueueJoinBody):
    return await live_duels_service.join_queue(body)


async def leave_queue(body: QueueLeaveBody):
    return await live_duels_service.leave_queue(body)


async def queue_status(user_id: str):
    return await live_duels_service.queue_status(user_id)
