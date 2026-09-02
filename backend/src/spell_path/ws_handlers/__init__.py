"""WebSocket handler registration."""

from fastapi import APIRouter, Query, WebSocket

from .live_duels import live_duel_ws


def register_websockets(api_router: APIRouter) -> None:
    @api_router.websocket("/spellpath/ws/duel/{duel_id}")
    async def live_duel_websocket(
        websocket: WebSocket,
        duel_id: str,
        user_id: str = Query(...),
    ):
        await live_duel_ws(websocket, duel_id, user_id)
