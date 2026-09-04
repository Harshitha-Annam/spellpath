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

# Default path_complexity (0–100) when the caller omits it.
DEFAULT_PATH_COMPLEXITY: Dict[str, float] = {
    "easy": 30.0,
    "medium": 50.0,
    "hard": 70.0,
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
        "path_complexity_attempts": 24,
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
        "path_complexity_attempts": 28,
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
        "path_complexity_attempts": 32,
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


def clamp_path_complexity(value: float) -> float:
    """Clamp path complexity to the inclusive [0, 100] range."""
    return max(0.0, min(100.0, float(value)))


def resolve_path_complexity(
    difficulty: str,
    path_complexity: Optional[float],
) -> float:
    """
    Resolve the caller's path_complexity, or fall back to the difficulty default.
    """
    if path_complexity is None:
        return DEFAULT_PATH_COMPLEXITY.get(difficulty, 50.0)
    return clamp_path_complexity(path_complexity)


def path_complexity_targets(grid_size: int, path_complexity: float) -> Dict:
    """
    Map path_complexity (0–100) to Hamiltonian path shape targets.

    Low complexity → snake-like (few turns, long straights).
    High complexity → woven (many turns, short max straight).

    Note: a column boustrophedon has ~2*(n-1) turns (two corners per
    column switch) and max straight of n-1 steps.
    """
    t = clamp_path_complexity(path_complexity) / 100.0
    n = max(2, int(grid_size))

    turns_low = 2 * (n - 1)
    turns_high = max(turns_low + 1, int(round(n * 4.0)))
    straight_low = n - 1
    straight_high = 3

    target_turns = int(round(turns_low + t * (turns_high - turns_low)))
    max_straight = int(round(straight_low + t * (straight_high - straight_low)))
    max_straight = max(2, max_straight)
    min_turns = max(1, int(round(target_turns * 0.85)))

    # Near-zero keeps the snake almost intact; high values fully mix.
    qf_scale = 0.005 + (t ** 1.4) * 1.8

    return {
        "path_complexity": clamp_path_complexity(path_complexity),
        "target_turns": target_turns,
        "min_turns": min_turns,
        "max_straight": max_straight,
        "qf_scale": qf_scale,
    }
