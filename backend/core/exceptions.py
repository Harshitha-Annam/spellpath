"""Domain and application exceptions mapped to HTTP status codes."""


class AppError(Exception):
    status_code: int = 500

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class BadRequestError(AppError):
    status_code = 400


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class UpstreamError(AppError):
    status_code = 502


class InternalServerError(AppError):
    status_code = 500


class PlayerNotFound(NotFoundError):
    def __init__(self, message: str = "Player not found"):
        super().__init__(message)


class DuelNotFound(NotFoundError):
    def __init__(self, message: str = "Spellpath combat not found"):
        super().__init__(message)


class AttemptNotFound(NotFoundError):
    def __init__(self, message: str = "Attempt not found"):
        super().__init__(message)


class DuelPuzzleNotFound(NotFoundError):
    def __init__(self, message: str = "Puzzle not found for this spellpath combat"):
        super().__init__(message)


class RevealedPuzzlesNotFound(NotFoundError):
    def __init__(self, message: str = "Puzzles not found"):
        super().__init__(message)


class LiveDuelNotFound(NotFoundError):
    def __init__(self, message: str = "Duel not found"):
        super().__init__(message)


class DuelPreparing(ConflictError):
    def __init__(self, prepared_count: int, puzzle_count: int):
        super().__init__(f"Still preparing puzzles ({prepared_count}/{puzzle_count})")


class AttemptNotCompleted(ConflictError):
    def __init__(
        self,
        message: str = "Finish all six puzzles (solve or skip) before solutions are revealed",
    ):
        super().__init__(message)


class ForfeitConflict(ConflictError):
    def __init__(self, message: str = "Could not forfeit duel"):
        super().__init__(message)


class DuelPackFailed(UpstreamError):
    def __init__(self, message: str = "Spellpath combat pack failed"):
        super().__init__(message)
