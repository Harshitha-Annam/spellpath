import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Difficulty } from '../types';
import { ServerHostButton } from './ServerHostButton';

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
}) => {
  const isBusy = isGenerating || isBuilding;
  const difficulties: { key: Difficulty; label: string }[] = [
    { key: 'easy', label: 'Easy' },
    { key: 'medium', label: 'Medium' },
    { key: 'hard', label: 'Hard' },
  ];

  return (
    <View style={styles.headerContainer}>
      <View style={styles.titleRow}>
        <View style={styles.titleSpacer} />
        <Text style={styles.title}>Spell Path</Text>
        <View style={styles.titleActions}>
          <ServerHostButton disabled={isBusy} />
        </View>
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
            style={[styles.actionBtn, styles.resetBtn]}
            onPress={onReset}
          >
            <Text style={styles.resetBtnText}>🔄 Reset Board</Text>
          </TouchableOpacity>

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
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  titleRow: {
    width: '100%',
    maxWidth: 380,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleSpacer: {
    width: 36,
  },
  titleActions: {
    width: 36,
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 32,
    fontWeight: '900',
    color: '#1e1b4b',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  scoreChip: {
    marginTop: 8,
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
  liveDuelBtn: {
    backgroundColor: '#059669',
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
    backgroundColor: '#4f46e5',
  },
  generateBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  buildBtn: {
    backgroundColor: '#0d9488',
  },
  buildBtnText: {
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
