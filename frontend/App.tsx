import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMode, Difficulty, PuzzleData, GridPos, ScoreResult } from './src/types';
import { fetchGeneratedPuzzle, fetchBuiltPuzzle, scorePuzzleSolve, ensureCustomApiBaseLoaded } from './src/api';
import { generatePuzzle } from './src/puzzleGenerator';
import {
  loadPuzzleStats,
  resetPuzzleStats,
  savePuzzleStats,
  PuzzleRunStats,
  loadSessionScore,
  awardPuzzleScore,
  revokePuzzleScoreAward,
} from './src/puzzleStatsStorage';
import { isSuccessfulSolve, scoreLocalSolve } from './src/scoring';
import { HeaderControls } from './src/components/HeaderControls';
import { WordDisplay } from './src/components/WordDisplay';
import { GameBoard } from './src/components/GameBoard';
import { DuelScreen } from './src/DuelScreen';
import { LiveDuelScreen } from './src/screens/duel/LiveDuelScreen';

const EMPTY_STATS: PuzzleRunStats = {
  puzzleId: '',
  misses: 0,
  backtracks: 0,
};

export default function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<AppMode>('solo');

  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [puzzle, setPuzzle] = useState<PuzzleData>(() => generatePuzzle('easy'));
  const [path, setPath] = useState<GridPos[]>([{ row: 0, col: 0 }]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showingSolution, setShowingSolution] = useState(false);
  const [boardDragging, setBoardDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [runStats, setRunStats] = useState<PuzzleRunStats>(EMPTY_STATS);
  const [sessionScore, setSessionScore] = useState(0);
  const [puzzleScore, setPuzzleScore] = useState<ScoreResult | null>(null);
  const [scorePending, setScorePending] = useState(false);
  const handleBoardDragChange = useCallback((dragging: boolean) => {
    setBoardDragging(dragging);
    // setState is async; disable scroll immediately so upward board drags
    // don't trigger ScrollView bounce/overscroll before the next render.
    scrollRef.current?.setNativeProps({
      scrollEnabled: !dragging,
      ...(Platform.OS === 'android'
        ? { overScrollMode: dragging ? 'never' : 'auto' }
        : { bounces: !dragging }),
    });
  }, []);

  const statsRef = useRef<PuzzleRunStats>(EMPTY_STATS);
  const scoredPuzzleIdsRef = useRef<Set<string>>(new Set());
  const scoreCacheRef = useRef<Map<string, ScoreResult>>(new Map());
  const didSeedPath = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scoreAbortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight generate if the screen unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      scoreAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void ensureCustomApiBaseLoaded();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const total = await loadSessionScore();
      if (!cancelled) {
        setSessionScore(total);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const beginPuzzleRun = useCallback(async (newPuzzle: PuzzleData) => {
    scoreAbortRef.current?.abort();
    scoreCacheRef.current.delete(newPuzzle.id);
    scoredPuzzleIdsRef.current.delete(newPuzzle.id);

    const fresh = await resetPuzzleStats(newPuzzle.id);
    statsRef.current = fresh;
    setRunStats(fresh);
    setPuzzleScore(null);
    setScorePending(false);

    const total = await revokePuzzleScoreAward(newPuzzle.id);
    setSessionScore(total);
  }, []);

  // Seed path + stats for the initial local puzzle (no API on launch).
  useEffect(() => {
    if (!didSeedPath.current) {
      didSeedPath.current = true;
      setPath([puzzle.startCell]);
      void beginPuzzleRun(puzzle);
    }
  }, [puzzle, beginPuzzleRun]);

  const applyPuzzle = useCallback(
    (newPuzzle: PuzzleData) => {
      setPuzzle(newPuzzle);
      setPath([newPuzzle.startCell]);
      setShowingSolution(false);
      void beginPuzzleRun(newPuzzle);
    },
    [beginPuzzleRun],
  );

  const persistStats = useCallback((next: PuzzleRunStats) => {
    statsRef.current = next;
    setRunStats(next);
    void savePuzzleStats(next);
  }, []);

  const handleMiss = useCallback(() => {
    const current = statsRef.current;
    if (!current.puzzleId) {
      return;
    }
    persistStats({ ...current, misses: current.misses + 1 });
  }, [persistStats]);

  const handleBacktrack = useCallback(() => {
    const current = statsRef.current;
    if (!current.puzzleId) {
      return;
    }
    persistStats({ ...current, backtracks: current.backtracks + 1 });
  }, [persistStats]);

  const loadPuzzle = useCallback(
    async (diff: Difficulty) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsGenerating(true);
      setError(null);

      try {
        const newPuzzle = await fetchGeneratedPuzzle(diff, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        applyPuzzle(newPuzzle);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }
        // Keep a playable local board so drag still works offline.
        const fallback = generatePuzzle(diff);
        applyPuzzle(fallback);

        const message =
          err instanceof Error ? err.message : 'Could not generate a puzzle';
        const isNetwork =
          message === 'Network request failed' ||
          message.includes('Failed to fetch');
        setError(
          isNetwork
            ? 'Could not reach the puzzle server — showing a local puzzle. Start the backend on port 8000 (`uvicorn main:app --reload --host 0.0.0.0`).'
            : message,
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsGenerating(false);
        }
      }
    },
    [applyPuzzle],
  );

  const loadBuiltPuzzle = useCallback(
    async (diff: Difficulty) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsBuilding(true);
      setError(null);

      try {
        const newPuzzle = await fetchBuiltPuzzle(diff, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        applyPuzzle(newPuzzle);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return;
        }
        const fallback = generatePuzzle(diff);
        applyPuzzle(fallback);

        const message =
          err instanceof Error ? err.message : 'Could not build a puzzle';
        const isNetwork =
          message === 'Network request failed' ||
          message.includes('Failed to fetch');
        setError(
          isNetwork
            ? 'Could not reach the puzzle server — showing a local puzzle. Start the backend on port 8000 (`uvicorn main:app --reload --host 0.0.0.0`).'
            : message,
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsBuilding(false);
        }
      }
    },
    [applyPuzzle],
  );

  // Hydrate stats if secure storage already has values for this puzzle id
  // (e.g. after a fast refresh mid-run). New puzzles go through beginPuzzleRun.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadPuzzleStats(puzzle.id);
      if (cancelled) {
        return;
      }
      if (stored.puzzleId === puzzle.id && statsRef.current.puzzleId === '') {
        statsRef.current = stored;
        setRunStats(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puzzle.id]);

  const handleSelectDifficulty = (newDiff: Difficulty) => {
    setDifficulty(newDiff);
    // Local board only — API runs when the user taps Generate Puzzle.
    applyPuzzle(generatePuzzle(newDiff));
    setError(null);
  };

  const handleGenerate = () => {
    void loadPuzzle(difficulty);
  };

  const handleBuild = () => {
    void loadBuiltPuzzle(difficulty);
  };

  const handleReset = () => {
    if (puzzle) {
      setPath([puzzle.startCell]);
      setShowingSolution(false);
      void beginPuzzleRun(puzzle);
    }
  };

  const handlePathChange = (newPath: GridPos[]) => {
    setPath(newPath);
    if (showingSolution) {
      setShowingSolution(false);
    }
  };

  const handleShowSolution = () => {
    if (!puzzle?.solutionPath?.length) {
      return;
    }
    // Guard: never draw a path with diagonal jumps / revisits / wrong length.
    const expected = puzzle.gridSize * puzzle.gridSize;
    const sp = puzzle.solutionPath;
    if (sp.length !== expected) {
      return;
    }
    for (let i = 0; i < sp.length; i++) {
      if (i > 0) {
        const a = sp[i - 1];
        const b = sp[i];
        if (Math.abs(a.row - b.row) + Math.abs(a.col - b.col) !== 1) {
          return;
        }
      }
    }
    if (showingSolution) {
      setPath([puzzle.startCell]);
      setShowingSolution(false);
      return;
    }
    setPath(sp.map((p) => ({ row: p.row, col: p.col })));
    setShowingSolution(true);
  };

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
    !!puzzle && !showingSolution && isSuccessfulSolve(puzzle, path);

  useEffect(() => {
    if (!isSolved || !puzzle) {
      return;
    }

    const cached = scoreCacheRef.current.get(puzzle.id);
    if (cached) {
      setPuzzleScore(cached);
      setScorePending(false);
      return;
    }
    if (scoredPuzzleIdsRef.current.has(puzzle.id)) {
      return;
    }

    scoredPuzzleIdsRef.current.add(puzzle.id);
    const controller = new AbortController();
    scoreAbortRef.current = controller;
    setScorePending(true);

    const stats = statsRef.current;
    const misses = stats.puzzleId === puzzle.id ? stats.misses : 0;
    const backtracks = stats.puzzleId === puzzle.id ? stats.backtracks : 0;

    void (async () => {
      try {
        let result: ScoreResult;
        try {
          result = await scorePuzzleSolve(
            { puzzle, path, misses, backtracks },
            controller.signal,
          );
        } catch (err) {
          if (
            controller.signal.aborted ||
            (err instanceof Error && err.name === 'AbortError')
          ) {
            scoredPuzzleIdsRef.current.delete(puzzle.id);
            return;
          }
          result = scoreLocalSolve(puzzle, path, misses, backtracks);
        }

        if (controller.signal.aborted) {
          scoredPuzzleIdsRef.current.delete(puzzle.id);
          return;
        }

        scoreCacheRef.current.set(puzzle.id, result);
        setPuzzleScore(result);
        if (result.solved && typeof result.score === 'number') {
          const total = await awardPuzzleScore(puzzle.id, result.score);
          if (!controller.signal.aborted) {
            setSessionScore(total);
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          setScorePending(false);
        }
      }
    })();
  }, [isSolved, puzzle, path]);

  const bottomPad = Math.max(insets.bottom, 16) + 16;

  const soloContent = (
    <>
      <HeaderControls
        selectedDifficulty={difficulty}
        onSelectDifficulty={handleSelectDifficulty}
        onGenerate={handleGenerate}
        onBuild={handleBuild}
        onReset={handleReset}
        onShowSolution={handleShowSolution}
        showingSolution={showingSolution}
        isGenerating={isGenerating}
        isBuilding={isBuilding}
        sessionScore={sessionScore}
        onOpenDuel={() => setMode('duel')}
        onOpenLiveDuel={() => setMode('liveDuel')}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {puzzle ? (
        <View style={styles.gameArea}>
          <WordDisplay
            targetWord={puzzle.targetWord}
            currentWord={currentWord}
            isSolved={isSolved}
            misses={runStats.misses}
            backtracks={runStats.backtracks}
            scoreResult={puzzleScore}
            scorePending={scorePending}
          />

          <View style={styles.boardSection}>
            <GameBoard
              key={puzzle.id}
              puzzle={puzzle}
              path={path}
              onPathChange={handlePathChange}
              onDragChange={handleBoardDragChange}
              onMiss={handleMiss}
              onBacktrack={handleBacktrack}
              interactionLocked={isSolved || showingSolution}
            />
            {(isGenerating || isBuilding) ? (
              <View style={styles.loadingOverlay} pointerEvents="none">
                <ActivityIndicator size="large" color="#4f46e5" />
                <Text style={styles.loadingText}>
                  {isBuilding ? 'Building puzzle…' : 'Generating puzzle…'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.initialLoading}>
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text style={styles.loadingText}>Generating puzzle…</Text>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {mode === 'liveDuel' ? (
        <View style={[styles.screen, { paddingBottom: bottomPad }]}>
          <LiveDuelScreen
            onBackToSolo={() => setMode('solo')}
            onBoardDragChange={handleBoardDragChange}
          />
        </View>
      ) : mode === 'duel' ? (
        <View style={[styles.screen, { paddingBottom: bottomPad }]}>
          <DuelScreen
            onBackToSolo={() => setMode('solo')}
            onBoardDragChange={handleBoardDragChange}
          />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.screen}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: bottomPad },
          ]}
          keyboardShouldPersistTaps="handled"
          // Disable scroll while drawing so ScrollView doesn't steal the gesture.
          scrollEnabled={!boardDragging}
          nestedScrollEnabled
          bounces={!boardDragging}
          overScrollMode={boardDragging ? 'never' : 'auto'}
          showsVerticalScrollIndicator
        >
          {soloContent}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  gameArea: {
    alignItems: 'center',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  boardSection: {
    width: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  initialLoading: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    marginTop: 8,
    color: '#4338ca',
    fontWeight: '700',
    fontSize: 14,
  },
});
