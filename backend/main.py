import logging
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from puzzle_logic import create_puzzle_flow, DEFAULT_DEEPSEEK_MODEL
from get_puzzle import get_puzzle, DEFAULT_GET_PUZZLE_MODEL
from scoring import score_puzzle
from duel_store import store as duel_store
from duels import prepare_duel_pack, score_duel_submission

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


class ScorePuzzleBody(BaseModel):
    difficulty: Optional[str] = Field(None, description="easy | medium | hard | very_hard")
    grid_size: int = Field(..., ge=1, le=9)
    milestones: List[Dict[str, Any]]
    walls: List[Dict[str, Any]] = Field(default_factory=list)
    path: List[Any]
    misses: int = Field(0, ge=0)
    backtracks: int = Field(0, ge=0)


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


@app.post("/score-puzzle")
def score_puzzle_endpoint(body: ScorePuzzleBody):
    """
    Score a submitted trace. Points are awarded only for a successful solve:
    visit every cell once, milestones in order, start on the first milestone,
    end on the last milestone. Penalties: -0.1 per backtrack, -0.25 per miss.
    The score is not clamped and may be negative.
    """
    t0 = time.perf_counter()
    logger.info(
        "/score-puzzle request difficulty=%r grid_size=%s path_len=%s misses=%s backtracks=%s",
        body.difficulty,
        body.grid_size,
        len(body.path or []),
        body.misses,
        body.backtracks,
    )
    try:
        result = score_puzzle(
            difficulty=body.difficulty,
            grid_size=body.grid_size,
            milestones=body.milestones,
            walls=body.walls,
            path=body.path,
            misses=body.misses,
            backtracks=body.backtracks,
        )
        logger.info(
            "/score-puzzle solved=%s score=%s reason=%s (%.2fs)",
            result.get("solved"),
            result.get("score"),
            result.get("reason"),
            time.perf_counter() - t0,
        )
        return result
    except ValueError as ve:
        logger.warning("/score-puzzle ValueError after %.2fs: %s", time.perf_counter() - t0, ve)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("/score-puzzle failed after %.2fs: %s", time.perf_counter() - t0, e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Async duels (shared 6-puzzle gauntlet, in-memory store)
# ---------------------------------------------------------------------------


class CreatePlayerBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=24)


class CreateDuelBody(BaseModel):
    player_id: str


class StartAttemptBody(BaseModel):
    player_id: str


class SubmitDuelPuzzleBody(BaseModel):
    path: List[Any] = Field(default_factory=list)
    misses: int = Field(0, ge=0)
    backtracks: int = Field(0, ge=0)
    time_ms: int = Field(..., ge=0)
    skipped: bool = False


@app.post("/players")
def create_player(body: CreatePlayerBody):
    try:
        return duel_store.create_player(body.name)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.get("/players/{player_id}")
def get_player(player_id: str):
    player = duel_store.get_player(player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@app.post("/duels")
def create_duel(body: CreateDuelBody):
    try:
        duel = duel_store.create_duel(body.player_id)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    prepare_duel_pack(duel["id"])
    return duel


@app.get("/duels/{id_or_code}")
def get_duel(id_or_code: str):
    duel = duel_store.get_duel(id_or_code)
    if not duel:
        raise HTTPException(status_code=404, detail="Duel not found")
    return duel


@app.get("/duels/{id_or_code}/puzzles")
def get_duel_puzzles(id_or_code: str):
    duel = duel_store.get_duel(id_or_code)
    if not duel:
        raise HTTPException(status_code=404, detail="Duel not found")
    if duel["status"] == "preparing":
        raise HTTPException(
            status_code=409,
            detail=f"Still preparing puzzles ({duel['prepared_count']}/{duel['puzzle_count']})",
        )
    if duel["status"] == "failed":
        raise HTTPException(status_code=502, detail=duel.get("error") or "Duel pack failed")
    puzzles = duel_store.get_duel_puzzles(id_or_code, include_solutions=False)
    return {"duel_id": duel["id"], "code": duel["code"], "puzzles": puzzles}


@app.get("/duels/{id_or_code}/leaderboard")
def get_duel_leaderboard(
    id_or_code: str,
    attempt_id: Optional[str] = Query(None, description="Center neighborhood on this attempt"),
):
    duel = duel_store.get_duel(id_or_code)
    if not duel:
        raise HTTPException(status_code=404, detail="Duel not found")
    board = duel_store.leaderboard(duel["id"], around_attempt_id=attempt_id)
    return {"duel": duel, **board}


@app.post("/duels/{id_or_code}/attempts")
def start_duel_attempt(id_or_code: str, body: StartAttemptBody):
    duel = duel_store.get_duel(id_or_code)
    if not duel:
        raise HTTPException(status_code=404, detail="Duel not found")
    try:
        return duel_store.start_attempt(duel["id"], body.player_id)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str):
    attempt = duel_store.get_attempt(attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    return attempt


@app.get("/attempts/{attempt_id}/revealed-puzzles")
def get_revealed_puzzles(attempt_id: str):
    """Solutions are only revealed after the attempt is fully submitted."""
    attempt = duel_store.get_attempt(attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt["status"] != "completed":
        raise HTTPException(
            status_code=409,
            detail="Finish all six puzzles (solve or skip) before solutions are revealed",
        )
    puzzles = duel_store.get_revealed_puzzles(attempt_id)
    if puzzles is None:
        raise HTTPException(status_code=404, detail="Puzzles not found")
    return {"attempt_id": attempt_id, "puzzles": puzzles}


@app.post("/attempts/{attempt_id}/puzzles/{puzzle_index}/submit")
def submit_duel_puzzle(attempt_id: str, puzzle_index: int, body: SubmitDuelPuzzleBody):
    attempt = duel_store.get_attempt(attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")

    puzzle = duel_store.get_raw_puzzle(attempt["duel_id"], puzzle_index)
    if not puzzle:
        raise HTTPException(status_code=404, detail="Puzzle not found for this duel")

    try:
        if body.skipped:
            score_result = {
                "solved": False,
                "reason": "skipped",
                "score": None,
                "base_points": 0,
                "misses": body.misses,
                "backtracks": body.backtracks,
                "miss_penalty": 0.0,
                "backtrack_penalty": 0.0,
            }
            updated = duel_store.submit_puzzle_result(
                attempt_id,
                puzzle_index,
                score=0.0,
                time_ms=body.time_ms,
                misses=body.misses,
                backtracks=body.backtracks,
                solved=False,
                skipped=True,
            )
        else:
            score_result = score_duel_submission(
                puzzle=puzzle,
                path=body.path,
                misses=body.misses,
                backtracks=body.backtracks,
            )
            awarded = score_result.get("score")
            updated = duel_store.submit_puzzle_result(
                attempt_id,
                puzzle_index,
                score=float(awarded) if isinstance(awarded, (int, float)) else 0.0,
                time_ms=body.time_ms,
                misses=body.misses,
                backtracks=body.backtracks,
                solved=bool(score_result.get("solved")),
                skipped=False,
            )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    duel = duel_store.get_duel(updated["duel_id"])
    board = None
    revealed = None
    if updated["status"] == "completed":
        board = duel_store.leaderboard(updated["duel_id"], around_attempt_id=updated["id"])
        revealed = duel_store.get_revealed_puzzles(updated["id"])

    return {
        "score_result": score_result,
        "attempt": updated,
        "duel": duel,
        "leaderboard": board,
        "revealed_puzzles": revealed,
    }
