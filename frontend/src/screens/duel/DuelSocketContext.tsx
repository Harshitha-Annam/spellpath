import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { mapApiPuzzle, resolveLiveDuelWsUrl, forfeitLiveDuel, abortLiveDuel } from '../../api';
import {
  LiveDuelEndPayload,
  LiveDuelOpponentProgress,
  LiveDuelPhase,
  LiveDuelRematchStatus,
  LiveDuelScoreBreakdown,
  PuzzleData,
} from '../../types';

export type LiveDuelSocketStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'countdown'
  | 'active'
  | 'finished'
  | 'error';

interface DuelSocketContextValue {
  status: LiveDuelSocketStatus;
  phase: LiveDuelPhase;
  setPhase: (phase: LiveDuelPhase) => void;
  countdownStartAt: number | null;
  duelStartAt: number | null;
  durationSec: number;
  currentPuzzle: PuzzleData | null;
  puzzleIndex: number;
  myScore: number;
  opponentProgress: LiveDuelOpponentProgress;
  opponentName: string;
  setOpponentName: (name: string) => void;
  timeRemaining: number;
  result: LiveDuelEndPayload | null;
  lastAnswerCorrect: boolean | null;
  lastPointsAwarded: number | null;
  lastBreakdown: LiveDuelScoreBreakdown | null;
  connectionError: string | null;
  isReconnecting: boolean;
  opponentSolveFlash: boolean;
  puzzleUnavailable: boolean;
  rematchStatus: LiveDuelRematchStatus;
  rematchOfferFrom: string | null;
  rematchDuelId: string | null;
  /** True when match was cancelled before play started (local or opponent abort). */
  matchCancelled: boolean;
  connect: (duelId: string, userId: string) => Promise<void>;
  disconnect: () => void;
  resetSession: () => void;
  forfeit: () => Promise<void>;
  /** Leave before the duel becomes active — goes home, no scoreboard. */
  abortMatch: () => Promise<void>;
  requestRematch: () => void;
  acceptRematch: () => void;
  submitAnswer: (
    puzzleIndex: number,
    answer: { path: { row: number; col: number }[]; misses: number; backtracks: number },
  ) => void;
}

const DuelSocketContext = createContext<DuelSocketContextValue | null>(null);

const MAX_RECONNECT_ATTEMPTS = 5;

function mapWsPuzzle(raw: unknown): PuzzleData {
  const p = raw as {
    id?: string;
    difficulty?: string;
    grid_size: number;
    word?: string;
    clue?: string;
    milestones: { index: number; character: string; cell: [number, number] }[];
    walls?: { cell_a: [number, number]; cell_b: [number, number] }[];
    start_cell?: [number, number];
    end_cell?: [number, number];
  };
  const difficulty = (p.difficulty ?? 'easy') as 'easy' | 'medium' | 'hard';
  return mapApiPuzzle({ ...p, word: p.word ?? '', clue: p.clue }, difficulty);
}

function parseOpponentProgress(raw: unknown): LiveDuelOpponentProgress {
  const o = raw as {
    solved?: number;
    score?: number;
    display_name?: string;
    connected?: boolean;
    ready?: boolean;
  };
  return {
    solved: Number(o.solved) || 0,
    score: Number(o.score) || 0,
    displayName: o.display_name ?? undefined,
    connected: o.connected,
    ready: o.ready,
  };
}

