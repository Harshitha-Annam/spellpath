import logging
from typing import Optional

from core.exceptions import BadRequestError, InternalServerError, UpstreamError
from spell_path.services.puzzles.engine import build_puzzle as build_engine_puzzle
from spell_path.services.puzzles.get_puzzle import get_puzzle
from spell_path.services.puzzles.puzzle_logic import create_puzzle_flow
from spell_path.services.puzzles.scoring import score_puzzle
from utils.timing import timed_operation
from spell_path.validators.puzzles import GetPuzzleBody, ScorePuzzleBody

logger = logging.getLogger("services.puzzles")


def run_get_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    with timed_operation(
        logger,
        "/get-puzzle",
        difficulty=difficulty,
        grid_size=grid_size,
        word=word,
        model_name=model_name,
    ) as log_ok:
        try:
            puzzle = get_puzzle(
                difficulty=difficulty,
                grid_size=grid_size,
                word=word,
                model_name=model_name,
            )
        except ValueError as exc:
            raise UpstreamError(str(exc)) from exc
        except RuntimeError as exc:
            raise UpstreamError(str(exc)) from exc
        except Exception as exc:
            raise InternalServerError(str(exc)) from exc

        log_ok(f"keys={list(puzzle.keys()) if isinstance(puzzle, dict) else type(puzzle)}")
        return puzzle


def create_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    with timed_operation(
        logger,
        "/create-puzzle",
        difficulty=difficulty,
        grid_size=grid_size,
        word=word,
        model_name=model_name,
    ) as log_ok:
        try:
            puzzle = create_puzzle_flow(
                difficulty=difficulty,
                grid_size=grid_size,
                word=word,
                model_name=model_name,
            )
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        except Exception as exc:
            raise InternalServerError(str(exc)) from exc

        log_ok(
            f"id={puzzle.get('id')} word={puzzle.get('word')} "
            f"grid={puzzle.get('grid_size')} walls={len(puzzle.get('walls') or [])}"
        )
        return puzzle


def get_puzzle_from_body(body: GetPuzzleBody):
    return run_get_puzzle(body.difficulty, body.grid_size, body.word, body.model_name)


def build_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
):
    with timed_operation(
        logger,
        "/build-puzzle",
        difficulty=difficulty,
        grid_size=grid_size,
        word=word,
    ) as log_ok:
        try:
            puzzle = build_engine_puzzle(
                difficulty=difficulty,
                grid_size=grid_size,
                word=word,
            )
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        except RuntimeError as exc:
            raise UpstreamError(str(exc)) from exc
        except Exception as exc:
            raise InternalServerError(str(exc)) from exc

        log_ok(
            f"id={puzzle.get('id')} word={puzzle.get('word')} "
            f"grid={puzzle.get('grid_size')} walls={len(puzzle.get('walls') or [])}"
        )
        return puzzle


def generate_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    with timed_operation(
        logger,
        "/generate-puzzle",
        difficulty=difficulty,
        grid_size=grid_size,
        word=word,
        model_name=model_name,
    ) as log_ok:
        try:
            puzzle = create_puzzle_flow(
                difficulty=difficulty,
                grid_size=grid_size,
                word=word,
                model_name=model_name,
            )
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        except Exception as exc:
            raise InternalServerError(str(exc)) from exc

        log_ok(
            f"id={puzzle.get('id')} word={puzzle.get('word')} "
            f"grid={puzzle.get('grid_size')} walls={len(puzzle.get('walls') or [])}"
        )
        return puzzle


def score_puzzle_submission(body: ScorePuzzleBody):
    with timed_operation(
        logger,
        "/score-puzzle",
        difficulty=body.difficulty,
        grid_size=body.grid_size,
        path_len=len(body.path or []),
        misses=body.misses,
        backtracks=body.backtracks,
    ) as log_ok:
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
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        except Exception as exc:
            raise InternalServerError(str(exc)) from exc

        log_ok(f"solved={result.get('solved')} score={result.get('score')} reason={result.get('reason')}")
        return result
