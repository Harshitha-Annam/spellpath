"""Difficulty presets, grid sizes, and word bank."""

from __future__ import annotations

import random
from typing import Dict, Optional, Tuple

ALLOWED_SIZES = (5, 7, 9)

DIFFICULTY_TO_SIZE: Dict[str, int] = {
    "easy": 5,
    "medium": 7,
    "hard": 9,
}

SIZE_PRESETS: Dict[int, Dict] = {
    5: {
        "difficulty": "easy",
        "target_diff": 20,
        "qf": 1.0,
        "iterations": 40,
        "node_budget": 8000,
        "validate_budget": 40000,
        "max_fixes": 0,
        "word_lengths": (4, 5, 6),
        "wall_count_min": 0,
        "wall_count_max": 0,
        "trust_forced_during_refine": False,
        "skip_validate_if_forced": True,
    },
    7: {
        "difficulty": "medium",
        "target_diff": 45,
        "qf": 0.7,
        "iterations": 40,
        "node_budget": 6000,
        "validate_budget": 30000,
        "max_fixes": 0,
        "word_lengths": (5, 6, 7, 8),
        "wall_count_min": 4,
        "wall_count_max": 5,
        "trust_forced_during_refine": True,
        "skip_validate_if_forced": True,
    },
    9: {
        "difficulty": "hard",
        "target_diff": 60,
        "qf": 0.35,
        "iterations": 30,
        "node_budget": 3000,
        "validate_budget": 20000,
        "max_fixes": 0,
        "word_lengths": (7, 8, 9, 10),
        "wall_count_min": 6,
        "wall_count_max": 8,
        "trust_forced_during_refine": True,
        "skip_validate_if_forced": True,
    },
}

WORD_BANK: Dict[int, list] = {
    3: ["CAT", "DOG", "ZIP", "MAP", "SUN", "RUN", "FOX", "BOX", "KEY", "TOY"],
    4: ["WORD", "GAME", "MAZE", "PATH", "GOLD", "STAR", "BLUE", "FIRE", "WIND", "LAND"],
    5: ["BOARD", "LIGHT", "WATER", "EARTH", "TRAIL", "SHARK", "CROWN", "CLOCK", "STONE", "SPACE"],
    6: ["PUZZLE", "MATRIX", "FOREST", "CASTLE", "SHADOW", "BRIDGE", "STREAM", "KNIGHT", "WIZARD", "DRAGON"],
    7: ["JOURNEY", "MYSTERY", "PHANTOM", "THUNDER", "CRYSTAL", "COMPASS", "MONSTER", "LANTERN", "VICTORY", "HARVEST"],
    8: ["MOUNTAIN", "TREASURE", "VOLCANO", "FRONTIER", "PYRAMID", "UNIVERSE", "FORTRESS", "SPARKLE", "WINDMILL", "CAROUSEL"],
    9: ["ADVENTURE", "LIGHTNING", "WONDERLAND", "LABYRINTH", "STARLIGHT", "MOONLIGHT", "FIRELIGHT", "WHIRLPOOL", "DAYBREAK", "NIGHTFALL"],
    10: ["SPELLBOUND", "STORMCLOUD", "MASTERMIND", "CROSSROADS", "AFTERGLOW", "PATHFINDER", "BRIGHTNESS", "SNOWFLAKE", "WATERFALL", "CANDLELIGHT"],
}


def get_random_word(length: int) -> str:
    words = WORD_BANK.get(length)
    if words:
        return random.choice(words)
    available = sorted(WORD_BANK.keys())
    closest = min(available, key=lambda length_key: abs(length_key - length))
    return random.choice(WORD_BANK[closest])


def resolve_grid_size(
    difficulty: str,
    grid_size: Optional[int],
) -> Tuple[int, str, Dict]:
    """Resolve to one of ALLOWED_SIZES (5, 7, 9)."""
    if grid_size is not None:
        if grid_size not in ALLOWED_SIZES:
            raise ValueError(f"grid_size must be one of {ALLOWED_SIZES} (got {grid_size})")
        size = grid_size
        difficulty = next(
            (d for d, s in DIFFICULTY_TO_SIZE.items() if s == size),
            difficulty if difficulty in DIFFICULTY_TO_SIZE else "medium",
        )
    else:
        if difficulty not in DIFFICULTY_TO_SIZE:
            difficulty = "medium"
        size = DIFFICULTY_TO_SIZE[difficulty]

    return size, difficulty, SIZE_PRESETS[size]
