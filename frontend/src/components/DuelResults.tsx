import React, { useState } from 'react';
import {
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { buildDuelShareMessage, formatDuration } from '../api';
import { formatScore } from '../scoring';
import {
  DuelAttempt,
  DuelInfo,
  DuelLeaderboard,
  LeaderboardEntry,
  PuzzleData,
} from '../types';
import { GameBoard } from './GameBoard';

interface Props {
  duel: DuelInfo;
  attempt: DuelAttempt;
  leaderboard: DuelLeaderboard | null;
  revealedPuzzles: PuzzleData[];
  onPlayAgain: () => void;
  onBackToLobby: () => void;
  onBackToSolo: () => void;
}

function EntryRow({
  entry,
  highlight,
}: {
  entry: LeaderboardEntry;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.row, highlight && styles.rowHighlight]}>
      <Text style={[styles.rank, highlight && styles.rowTextHi]}>
        #{entry.rank}
      </Text>
      <View style={styles.rowMid}>
        <Text style={[styles.rowName, highlight && styles.rowTextHi]}>
          {entry.player_name}
        </Text>
        <Text style={[styles.rowMeta, highlight && styles.rowMetaHi]}>
          {formatDuration(entry.total_time_ms)}
        </Text>
      </View>
      <Text style={[styles.rowScore, highlight && styles.rowTextHi]}>
        {entry.total_score.toFixed(2)}
      </Text>
    </View>
  );
}

