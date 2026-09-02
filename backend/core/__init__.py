"""Application core: exceptions and global handlers."""

from .exception_handlers import register_exception_handlers
from .exceptions import (
    AppError,
    AttemptNotCompleted,
    AttemptNotFound,
    BadRequestError,
    ConflictError,
    DuelNotFound,
    DuelPackFailed,
    DuelPreparing,
    DuelPuzzleNotFound,
    ForfeitConflict,
    InternalServerError,
    LiveDuelNotFound,
    NotFoundError,
    PlayerNotFound,
    RevealedPuzzlesNotFound,
    UpstreamError,
)

__all__ = [
    "AppError",
    "AttemptNotCompleted",
    "AttemptNotFound",
    "BadRequestError",
    "ConflictError",
    "DuelNotFound",
    "DuelPackFailed",
    "DuelPreparing",
    "DuelPuzzleNotFound",
    "ForfeitConflict",
    "InternalServerError",
    "LiveDuelNotFound",
    "NotFoundError",
    "PlayerNotFound",
    "RevealedPuzzlesNotFound",
    "UpstreamError",
    "register_exception_handlers",
]
