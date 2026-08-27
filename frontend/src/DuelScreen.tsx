import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createDuel,
  createPlayer,
  fetchDuel,
  fetchDuelPuzzles,
  fetchPlayer,
  fetchRevealedDuelPuzzles,
  mapApiPuzzle,
  startDuelAttempt,
  submitDuelPuzzle,
  waitForDuelReady,
} from './api';
import { GameBoard } from './components/GameBoard';
import { DuelLobby } from './components/DuelLobby';
import { DuelProgress } from './components/DuelProgress';
import { DuelResults } from './components/DuelResults';
import { WordDisplay } from './components/WordDisplay';
import {
  clearPlayerProfile,
  loadPlayerProfile,
  savePlayerProfile,
} from './playerStorage';
import { isSuccessfulSolve } from './scoring';
import {
  DuelAttempt,
  DuelInfo,
  DuelLeaderboard,
  GridPos,
  PlayerProfile,
  PuzzleData,
  ScoreResult,
} from './types';

type Phase = 'lobby' | 'playing' | 'results';

interface Props {
  onBackToSolo: () => void;
  onBoardDragChange?: (dragging: boolean) => void;
}

function mapRevealedPuzzles(raw: unknown[] | null | undefined): PuzzleData[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  return raw.map((item, index) => {
    const p = item as {
      difficulty?: string;
      grid_size: number;
      word: string;
      milestones: { index: number; character: string; cell: [number, number] }[];
      walls?: { cell_a: [number, number]; cell_b: [number, number] }[];
      solution_path?: [number, number][];
      start_cell?: [number, number];
      end_cell?: [number, number];
      id?: string;
    };
    const difficulty =
      p.difficulty === 'easy' || p.difficulty === 'medium' || p.difficulty === 'hard'
        ? p.difficulty
        : index < 2
          ? 'easy'
          : index < 4
            ? 'medium'
            : 'hard';
    return mapApiPuzzle(p, difficulty);
  });
}

