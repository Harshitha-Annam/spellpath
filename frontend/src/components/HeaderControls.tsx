import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Difficulty } from '../types';

interface Props {
  selectedDifficulty: Difficulty;
  onSelectDifficulty: (difficulty: Difficulty) => void;
  onGenerate: () => void;
  onBuild?: () => void;
  onReset: () => void;
  onShowSolution?: () => void;
  showingSolution?: boolean;
  isGenerating?: boolean;
  isBuilding?: boolean;
  sessionScore?: number;
  onOpenDuel?: () => void;
  onOpenLiveDuel?: () => void;
  /** Reset / Show Solution only apply once a puzzle is on the board. */
  hasPuzzle?: boolean;
}

export const HeaderControls: React.FC<Props> = ({
  selectedDifficulty,
  onSelectDifficulty,
  onGenerate,
  onBuild,
  onReset,
  onShowSolution,
  showingSolution = false,
  isGenerating = false,
  isBuilding = false,
  sessionScore = 0,
  onOpenDuel,
  onOpenLiveDuel,
  hasPuzzle = false,
}) => {
  const isBusy = isGenerating || isBuilding;
  const boardActionsDisabled = isBusy || !hasPuzzle;
  const difficulties: { key: Difficulty; label: string }[] = [
    { key: 'easy', label: 'Easy' },
    { key: 'medium', label: 'Medium' },
    { key: 'hard', label: 'Hard' },
  ];

  return (
    <View style={styles.headerContainer}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Spell Path</Text>
      </View>
      <View style={styles.scoreChip}>
        <Text style={styles.scoreLabel}>TOTAL SCORE</Text>
        <Text style={styles.scoreValue}>{sessionScore.toFixed(2)}</Text>
      </View>

      {onOpenLiveDuel ? (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.liveDuelBtn}
          onPress={onOpenLiveDuel}
          disabled={isBusy}
        >
          <Text style={styles.liveDuelBtnText}>⚡ Live Duel</Text>
        </TouchableOpacity>
      ) : null}
      {onOpenDuel ? (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.duelBtn}
          onPress={onOpenDuel}
          disabled={isBusy}
        >
          <Text style={styles.duelBtnText}>⚔️ Spellpath Combat</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.difficultyRow}>
        {difficulties.map((diff) => {
          const isSelected = selectedDifficulty === diff.key;
          return (
            <TouchableOpacity
              key={diff.key}
              activeOpacity={0.8}
              disabled={isBusy}
              onPress={() => onSelectDifficulty(diff.key)}
              style={[
                styles.difficultyButton,
                isSelected && styles.difficultyButtonActive,
                isBusy && styles.disabledBtn,
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
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Control Buttons */}
      <View style={styles.actionColumn}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={isBusy}
            style={[
              styles.actionBtn,
              styles.generateBtn,
              isBusy && styles.disabledBtn,
            ]}
            onPress={onGenerate}
          >
            <Text style={styles.generateBtnText}>
              {isGenerating ? 'Generating…' : '✨ Generate Puzzle'}
            </Text>
          </TouchableOpacity>

          {onBuild ? (
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={isBusy}
              style={[
                styles.actionBtn,
                styles.buildBtn,
                isBusy && styles.disabledBtn,
              ]}
              onPress={onBuild}
            >
              <Text style={styles.buildBtnText}>
                {isBuilding ? 'Building…' : '🧩 Build Puzzle'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={boardActionsDisabled}
            style={[
              styles.actionBtn,
              styles.resetBtn,
              boardActionsDisabled && styles.disabledBtn,
            ]}
            onPress={onReset}
          >
            <Text style={styles.resetBtnText}>🔄 Reset Board</Text>
          </TouchableOpacity>

          {onShowSolution ? (
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={boardActionsDisabled}
              style={[
                styles.actionBtn,
                styles.solutionBtn,
                showingSolution && styles.solutionBtnActive,
                boardActionsDisabled && styles.disabledBtn,
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
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: '#0f0f18',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3a',
  },
  titleRow: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    fontSize: 32,
    fontWeight: '900',
    color: '#f5f5ff',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  scoreChip: {
    marginTop: 8,
    backgroundColor: '#1a1a28',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginBottom: 12,
    minWidth: 140,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7c6cff',
    letterSpacing: 1.2,
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#f5f5ff',
    marginTop: 1,
  },
  duelBtn: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#2a2a3a',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#555',
  },
  duelBtnText: {
    color: '#f5f5ff',
    fontWeight: '900',
    fontSize: 16,
  },
  liveDuelBtn: {
    backgroundColor: '#e85a3c',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    marginBottom: 8,
  },
  liveDuelBtnText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 16,
  },
  difficultyRow: {
    flexDirection: 'row',
    backgroundColor: '#1a1a28',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  difficultyButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  difficultyButtonActive: {
    backgroundColor: '#7c6cff',
  },
  difficultyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#aaa',
  },
  difficultyTextActive: {
    color: '#ffffff',
  },
  actionColumn: {
    width: '100%',
    maxWidth: 380,
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtn: {
    backgroundColor: '#7c6cff',
  },
  generateBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  buildBtn: {
    backgroundColor: '#2a2a3a',
    borderWidth: 1,
    borderColor: '#555',
  },
  buildBtnText: {
    color: '#f5f5ff',
    fontWeight: '700',
    fontSize: 14,
  },
  resetBtn: {
    backgroundColor: '#1e1e2e',
    borderWidth: 1,
    borderColor: '#333',
  },
  resetBtnText: {
    color: '#ccc',
    fontWeight: '700',
    fontSize: 14,
  },
  solutionBtn: {
    backgroundColor: '#3b2f00',
    borderWidth: 1,
    borderColor: '#fbbf24',
  },
  solutionBtnActive: {
    backgroundColor: '#fbbf24',
    borderColor: '#fbbf24',
  },
  solutionBtnText: {
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 14,
  },
  solutionBtnTextActive: {
    color: '#0f0f18',
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
