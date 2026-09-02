"""HTTP route registration for the Spell Path API."""

from fastapi import APIRouter

from .async_duels import router as async_duels_router
from .live_duels import router as live_duels_router
from .puzzles import router as puzzles_router
from .root import router as root_router


def register_spellpath_routes(api_router: APIRouter) -> None:
    spellpath = APIRouter(prefix="/spellpath", tags=["spellpath"])
    spellpath.include_router(root_router)
    spellpath.include_router(puzzles_router)
    spellpath.include_router(async_duels_router)
    spellpath.include_router(live_duels_router)
    api_router.include_router(spellpath)
