import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { buildLiveDuelShareMessage } from '../../api';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { loadLiveDuelStats, recordLiveDuelResult, LiveDuelStats } from '../../liveDuelStatsStorage';
import { formatScore } from '../../scoring';
import { LiveDuelPuzzleResult } from '../../types';
import { useDuelSocket } from './DuelSocketContext';

interface Props {
  userId: string;
  onNewGame: () => void;
  onRematchBot: () => void;
  onHome: () => void;
}

function PuzzleAnalysisRow({
  index,
  mine,
  theirs,
  opponentName,
}: {
  index: number;
  mine: LiveDuelPuzzleResult | undefined;
  theirs: LiveDuelPuzzleResult | undefined;
  opponentName: string;
}) {
  const word = mine?.word ?? theirs?.word ?? '—';
  const difficulty = (mine?.difficulty ?? theirs?.difficulty ?? '').toUpperCase();

  return (
    <View style={styles.analysisRow}>
      <View style={styles.analysisHeader}>
        <Text style={styles.analysisIndex}>#{index + 1}</Text>
        <Text style={styles.analysisWord}>{word}</Text>
        {difficulty ? <Text style={styles.analysisDiff}>{difficulty}</Text> : null}
      </View>

      <View style={styles.analysisScores}>
        <View style={styles.analysisCol}>
          <Text style={styles.analysisColLabel}>You</Text>
          {mine?.solved ? (
            <>
              <Text style={styles.analysisScore}>{formatScore(mine.score)}</Text>
              <Text style={styles.analysisMeta}>
                base {mine.base_points}
                {mine.misses > 0 ? ` · ${mine.misses} miss` : ''}
                {mine.backtracks > 0 ? ` · ${mine.backtracks} back` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.analysisSkipped}>—</Text>
          )}
        </View>

        <View style={styles.analysisCol}>
          <Text style={styles.analysisColLabel}>{opponentName}</Text>
          {theirs?.solved ? (
            <>
              <Text style={styles.analysisScore}>{formatScore(theirs.score)}</Text>
              <Text style={styles.analysisMeta}>
                base {theirs.base_points}
                {theirs.misses > 0 ? ` · ${theirs.misses} miss` : ''}
                {theirs.backtracks > 0 ? ` · ${theirs.backtracks} back` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.analysisSkipped}>—</Text>
          )}
        </View>
      </View>
    </View>
  );
}

function endReasonLabel(
  reason: string | null | undefined,
  won: boolean | null,
): string | null {
  if (reason === 'abort') {
    return 'Match cancelled before it started';
  }
  if (reason === 'forfeit') {
    return won === true ? 'Opponent forfeited' : won === false ? 'You forfeited' : 'Ended by forfeit';
  }
  if (reason === 'disconnect') {
    return won === true ? 'Opponent disconnected' : won === false ? 'You disconnected' : 'Ended by disconnect';
  }
  return null;
}