export const DuelSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const duelIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const forfeitingRef = useRef(false);
  const phaseRef = useRef<LiveDuelPhase>('queue');

  const [status, setStatus] = useState<LiveDuelSocketStatus>('idle');
  const [phase, setPhaseState] = useState<LiveDuelPhase>('queue');
  const [countdownStartAt, setCountdownStartAt] = useState<number | null>(null);
  const [duelStartAt, setDuelStartAt] = useState<number | null>(null);
  const [durationSec, setDurationSec] = useState(60);
  const [currentPuzzle, setCurrentPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [myScore, setMyScore] = useState(0);
  const [opponentProgress, setOpponentProgress] = useState<LiveDuelOpponentProgress>({
    solved: 0,
    score: 0,
  });
  const [opponentName, setOpponentName] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(60);
  const [result, setResult] = useState<LiveDuelEndPayload | null>(null);
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null);
  const [lastPointsAwarded, setLastPointsAwarded] = useState<number | null>(null);
  const [lastBreakdown, setLastBreakdown] = useState<LiveDuelScoreBreakdown | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [opponentSolveFlash, setOpponentSolveFlash] = useState(false);
  const [puzzleUnavailable, setPuzzleUnavailable] = useState(false);
  const [rematchStatus, setRematchStatus] = useState<LiveDuelRematchStatus>('idle');
  const [rematchOfferFrom, setRematchOfferFrom] = useState<string | null>(null);
  const [rematchDuelId, setRematchDuelId] = useState<string | null>(null);
  const [matchCancelled, setMatchCancelled] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  phaseRef.current = phase;
  const resultRef = useRef(result);
  resultRef.current = result;
  const duelStartAtRef = useRef<number | null>(null);
  const timerExpiredHandledRef = useRef(false);
  const opponentSolvedRef = useRef(0);
  const [tick, setTick] = useState(0);

  const setPhase = useCallback((next: LiveDuelPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const teardownSocket = useCallback(() => {
    clearReconnectTimer();
    intentionalCloseRef.current = true;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [clearReconnectTimer]);

  const resetSession = useCallback(() => {
    setCountdownStartAt(null);
    setDuelStartAt(null);
    duelStartAtRef.current = null;
    setDurationSec(60);
    setCurrentPuzzle(null);
    setPuzzleIndex(0);
    setMyScore(0);
    setOpponentProgress({ solved: 0, score: 0 });
    opponentSolvedRef.current = 0;
    setOpponentName('');
    setTimeRemaining(60);
    setResult(null);
    setLastAnswerCorrect(null);
    setLastPointsAwarded(null);
    setLastBreakdown(null);
    setConnectionError(null);
    setIsReconnecting(false);
    setOpponentSolveFlash(false);
    setPuzzleUnavailable(false);
    setRematchStatus('idle');
    setRematchOfferFrom(null);
    setRematchDuelId(null);
    setMatchCancelled(false);
    reconnectAttemptRef.current = 0;
  }, []);

  const applyDuelEnd = useCallback(
    (payload: LiveDuelEndPayload) => {
      const cancelledBeforeStart =
        payload.end_reason === 'abort' ||
        (payload.end_reason === 'forfeit' &&
          duelStartAtRef.current == null &&
          phaseRef.current !== 'playing');

      if (cancelledBeforeStart) {
        setMatchCancelled(true);
        setStatus('finished');
        setIsReconnecting(false);
        setConnectionError(null);
        setResult(null);
        return;
      }

      setResult(payload);
      setStatus('finished');
      setPhase('result');
      setIsReconnecting(false);
      setConnectionError(null);
    },
    [setPhase],
  );

  const handleMessage = useCallback((event: WebSocketMessageEvent) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }

    const type = payload.type as string;
    switch (type) {
      case 'duel_info': {
        const opponent = payload.opponent as
          | { display_name?: string; connected?: boolean; ready?: boolean }
          | undefined;
        if (opponent?.display_name) {
          setOpponentName(opponent.display_name);
        }
        if (opponent) {
          setOpponentProgress((prev) => ({
            ...prev,
            displayName: opponent.display_name ?? prev.displayName,
            connected: opponent.connected ?? prev.connected,
            ready: opponent.ready ?? prev.ready,
          }));
        }
        break;
      }
      case 'countdown':
        setConnectionError(null);
        setIsReconnecting(false);
        setStatus('countdown');
        setCountdownStartAt(Number(payload.start_at));
        setPhase('countdown');
        break;
      case 'duel_start':
        setConnectionError(null);
        setIsReconnecting(false);
        setStatus('active');
        setDuelStartAt(Number(payload.start_at));
        duelStartAtRef.current = Number(payload.start_at);
        setDurationSec(Number(payload.duration_sec) || 60);
        setPhase('playing');
        break;
      case 'puzzle':
        setPuzzleUnavailable(false);
        setCurrentPuzzle(mapWsPuzzle(payload.puzzle));
        setPuzzleIndex(Number(payload.index));
        setLastAnswerCorrect(null);
        setLastPointsAwarded(null);
        setLastBreakdown(null);
        break;
      case 'answer_result':
        setMyScore(Number(payload.score) || 0);
        setLastAnswerCorrect(Boolean(payload.correct));
        if (payload.points_awarded != null) {
          setLastPointsAwarded(Number(payload.points_awarded));
        }
        if (payload.breakdown) {
          setLastBreakdown(payload.breakdown as LiveDuelScoreBreakdown);
        }
        break;
      case 'opponent_progress': {
        const progress = parseOpponentProgress(payload);
        const prevSolved = opponentSolvedRef.current;
        if (progress.solved > prevSolved) {
          opponentSolvedRef.current = progress.solved;
          setOpponentSolveFlash(true);
          setTimeout(() => setOpponentSolveFlash(false), 1200);
        }
        if (progress.displayName) {
          setOpponentName(progress.displayName);
        }
        setOpponentProgress(progress);
        break;
      }
      case 'resync': {
        const duelStatus = String(payload.status);
        if (payload.countdown_start_at != null) {
          setCountdownStartAt(Number(payload.countdown_start_at));
        }
        if (payload.duel_start_at != null) {
          setDuelStartAt(Number(payload.duel_start_at));
          duelStartAtRef.current = Number(payload.duel_start_at);
        }
        if (payload.duration_sec != null) {
          setDurationSec(Number(payload.duration_sec));
        }
        setMyScore(Number(payload.score) || 0);
        setPuzzleIndex(Number(payload.puzzle_index) || 0);
        if (payload.current_puzzle) {
          setCurrentPuzzle(mapWsPuzzle(payload.current_puzzle));
        }
        const opponent = payload.opponent;
        if (opponent) {
          const progress = parseOpponentProgress(opponent);
          opponentSolvedRef.current = progress.solved;
          if (progress.displayName) {
            setOpponentName(progress.displayName);
          }
          setOpponentProgress(progress);
        }
        if (payload.time_remaining != null) {
          setTimeRemaining(Number(payload.time_remaining));
        }
        setConnectionError(null);
        setIsReconnecting(false);
        if (duelStatus === 'countdown') {
          setStatus('countdown');
          setPhase('countdown');
        } else if (duelStatus === 'active') {
          setStatus('active');
          setPhase('playing');
        } else if (duelStatus === 'finished') {
          setStatus('finished');
          setPhase('result');
        }
        break;
      }
      case 'duel_end':
        applyDuelEnd({
          scores: (payload.scores as Record<string, number>) || {},
          winner_id: (payload.winner_id as string | null) ?? null,
          puzzles_solved: (payload.puzzles_solved as Record<string, number>) || {},
          player_names: (payload.player_names as Record<string, string>) || {},
          puzzle_results: (payload.puzzle_results as LiveDuelEndPayload['puzzle_results']) || {},
          end_reason: (payload.end_reason as string | null) ?? null,
        });
        break;
      case 'rematch_offer':
        setRematchStatus('offer');
        setRematchOfferFrom(String(payload.from_name ?? 'Opponent'));
        break;
      case 'rematch_status':
        setRematchStatus(String(payload.status) === 'waiting' ? 'waiting' : 'idle');
        break;
      case 'rematch_matched':
        setRematchStatus('matched');
        setRematchDuelId(String(payload.duel_id ?? ''));
        if (payload.opponent_name) {
          setOpponentName(String(payload.opponent_name));
        }
        break;
      case 'no_more_puzzles':
        setPuzzleUnavailable(true);
        break;
      default:
        break;
    }
  }, [applyDuelEnd, setPhase]);

  const openSocket = useCallback(
    async (isReconnect = false) => {
      const duelId = duelIdRef.current;
      const userId = userIdRef.current;
      if (!duelId || !userId) {
        return;
      }

      clearReconnectTimer();
      if (isReconnect && phaseRef.current !== 'queue') {
        setIsReconnecting(true);
      }
      setStatus('connecting');

      const url = await resolveLiveDuelWsUrl(duelId, userId);
      intentionalCloseRef.current = false;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionError(null);
        setIsReconnecting(false);
        setStatus((prev) => (prev === 'connecting' ? 'connected' : prev));
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        setStatus('error');
        setConnectionError('Connection lost. Trying to reconnect…');
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (
          intentionalCloseRef.current ||
          forfeitingRef.current ||
          statusRef.current === 'finished'
        ) {
          setIsReconnecting(false);
          return;
        }
        if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setStatus('error');
          setIsReconnecting(false);
          setConnectionError('Could not reconnect. Check your connection and try again.');
          return;
        }
        const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 8000);
        reconnectAttemptRef.current += 1;
        setIsReconnecting(true);
        setConnectionError('Connection lost. Reconnecting…');
        reconnectTimerRef.current = setTimeout(() => {
          void openSocket(true);
        }, delay);
      };
    },
    [clearReconnectTimer, handleMessage],
  );

  const connect = useCallback(
    async (duelId: string, userId: string) => {
      duelIdRef.current = duelId;
      userIdRef.current = userId;
      reconnectAttemptRef.current = 0;
      teardownSocket();
      intentionalCloseRef.current = false;
      await openSocket(false);
    },
    [openSocket, teardownSocket],
  );

  const disconnect = useCallback(() => {
    teardownSocket();
    duelIdRef.current = null;
    userIdRef.current = null;
    setStatus('idle');
    setIsReconnecting(false);
  }, [teardownSocket]);

  const sendMessage = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(payload));
  }, []);

  const forfeit = useCallback(async () => {
    const duelId = duelIdRef.current;
    const userId = userIdRef.current;
    if (!duelId || !userId || forfeitingRef.current) {
      return;
    }

    forfeitingRef.current = true;
    intentionalCloseRef.current = true;
    sendMessage({ type: 'forfeit' });

    try {
      const payload = await forfeitLiveDuel(duelId, userId);
      applyDuelEnd(payload);
    } catch {
      if (!resultRef.current) {
        if (duelStartAtRef.current != null || phaseRef.current === 'playing') {
          applyDuelEnd({
            scores: {},
            winner_id: null,
            puzzles_solved: {},
            end_reason: 'forfeit',
          });
        } else {
          setMatchCancelled(true);
          setStatus('finished');
        }
      }
    } finally {
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      forfeitingRef.current = false;
    }
  }, [applyDuelEnd, clearReconnectTimer, sendMessage]);

  const abortMatch = useCallback(async () => {
    const duelId = duelIdRef.current;
    const userId = userIdRef.current;
    if (forfeitingRef.current) {
      return;
    }

    if (duelStartAtRef.current != null || phaseRef.current === 'playing') {
      await forfeit();
      return;
    }

    forfeitingRef.current = true;
    intentionalCloseRef.current = true;
    sendMessage({ type: 'abort' });

    try {
      if (duelId && userId) {
        await abortLiveDuel(duelId, userId);
      }
    } catch {
      // Local leave still proceeds.
    } finally {
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setMatchCancelled(true);
      setStatus('finished');
      setIsReconnecting(false);
      setConnectionError(null);
      setResult(null);
      forfeitingRef.current = false;
    }
  }, [clearReconnectTimer, forfeit, sendMessage]);

  const requestRematch = useCallback(() => {
    setRematchStatus('waiting');
    sendMessage({ type: 'rematch_request' });
  }, [sendMessage]);

  const acceptRematch = useCallback(() => {
    setRematchStatus('waiting');
    sendMessage({ type: 'rematch_request' });
  }, [sendMessage]);

  const submitAnswer = useCallback(
    (
      index: number,
      answer: { path: { row: number; col: number }[]; misses: number; backtracks: number },
    ) => {
      sendMessage({
        type: 'submit_answer',
        puzzle_index: index,
        answer,
      });
    },
    [sendMessage],
  );

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (duelStartAt != null && status === 'active') {
      const remaining = Math.max(0, durationSec - (Date.now() / 1000 - duelStartAt));
      setTimeRemaining(remaining);
    }
  }, [duelStartAt, durationSec, status, tick]);

  useEffect(() => {
    if (status !== 'active' || duelStartAt == null) {
      timerExpiredHandledRef.current = false;
      return;
    }
    if (timeRemaining > 0 || resultRef.current) {
      return;
    }
    if (timerExpiredHandledRef.current) {
      return;
    }
    timerExpiredHandledRef.current = true;

    const resyncForEnd = () => {
      if (statusRef.current === 'finished' || resultRef.current) {
        return;
      }
      if (!duelIdRef.current || !userIdRef.current) {
        return;
      }
      intentionalCloseRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      intentionalCloseRef.current = false;
      void openSocket(true);
    };

    const t1 = setTimeout(resyncForEnd, 400);
    const t2 = setTimeout(resyncForEnd, 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [timeRemaining, status, duelStartAt, openSocket]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (
        next === 'active' &&
        duelIdRef.current &&
        userIdRef.current &&
        status !== 'finished' &&
        status !== 'idle'
      ) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          void openSocket(true);
        }
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [openSocket, status]);

  useEffect(() => () => disconnect(), [disconnect]);

  const value = useMemo(
    (): DuelSocketContextValue => ({
      status,
      phase,
      setPhase,
      countdownStartAt,
      duelStartAt,
      durationSec,
      currentPuzzle,
      puzzleIndex,
      myScore,
      opponentProgress,
      opponentName,
      setOpponentName,
      timeRemaining,
      result,
      lastAnswerCorrect,
      lastPointsAwarded,
      lastBreakdown,
      connectionError,
      isReconnecting,
      opponentSolveFlash,
      puzzleUnavailable,
      rematchStatus,
      rematchOfferFrom,
      rematchDuelId,
      matchCancelled,
      connect,
      disconnect,
      resetSession,
      forfeit,
      abortMatch,
      requestRematch,
      acceptRematch,
      submitAnswer,
    }),
    [
      status,
      phase,
      setPhase,
      countdownStartAt,
      duelStartAt,
      durationSec,
      currentPuzzle,
      puzzleIndex,
      myScore,
      opponentProgress,
      opponentName,
      timeRemaining,
      result,
      lastAnswerCorrect,
      lastPointsAwarded,
      lastBreakdown,
      connectionError,
      isReconnecting,
      opponentSolveFlash,
      puzzleUnavailable,
      rematchStatus,
      rematchOfferFrom,
      rematchDuelId,
      matchCancelled,
      connect,
      disconnect,
      resetSession,
      forfeit,
      abortMatch,
      requestRematch,
      acceptRematch,
      submitAnswer,
    ],
  );

  return <DuelSocketContext.Provider value={value}>{children}</DuelSocketContext.Provider>;
};

export function useDuelSocket(): DuelSocketContextValue {
  const ctx = useContext(DuelSocketContext);
  if (!ctx) {
    throw new Error('useDuelSocket must be used within DuelSocketProvider');
  }
  return ctx;
}
