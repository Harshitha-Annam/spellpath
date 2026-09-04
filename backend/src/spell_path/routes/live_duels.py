"""REST routes for live duel matchmaking."""

from __future__ import annotations

from fastapi import APIRouter, Query

from spell_path.controllers import live_duels as live_duels_controller
from spell_path.validators.live_duels import BotDuelBody, ForfeitBody, QueueJoinBody, QueueLeaveBody

router = APIRouter(prefix="/duels", tags=["live-duels"])


@router.post("/{duel_id}/forfeit")
async def forfeit_live_duel(duel_id: str, body: ForfeitBody):
    """Forfeit an active live duel (reliable HTTP fallback when WS is flaky)."""
    return await live_duels_controller.forfeit_live_duel(duel_id, body)


@router.post("/{duel_id}/abort")
async def abort_live_duel(duel_id: str, body: ForfeitBody):
    """Cancel a matched duel before it starts (waiting / countdown). Returns home — no scoreboard."""
    return await live_duels_controller.abort_live_duel(duel_id, body)


@router.post("/queue/bot")
async def join_bot_duel(body: BotDuelBody):
    """Start an immediate duel against a bot opponent (used when queue is empty)."""
    return await live_duels_controller.join_bot_duel(body)


@router.post("/queue")
async def join_queue(body: QueueJoinBody):
    """
    Enter the live duel matchmaking queue.
    Returns immediately with matched=true and duel_id when paired,
    or matched=false when still waiting (poll GET /duels/queue/status).
    """
    return await live_duels_controller.join_queue(body)


@router.post("/queue/leave")
async def leave_queue(body: QueueLeaveBody):
    return await live_duels_controller.leave_queue(body)


@router.get("/queue/status")
async def queue_status(user_id: str = Query(..., min_length=1)):
    return await live_duels_controller.queue_status(user_id)