export const DuelResultScreen: React.FC<Props> = ({
  userId,
  onNewGame,
  onRematchBot,
  onHome,
}) => {
  const {
    result,
    disconnect,
    rematchStatus,
    rematchOfferFrom,
    requestRematch,
    acceptRematch,
  } = useDuelSocket();
  const [stats, setStats] = useState<LiveDuelStats | null>(null);
  const recordedRef = React.useRef(false);

  const opponentId = useMemo(
    () => (result ? Object.keys(result.scores).find((id) => id !== userId) : undefined),
    [result, userId],
  );

  useEffect(() => {
    if (!result || recordedRef.current) {
      return;
    }
    recordedRef.current = true;
    const opponentName =
      (opponentId && result.player_names?.[opponentId]) || 'Opponent';
    const myScore = result.scores[userId] ?? 0;
    const opponentScore = opponentId != null ? result.scores[opponentId] ?? 0 : 0;
    const mySolved = result.puzzles_solved[userId] ?? 0;
    const won =
      result.winner_id === userId
        ? true
        : result.winner_id && result.winner_id !== userId
          ? false
          : null;

    void recordLiveDuelResult({
      opponentName,
      myScore,
      opponentScore,
      won,
      puzzlesSolved: mySolved,
    }).then(setStats);
  }, [opponentId, result, userId]);

  useEffect(() => {
    void loadLiveDuelStats().then(setStats);
  }, []);

  const analysisRows = useMemo(() => {
    if (!result?.puzzle_results) {
      return [];
    }
    const mine = result.puzzle_results[userId] ?? [];
    const theirs = opponentId != null ? result.puzzle_results[opponentId] ?? [] : [];
    const maxLen = Math.max(mine.length, theirs.length);
    const rows: { index: number; mine?: LiveDuelPuzzleResult; theirs?: LiveDuelPuzzleResult }[] = [];
    for (let i = 0; i < maxLen; i++) {
      rows.push({
        index: i,
        mine: mine.find((r) => r.index === i) ?? mine[i],
        theirs: theirs.find((r) => r.index === i) ?? theirs[i],
      });
    }
    return rows;
  }, [opponentId, result, userId]);

  if (!result) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Duel ended</Text>
      </View>
    );
  }

  const myScore = result.scores[userId] ?? 0;
  const opponentScore = opponentId != null ? result.scores[opponentId] ?? 0 : 0;
  const mySolved = result.puzzles_solved[userId] ?? 0;
  const opponentSolved = opponentId != null ? result.puzzles_solved[opponentId] ?? 0 : 0;
  const opponentName =
    (opponentId && result.player_names?.[opponentId]) || 'Opponent';
  const isBot = opponentName === 'Bot';

  let banner = 'TIE';
  let bannerColor = '#fbbf24';
  if (result.winner_id === userId) {
    banner = 'YOU WIN';
    bannerColor = '#4ade80';
  } else if (result.winner_id && result.winner_id !== userId) {
    banner = 'YOU LOSE';
    bannerColor = '#ff6b6b';
  }

  const reasonLabel = endReasonLabel(
    result.end_reason,
    result.winner_id === userId
      ? true
      : result.winner_id && result.winner_id !== userId
        ? false
        : null,
  );

  const handleHome = () => {
    disconnect();
    onHome();
  };

  const handleNewGame = () => {
    disconnect();
    onNewGame();
  };

  const handleRematchBot = () => {
    disconnect();
    onRematchBot();
  };

  const handleShare = async () => {
    const playerName = result.player_names?.[userId] ?? 'You';
    const won =
      result.winner_id === userId
        ? true
        : result.winner_id && result.winner_id !== userId
          ? false
          : null;
    const myResults = result.puzzle_results?.[userId] ?? [];
    const message = buildLiveDuelShareMessage({
      playerName,
      opponentName,
      myScore,
      opponentScore,
      won,
      puzzlesSolved: mySolved,
      puzzleResults: myResults.map((r) => ({
        difficulty: r.difficulty,
        solved: r.solved,
        score: r.score,
      })),
    });
    try {
      await Share.share({ message });
    } catch {
      // user dismissed
    }
  };

  const rematchHint =
    rematchStatus === 'waiting'
      ? `Waiting for ${opponentName} to accept rematch…`
      : rematchStatus === 'offer' && rematchOfferFrom
        ? `${rematchOfferFrom} wants a rematch!`
        : null;

  const rematchDisabled = rematchStatus === 'waiting';

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.banner, { color: bannerColor }]}>{banner}</Text>
      {reasonLabel ? <Text style={styles.reasonLabel}>{reasonLabel}</Text> : null}

      {stats ? (
        <Text style={styles.statsLine}>
          Record: {stats.wins}W · {stats.losses}L · {stats.ties}T
          {stats.currentStreak > 0 ? ` · 🔥 ${stats.currentStreak} streak` : ''}
        </Text>
      ) : null}

      <View style={styles.scoreCard}>
        <View style={styles.scoreRow}>
          <View style={styles.scoreIdentity}>
            <PlayerAvatar name={result.player_names?.[userId] ?? 'You'} size={36} />
            <Text style={styles.scoreLabel}>You</Text>
          </View>
          <Text style={styles.scoreValue}>
            {formatScore(myScore)} · {mySolved} solved
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <View style={styles.scoreIdentity}>
            <PlayerAvatar name={opponentName} size={36} />
            <Text style={styles.scoreLabel}>{opponentName}</Text>
          </View>
          <Text style={styles.scoreValue}>
            {formatScore(opponentScore)} · {opponentSolved} solved
          </Text>
        </View>
      </View>

      {analysisRows.length > 0 ? (
        <View style={styles.analysisSection}>
          <Text style={styles.analysisTitle}>Puzzle-by-puzzle</Text>
          {analysisRows.map((row) => (
            <PuzzleAnalysisRow
              key={`puzzle-${row.index}`}
              index={row.index}
              mine={row.mine}
              theirs={row.theirs}
              opponentName={opponentName}
            />
          ))}
        </View>
      ) : null}

      {rematchHint ? <Text style={styles.rematchHint}>{rematchHint}</Text> : null}

      <TouchableOpacity style={styles.shareBtn} onPress={() => void handleShare()}>
        <Text style={styles.shareBtnText}>Share result</Text>
      </TouchableOpacity>

      {!isBot && rematchStatus === 'offer' ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={acceptRematch}>
          <Text style={styles.primaryBtnText}>Accept rematch vs {opponentName}</Text>
        </TouchableOpacity>
      ) : isBot ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={handleRematchBot}>
          <Text style={styles.primaryBtnText}>Rematch vs Bot</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.primaryBtn, rematchDisabled && styles.btnDisabled]}
          disabled={rematchDisabled}
          onPress={requestRematch}
        >
          <Text style={styles.primaryBtnText}>
            {rematchDisabled ? 'Waiting for opponent…' : `Rematch vs ${opponentName}`}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.newGameBtn} onPress={handleNewGame}>
        <Text style={styles.newGameBtnText}>New game</Text>
        <Text style={styles.newGameHint}>Find a different opponent</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={handleHome}>
        <Text style={styles.secondaryBtnText}>Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    padding: 24,
    gap: 20,
    alignItems: 'stretch',
    paddingBottom: 32,
  },
  banner: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  reasonLabel: {
    color: '#888',
    textAlign: 'center',
    fontSize: 14,
  },
  statsLine: {
    color: '#e85a3c',
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 14,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    textAlign: 'center',
  },
  scoreCard: {
    backgroundColor: '#1a1a28',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  scoreLabel: { color: '#aaa', fontSize: 16 },
  scoreValue: { color: '#f5f5ff', fontSize: 16, fontWeight: '700' },
  analysisSection: { gap: 10 },
  analysisTitle: { color: '#f5f5ff', fontSize: 18, fontWeight: '800' },
  analysisRow: {
    backgroundColor: '#1a1a28',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  analysisIndex: { color: '#e85a3c', fontWeight: '800', fontSize: 14 },
  analysisWord: { color: '#f5f5ff', fontWeight: '700', fontSize: 15, flex: 1 },
  analysisDiff: { color: '#888', fontSize: 11, fontWeight: '700' },
  analysisScores: { flexDirection: 'row', gap: 12 },
  analysisCol: { flex: 1, gap: 2 },
  analysisColLabel: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  analysisScore: { color: '#f5f5ff', fontSize: 18, fontWeight: '800' },
  analysisMeta: { color: '#94a3b8', fontSize: 11 },
  analysisSkipped: { color: '#555', fontSize: 16 },
  rematchHint: {
    color: '#fbbf24',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 14,
  },
  shareBtn: {
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  shareBtnText: { color: '#f5f5ff', fontSize: 16, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: '#e85a3c',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  btnDisabled: { opacity: 0.55 },
  newGameBtn: {
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e85a3c',
    gap: 2,
  },
  newGameBtnText: { color: '#f5f5ff', fontSize: 17, fontWeight: '700' },
  newGameHint: { color: '#888', fontSize: 12 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#888', fontSize: 16 },
});
