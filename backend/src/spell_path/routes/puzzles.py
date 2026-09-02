from typing import Optional

from fastapi import APIRouter, Query

from spell_path.controllers import puzzles as puzzle_controller
from spell_path.services.puzzles.get_puzzle import DEFAULT_GET_PUZZLE_MODEL
from spell_path.services.puzzles.puzzle_logic import DEFAULT_DEEPSEEK_MODEL
from spell_path.validators.puzzles import GetPuzzleBody, ScorePuzzleBody

router = APIRouter(tags=["puzzles"])


@router.get("/create-puzzle")
def create_puzzle(
    difficulty: str = Query("medium", description="Difficulty level: easy, medium, hard, very_hard"),
    grid_size: Optional[int] = Query(None, ge=5, le=9, description="Size of the grid (5, 7, or 9)"),
    word: Optional[str] = Query(None, description="The target word for milestones"),
    model_name: str = Query(DEFAULT_DEEPSEEK_MODEL, description="DeepSeek model name to use"),
):
    return puzzle_controller.create_puzzle(difficulty, grid_size, word, model_name)


@router.get("/get-puzzle")
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
    return puzzle_controller.run_get_puzzle(difficulty, grid_size, word, model_name)


@router.post("/get-puzzle")
def get_puzzle_post(body: GetPuzzleBody):
    """
    Same as GET, but accepts a JSON body, e.g.:
    {"difficulty": "medium"}
    """
    return puzzle_controller.get_puzzle_from_body(body)


@router.get("/build-puzzle")
def build_puzzle_endpoint(
    difficulty: str = Query("medium", description="Difficulty level: easy, medium, hard"),
    grid_size: Optional[int] = Query(None, ge=5, le=9, description="Size of the grid (5, 7, or 9)"),
    word: Optional[str] = Query(None, description="Optional target word for milestones"),
):
    """
    Procedural puzzle builder (no LLM).
    Uses backbite Hamiltonian paths, milestone placement, and iterative wall validation.
    """
    return puzzle_controller.build_puzzle(difficulty, grid_size, word)


@router.get("/generate-puzzle")
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
    return puzzle_controller.generate_puzzle(difficulty, grid_size, word, model_name)


@router.post("/score-puzzle")
def score_puzzle_endpoint(body: ScorePuzzleBody):
    """
    Score a submitted trace. Points are awarded only for a successful solve:
    visit every cell once, milestones in order, start on the first milestone,
    end on the last milestone. Penalties: -0.1 per backtrack, -0.25 per miss.
    The score is not clamped and may be negative.
    """
    return puzzle_controller.score_puzzle_submission(body)