export const DuelResults: React.FC<Props> = ({
  duel,
  attempt,
  leaderboard,
  revealedPuzzles,
  onPlayAgain,
  onBackToLobby,
  onBackToSolo,
}) => {
  const champion = leaderboard?.champion ?? null;
  const neighborhood = leaderboard?.neighborhood ?? [];
  const [expandedIndex, setExpandedIndex] = useState(0);

  const share = async () => {
    const message = buildDuelShareMessage({
      code: duel.code,
      playerName: attempt.player_name || 'Player',
      totalScore: attempt.total_score,
      totalTimeMs: attempt.total_time_ms,
      becameChampion: attempt.became_champion,
      beatChampion: attempt.beat_champion,
      championName: duel.champion?.player_name,
      championScore: duel.champion?.total_score,
      puzzleResults: attempt.puzzle_results.map((r) => ({
        difficulty: String(r.difficulty),
        score: r.score,
        solved: r.solved,
        skipped: r.skipped,
      })),
    });
    try {
      await Share.share({ message });
    } catch {
      // user cancelled
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SPELLPATH COMBAT COMPLETE</Text>
      {attempt.became_champion ? (
        <Text style={styles.hero}>You took the crown!</Text>
      ) : attempt.beat_champion ? (
        <Text style={styles.hero}>You beat the old record</Text>
      ) : (
        <Text style={styles.hero}>Run finished</Text>
      )}

      <View style={styles.scoreCard}>
        <Text style={styles.bigScore}>{attempt.total_score.toFixed(2)}</Text>
        <Text style={styles.scoreSub}>
          {formatDuration(attempt.total_time_ms)}
          {leaderboard?.your_rank
            ? ` · Rank #${leaderboard.your_rank} of ${leaderboard.total_attempts}`
            : ''}
        </Text>
      </View>

      <View style={styles.breakdown}>
        {attempt.puzzle_results.map((slot) => (
          <View key={`${slot.puzzle_id}-final`} style={styles.breakRow}>
            <Text style={styles.breakDiff}>
              {String(slot.difficulty).toUpperCase()}
            </Text>
            <Text style={styles.breakScore}>
              {slot.skipped ? 'Skipped' : formatScore(slot.score)}
            </Text>
            <Text style={styles.breakTime}>{formatDuration(slot.time_ms)}</Text>
          </View>
        ))}
      </View>

      {revealedPuzzles.length > 0 ? (
        <View style={styles.solutionsSection}>
          <Text style={styles.solutionsTitle}>Official solutions</Text>
          <Text style={styles.solutionsHint}>
            Revealed after you finish all six puzzles. Tap a board to expand.
          </Text>
          {revealedPuzzles.map((puzzle, index) => {
            const slot = attempt.puzzle_results[index];
            const expanded = expandedIndex === index;
            const solutionPath =
              puzzle.solutionPath?.length > 0
                ? puzzle.solutionPath
                : [puzzle.startCell];
            return (
              <View key={`sol-${puzzle.id}-${index}`} style={styles.solutionCard}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() =>
                    setExpandedIndex(expanded ? -1 : index)
                  }
                  style={styles.solutionHeader}
                >
                  <View>
                    <Text style={styles.solutionLabel}>
                      Puzzle {index + 1} · {String(puzzle.difficulty).toUpperCase()}
                    </Text>
                    <Text style={styles.solutionWord}>{puzzle.targetWord}</Text>
                  </View>
                  <Text style={styles.solutionStatus}>
                    {slot?.skipped
                      ? 'You skipped'
                      : slot?.solved
                        ? `You scored ${formatScore(slot.score)}`
                        : 'Unsolved'}
                  </Text>
                </TouchableOpacity>
                {expanded ? (
                  <View style={styles.solutionBoard}>
                    <GameBoard
                      puzzle={puzzle}
                      path={solutionPath}
                      onPathChange={() => undefined}
                      interactionLocked
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {champion ? (
        <View style={styles.champBox}>
          <Text style={styles.champLabel}>CURRENT CHAMPION</Text>
          <Text style={styles.champName}>{champion.player_name}</Text>
          <Text style={styles.champScore}>
            {champion.total_score.toFixed(2)} pts ·{' '}
            {formatDuration(champion.total_time_ms)}
          </Text>
        </View>
      ) : null}

      {neighborhood.length > 0 ? (
        <View style={styles.board}>
          <Text style={styles.boardTitle}>Nearby standings</Text>
          {neighborhood.map((entry) => (
            <EntryRow
              key={entry.attempt_id}
              entry={entry}
              highlight={entry.attempt_id === attempt.id}
            />
          ))}
        </View>
      ) : null}

      <TouchableOpacity style={styles.shareBtn} onPress={() => void share()}>
        <Text style={styles.shareBtnText}>Share challenge result</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.primaryBtn} onPress={onPlayAgain}>
        <Text style={styles.primaryBtnText}>Try again on this pack</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onBackToLobby}>
        <Text style={styles.secondaryBtnText}>Back to spellpath combat lobby</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onBackToSolo}>
        <Text style={styles.link}>Return to solo mode</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 10,
  },
  eyebrow: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '800',
    color: '#0f766e',
    letterSpacing: 1.2,
  },
  hero: {
    fontSize: 26,
    fontWeight: '900',
    color: '#134e4a',
  },
  scoreCard: {
    backgroundColor: '#ecfdf5',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#99f6e4',
  },
  bigScore: {
    fontSize: 40,
    fontWeight: '900',
    color: '#115e59',
  },
  scoreSub: {
    marginTop: 4,
    color: '#0f766e',
    fontWeight: '700',
  },
  breakdown: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  breakRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center',
  },
  breakDiff: {
    width: 72,
    fontWeight: '800',
    color: '#475569',
    fontSize: 12,
  },
  breakScore: {
    flex: 1,
    fontWeight: '800',
    color: '#0f172a',
  },
  breakTime: {
    color: '#64748b',
    fontWeight: '600',
  },
  solutionsSection: {
    gap: 8,
  },
  solutionsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#134e4a',
  },
  solutionsHint: {
    color: '#64748b',
    fontSize: 13,
    marginBottom: 4,
  },
  solutionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  solutionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  solutionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0f766e',
    letterSpacing: 0.8,
  },
  solutionWord: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  solutionStatus: {
    fontWeight: '700',
    color: '#64748b',
    fontSize: 12,
    maxWidth: 120,
    textAlign: 'right',
  },
  solutionBoard: {
    alignItems: 'center',
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  champBox: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
    alignItems: 'center',
  },
  champLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 1,
  },
  champName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#92400e',
  },
  champScore: {
    color: '#a16207',
    fontWeight: '700',
  },
  board: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
  },
  boardTitle: {
    fontWeight: '800',
    color: '#334155',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rowHighlight: {
    backgroundColor: '#ccfbf1',
  },
  rank: {
    width: 36,
    fontWeight: '800',
    color: '#64748b',
  },
  rowMid: {
    flex: 1,
  },
  rowName: {
    fontWeight: '800',
    color: '#0f172a',
  },
  rowMeta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  rowMetaHi: {
    color: '#0f766e',
  },
  rowScore: {
    fontWeight: '900',
    color: '#0f172a',
  },
  rowTextHi: {
    color: '#134e4a',
  },
  shareBtn: {
    backgroundColor: '#f59e0b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareBtnText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  primaryBtn: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  secondaryBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  secondaryBtnText: {
    color: '#334155',
    fontWeight: '800',
  },
  link: {
    textAlign: 'center',
    color: '#0f766e',
    fontWeight: '700',
    paddingVertical: 8,
  },
});
