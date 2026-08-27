import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScoreResult } from '../types';
import { formatScore } from '../scoring';

interface Props {
  targetWord: string;
  currentWord: string;
  isSolved: boolean;
  misses?: number;
  backtracks?: number;
  scoreResult?: ScoreResult | null;
  scorePending?: boolean;
}

export const WordDisplay: React.FC<Props> = ({
  targetWord,
  currentWord,
  isSolved,
  misses = 0,
  backtracks = 0,
  scoreResult = null,
  scorePending = false,
}) => {
  return (
    <View style={styles.container}>
      {/* Target Word preview */}
      <View style={styles.targetSection}>
        <Text style={styles.targetLabel}>TARGET WORD</Text>
        <Text style={styles.targetWord}>{targetWord}</Text>
      </View>

      {/* Spelled Word state */}
      <View style={styles.currentSection}>
        <Text style={styles.currentLabel}>
          SPELLED:{' '}
          <Text style={styles.lengthText}>
            ({currentWord.length}/{targetWord.length})
          </Text>
        </Text>
        <View style={styles.lettersContainer}>
          {currentWord.split('').map((char, index) => (
            <View key={index} style={styles.letterBox}>
              <Text style={styles.letterText}>{char}</Text>
            </View>
          ))}
          {currentWord.length === 0 && (
            <Text style={styles.placeholderText}>
              Drag from START through empty cells to spell
            </Text>
          )}
        </View>
      </View>

      {/* Success banner */}
      {isSolved && (
        <View style={styles.solvedBanner}>
          <Text style={styles.solvedTitle}>PUZZLE SOLVED!</Text>
          <Text style={styles.solvedSub}>
            You successfully spelled {targetWord}!
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <Text style={styles.statValue}>
                {scorePending && scoreResult == null
                  ? '…'
                  : formatScore(scoreResult?.score)}
              </Text>
              <Text style={styles.statLabel}>Score</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statValue}>{misses}</Text>
              <Text style={styles.statLabel}>Misses</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statValue}>{backtracks}</Text>
              <Text style={styles.statLabel}>Backtracks</Text>
            </View>
          </View>
          {scoreResult?.solved ? (
            <Text style={styles.scoreBreakdown}>
              {formatScore(scoreResult.base_points)} base −{' '}
              {formatScore(scoreResult.miss_penalty)} misses −{' '}
              {formatScore(scoreResult.backtrack_penalty)} backtracks
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    width: '100%',
  },
  targetSection: {
    alignItems: 'center',
    marginBottom: 8,
  },
  targetLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1.5,
  },
  targetWord: {
    fontSize: 22,
    fontWeight: '900',
    color: '#4338ca',
    letterSpacing: 3,
    marginTop: 2,
  },
  currentSection: {
    alignItems: 'center',
    width: '100%',
  },
  currentLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 1,
    marginBottom: 4,
  },
  lengthText: {
    color: '#6366f1',
    fontWeight: '800',
  },
  lettersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
  },
  letterBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  letterText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  placeholderText: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  solvedBanner: {
    marginTop: 10,
    backgroundColor: '#10b981',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    width: '90%',
    maxWidth: 380,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  solvedTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  solvedSub: {
    color: '#ecfdf5',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  statChip: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 88,
    alignItems: 'center',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    color: '#ecfdf5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  scoreBreakdown: {
    color: '#ecfdf5',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
  },
});
