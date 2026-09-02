"""DFS uniqueness solvers with flood-fill pruning."""

from __future__ import annotations

from typing import Dict, List, Optional, Set, Tuple

from .grid import Cell, EdgeKey, cell_key, open_neighbors

Milestone = Dict


class UniquenessSolver:
    """Exhaustive DFS to count/verify Hamiltonian path uniqueness."""

    def __init__(self, rows: int, cols: int, node_budget: int):
        self.rows = rows
        self.cols = cols
        self.node_budget = node_budget

    def solve(
        self,
        path: List[Cell],
        wall_set: Set[EdgeKey],
        return_alt: bool = False,
    ) -> Dict:
        """Check whether exactly one Hamiltonian path exists (fixed start/end)."""
        length = len(path)
        start = path[0]
        end = path[-1]
        start_key = cell_key(*start)
        intended_keys = [cell_key(r, c) for r, c in path]

        visited: Set[str] = set()
        order: List[str] = []
        nodes = 0
        found_other = False
        alt_order: Optional[List[str]] = None
        budget_hit = False

        def flood_reaches(from_row: int, from_col: int, must_cover: List[str]) -> bool:
            seen = {cell_key(from_row, from_col)}
            stack = [(from_row, from_col)]
            while stack:
                cr, cc = stack.pop()
                for nr, nc in open_neighbors(cr, cc, self.rows, self.cols, wall_set):
                    k = cell_key(nr, nc)
                    if k in seen:
                        continue
                    if k in visited and not (nr == end[0] and nc == end[1]):
                        continue
                    seen.add(k)
                    stack.append((nr, nc))
            return all(k in seen for k in must_cover)

        def step(row: int, col: int, count: int) -> None:
            nonlocal nodes, found_other, alt_order, budget_hit
            if found_other or budget_hit:
                return
            nodes += 1
            if nodes > self.node_budget:
                budget_hit = True
                return
            if count == length:
                if row == end[0] and col == end[1]:
                    if order != intended_keys:
                        found_other = True
                        if return_alt:
                            alt_order = list(order)
                return

            remaining = [
                cell_key(gr, gc)
                for gr in range(self.rows)
                for gc in range(self.cols)
                if cell_key(gr, gc) not in visited
            ]
            if remaining and not flood_reaches(row, col, remaining):
                return

            neighbors = [
                (nr, nc)
                for nr, nc in open_neighbors(row, col, self.rows, self.cols, wall_set)
                if cell_key(nr, nc) not in visited
            ]
            neighbors_scored = []
            for nr, nc in neighbors:
                degree = sum(
                    1
                    for x2, y2 in open_neighbors(nr, nc, self.rows, self.cols, wall_set)
                    if cell_key(x2, y2) not in visited
                )
                neighbors_scored.append(((nr, nc), degree))
            neighbors_scored.sort(key=lambda item: item[1])

            for (nr, nc), _ in neighbors_scored:
                if found_other or budget_hit:
                    return
                nk = cell_key(nr, nc)
                visited.add(nk)
                order.append(nk)
                step(nr, nc, count + 1)
                order.pop()
                visited.remove(nk)

        visited.add(start_key)
        order.append(start_key)
        step(start[0], start[1], 1)

        result: Dict = {
            "unique": not found_other,
            "exhausted": not budget_hit,
            "nodes": nodes,
        }
        if return_alt and alt_order:
            result["alt_path"] = [tuple(map(int, k.split(","))) for k in alt_order]
        elif return_alt:
            result["alt_path"] = None
        return result

    def solve_with_milestones(
        self,
        path: List[Cell],
        wall_set: Set[EdgeKey],
        milestones: List[Milestone],
    ) -> Dict:
        """Verify uniqueness when milestones must be visited in order."""
        length = len(path)
        start = path[0]
        end = path[-1]
        start_key = cell_key(*start)
        intended_keys = [cell_key(r, c) for r, c in path]

        milestone_map: Dict[Cell, int] = {}
        for milestone in milestones:
            milestone_map[(milestone["cell"][0], milestone["cell"][1])] = milestone["index"]

        visited: Set[str] = set()
        order: List[str] = []
        nodes = 0
        found_other = False
        budget_hit = False

        def flood_reaches(from_row: int, from_col: int, must_cover: List[str]) -> bool:
            seen = {cell_key(from_row, from_col)}
            stack = [(from_row, from_col)]
            while stack:
                cr, cc = stack.pop()
                for nr, nc in open_neighbors(cr, cc, self.rows, self.cols, wall_set):
                    k = cell_key(nr, nc)
                    if k in seen:
                        continue
                    if k in visited and not (nr == end[0] and nc == end[1]):
                        continue
                    seen.add(k)
                    stack.append((nr, nc))
            return all(k in seen for k in must_cover)

        def step(row: int, col: int, count: int, next_milestone: int) -> None:
            nonlocal nodes, found_other, budget_hit
            if found_other or budget_hit:
                return
            nodes += 1
            if nodes > self.node_budget:
                budget_hit = True
                return
            if count == length:
                if row == end[0] and col == end[1] and next_milestone == len(milestones):
                    if order != intended_keys:
                        found_other = True
                return

            remaining = [
                cell_key(gr, gc)
                for gr in range(self.rows)
                for gc in range(self.cols)
                if cell_key(gr, gc) not in visited
            ]
            if remaining and not flood_reaches(row, col, remaining):
                return

            neighbors = [
                (nr, nc)
                for nr, nc in open_neighbors(row, col, self.rows, self.cols, wall_set)
                if cell_key(nr, nc) not in visited
            ]
            neighbors_scored = []
            for nr, nc in neighbors:
                cell = (nr, nc)
                if cell in milestone_map and milestone_map[cell] != next_milestone:
                    continue
                degree = sum(
                    1
                    for x2, y2 in open_neighbors(nr, nc, self.rows, self.cols, wall_set)
                    if cell_key(x2, y2) not in visited
                )
                neighbors_scored.append(((nr, nc), degree))
            neighbors_scored.sort(key=lambda item: item[1])

            for (nr, nc), _ in neighbors_scored:
                if found_other or budget_hit:
                    return
                nk = cell_key(nr, nc)
                new_next = next_milestone + 1 if (nr, nc) in milestone_map else next_milestone
                visited.add(nk)
                order.append(nk)
                step(nr, nc, count + 1, new_next)
                order.pop()
                visited.remove(nk)

        visited.add(start_key)
        order.append(start_key)
        step(start[0], start[1], 1, 1)

        return {
            "unique": not found_other,
            "exhausted": not budget_hit,
            "nodes": nodes,
        }


def find_divergence_edge(intended: List[Cell], alt: List[Cell]) -> Optional[str]:
    from .grid import edge_key

    length = min(len(intended), len(alt))
    for index in range(1, length):
        if intended[index] != alt[index]:
            ar, ac = alt[index - 1]
            br, bc = alt[index]
            return edge_key(ar, ac, br, bc)
    return None
