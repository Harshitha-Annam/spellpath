"""Puzzle business logic: generation, LLM flows, and scoring."""

from .engine import PuzzleEngine, build_puzzle
from .get_puzzle import DEFAULT_GET_PUZZLE_MODEL, get_puzzle
from .puzzle_logic import DEFAULT_DEEPSEEK_MODEL, create_puzzle_flow
from .scoring import score_puzzle
from .service import (
    build_puzzle as build_puzzle_endpoint,
    create_puzzle,
    generate_puzzle,
    get_puzzle_from_body,
    run_get_puzzle,
    score_puzzle_submission,
)

__all__ = [
    "DEFAULT_DEEPSEEK_MODEL",
    "DEFAULT_GET_PUZZLE_MODEL",
    "PuzzleEngine",
    "build_puzzle",
    "build_puzzle_endpoint",
    "create_puzzle",
    "create_puzzle_flow",
    "generate_puzzle",
    "get_puzzle",
    "get_puzzle_from_body",
    "run_get_puzzle",
    "score_puzzle",
    "score_puzzle_submission",
]