export const DuelScreen: React.FC<Props> = ({
  onBackToSolo,
  onBoardDragChange,
}) => {
  const [phase, setPhase] = useState<Phase>('lobby');
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [suggestedName, setSuggestedName] = useState('');
  const [duel, setDuel] = useState<DuelInfo | null>(null);
  const [puzzles, setPuzzles] = useState<PuzzleData[]>([]);
  const [revealedPuzzles, setRevealedPuzzles] = useState<PuzzleData[]>([]);
  const [attempt, setAttempt] = useState<DuelAttempt | null>(null);
  const [leaderboard, setLeaderboard] = useState<DuelLeaderboard | null>(null);
  const [path, setPath] = useState<GridPos[]>([]);
  const [misses, setMisses] = useState(0);
  const [backtracks, setBacktracks] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [scorePending, setScorePending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const puzzleStartedAtRef = useRef<number>(Date.now());
  const submittingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const statsRef = useRef({ misses: 0, backtracks: 0 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadPlayerProfile();
      if (cancelled || !stored) {
        return;
      }
      setSuggestedName(stored.name);
      try {
        // In-memory backend resets on restart — verify the id still exists.
        const live = await fetchPlayer(stored.id);
        if (!cancelled) {
          setPlayer(live);
          await savePlayerProfile(live);
        }
      } catch {
        // Stale id: keep the name suggestion but require (re)register.
        await clearPlayerProfile();
        if (!cancelled) {
          setPlayer(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  /** Make sure the active player exists on the current backend process. */
  const ensurePlayer = useCallback(
    async (signal?: AbortSignal): Promise<PlayerProfile> => {
      if (!player?.name) {
        throw new Error('Enter a display name first');
      }
      try {
        const live = await fetchPlayer(player.id, signal);
        return live;
      } catch {
        const fresh = await createPlayer(player.name, signal);
        await savePlayerProfile(fresh);
        setPlayer(fresh);
        setSuggestedName(fresh.name);
        return fresh;
      }
    },
    [player],
  );

  const currentIndex = attempt?.current_index ?? 0;
  const puzzle = puzzles[currentIndex] ?? null;

  useEffect(() => {
    if (phase !== 'playing' || !attempt || attempt.status !== 'in_progress') {
      return;
    }
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - puzzleStartedAtRef.current);
    }, 250);
    return () => clearInterval(timer);
  }, [phase, attempt, currentIndex]);

  const beginPuzzle = useCallback((nextPuzzle: PuzzleData) => {
    setPath([nextPuzzle.startCell]);
    setMisses(0);
    setBacktracks(0);
    statsRef.current = { misses: 0, backtracks: 0 };
    setScoreResult(null);
    setScorePending(false);
    submittingRef.current = false;
    puzzleStartedAtRef.current = Date.now();
    setElapsedMs(0);
  }, []);

  const finishOrAdvance = useCallback(
    async (
      response: {
        score_result: ScoreResult;
        attempt: DuelAttempt;
        duel: DuelInfo | null;
        leaderboard: DuelLeaderboard | null;
        revealed_puzzles?: unknown[] | null;
      },
      pack: PuzzleData[],
      signal: AbortSignal,
    ) => {
      setScoreResult(response.score_result);
      setAttempt(response.attempt);
      if (response.duel) {
        setDuel(response.duel);
      }

      if (response.attempt.status === 'completed') {
        let revealed = mapRevealedPuzzles(response.revealed_puzzles);
        if (revealed.length === 0) {
          try {
            revealed = await fetchRevealedDuelPuzzles(response.attempt.id, signal);
          } catch {
            // Results still work without boards if reveal fails.
          }
        }
        setRevealedPuzzles(revealed);
        setLeaderboard(response.leaderboard);
        setPhase('results');
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
      if (signal.aborted) {
        return;
      }
      const nextPuzzle = pack[response.attempt.current_index];
      if (nextPuzzle) {
        beginPuzzle(nextPuzzle);
      }
    },
    [beginPuzzle],
  );

  const handleRegister = async (name: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsBusy(true);
    setError(null);
    try {
      const profile = await createPlayer(name, controller.signal);
      await savePlayerProfile(profile);
      setPlayer(profile);
      setSuggestedName(profile.name);
      // New player should not keep the previous player's duel context.
      setDuel(null);
      setAttempt(null);
      setPuzzles([]);
      setRevealedPuzzles([]);
      setLeaderboard(null);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Could not create player');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSwitchPlayer = () => {
    setSuggestedName(player?.name ?? suggestedName);
    setPlayer(null);
    setDuel(null);
    setAttempt(null);
    setPuzzles([]);
    setRevealedPuzzles([]);
    setLeaderboard(null);
    setError(null);
    void clearPlayerProfile();
  };

  const handleCreateDuel = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsBusy(true);
    setError(null);
    try {
      const active = await ensurePlayer(controller.signal);
      let next = await createDuel(active.id, controller.signal);
      setDuel(next);
      next = await waitForDuelReady(next.id, controller.signal, setDuel);
      setDuel(next);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Could not create duel');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleJoinDuel = async (code: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsBusy(true);
    setError(null);
    try {
      // Join needs a live player before starting the run; validate early.
      await ensurePlayer(controller.signal);
      let next = await fetchDuel(code, controller.signal);
      setDuel(next);
      if (next.status === 'preparing') {
        next = await waitForDuelReady(next.id, controller.signal, setDuel);
        setDuel(next);
      }
      if (next.status === 'failed') {
        throw new Error(next.error || 'This duel failed to prepare');
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Could not join duel');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const launchRun = async () => {
    if (!duel) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsBusy(true);
    setError(null);
    try {
      const active = await ensurePlayer(controller.signal);
      const pack = await fetchDuelPuzzles(duel.id, controller.signal);
      const nextAttempt = await startDuelAttempt(
        duel.id,
        active.id,
        controller.signal,
      );
      const freshDuel = await fetchDuel(duel.id, controller.signal);
      setPuzzles(pack);
      setRevealedPuzzles([]);
      setAttempt(nextAttempt);
      setDuel(freshDuel);
      setLeaderboard(null);
      setPhase('playing');
      const startPuzzle = pack[nextAttempt.current_index];
      if (startPuzzle) {
        beginPuzzle(startPuzzle);
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Could not start duel');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleMiss = useCallback(() => {
    statsRef.current = {
      ...statsRef.current,
      misses: statsRef.current.misses + 1,
    };
    setMisses(statsRef.current.misses);
  }, []);

  const handleBacktrack = useCallback(() => {
    statsRef.current = {
      ...statsRef.current,
      backtracks: statsRef.current.backtracks + 1,
    };
    setBacktracks(statsRef.current.backtracks);
  }, []);

  const submitCurrentPuzzle = useCallback(
    (opts: { skipped: boolean }) => {
      if (!attempt || !puzzle || submittingRef.current || attempt.status !== 'in_progress') {
        return;
      }
      submittingRef.current = true;
      setScorePending(true);
      setError(null);

      const timeMs = Math.max(0, Date.now() - puzzleStartedAtRef.current);
      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await submitDuelPuzzle(
            attempt.id,
            currentIndex,
            {
              path: opts.skipped ? [] : path,
              misses: statsRef.current.misses,
              backtracks: statsRef.current.backtracks,
              time_ms: timeMs,
              skipped: opts.skipped,
            },
            controller.signal,
          );
          await finishOrAdvance(response, puzzles, controller.signal);
        } catch (err) {
          submittingRef.current = false;
          if (controller.signal.aborted) {
            return;
          }
          setError(
            err instanceof Error
              ? err.message
              : 'Submit failed — check your connection and try again.',
          );
        } finally {
          setScorePending(false);
        }
      })();
    },
    [attempt, puzzle, currentIndex, path, puzzles, finishOrAdvance],
  );

  const handleSkip = useCallback(() => {
    submitCurrentPuzzle({ skipped: true });
  }, [submitCurrentPuzzle]);

  const handleRetrySubmit = useCallback(() => {
    submitCurrentPuzzle({ skipped: false });
  }, [submitCurrentPuzzle]);

  const currentWord = useMemo(() => {
    if (!puzzle || path.length === 0) {
      return '';
    }
    return path
      .map((p) => puzzle.cells[p.row][p.col].letter)
      .filter(Boolean)
      .join('');
  }, [puzzle, path]);

  const isSolved =
    !!puzzle && !!attempt && attempt.status === 'in_progress' && isSuccessfulSolve(puzzle, path);

  useEffect(() => {
    if (!isSolved || !puzzle || !attempt || submittingRef.current || scorePending) {
      return;
    }
    // Don't auto-retry while a previous submit error is showing — user taps Retry.
    if (error) {
      return;
    }
    submitCurrentPuzzle({ skipped: false });
  }, [isSolved, puzzle, attempt, scorePending, error, submitCurrentPuzzle]);

  if (phase === 'lobby') {
    return (
      <DuelLobby
        player={player}
        suggestedName={suggestedName}
        duel={duel}
        isBusy={isBusy}
        error={error}
        onRegister={(name) => void handleRegister(name)}
        onSwitchPlayer={handleSwitchPlayer}
        onCreateDuel={() => void handleCreateDuel()}
        onJoinDuel={(code) => void handleJoinDuel(code)}
        onStartRun={() => void launchRun()}
        onBackToSolo={onBackToSolo}
      />
    );
  }

  if (phase === 'results' && attempt && duel) {
    return (
      <DuelResults
        duel={duel}
        attempt={attempt}
        leaderboard={leaderboard}
        revealedPuzzles={revealedPuzzles}
        onPlayAgain={() => void launchRun()}
        onBackToLobby={() => {
          setPhase('lobby');
          setAttempt(null);
          setPuzzles([]);
          setRevealedPuzzles([]);
          setError(null);
          if (duel) {
            void fetchDuel(duel.id)
              .then(setDuel)
              .catch(() => undefined);
          }
        }}
        onBackToSolo={onBackToSolo}
      />
    );
  }

  if (!puzzle || !attempt) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0f766e" />
        <Text style={styles.loadingText}>Loading duel…</Text>
      </View>
    );
  }

  return (
    <View style={styles.playWrap}>
      <DuelProgress
        attempt={attempt}
        champion={duel?.champion ?? null}
        puzzleIndex={currentIndex}
        elapsedMs={elapsedMs}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {error && isSolved && !scorePending ? (
        <TouchableOpacity style={styles.retryBtn} onPress={handleRetrySubmit}>
          <Text style={styles.retryBtnText}>Retry submit</Text>
        </TouchableOpacity>
      ) : null}
      <WordDisplay
        targetWord={puzzle.targetWord}
        currentWord={currentWord}
        isSolved={isSolved}
        misses={misses}
        backtracks={backtracks}
        scoreResult={scoreResult}
        scorePending={scorePending}
      />
      <View style={styles.boardSection}>
        <GameBoard
          key={`${attempt.id}-${puzzle.id}-${currentIndex}`}
          puzzle={puzzle}
          path={path}
          onPathChange={setPath}
          onDragChange={onBoardDragChange}
          onMiss={handleMiss}
          onBacktrack={handleBacktrack}
          interactionLocked={isSolved || scorePending}
        />
      </View>
      <TouchableOpacity
        style={[styles.skipBtn, scorePending && styles.skipBtnDisabled]}
        disabled={scorePending}
        onPress={handleSkip}
      >
        <Text style={styles.skipBtnText}>
          {scorePending ? 'Submitting…' : 'Skip puzzle (0 pts)'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.codeHint}>Code {duel?.code}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  playWrap: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 24,
  },
  boardSection: {
    width: '100%',
    alignItems: 'center',
  },
  skipBtn: {
    marginTop: 12,
    width: '100%',
    maxWidth: 380,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  skipBtnDisabled: {
    opacity: 0.55,
  },
  skipBtnText: {
    color: '#475569',
    fontWeight: '800',
    fontSize: 14,
  },
  retryBtn: {
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#0f766e',
  },
  retryBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
  },
  loading: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#0f766e',
    fontWeight: '700',
  },
  errorText: {
    color: '#b91c1c',
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  codeHint: {
    marginTop: 10,
    color: '#64748b',
    fontWeight: '700',
    letterSpacing: 1,
  },
});
