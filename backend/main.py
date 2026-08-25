import logging
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from puzzle_logic import create_puzzle_flow, DEFAULT_DEEPSEEK_MODEL
from get_puzzle import get_puzzle, DEFAULT_GET_PUZZLE_MODEL

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("main")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "Hello World"}


@app.get("/create-puzzle")
def create_puzzle(
    difficulty: str = Query("medium", description="Difficulty level: easy, medium, hard, very_hard"),
    grid_size: Optional[int] = Query(None, ge=5, le=9, description="Size of the grid (5, 7, or 9)"),
    word: Optional[str] = Query(None, description="The target word for milestones"),
    model_name: str = Query(DEFAULT_DEEPSEEK_MODEL, description="DeepSeek model name to use"),
):
    t0 = time.perf_counter()
    logger.info(
        "/create-puzzle request difficulty=%r grid_size=%r word=%r model_name=%r",
        difficulty,
        grid_size,
        word,
        model_name,
    )
    try:
        puzzle = create_puzzle_flow(
            difficulty=difficulty,
            grid_size=grid_size,
            word=word,
            model_name=model_name,
        )
        logger.info(
            "/create-puzzle success id=%s word=%s grid=%s walls=%s (%.2fs)",
            puzzle.get("id"),
            puzzle.get("word"),
            puzzle.get("grid_size"),
            len(puzzle.get("walls") or []),
            time.perf_counter() - t0,
        )
        return puzzle
    except ValueError as ve:
        logger.warning("/create-puzzle ValueError after %.2fs: %s", time.perf_counter() - t0, ve)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("/create-puzzle failed after %.2fs: %s", time.perf_counter() - t0, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/get-puzzle")
def get_puzzle_endpoint(
    difficulty: str = Query("medium", description="Difficulty level: easy, medium, hard, very_hard"),
    grid_size: Optional[int] = Query(None, ge=5, le=9, description="Size of the grid (5, 7, or 9)"),
    word: Optional[str] = Query(None, description="Optional target word for milestones"),
    model_name: str = Query(
        DEFAULT_GET_PUZZLE_MODEL,
        description="DeepSeek model name (default: deepseek-chat)",
    ),
):
    """
    GET with query params only — do not send a JSON body.
    Example: /get-puzzle?difficulty=medium
    """
    return _run_get_puzzle(difficulty, grid_size, word, model_name)


class GetPuzzleBody(BaseModel):
    difficulty: str = Field("medium", description="easy | medium | hard | very_hard")
    grid_size: Optional[int] = Field(None, ge=5, le=9)
    word: Optional[str] = None
    model_name: str = DEFAULT_GET_PUZZLE_MODEL


@app.post("/get-puzzle")
def get_puzzle_post(body: GetPuzzleBody):
    """
    Same as GET, but accepts a JSON body, e.g.:
    {"difficulty": "medium"}
    """
    return _run_get_puzzle(body.difficulty, body.grid_size, body.word, body.model_name)


def _run_get_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    t0 = time.perf_counter()
    logger.info(
        "/get-puzzle request difficulty=%r grid_size=%r word=%r model_name=%r",
        difficulty,
        grid_size,
        word,
        model_name,
    )
    try:
        puzzle = get_puzzle(
            difficulty=difficulty,
            grid_size=grid_size,
            word=word,
            model_name=model_name,
        )
        logger.info(
            "/get-puzzle success keys=%s (%.2fs)",
            list(puzzle.keys()) if isinstance(puzzle, dict) else type(puzzle),
            time.perf_counter() - t0,
        )
        return puzzle
    except ValueError as ve:
        # Model output / parse problems — not a client bad request.
        logger.warning("/get-puzzle ValueError after %.2fs: %s", time.perf_counter() - t0, ve)
        raise HTTPException(status_code=502, detail=str(ve))
    except RuntimeError as re:
        # Upstream DeepSeek rejected the call or returned empty content.
        logger.warning("/get-puzzle RuntimeError after %.2fs: %s", time.perf_counter() - t0, re)
        raise HTTPException(status_code=502, detail=str(re))
    except Exception as e:
        logger.exception("/get-puzzle failed after %.2fs: %s", time.perf_counter() - t0, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/generate-puzzle")
def generate_puzzle_endpoint(
    difficulty: str = Query("medium", description="Difficulty level: easy, medium, hard, very_hard"),
    grid_size: Optional[int] = Query(None, ge=5, le=9, description="Size of the grid (5, 7, or 9)"),
    word: Optional[str] = Query(None, description="The target word for milestones"),
    model_name: str = Query(DEFAULT_DEEPSEEK_MODEL, description="DeepSeek model name to use"),
):
    """
    LLM puzzle generator powered by DeepSeek.
    Same response shape as /create-puzzle.
    """
    t0 = time.perf_counter()
    logger.info(
        "/generate-puzzle request difficulty=%r grid_size=%r word=%r model_name=%r",
        difficulty,
        grid_size,
        word,
        model_name,
    )
    try:
        puzzle = create_puzzle_flow(
            difficulty=difficulty,
            grid_size=grid_size,
            word=word,
            model_name=model_name,
        )
        logger.info(
            "/generate-puzzle success id=%s word=%s grid=%s walls=%s (%.2fs)",
            puzzle.get("id"),
            puzzle.get("word"),
            puzzle.get("grid_size"),
            len(puzzle.get("walls") or []),
            time.perf_counter() - t0,
        )
        return puzzle
    except ValueError as ve:
        logger.warning("/generate-puzzle ValueError after %.2fs: %s", time.perf_counter() - t0, ve)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("/generate-puzzle failed after %.2fs: %s", time.perf_counter() - t0, e)
        raise HTTPException(status_code=500, detail=str(e))
