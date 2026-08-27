import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Difficulty } from '../types';

interface Props {
  selectedDifficulty: Difficulty;
  onSelectDifficulty: (difficulty: Difficulty) => void;
  onGenerate: () => void;
  onReset: () => void;
  onShowSolution?: () => void;
  showingSolution?: boolean;
  isGenerating?: boolean;
  sessionScore?: number;
  onOpenDuel?: () => void;
}

export const HeaderControls: React.FC<Props> = ({
  selectedDifficulty,
  onSelectDifficulty,
  onGenerate,
  onReset,
  onShowSolution,
  showingSolution = false,
  isGenerating = false,
  sessionScore = 0,
  onOpenDuel,
}) => {
  const difficulties: { key: Difficulty; label: string; gridLabel: string }[] = [
    { key: 'easy', label: 'Easy', gridLabel: '5x5' },
    { key: 'medium', label: 'Medium', gridLabel: '7x7' },
    { key: 'hard', label: 'Hard', gridLabel: '9x9' },
  ];

  return (
    <View style={styles.headerContainer}>
      <Text style={styles.title}>Spell Path</Text>
      <Text style={styles.subtitle}>Connect letters orthogonally to spell the target word!</Text>
      <View style={styles.scoreChip}>
        <Text style={styles.scoreLabel}>TOTAL SCORE</Text>
        <Text style={styles.scoreValue}>{sessionScore.toFixed(2)}</Text>
      </View>

      {onOpenDuel ? (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.duelBtn}
          onPress={onOpenDuel}
          disabled={isGenerating}
        >
          <Text style={styles.duelBtnText}>⚔️ Async Duel</Text>
          <Text style={styles.duelBtnSub}>6-puzzle challenge · beat a friend's record</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.difficultyRow}>
        {difficulties.map((diff) => {
          const isSelected = selectedDifficulty === diff.key;
          return (
            <TouchableOpacity
              key={diff.key}
              activeOpacity={0.8}
              disabled={isGenerating}
              onPress={() => onSelectDifficulty(diff.key)}
              style={[
                styles.difficultyButton,
                isSelected && styles.difficultyButtonActive,
                isGenerating && styles.disabledBtn,
              ]}
            >
              <Text
                style={[
                  styles.difficultyText,
                  isSelected && styles.difficultyTextActive,
                ]}
              >
                {diff.label}
              </Text>
              <Text
                style={[
                  styles.difficultySubText,
                  isSelected && styles.difficultySubTextActive,
                ]}
              >
                {diff.gridLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Control Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={isGenerating}
          style={[
            styles.actionBtn,
            styles.generateBtn,
            isGenerating && styles.disabledBtn,
          ]}
          onPress={onGenerate}
        >
          <Text style={styles.generateBtnText}>
            {isGenerating ? 'Generating…' : '✨ Generate Puzzle'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.actionBtn, styles.resetBtn]}
          onPress={onReset}
        >
          <Text style={styles.resetBtnText}>🔄 Reset Board</Text>
        </TouchableOpacity>
      </View>

      {onShowSolution ? (
        <TouchableOpacity
          activeOpacity={0.8}
          style={[
            styles.actionBtn,
            styles.solutionBtn,
            showingSolution && styles.solutionBtnActive,
          ]}
          onPress={onShowSolution}
        >
          <Text
            style={[
              styles.solutionBtnText,
              showingSolution && styles.solutionBtnTextActive,
            ]}
          >
            {showingSolution ? '🙈 Hide Solution' : '🧭 Show Solution'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#1e1b4b',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 10,
    textAlign: 'center',
  },
  scoreChip: {
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginBottom: 12,
    minWidth: 140,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6366f1',
    letterSpacing: 1.2,
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#312e81',
    marginTop: 1,
  },
  duelBtn: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  duelBtnText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 16,
  },
  duelBtnSub: {
    marginTop: 2,
    color: '#ccfbf1',
    fontWeight: '600',
    fontSize: 12,
  },
  difficultyRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    width: '100%',
    maxWidth: 380,
  },
  difficultyButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  difficultyButtonActive: {
    backgroundColor: '#6366f1',
  },
  difficultyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  difficultyTextActive: {
    color: '#ffffff',
  },
  difficultySubText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#94a3b8',
    marginTop: 1,
  },
  difficultySubTextActive: {
    color: '#e0e7ff',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 380,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtn: {
    backgroundColor: '#4f46e5',
  },
  generateBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  resetBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  resetBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 14,
  },
  solutionBtn: {
    marginTop: 10,
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  solutionBtnActive: {
    backgroundColor: '#ea580c',
    borderColor: '#c2410c',
  },
  solutionBtnText: {
    color: '#9a3412',
    fontWeight: '700',
    fontSize: 14,
  },
  solutionBtnTextActive: {
    color: '#ffffff',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
