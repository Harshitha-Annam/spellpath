"""Evenly-spaced milestone placement along the solution path."""

from __future__ import annotations

from typing import Dict, List, Tuple

from .grid import sanitize_word

Cell = Tuple[int, int]
Milestone = Dict


class MilestonePlacer:
    """Places word letters as numbered milestones along a Hamiltonian path."""

    @staticmethod
    def place(path: List[Cell], word: str) -> List[Milestone]:
        """
        Pin first letter to path start and last letter to path end;
        space remaining letters evenly between.
        """
        word = sanitize_word(word)
        length = len(word)
        path_len = len(path)
        if length == 0 or length > path_len:
            raise ValueError(f"Word length {length} must be between 1 and path length {path_len}")

        milestones: List[Milestone] = []
        for index in range(length):
            path_index = 0 if length == 1 else round(index * (path_len - 1) / (length - 1))
            milestones.append({
                "index": index,
                "character": word[index],
                "cell": [path[path_index][0], path[path_index][1]],
                "path_index": path_index,
            })
        return milestones
