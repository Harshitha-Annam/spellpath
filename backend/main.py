import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from core import register_exception_handlers
from middlewares import register_middlewares
from spell_path.routes import register_spellpath_routes
from spell_path.ws_handlers import register_websockets
from spell_path.ws_handlers.live_duels import live_duel_maintenance_loop

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_task = asyncio.create_task(live_duel_maintenance_loop())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)
register_middlewares(app)

api_router = APIRouter(prefix="/api")


@api_router.get("/health")
def health():
    return {"status": "ok"}


register_spellpath_routes(api_router)
register_websockets(api_router)
app.include_router(api_router)
