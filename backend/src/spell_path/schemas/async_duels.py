"""Typed record shapes for the async duel in-memory database."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict

AsyncDuelStatus = Literal["preparing", "ready", "failed"]
AttemptStatus = Literal["in_progress", "completed"]


class PlayerRecord(TypedDict):
    id: str
    name: str
    created_at: float


class PuzzleSlotRecord(TypedDict, total=False):
    index: int
    difficulty: str
    puzzle_id: str
    solved: bool
    skipped: bool
    score: Optional[float]
    time_ms: Optional[int]
    misses: Optional[int]
    backtracks: Optional[int]
    submitted_at: Optional[float]


class AttemptRecord(TypedDict):
    id: str
    duel_id: str
    player_id: str
    status: AttemptStatus
    current_index: int
    puzzle_results: List[PuzzleSlotRecord]
    total_score: float
    total_time_ms: int
    started_at: float
    completed_at: Optional[float]
    beat_champion: bool
    became_champion: bool


class AsyncDuelRecord(TypedDict):
    id: str
    code: str
    creator_id: str
    status: AsyncDuelStatus
    puzzles: List[Dict[str, Any]]
    puzzle_count: int
    prepared_count: int
    error: Optional[str]
    champion_attempt_id: Optional[str]
    created_at: float
    ready_at: Optional[float]
