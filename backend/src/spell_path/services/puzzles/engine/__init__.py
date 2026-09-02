"""
Spell Path puzzle-building engine.

Path-first generation pipeline:
  Hamiltonian path (backbite) → milestones → walls → uniqueness validation
"""

from .engine import PuzzleEngine, build_puzzle

__all__ = ["PuzzleEngine", "build_puzzle"]
