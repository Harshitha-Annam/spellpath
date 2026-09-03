"""HTTP route registration for the Spell Path API."""

from fastapi import APIRouter

from .async_duels import router as async_duels_router
from .live_duels import router as live_duels_router
from .puzzles import router as puzzles_router
from .root import router as root_router


def register_spellpath_routes(api_router: APIRouter) -> None:
    # creates a router for the spellpath api and includes the root, puzzles, async duels, and live duels routers
    spellpath = APIRouter(prefix="/spellpath", tags=["spellpath"])
    spellpath.include_router(root_router) # includes the root router
    spellpath.include_router(puzzles_router) # includes the puzzles router
    spellpath.include_router(async_duels_router) # includes the async duels router
    spellpath.include_router(live_duels_router) # includes the live duels router
    api_router.include_router(spellpath) # includes the spellpath router in the api router
