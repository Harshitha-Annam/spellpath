from typing import Any, List

from pydantic import BaseModel, Field


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
