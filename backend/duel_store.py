"""In-memory store for async duels, players, and attempts.

Production apps (Wordle-style async competition) use a shared board so scores
are comparable. This store keeps one fixed 6-puzzle pack per duel and ranks
attempts by total score, then total time as a tie-break.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, List, Optional


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _short_code(length: int = 6) -> str:
    # Ambiguity-safe alphabet (no 0/O, 1/I/L).
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    seed = uuid.uuid4().hex
    return "".join(alphabet[int(seed[i : i + 2], 16) % len(alphabet)] for i in range(0, length * 2, 2))


class DuelStore:
    """Thread-safe in-memory database for duel mode."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.players: Dict[str, Dict[str, Any]] = {}
        self.duels: Dict[str, Dict[str, Any]] = {}
        self.duels_by_code: Dict[str, str] = {}
        self.attempts: Dict[str, Dict[str, Any]] = {}

    # ---- players ----

    def create_player(self, name: str) -> Dict[str, Any]:
        cleaned = " ".join((name or "").strip().split())
        if not cleaned:
            raise ValueError("Name is required")
        if len(cleaned) > 24:
            raise ValueError("Name must be 24 characters or fewer")
        with self._lock:
            player = {
                "id": _new_id("player"),
                "name": cleaned,
                "created_at": time.time(),
            }
            self.players[player["id"]] = player
            return dict(player)

    def get_player(self, player_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            player = self.players.get(player_id)
            return dict(player) if player else None

    # ---- duels ----

    def create_duel(self, creator_id: str) -> Dict[str, Any]:
        with self._lock:
            if creator_id not in self.players:
                raise ValueError("Unknown player")
            code = _short_code()
            while code in self.duels_by_code:
                code = _short_code()
            duel_id = _new_id("duel")
            duel = {
                "id": duel_id,
                "code": code,
                "creator_id": creator_id,
                "status": "preparing",  # preparing | ready | failed
                "puzzles": [],
                "puzzle_count": 6,
                "prepared_count": 0,
                "error": None,
                "champion_attempt_id": None,
                "created_at": time.time(),
                "ready_at": None,
            }
            self.duels[duel_id] = duel
            self.duels_by_code[code] = duel_id
            return self._public_duel(duel)

    def set_duel_progress(self, duel_id: str, prepared_count: int) -> None:
        with self._lock:
            duel = self.duels.get(duel_id)
            if not duel:
                return
            duel["prepared_count"] = prepared_count

    def set_duel_ready(self, duel_id: str, puzzles: List[Dict[str, Any]]) -> None:
        with self._lock:
            duel = self.duels.get(duel_id)
            if not duel:
                return
            duel["puzzles"] = puzzles
            duel["prepared_count"] = len(puzzles)
            duel["status"] = "ready"
            duel["ready_at"] = time.time()
            duel["error"] = None

    def set_duel_failed(self, duel_id: str, error: str) -> None:
        with self._lock:
            duel = self.duels.get(duel_id)
            if not duel:
                return
            duel["status"] = "failed"
            duel["error"] = error

    def resolve_duel_id(self, id_or_code: str) -> Optional[str]:
        key = (id_or_code or "").strip()
        if not key:
            return None
        with self._lock:
            if key in self.duels:
                return key
            upper = key.upper()
            return self.duels_by_code.get(upper)

    def get_duel(self, id_or_code: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            duel_id = self.resolve_duel_id(id_or_code)
            if not duel_id:
                return None
            return self._public_duel(self.duels[duel_id])

    def get_duel_puzzles(self, id_or_code: str, *, include_solutions: bool = False) -> Optional[List[Dict[str, Any]]]:
        with self._lock:
            duel_id = self.resolve_duel_id(id_or_code)
            if not duel_id:
                return None
            duel = self.duels[duel_id]
            if duel["status"] != "ready":
                return None
            puzzles = []
            for puzzle in duel["puzzles"]:
                item = dict(puzzle)
                if not include_solutions:
                    item.pop("solution_path", None)
                puzzles.append(item)
            return puzzles

    def get_raw_puzzle(self, duel_id: str, index: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            duel = self.duels.get(duel_id)
            if not duel or duel["status"] != "ready":
                return None
            if index < 0 or index >= len(duel["puzzles"]):
                return None
            return dict(duel["puzzles"][index])

    # ---- attempts ----

    def start_attempt(self, duel_id: str, player_id: str) -> Dict[str, Any]:
        with self._lock:
            duel = self.duels.get(duel_id)
            if not duel:
                raise ValueError("Duel not found")
            if duel["status"] != "ready":
                raise ValueError("Duel puzzles are not ready yet")
            if player_id not in self.players:
                raise ValueError("Unknown player")

            # One active run at a time per player per duel.
            for attempt in self.attempts.values():
                if (
                    attempt["duel_id"] == duel_id
                    and attempt["player_id"] == player_id
                    and attempt["status"] == "in_progress"
                ):
                    return self._public_attempt(attempt)

            puzzle_slots = [
                {
                    "index": i,
                    "difficulty": duel["puzzles"][i]["difficulty"],
                    "puzzle_id": duel["puzzles"][i]["id"],
                    "solved": False,
                    "skipped": False,
                    "score": None,
                    "time_ms": None,
                    "misses": None,
                    "backtracks": None,
                    "submitted_at": None,
                }
                for i in range(len(duel["puzzles"]))
            ]
            attempt = {
                "id": _new_id("attempt"),
                "duel_id": duel_id,
                "player_id": player_id,
                "status": "in_progress",  # in_progress | completed
                "current_index": 0,
                "puzzle_results": puzzle_slots,
                "total_score": 0.0,
                "total_time_ms": 0,
                "started_at": time.time(),
                "completed_at": None,
                "beat_champion": False,
                "became_champion": False,
            }
            self.attempts[attempt["id"]] = attempt
            return self._public_attempt(attempt)

    def get_attempt(self, attempt_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            attempt = self.attempts.get(attempt_id)
            return self._public_attempt(attempt) if attempt else None

    def submit_puzzle_result(
        self,
        attempt_id: str,
        puzzle_index: int,
        *,
        score: float,
        time_ms: int,
        misses: int,
        backtracks: int,
        solved: bool,
        skipped: bool = False,
    ) -> Dict[str, Any]:
        with self._lock:
            attempt = self.attempts.get(attempt_id)
            if not attempt:
                raise ValueError("Attempt not found")
            if attempt["status"] != "in_progress":
                raise ValueError("Attempt is already completed")
            if puzzle_index != attempt["current_index"]:
                raise ValueError(
                    f"Expected puzzle index {attempt['current_index']}, got {puzzle_index}"
                )

            slot = attempt["puzzle_results"][puzzle_index]
            if slot["submitted_at"] is not None:
                raise ValueError("This puzzle was already submitted")

            was_skipped = bool(skipped)
            was_solved = bool(solved) and not was_skipped
            awarded = float(score) if was_solved else 0.0
            elapsed = max(0, int(time_ms))
            slot.update(
                {
                    "solved": was_solved,
                    "skipped": was_skipped,
                    "score": awarded,
                    "time_ms": elapsed,
                    "misses": max(0, int(misses)),
                    "backtracks": max(0, int(backtracks)),
                    "submitted_at": time.time(),
                }
            )
            attempt["total_score"] = round(attempt["total_score"] + awarded, 2)
            attempt["total_time_ms"] = int(attempt["total_time_ms"]) + elapsed

            duel = self.duels[attempt["duel_id"]]
            if puzzle_index + 1 >= len(duel["puzzles"]):
                attempt["status"] = "completed"
                attempt["completed_at"] = time.time()
                attempt["current_index"] = puzzle_index
                self._maybe_crown_champion(attempt)
            else:
                attempt["current_index"] = puzzle_index + 1

            return self._public_attempt(attempt)

    def get_revealed_puzzles(self, attempt_id: str) -> Optional[List[Dict[str, Any]]]:
        """Return full puzzles (with solutions) only after the attempt is finished."""
        with self._lock:
            attempt = self.attempts.get(attempt_id)
            if not attempt or attempt["status"] != "completed":
                return None
            duel = self.duels.get(attempt["duel_id"])
            if not duel or duel["status"] != "ready":
                return None
            return [dict(p) for p in duel["puzzles"]]

    def list_attempts_for_duel(self, duel_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            items = [
                self._public_attempt(a)
                for a in self.attempts.values()
                if a["duel_id"] == duel_id and a["status"] == "completed"
            ]
            items.sort(
                key=lambda a: (-float(a["total_score"]), int(a["total_time_ms"]), a["completed_at"] or 0)
            )
            return items

    def leaderboard(self, duel_id: str, around_attempt_id: Optional[str] = None) -> Dict[str, Any]:
        ranked = self.list_attempts_for_duel(duel_id)
        entries = []
        for rank, attempt in enumerate(ranked, start=1):
            player = self.get_player(attempt["player_id"]) or {"id": attempt["player_id"], "name": "Unknown"}
            entries.append(
                {
                    "rank": rank,
                    "attempt_id": attempt["id"],
                    "player_id": player["id"],
                    "player_name": player["name"],
                    "total_score": attempt["total_score"],
                    "total_time_ms": attempt["total_time_ms"],
                    "completed_at": attempt["completed_at"],
                }
            )

        champion = entries[0] if entries else None
        neighborhood: List[Dict[str, Any]] = []
        your_rank = None
        if around_attempt_id:
            for i, entry in enumerate(entries):
                if entry["attempt_id"] == around_attempt_id:
                    your_rank = entry["rank"]
                    start = max(0, i - 2)
                    end = min(len(entries), i + 3)
                    neighborhood = entries[start:end]
                    break
        if not neighborhood:
            neighborhood = entries[:5]

        return {
            "champion": champion,
            "entries": entries[:20],
            "neighborhood": neighborhood,
            "your_rank": your_rank,
            "total_attempts": len(entries),
        }

    def _maybe_crown_champion(self, attempt: Dict[str, Any]) -> None:
        duel = self.duels[attempt["duel_id"]]
        previous_id = duel.get("champion_attempt_id")
        previous = self.attempts.get(previous_id) if previous_id else None

        is_better = False
        if previous is None:
            is_better = True
        else:
            if attempt["total_score"] > previous["total_score"]:
                is_better = True
            elif (
                attempt["total_score"] == previous["total_score"]
                and attempt["total_time_ms"] < previous["total_time_ms"]
            ):
                is_better = True

        if previous is not None:
            attempt["beat_champion"] = (
                attempt["total_score"] > previous["total_score"]
                or (
                    attempt["total_score"] == previous["total_score"]
                    and attempt["total_time_ms"] < previous["total_time_ms"]
                )
            )
        else:
            attempt["beat_champion"] = True

        if is_better:
            duel["champion_attempt_id"] = attempt["id"]
            attempt["became_champion"] = True
        else:
            attempt["became_champion"] = False

    def _public_duel(self, duel: Dict[str, Any]) -> Dict[str, Any]:
        champion_payload = None
        champ_id = duel.get("champion_attempt_id")
        if champ_id and champ_id in self.attempts:
            attempt = self.attempts[champ_id]
            player = self.players.get(attempt["player_id"], {})
            champion_payload = {
                "attempt_id": attempt["id"],
                "player_id": attempt["player_id"],
                "player_name": player.get("name", "Unknown"),
                "total_score": attempt["total_score"],
                "total_time_ms": attempt["total_time_ms"],
                "puzzle_results": [
                    {
                        "index": slot["index"],
                        "difficulty": slot["difficulty"],
                        "score": slot["score"],
                        "time_ms": slot["time_ms"],
                        "solved": slot["solved"],
                        "skipped": slot.get("skipped", False),
                    }
                    for slot in attempt["puzzle_results"]
                ],
            }

        creator = self.players.get(duel["creator_id"], {})
        return {
            "id": duel["id"],
            "code": duel["code"],
            "creator_id": duel["creator_id"],
            "creator_name": creator.get("name"),
            "status": duel["status"],
            "puzzle_count": duel["puzzle_count"],
            "prepared_count": duel["prepared_count"],
            "error": duel["error"],
            "created_at": duel["created_at"],
            "ready_at": duel["ready_at"],
            "champion": champion_payload,
            "attempt_count": sum(
                1
                for a in self.attempts.values()
                if a["duel_id"] == duel["id"] and a["status"] == "completed"
            ),
        }

    def _public_attempt(self, attempt: Dict[str, Any]) -> Dict[str, Any]:
        player = self.players.get(attempt["player_id"], {})
        return {
            "id": attempt["id"],
            "duel_id": attempt["duel_id"],
            "player_id": attempt["player_id"],
            "player_name": player.get("name"),
            "status": attempt["status"],
            "current_index": attempt["current_index"],
            "puzzle_results": [dict(slot) for slot in attempt["puzzle_results"]],
            "total_score": attempt["total_score"],
            "total_time_ms": attempt["total_time_ms"],
            "started_at": attempt["started_at"],
            "completed_at": attempt["completed_at"],
            "beat_champion": attempt.get("beat_champion", False),
            "became_champion": attempt.get("became_champion", False),
        }


store = DuelStore()
