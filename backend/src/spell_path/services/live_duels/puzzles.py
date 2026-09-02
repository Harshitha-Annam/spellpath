"""Live duel puzzle generation — reuses the same engine as GET /build-puzzle."""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, Dict, Iterable, Set

from spell_path.services.puzzles.engine import build_puzzle
from spell_path.services.puzzles.engine.config import DIFFICULTY_TO_SIZE, SIZE_PRESETS, WORD_BANK

logger = logging.getLogger("live_duels.puzzles")

def difficulty_for_index(index: int) -> str:
    """Ramp difficulty during a 2-minute duel: easy → medium → hard."""
    if index < 3:
        return "easy"
    if index < 6:
        return "medium"
    return "hard"


def _normalize_word(word: str) -> str:
    return word.strip().upper()


def pick_unique_word(difficulty: str, exclude: Set[str]) -> str:
    """Pick a word from the engine word bank that has not been used in this duel."""
    size = DIFFICULTY_TO_SIZE.get(difficulty, 7)
    preset = SIZE_PRESETS.get(size, SIZE_PRESETS[7])
    lengths: Iterable[int] = preset.get("word_lengths", (5, 6, 7))

    candidates: list[str] = []
    for length in lengths:
        for word in WORD_BANK.get(length, []):
            normalized = _normalize_word(word)
            if normalized not in exclude:
                candidates.append(word)

    if not candidates:
        for words in WORD_BANK.values():
            for word in words:
                normalized = _normalize_word(word)
                if normalized not in exclude:
                    candidates.append(word)

    if not candidates:
        raise RuntimeError("No unused words available for live duel puzzle generation")

    return random.choice(candidates)


def build_live_duel_puzzle(index: int, exclude_words: Set[str]) -> Dict[str, Any]:
    """
    Build one puzzle using the same procedural engine as /build-puzzle.
    Ensures the target word has not appeared earlier in this duel set.
    """
    difficulty = difficulty_for_index(index)
    word = pick_unique_word(difficulty, exclude_words)
    puzzle = build_puzzle(difficulty=difficulty, word=word)
    puzzle["difficulty"] = puzzle.get("difficulty") or difficulty
    return puzzle


def public_puzzle(puzzle: Dict[str, Any]) -> Dict[str, Any]:
    """Strip solution data and target word before sending to clients."""
    return {
        "id": puzzle.get("id"),
        "difficulty": puzzle.get("difficulty"),
        "grid_size": puzzle["grid_size"],
        "start_cell": puzzle.get("start_cell"),
        "end_cell": puzzle.get("end_cell"),
        "milestones": puzzle.get("milestones") or [],
        "walls": puzzle.get("walls") or [],
    }


async def ensure_puzzle_at_index(duel: Any, index: int) -> Dict[str, Any]:
    """
    Lazily generate puzzles in the shared sequence as players advance.
    Both players always read puzzle_sequence[index] — same puzzle, independent progress.
    """
    async with duel.generation_lock:
        while len(duel.puzzle_sequence) <= index:
            next_index = len(duel.puzzle_sequence)
            try:
                puzzle = await asyncio.to_thread(
                    build_live_duel_puzzle,
                    next_index,
                    duel.used_words,
                )
            except Exception as exc:
                logger.exception(
                    "Failed to build live duel puzzle index=%s duel=%s: %s",
                    next_index,
                    duel.id,
                    exc,
                )
                raise
            word_key = _normalize_word(str(puzzle.get("word") or ""))
            if word_key:
                duel.used_words.add(word_key)
            duel.puzzle_sequence.append(puzzle)
            logger.info(
                "Live duel %s generated puzzle %s (%s, word=%s)",
                duel.id,
                next_index,
                puzzle.get("difficulty"),
                puzzle.get("word"),
            )
        return duel.puzzle_sequence[index]


def schedule_prefetch(duel: Any, from_index: int) -> None:
    """Generate the next puzzle in the background while players solve the current one."""

    async def _prefetch() -> None:
        target = from_index + 1
        try:
            await ensure_puzzle_at_index(duel, target)
        except Exception:
            logger.exception(
                "Prefetch failed for duel=%s index=%s",
                duel.id,
                target,
            )

    asyncio.create_task(_prefetch())
