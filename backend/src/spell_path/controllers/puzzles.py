from typing import Optional

from spell_path.services import puzzles as puzzle_service
from spell_path.validators.puzzles import GetPuzzleBody, ScorePuzzleBody


def run_get_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    return puzzle_service.run_get_puzzle(difficulty, grid_size, word, model_name)


def create_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    return puzzle_service.create_puzzle(difficulty, grid_size, word, model_name)


def get_puzzle_from_body(body: GetPuzzleBody):
    return puzzle_service.get_puzzle_from_body(body)


def build_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    path_complexity: Optional[float] = None,
):
    return puzzle_service.build_puzzle(difficulty, grid_size, word, path_complexity)


def generate_puzzle(
    difficulty: str,
    grid_size: Optional[int],
    word: Optional[str],
    model_name: str,
):
    return puzzle_service.generate_puzzle(difficulty, grid_size, word, model_name)


def score_puzzle_submission(body: ScorePuzzleBody):
    return puzzle_service.score_puzzle_submission(body)
