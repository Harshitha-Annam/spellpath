import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parent / "src")) # looks inside backend/src for importing things without this below imports fail

from core import register_exception_handlers # registers exception handlers for the app
from middlewares import register_middlewares # registers middlewares for the app
from spell_path.routes import register_spellpath_routes # registers spellpath routes for the app
from spell_path.ws_handlers import register_websockets # registers websocket handlers for the app
from spell_path.ws_handlers.live_duels import live_duel_maintenance_loop # runs the live duel maintenance loop

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("main")

# lifespan is a context manager that runs the live duel maintenance loop and cleans up after it
@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_task = asyncio.create_task(live_duel_maintenance_loop())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

# creates the fastapi app and registers the lifespan context manager
app = FastAPI(lifespan=lifespan)

register_exception_handlers(app) # registers exception handlers for the app
register_middlewares(app) # registers middlewares for the app

api_router = APIRouter(prefix="/api") # creates a router for the api

# health check endpoint
@api_router.get("/health")
def health():
    return {"status": "ok"}

# registers spellpath routes and websocket handlers for the app
register_spellpath_routes(api_router)
register_websockets(api_router)
app.include_router(api_router) # includes the api router in the app
