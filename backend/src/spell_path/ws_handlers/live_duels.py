"""WebSocket handlers for live 1v1 duels."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from spell_path.services.puzzles.scoring import score_puzzle

from spell_path.schemas.live_duels import Duel, DuelStatus, PlayerState
from spell_path.services.live_duels import manager as live_duel_manager
from spell_path.services.live_duels.manager import BOT_USER_ID, CLEANUP_INTERVAL_SEC
from spell_path.services.live_duels.puzzles import ensure_puzzle_at_index, public_puzzle, schedule_prefetch

logger = logging.getLogger("live_duels.ws")

COUNTDOWN_SEC = 3
DUEL_DURATION_SEC = 120


async def _send_json(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        logger.debug("Failed to send WS message: %s", payload.get("type"))


async def _broadcast(duel: Duel, payload: dict, exclude_user_id: Optional[str] = None) -> None:
    for uid, player in duel.players.items():
        if exclude_user_id and uid == exclude_user_id:
            continue
        if player.ws and player.connected:
            await _send_json(player.ws, payload)


async def _send_to_player(player: PlayerState, payload: dict) -> None:
    if player.ws and player.connected:
        await _send_json(player.ws, payload)


def _time_remaining(duel: Duel) -> float:
    if duel.duel_start_at is None:
        return float(DUEL_DURATION_SEC)
    elapsed = time.time() - duel.duel_start_at
    return max(0.0, duel.duration_sec - elapsed)


def _score_submission(puzzle: dict, answer: dict) -> dict:
    path = answer.get("path") or []
    misses = int(answer.get("misses") or 0)
    backtracks = int(answer.get("backtracks") or 0)
    return score_puzzle(
        difficulty=puzzle.get("difficulty"),
        grid_size=int(puzzle["grid_size"]),
        milestones=puzzle.get("milestones") or [],
        walls=puzzle.get("walls") or [],
        path=path,
        misses=misses,
        backtracks=backtracks,
    )


def _puzzle_points(score_result: dict) -> float:
    raw = score_result.get("score")
    if raw is None:
        return 0.0
    return round(float(raw), 2)


def _breakdown_payload(score_result: dict) -> dict:
    return {
        "base_points": score_result.get("base_points"),
        "misses": score_result.get("misses"),
        "backtracks": score_result.get("backtracks"),
        "miss_penalty": score_result.get("miss_penalty"),
        "backtrack_penalty": score_result.get("backtrack_penalty"),
        "score": score_result.get("score"),
    }


def _record_puzzle_result(
    player: PlayerState,
    puzzle: dict,
    puzzle_index: int,
    score_result: dict,
) -> dict:
    entry = {
        "index": puzzle_index,
        "puzzle_id": puzzle.get("id"),
        "word": puzzle.get("word"),
        "difficulty": puzzle.get("difficulty"),
        "grid_size": puzzle.get("grid_size"),
        "solved": bool(score_result.get("solved")),
        **_breakdown_payload(score_result),
    }
    player.puzzle_results.append(entry)
    return entry


def _opponent_player(duel: Duel, user_id: str) -> Optional[PlayerState]:
    for uid, player in duel.players.items():
        if uid != user_id:
            return player
    return None


async def _send_duel_info(duel: Duel, player: PlayerState) -> None:
    opponent = _opponent_player(duel, player.user_id)
    await _send_to_player(
        player,
        {
            "type": "duel_info",
            "opponent": {
                "display_name": opponent.display_name if opponent else "Opponent",
            },
        },
    )


async def _send_resync(duel: Duel, player: PlayerState) -> None:
    puzzle_payload = None
    if duel.status == DuelStatus.ACTIVE:
        if player.current_index < len(duel.puzzle_sequence):
            puzzle_payload = public_puzzle(duel.puzzle_sequence[player.current_index])
        else:
            try:
                puzzle = await ensure_puzzle_at_index(duel, player.current_index)
                puzzle_payload = public_puzzle(puzzle)
            except Exception:
                puzzle_payload = None

    opponent = next(
        (p for uid, p in duel.players.items() if uid != player.user_id),
        None,
    )
    await _send_to_player(
        player,
        {
            "type": "resync",
            "status": duel.status.value,
            "current_puzzle": puzzle_payload,
            "puzzle_index": player.current_index,
            "score": player.score,
            "time_remaining": _time_remaining(duel),
            "countdown_start_at": duel.countdown_start_at,
            "duel_start_at": duel.duel_start_at,
            "duration_sec": duel.duration_sec,
            "opponent": {
                "solved": opponent.puzzles_solved if opponent else 0,
                "score": opponent.score if opponent else 0,
                "display_name": opponent.display_name if opponent else "Opponent",
            },
        },
    )


def _is_bot(player: PlayerState) -> bool:
    return player.user_id.startswith(BOT_USER_ID)


def _human_player(duel: Duel) -> Optional[PlayerState]:
    for player in duel.players.values():
        if not _is_bot(player):
            return player
    return None


def _bot_player(duel: Duel) -> Optional[PlayerState]:
    for player in duel.players.values():
        if _is_bot(player):
            return player
    return None


def duel_end_payload(duel: Duel) -> dict:
    scores = {uid: round(p.score, 2) for uid, p in duel.players.items()}
    puzzles_solved = {uid: p.puzzles_solved for uid, p in duel.players.items()}
    player_names = {uid: p.display_name for uid, p in duel.players.items()}
    puzzle_results = {uid: list(p.puzzle_results) for uid, p in duel.players.items()}
    return {
        "type": "duel_end",
        "scores": scores,
        "winner_id": duel.winner_id,
        "puzzles_solved": puzzles_solved,
        "player_names": player_names,
        "puzzle_results": puzzle_results,
        "end_reason": duel.end_reason,
    }


async def notify_duel_end(duel: Duel) -> None:
    await _broadcast(duel, duel_end_payload(duel))


async def _emit_duel_end(duel: Duel) -> None:
    await notify_duel_end(duel)


async def _run_duel_timer(duel_id: str) -> None:
    """End the duel when duration_sec elapses after duel_start_at."""
    try:
        while True:
            duel = await live_duel_manager.get_duel(duel_id)
            if not duel or duel.ended:
                return
            if duel.status != DuelStatus.ACTIVE or duel.duel_start_at is None:
                await asyncio.sleep(0.25)
                continue
            remaining = duel.duel_start_at + duel.duration_sec - time.time()
            if remaining <= 0:
                break
            await asyncio.sleep(min(remaining, 1.0))
    except asyncio.CancelledError:
        return
    except Exception:
        logger.exception("Live duel timer error duel=%s", duel_id)

    finished = await live_duel_manager.finish_duel(duel_id)
    if finished:
        await _emit_duel_end(finished)


async def _start_countdown(duel_id: str) -> None:
    duel = await live_duel_manager.get_duel(duel_id)
    if not duel or duel.status != DuelStatus.WAITING:
        return

    if not await live_duel_manager.both_connected(duel):
        return

    countdown_start_at = time.time() + COUNTDOWN_SEC
    duel = await live_duel_manager.set_countdown(duel_id, countdown_start_at)
    if not duel:
        return

    await _broadcast(
        duel,
        {
            "type": "countdown",
            "start_at": countdown_start_at,
            "countdown_sec": COUNTDOWN_SEC,
        },
    )

    async def _after_countdown() -> None:
        await asyncio.sleep(max(0.0, countdown_start_at - time.time()))
        active_duel = await live_duel_manager.set_active(duel_id, time.time())
        if not active_duel:
            return

        try:
            await live_duel_manager.ensure_initial_puzzles(active_duel)
        except Exception:
            logger.exception("Failed to generate initial puzzle for duel %s", duel_id)
            finished = await live_duel_manager.finish_duel(duel_id)
            if finished:
                await _emit_duel_end(finished)
            return

        await _broadcast(
            active_duel,
            {
                "type": "duel_start",
                "start_at": active_duel.duel_start_at,
                "duration_sec": active_duel.duration_sec,
            },
        )

        for _uid, player in active_duel.players.items():
            if player.ws and player.connected:
                puzzle = public_puzzle(active_duel.puzzle_sequence[0])
                await _send_to_player(
                    player,
                    {"type": "puzzle", "index": 0, "puzzle": puzzle},
                )

        asyncio.create_task(_run_duel_timer(duel_id))

        if active_duel.is_bot_duel:
            asyncio.create_task(_run_bot_opponent(duel_id))

    asyncio.create_task(_after_countdown())


async def _run_bot_opponent(duel_id: str) -> None:
    """Simulate bot solving puzzles at a human-like pace."""
    while True:
        duel = await live_duel_manager.get_duel(duel_id)
        if not duel or duel.ended or duel.status != DuelStatus.ACTIVE:
            return

        bot = _bot_player(duel)
        human = _human_player(duel)
        if not bot or not human:
            return

        await asyncio.sleep(random.uniform(14, 24))

        duel = await live_duel_manager.get_duel(duel_id)
        if not duel or duel.ended or duel.status != DuelStatus.ACTIVE:
            return

        bot = _bot_player(duel)
        human = _human_player(duel)
        if not bot or not human:
            return

        if _time_remaining(duel) <= 0:
            return

        try:
            puzzle = await ensure_puzzle_at_index(duel, bot.current_index)
        except Exception:
            return

        base_points = int(puzzle.get("grid_size") or 5)
        points = round(max(1.0, base_points - random.choice([0, 0, 0.25, 0.5])), 2)
        bot.puzzle_results.append(
            {
                "index": bot.current_index,
                "puzzle_id": puzzle.get("id"),
                "word": puzzle.get("word"),
                "difficulty": puzzle.get("difficulty"),
                "grid_size": puzzle.get("grid_size"),
                "solved": True,
                "score": points,
                "base_points": base_points,
                "misses": 0,
                "backtracks": 0,
                "miss_penalty": 0.0,
                "backtrack_penalty": 0.0,
            }
        )
        bot.score = round(bot.score + points, 2)
        bot.puzzles_solved += 1
        bot.current_index += 1

        if human.ws and human.connected:
            await _send_to_player(
                human,
                {
                    "type": "opponent_progress",
                    "solved": bot.puzzles_solved,
                    "score": bot.score,
                    "display_name": bot.display_name,
                },
            )


async def _finish_and_emit(duel_id: str) -> None:
    finished = await live_duel_manager.finish_duel(duel_id)
    if finished:
        await _emit_duel_end(finished)


async def _forfeit_and_emit(duel_id: str, user_id: str, reason: str = "forfeit") -> None:
    finished = await live_duel_manager.forfeit_duel(duel_id, user_id, reason=reason)
    if finished:
        await _emit_duel_end(finished)


async def _handle_forfeit(duel: Duel, player: PlayerState) -> None:
    if duel.ended:
        await _send_to_player(player, duel_end_payload(duel))
        return
    finished = await live_duel_manager.forfeit_duel(duel.id, player.user_id, reason="forfeit")
    if finished:
        payload = duel_end_payload(finished)
        await _send_to_player(player, payload)
        await _broadcast(finished, payload, exclude_user_id=player.user_id)


async def _handle_rematch_request(duel: Duel, player: PlayerState, message: dict) -> None:
    if duel.ended:
        opponent = _opponent_player(duel, player.user_id)
        if not opponent or _is_bot(opponent):
            await _send_to_player(
                player,
                {"type": "rematch_status", "status": "unavailable"},
            )
            return

        result = await live_duel_manager.request_rematch(
            user_id=player.user_id,
            opponent_id=opponent.user_id,
            previous_duel_id=duel.id,
            display_name=player.display_name,
            opponent_name=opponent.display_name,
        )

        if result["status"] == "matched" and result.get("duel_id"):
            payload = {
                "type": "rematch_matched",
                "duel_id": result["duel_id"],
                "opponent_name": opponent.display_name,
            }
            await _send_to_player(player, payload)
            if opponent.ws and opponent.connected:
                await _send_to_player(
                    opponent,
                    {
                        **payload,
                        "opponent_name": player.display_name,
                    },
                )
            return

        await _send_to_player(player, {"type": "rematch_status", "status": "waiting"})
        if opponent.ws and opponent.connected:
            await _send_to_player(
                opponent,
                {
                    "type": "rematch_offer",
                    "from_name": player.display_name,
                },
            )


async def _handle_submit(duel: Duel, player: PlayerState, message: dict) -> None:
    if duel.status != DuelStatus.ACTIVE or duel.ended:
        return

    puzzle_index = message.get("puzzle_index")
    if not isinstance(puzzle_index, int) or puzzle_index != player.current_index:
        return

    if _time_remaining(duel) <= 0:
        return

    try:
        puzzle = await ensure_puzzle_at_index(duel, puzzle_index)
    except Exception:
        await _send_to_player(
            player,
            {
                "type": "answer_result",
                "correct": False,
                "score": player.score,
                "reason": "puzzle_unavailable",
            },
        )
        return

    answer = message.get("answer") or {}
    score_result = _score_submission(puzzle, answer)
    if not score_result.get("solved"):
        player.wrong_attempts += 1
        await _send_to_player(
            player,
            {
                "type": "answer_result",
                "correct": False,
                "score": player.score,
                "reason": score_result.get("reason"),
            },
        )
        return

    points = _puzzle_points(score_result)
    _record_puzzle_result(player, puzzle, puzzle_index, score_result)
    player.score = round(player.score + points, 2)
    player.puzzles_solved += 1
    player.current_index += 1

    await _send_to_player(
        player,
        {
            "type": "answer_result",
            "correct": True,
            "score": player.score,
            "points_awarded": points,
            "breakdown": _breakdown_payload(score_result),
        },
    )

    opponent = next(
        (p for uid, p in duel.players.items() if uid != player.user_id),
        None,
    )
    if opponent:
        await _send_to_player(
            opponent,
            {
                "type": "opponent_progress",
                "solved": player.puzzles_solved,
                "score": player.score,
                "display_name": player.display_name,
            },
        )

    schedule_prefetch(duel, player.current_index)

    try:
        next_puzzle = await ensure_puzzle_at_index(duel, player.current_index)
        await _send_to_player(
            player,
            {
                "type": "puzzle",
                "index": player.current_index,
                "puzzle": public_puzzle(next_puzzle),
            },
        )
    except Exception:
        await _send_to_player(player, {"type": "no_more_puzzles"})


async def live_duel_ws(websocket: WebSocket, duel_id: str, user_id: str) -> None:
    duel = await live_duel_manager.get_duel(duel_id)
    if not duel or user_id not in duel.players:
        await websocket.close(code=4004)
        return

    await websocket.accept()
    duel = await live_duel_manager.attach_player(duel_id, user_id, websocket)
    if not duel:
        await websocket.close(code=4004)
        return

    player = duel.players[user_id]
    logger.info("Live duel WS connected duel=%s user=%s", duel_id, user_id)

    await _send_duel_info(duel, player)

    if duel.status == DuelStatus.FINISHED:
        await _emit_duel_end(duel)
        await live_duel_manager.detach_player(duel_id, user_id)
        return

    if duel.status in (DuelStatus.COUNTDOWN, DuelStatus.ACTIVE):
        await _send_resync(duel, player)
    elif duel.status == DuelStatus.WAITING:
        if await live_duel_manager.both_connected(duel):
            await _start_countdown(duel_id)

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")
            fresh = await live_duel_manager.get_duel(duel_id)
            if not fresh:
                break
            player = fresh.players.get(user_id)
            if not player:
                break

            if msg_type == "submit_answer":
                await _handle_submit(fresh, player, message)
            elif msg_type == "forfeit":
                await _handle_forfeit(fresh, player)
                break
            elif msg_type == "rematch_request":
                await _handle_rematch_request(fresh, player, message)
    except WebSocketDisconnect:
        logger.info("Live duel WS disconnected duel=%s user=%s", duel_id, user_id)
    except Exception:
        logger.exception("Live duel WS error duel=%s user=%s", duel_id, user_id)
    finally:
        await live_duel_manager.detach_player(duel_id, user_id)
        fresh = await live_duel_manager.get_duel(duel_id)
        if fresh and not fresh.ended and fresh.status == DuelStatus.ACTIVE:
            forfeited = await live_duel_manager.check_disconnect_forfeits()
            for duel in forfeited:
                await _emit_duel_end(duel)


async def live_duel_maintenance_loop() -> None:
    """Background cleanup plus disconnect-forfeit and timer-end notifications."""
    while True:
        try:
            timer_finished = await live_duel_manager.cleanup_once()
            for duel in timer_finished:
                await _emit_duel_end(duel)
            forfeited = await live_duel_manager.check_disconnect_forfeits()
            for duel in forfeited:
                await _emit_duel_end(duel)
        except Exception:
            logger.exception("Live duel maintenance loop error")
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)
