from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from spell_path.services.puzzles.get_puzzle import DEFAULT_GET_PUZZLE_MODEL


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
