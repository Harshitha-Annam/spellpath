import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GameBoard } from '../../components/GameBoard';
import { WordDisplay } from '../../components/WordDisplay';
import { formatScore, isSuccessfulSolve } from '../../scoring';
import { GridPos, PuzzleData } from '../../types';
import { useDuelSocket } from './DuelSocketContext';

interface Props {
  onDuelEnd: () => void;
  onBoardDragChange?: (dragging: boolean) => void;
}

function difficultyLabel(difficulty: string | undefined): string {
  return (difficulty ?? 'easy').toUpperCase();
}

function difficultyColor(difficulty: string | undefined): string {
  if (difficulty === 'hard') return '#f87171';
  if (difficulty === 'medium') return '#fb923c';
  return '#4ade80';
}

export const DuelGameScreen: React.FC<Props> = ({ onDuelEnd, onBoardDragChange }) => {
  const {
    currentPuzzle,
    puzzleIndex,
    myScore,
    opponentProgress,
    opponentName,
    timeRemaining,
    phase,
    lastAnswerCorrect,
    lastPointsAwarded,
    lastBreakdown,
    connectionError,
    isReconnecting,
    opponentSolveFlash,
    puzzleUnavailable,
    forfeit,
    submitAnswer,
  } = useDuelSocket();

  const [path, setPath] = useState<GridPos[]>([{ row: 0, col: 0 }]);
  const [misses, setMisses] = useState(0);
  const [backtracks, setBacktracks] = useState(0);
  const [flash, setFlash] = useState<'success' | 'error' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const puzzleRef = useRef<PuzzleData | null>(null);
  const puzzleEpochRef = useRef(0);

  const opponentLabel = opponentName || opponentProgress.displayName || 'Opponent';
  const scoreDelta = myScore - opponentProgress.score;
  const scoreDeltaText =
    scoreDelta > 0
      ? `+${formatScore(scoreDelta)} ahead`
      : scoreDelta < 0
        ? `${formatScore(Math.abs(scoreDelta))} behind`
        : 'Tied';

  useEffect(() => {
    if (phase === 'result') {
      onDuelEnd();
    }
  }, [onDuelEnd, phase]);

  useLayoutEffect(() => {
    if (!currentPuzzle) {
      return;
    }
    puzzleEpochRef.current += 1;
    puzzleRef.current = currentPuzzle;
    setPath([currentPuzzle.startCell]);
    setMisses(0);
    setBacktracks(0);
    submittingRef.current = false;
    setSubmitting(false);
  }, [currentPuzzle?.id, puzzleIndex]);

  useEffect(() => {
    if (lastAnswerCorrect === true) {
      setFlash('success');
    } else if (lastAnswerCorrect === false) {
      setFlash('error');
      submittingRef.current = false;
      setSubmitting(false);
    } else {
      setFlash(null);
      return;
    }
    const timer = setTimeout(() => setFlash(null), 450);
    return () => clearTimeout(timer);
  }, [lastAnswerCorrect]);

  const trySubmit = useCallback(
    (nextPath: GridPos[]) => {
      const puzzle = puzzleRef.current;
      if (!puzzle || submittingRef.current || timeExpired) {
        return;
      }
      if (!isSuccessfulSolve(puzzle, nextPath)) {
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      submitAnswer(puzzleIndex, {
        path: nextPath,
        misses,
        backtracks,
      });
    },
    [backtracks, misses, puzzleIndex, submitAnswer, timeExpired],
  );

  const handlePathChange = useCallback(
    (nextPath: GridPos[]) => {
      if (timeExpired) {
        return;
      }
      const epoch = puzzleEpochRef.current;
      const puzzle = puzzleRef.current;
      if (!puzzle) {
        return;
      }
      if (
        nextPath.some(
          (p) =>
            p.row < 0 ||
            p.col < 0 ||
            p.row >= puzzle.gridSize ||
            p.col >= puzzle.gridSize,
        )
      ) {
        return;
      }
      if (epoch !== puzzleEpochRef.current) {
        return;
      }
      setPath(nextPath);
      trySubmit(nextPath);
    },
    [timeExpired, trySubmit],
  );

  const handleForfeit = useCallback(() => {
    Alert.alert(
      'Leave duel?',
      'You will forfeit and your opponent wins.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            void forfeit();
          },
        },
      ],
    );
  }, [forfeit]);

  const timerSec = Math.ceil(timeRemaining);
  const timerColor = timerSec <= 15 ? '#ff6b6b' : '#f5f5ff';
  const timeExpired = timeRemaining <= 0;

  const currentWord = useMemo(() => {
    if (!currentPuzzle || path.length === 0) {
      return '';
    }
    const { cells, gridSize } = currentPuzzle;
    return path
      .map((p) => {
        if (
          p.row < 0 ||
          p.col < 0 ||
          p.row >= gridSize ||
          p.col >= gridSize
        ) {
          return '';
        }
        return cells[p.row]?.[p.col]?.letter ?? '';
      })
      .filter(Boolean)
      .join('');
  }, [currentPuzzle, path]);

  const isSolved =
    !!currentPuzzle && isSuccessfulSolve(currentPuzzle, path);

  const showBanner = Boolean(connectionError || isReconnecting);
  const showOpponentToast = opponentSolveFlash;
  const showFlash = flash !== null;
  const showTimeUp = timeExpired;

  if (!currentPuzzle) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>
          {puzzleUnavailable ? 'No more puzzles available' : 'Loading puzzle…'}
        </Text>
      </View>
    );
  }

  const diff = currentPuzzle.difficulty ?? 'easy';

  return (
    <View style={styles.container}>
      <View style={styles.headerBlock}>
        <View style={styles.matchHeader}>
          <Text style={styles.matchTitle} numberOfLines={1}>
            You vs {opponentLabel}
          </Text>
          <View style={styles.headerRight}>
            <View style={[styles.diffBadge, { borderColor: difficultyColor(diff) }]}>
              <Text style={[styles.diffBadgeText, { color: difficultyColor(diff) }]}>
                {difficultyLabel(diff)}
              </Text>
            </View>
            <Text style={styles.puzzleCounter}>#{puzzleIndex + 1}</Text>
          </View>
        </View>

        <View style={styles.topBar}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>TIME</Text>
            <Text style={[styles.statValue, { color: timerColor }]}>
              {Math.floor(timerSec / 60)}:{(timerSec % 60).toString().padStart(2, '0')}
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>YOU</Text>
            <Text style={styles.statValue}>{formatScore(myScore)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel} numberOfLines={1}>
              {opponentLabel.toUpperCase()}
            </Text>
            <Text style={styles.statValue}>
              {formatScore(opponentProgress.score)} ({opponentProgress.solved})
            </Text>
          </View>
        </View>

        <Text style={styles.scoreDelta}>{scoreDeltaText}</Text>
      </View>

      <View style={styles.boardBlock}>
        <WordDisplay
          targetWord={currentPuzzle.targetWord}
          currentWord={currentWord}
          isSolved={isSolved}
          hideTargetWord
          showSolvedBanner={false}
          misses={misses}
          backtracks={backtracks}
        />
        <GameBoard
          key={`${currentPuzzle.id}-${puzzleIndex}`}
          puzzle={currentPuzzle}
          path={path}
          onPathChange={handlePathChange}
          onDragChange={onBoardDragChange}
          onMiss={() => setMisses((m) => m + 1)}
          onBacktrack={() => setBacktracks((b) => b + 1)}
          interactionLocked={submitting || timeExpired}
        />

        <View pointerEvents="none" style={styles.overlayLayer}>
          <View style={[styles.bannerSlot, !showBanner && styles.overlayHidden]}>
            <View style={styles.banner}>
              <Text style={styles.bannerText} numberOfLines={2}>
                {connectionError ?? 'Reconnecting…'}
              </Text>
            </View>
          </View>

          <View style={[styles.toastSlot, !showOpponentToast && styles.overlayHidden]}>
            <Text style={styles.opponentToast} numberOfLines={1}>
              {opponentLabel} solved a puzzle!
            </Text>
          </View>

          <View style={[styles.flashSlot, !showFlash && styles.overlayHidden]}>
            {flash === 'success' ? (
              <View style={styles.flashBox}>
                <Text style={styles.flashSuccess}>
                  +{formatScore(lastPointsAwarded)} pts
                </Text>
                {lastBreakdown &&
                (lastBreakdown.misses > 0 || lastBreakdown.backtracks > 0) ? (
                  <Text style={styles.flashDetail} numberOfLines={2}>
                    Base {lastBreakdown.base_points}
                    {lastBreakdown.misses > 0
                      ? ` · ${lastBreakdown.misses} miss${lastBreakdown.misses === 1 ? '' : 'es'} (−${lastBreakdown.miss_penalty.toFixed(2)})`
                      : ''}
                    {lastBreakdown.backtracks > 0
                      ? ` · ${lastBreakdown.backtracks} backtrack${lastBreakdown.backtracks === 1 ? '' : 's'} (−${lastBreakdown.backtrack_penalty.toFixed(2)})`
                      : ''}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.flashError}>Try again</Text>
            )}
          </View>

          <View style={[styles.timeUpSlot, !showTimeUp && styles.overlayHidden]}>
            <View style={styles.timeUpBox}>
              <Text style={styles.timeUpTitle}>Time's up!</Text>
              <Text style={styles.timeUpSub}>Calculating results…</Text>
            </View>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.forfeitBtn} onPress={handleForfeit}>
        <Text style={styles.forfeitBtnText}>Leave duel</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  headerBlock: {
    gap: 8,
  },
  boardBlock: {
    flex: 1,
    position: 'relative',
    justifyContent: 'flex-start',
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  overlayHidden: {
    opacity: 0,
  },
  bannerSlot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  toastSlot: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
  },
  flashSlot: {
    position: 'absolute',
    top: 88,
    left: 16,
    right: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    backgroundColor: 'rgba(15, 15, 24, 0.88)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  timeUpSlot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 8, 16, 0.72)',
  },
  timeUpBox: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 15, 24, 0.95)',
    borderWidth: 1,
    borderColor: '#ff6b6b55',
  },
  timeUpTitle: {
    color: '#ff6b6b',
    fontSize: 22,
    fontWeight: '800',
  },
  timeUpSub: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  banner: {
    backgroundColor: '#3b2f00',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bannerText: {
    color: '#fbbf24',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  opponentToast: {
    textAlign: 'center',
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 14,
    backgroundColor: '#2a2410',
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    minHeight: 22,
  },
  matchTitle: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diffBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  diffBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  puzzleCounter: {
    color: '#7c6cff',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'right',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#1a1a28',
    borderRadius: 12,
    minHeight: 56,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: '#888',
    fontSize: 11,
    letterSpacing: 1,
  },
  statValue: {
    color: '#f5f5ff',
    fontSize: 20,
    fontWeight: '800',
  },
  scoreDelta: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    minHeight: 18,
  },
  flashBox: {
    alignItems: 'center',
    gap: 4,
  },
  flashSuccess: {
    textAlign: 'center',
    color: '#4ade80',
    fontWeight: '700',
    fontSize: 16,
  },
  flashDetail: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 12,
  },
  flashError: {
    textAlign: 'center',
    color: '#ff6b6b',
    fontWeight: '700',
    fontSize: 16,
  },
  loading: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#aaa',
  },
  forfeitBtn: {
    backgroundColor: '#2a1a1a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#663333',
    marginTop: 8,
    marginBottom: 8,
  },
  forfeitBtnText: {
    color: '#ff6b6b',
    fontWeight: '700',
    fontSize: 15,
  },
});
