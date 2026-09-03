import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '../api';
import { formatScore } from '../scoring';
import { DuelAttempt, DuelChampion } from '../types';

interface Props {
  attempt: DuelAttempt;
  champion: DuelChampion | null;
  puzzleIndex: number;
  elapsedMs: number;
}

export const DuelProgress: React.FC<Props> = ({
  attempt,
  champion,
  puzzleIndex,
  elapsedMs,
}) => {
  const ghostScore =
    champion?.puzzle_results?.[puzzleIndex]?.score ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.label}>SPELLPATH COMBAT SCORE</Text>
          <Text style={styles.value}>{attempt.total_score.toFixed(2)}</Text>
        </View>
        <View style={styles.rightMeta}>
          <Text style={styles.label}>PUZZLE TIME</Text>
          <Text style={styles.value}>{formatDuration(elapsedMs)}</Text>
        </View>
      </View>

      {champion ? (
        <Text style={styles.ghostLine}>
          Beat {champion.player_name}: {champion.total_score.toFixed(2)} pts
          {ghostScore != null
            ? ` · this board ${formatScore(ghostScore)}`
            : ''}
        </Text>
      ) : (
        <Text style={styles.ghostLine}>Set the first record on this pack</Text>
      )}

      <View style={styles.slots}>
        {attempt.puzzle_results.map((slot, i) => {
          const done = slot.submitted_at != null;
          const skipped = Boolean(slot.skipped);
          const current = i === puzzleIndex && !done;
          const letter =
            String(slot.difficulty || '').charAt(0).toUpperCase() || '?';
          return (
            <View
              key={`${slot.puzzle_id}-${i}`}
              style={[
                styles.slot,
                done && !skipped && styles.slotDone,
                done && skipped && styles.slotSkipped,
                current && styles.slotCurrent,
                !done && !current && styles.slotPending,
              ]}
            >
              <Text
                style={[
                  styles.slotLetter,
                  (done || current) && styles.slotLetterActive,
                ]}
              >
                {letter}
              </Text>
              <Text
                style={[
                  styles.slotScore,
                  (done || current) && styles.slotScoreActive,
                ]}
              >
                {done
                  ? skipped
                    ? 'skip'
                    : formatScore(slot.score)
                  : current
                    ? '…'
                    : '·'}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.progressCaption}>
        Puzzle {Math.min(puzzleIndex + 1, attempt.puzzle_results.length)} of{' '}
        {attempt.puzzle_results.length}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#1a1a28',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rightMeta: {
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7c6cff',
    letterSpacing: 1,
  },
  value: {
    fontSize: 22,
    fontWeight: '900',
    color: '#f5f5ff',
  },
  ghostLine: {
    marginTop: 6,
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 13,
  },
  slots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  slot: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  slotDone: {
    backgroundColor: '#7c6cff',
  },
  slotSkipped: {
    backgroundColor: '#555',
  },
  slotCurrent: {
    backgroundColor: '#fbbf24',
  },
  slotPending: {
    backgroundColor: '#2a2a3a',
  },
  slotLetter: {
    fontWeight: '900',
    color: '#aaa',
    fontSize: 12,
  },
  slotLetterActive: {
    color: '#ffffff',
  },
  slotScore: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    color: '#7c6cff',
  },
  slotScoreActive: {
    color: '#f5f5ff',
  },
  progressCaption: {
    marginTop: 8,
    textAlign: 'center',
    color: '#888',
    fontWeight: '600',
    fontSize: 12,
  },
});
