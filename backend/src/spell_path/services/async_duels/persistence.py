"""Public projections and persistence helpers for async duels."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from spell_path.repositories import async_duels as repo
from spell_path.schemas.async_duels import AttemptRecord, PuzzleSlotRecord


def to_public_player(player: Dict[str, Any]) -> Dict[str, Any]:
    return dict(player)


def to_public_duel(duel: Dict[str, Any]) -> Dict[str, Any]:
    champion_payload = None
    champ_id = duel.get("champion_attempt_id")
    if champ_id:
        attempt = repo.fetch_attempt(champ_id)
        if attempt:
            player = repo.fetch_player(attempt["player_id"]) or {}
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

    creator = repo.fetch_player(duel["creator_id"]) or {}
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
        "attempt_count": repo.count_completed_attempts_for_duel(duel["id"]),
    }


def to_public_attempt(attempt: Dict[str, Any]) -> Dict[str, Any]:
    player = repo.fetch_player(attempt["player_id"]) or {}
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


def fetch_public_duel(id_or_code: str) -> Optional[Dict[str, Any]]:
    duel_id = repo.fetch_duel_id(id_or_code)
    if not duel_id:
        return None
    duel = repo.fetch_duel_by_id(duel_id)
    if not duel:
        return None
    return to_public_duel(duel)


def fetch_duel_puzzles(id_or_code: str, *, include_solutions: bool = False) -> Optional[List[Dict[str, Any]]]:
    duel_id = repo.fetch_duel_id(id_or_code)
    if not duel_id:
        return None
    duel = repo.fetch_duel_by_id(duel_id)
    if not duel or duel["status"] != "ready":
        return None
    puzzles = []
    for puzzle in duel["puzzles"]:
        item = dict(puzzle)
        if not include_solutions:
            item.pop("solution_path", None)
        puzzles.append(item)
    return puzzles


def fetch_raw_puzzle(duel_id: str, index: int) -> Optional[Dict[str, Any]]:
    duel = repo.fetch_duel_by_id(duel_id)
    if not duel or duel["status"] != "ready":
        return None
    if index < 0 or index >= len(duel["puzzles"]):
        return None
    return dict(duel["puzzles"][index])


def build_puzzle_slots(duel: Dict[str, Any]) -> List[PuzzleSlotRecord]:
    return [
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


def maybe_crown_champion(attempt: AttemptRecord) -> AttemptRecord:
    duel = repo.fetch_duel_by_id(attempt["duel_id"])
    if not duel:
        return attempt

    previous_id = duel.get("champion_attempt_id")
    previous = repo.fetch_attempt(previous_id) if previous_id else None

    is_better = previous is None
    if previous is not None:
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

    attempt["became_champion"] = is_better
    if is_better:
        repo.update_duel(duel["id"], champion_attempt_id=attempt["id"])

    repo.update_attempt(
        attempt["id"],
        beat_champion=attempt["beat_champion"],
        became_champion=attempt["became_champion"],
    )
    return repo.fetch_attempt(attempt["id"]) or attempt


def build_leaderboard(duel_id: str, around_attempt_id: Optional[str] = None) -> Dict[str, Any]:
    ranked = [
        to_public_attempt(attempt)
        for attempt in repo.list_attempts_for_duel(duel_id, status="completed")
    ]
    ranked.sort(
        key=lambda attempt: (
            -float(attempt["total_score"]),
            int(attempt["total_time_ms"]),
            attempt["completed_at"] or 0,
        )
    )

    entries = []
    for rank, attempt in enumerate(ranked, start=1):
        player = repo.fetch_player(attempt["player_id"]) or {
            "id": attempt["player_id"],
            "name": "Unknown",
        }
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
        for index, entry in enumerate(entries):
            if entry["attempt_id"] == around_attempt_id:
                your_rank = entry["rank"]
                start = max(0, index - 2)
                end = min(len(entries), index + 3)
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


def fetch_revealed_puzzles(attempt_id: str) -> Optional[List[Dict[str, Any]]]:
    attempt = repo.fetch_attempt(attempt_id)
    if not attempt or attempt["status"] != "completed":
        return None
    duel = repo.fetch_duel_by_id(attempt["duel_id"])
    if not duel or duel["status"] != "ready":
        return None
    return [dict(puzzle) for puzzle in duel["puzzles"]]
