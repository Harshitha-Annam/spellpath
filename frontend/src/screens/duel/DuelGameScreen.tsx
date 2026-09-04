import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GameBoard } from '../../components/GameBoard';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { formatScore, isSuccessfulSolve } from '../../scoring';
import { GridPos, PuzzleData } from '../../types';
import { useDuelSocket } from './DuelSocketContext';

const ACCENT = '#e85a3c';
const ACCENT_SOFT = '#c94a32';

interface Props {
  playerName: string;
  onDuelEnd: () => void;
  onBoardDragChange?: (dragging: boolean) => void;
}

function formatTimer(seconds: number): string {
  const sec = Math.max(0, Math.ceil(seconds));
  const mm = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const ss = (sec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export const DuelGameScreen: React.FC<Props> = ({
  playerName,
  onDuelEnd,
  onBoardDragChange,
}) => {
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
  const youLabel = playerName.trim() || 'You';
  const opponentReady =
    opponentProgress.ready === true ||
    opponentProgress.connected === true ||
    phase === 'playing';
  const timeExpired = timeRemaining <= 0;

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

  const handleResetPath = useCallback(() => {
    const puzzle = puzzleRef.current;
    if (!puzzle || submittingRef.current || timeExpired) {
      return;
    }
    setPath([puzzle.startCell]);
    setMisses(0);
    setBacktracks(0);
  }, [timeExpired]);

  const handleForfeit = useCallback(() => {
    Alert.alert(
      'Quit duel?',
      'You will forfeit and see the final scoreboard. Your opponent wins.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Quit',
          style: 'destructive',
          onPress: () => {
            void forfeit();
          },
        },
      ],
    );
  }, [forfeit]);

  const timerSec = Math.ceil(timeRemaining);
  const showBanner = Boolean(connectionError || isReconnecting);
  const showOpponentToast = opponentSolveFlash;
  const showFlash = flash !== null;
  const showTimeUp = timeExpired;

  if (!currentPuzzle) {
    return (
      <View style={styles.loading}>
        <TouchableOpacity
          style={[styles.topQuitBtn, styles.loadingQuitBtn]}
          onPress={handleForfeit}
        >
          <Text style={styles.topQuitBtnText}>Quit</Text>
        </TouchableOpacity>
        <Text style={styles.loadingText}>
          {puzzleUnavailable ? 'No more puzzles available' : 'Loading puzzle…'}
        </Text>
      </View>
    );
  }

  const clueText =
    currentPuzzle.clue?.trim() ||
    'Connect the letters in order to reveal the hidden answer';

  return (
    <View style={styles.container}>
      <View style={styles.topBarRow}>
        <View style={styles.brandBlock}>
          <Text style={styles.brandTitle}>Jupiter</Text>
          <Text style={styles.brandTagline}>Your money companion</Text>
        </View>
        <TouchableOpacity style={styles.topQuitBtn} onPress={handleForfeit}>
          <Text style={styles.topQuitBtnText}>Quit</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.matchRow}>
        <View style={styles.playerCol}>
          <PlayerAvatar name={youLabel} size={54} />
          <Text style={styles.playerName} numberOfLines={1}>
            {youLabel}
          </Text>
          <Text style={styles.playerScore}>{formatScore(myScore)}</Text>
        </View>

        <View style={styles.timerBadge}>
          <Text style={[styles.timerText, timerSec <= 15 && styles.timerUrgent]}>
            {formatTimer(timeRemaining)}
          </Text>
        </View>

        <View style={styles.playerCol}>
          <PlayerAvatar name={opponentLabel} size={54} />
          <Text style={styles.playerName} numberOfLines={1}>
            {opponentLabel}
          </Text>
          {opponentReady ? (
            <Text style={styles.playerScore}>{formatScore(opponentProgress.score)}</Text>
          ) : (
            <Text style={styles.waitingText}>waiting...</Text>
          )}
        </View>
      </View>

      <View style={styles.clueCard}>
        <Text style={styles.clueText}>{clueText}</Text>
      </View>

      <View style={styles.boardBlock}>
        <GameBoard
          key={`${currentPuzzle.id}-${puzzleIndex}`}
          puzzle={currentPuzzle}
          path={path}
          onPathChange={handlePathChange}
          onDragChange={onBoardDragChange}
          onMiss={() => setMisses((m) => m + 1)}
          onBacktrack={() => setBacktracks((b) => b + 1)}
          interactionLocked={submitting || timeExpired}
          accent="jupiter"
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

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={handleResetPath}
        disabled={submitting || timeExpired}
      >
        <Text style={styles.resetBtnText}>Reset</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: '#0a0a0a',
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brandBlock: {
    alignItems: 'flex-start',
    flex: 1,
  },
  brandTitle: {
    color: ACCENT,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  brandTagline: {
    color: '#8a8a8a',
    fontSize: 12,
    marginTop: 2,
  },
  topQuitBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#1a1a1a',
    marginTop: 4,
  },
  topQuitBtnText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingQuitBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  playerCol: {
    width: 96,
    alignItems: 'center',
    gap: 4,
  },
  playerName: {
    color: '#f0f0f0',
    fontSize: 13,
    fontWeight: '700',
    maxWidth: 96,
    textAlign: 'center',
  },
  playerScore: {
    color: ACCENT,
    fontSize: 22,
    fontWeight: '800',
  },
  waitingText: {
    color: '#8a8a8a',
    fontSize: 13,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  timerBadge: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    minWidth: 88,
    alignItems: 'center',
  },
  timerText: {
    color: ACCENT,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timerUrgent: {
    color: '#ff6b6b',
  },
  clueCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  clueText: {
    color: '#e8e8e8',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '500',
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
    backgroundColor: 'rgba(10, 10, 10, 0.9)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  timeUpSlot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.72)',
  },
  timeUpBox: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 15, 15, 0.95)',
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
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    color: '#aaa',
  },
  resetBtn: {
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: ACCENT_SOFT,
    marginTop: 4,
    marginBottom: 8,
  },
  resetBtnText: {
    color: ACCENT,
    fontWeight: '700',
    fontSize: 16,
  },
});
