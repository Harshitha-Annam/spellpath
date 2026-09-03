import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatDuration } from '../api';
import { DuelInfo, PlayerProfile } from '../types';

interface Props {
  player: PlayerProfile | null;
  suggestedName?: string;
  duel: DuelInfo | null;
  isBusy: boolean;
  error: string | null;
  onRegister: (name: string) => void;
  onSwitchPlayer: () => void;
  onCreateDuel: () => void;
  onJoinDuel: (code: string) => void;
  onStartRun: () => void;
  onBackToSolo: () => void;
}

export const DuelLobby: React.FC<Props> = ({
  player,
  suggestedName = '',
  duel,
  isBusy,
  error,
  onRegister,
  onSwitchPlayer,
  onCreateDuel,
  onJoinDuel,
  onStartRun,
  onBackToSolo,
}) => {
  const [name, setName] = useState(player?.name ?? suggestedName);
  const [code, setCode] = useState('');

  useEffect(() => {
    setName(player?.name ?? suggestedName);
  }, [player?.name, suggestedName]);

  const champion = duel?.champion;
  const ready = duel?.status === 'ready';
  const preparing = duel?.status === 'preparing';

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={onBackToSolo} style={styles.backBtn}>
          <Text style={styles.backText}>← Solo mode</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Spellpath Combat</Text>
      <Text style={styles.subtitle}>
        Same 6 puzzles for everyone — 2 easy, 2 medium, 2 hard. Beat the champion
        on your own time.
      </Text>

      {!player ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>WHO IS PLAYING?</Text>
          <Text style={styles.hint}>
            Enter a name for this device session. Friends on the same phone can
            switch players anytime.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#888"
            maxLength={24}
            autoCapitalize="words"
            style={styles.input}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, isBusy && styles.disabled]}
            disabled={isBusy || !name.trim()}
            onPress={() => onRegister(name.trim())}
          >
            <Text style={styles.primaryBtnText}>
              {isBusy ? 'Saving…' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.playerRow}>
          <View style={styles.playerChip}>
            <Text style={styles.playerLabel}>Playing as</Text>
            <Text style={styles.playerName}>{player.name}</Text>
          </View>
          <TouchableOpacity
            onPress={onSwitchPlayer}
            disabled={isBusy}
            style={styles.switchBtn}
          >
            <Text style={styles.switchBtnText}>Switch player</Text>
          </TouchableOpacity>
        </View>
      )}

      {player ? (
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.primaryBtn, isBusy && styles.disabled]}
            disabled={isBusy}
            onPress={onCreateDuel}
          >
            <Text style={styles.primaryBtnText}>
              {isBusy ? 'Working…' : duel ? 'Create another spellpath combat' : 'Create new spellpath combat'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.orText}>or join a friend's challenge</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            placeholder="Challenge code"
            placeholderTextColor="#888"
            autoCapitalize="characters"
            maxLength={8}
            style={styles.input}
          />
          <TouchableOpacity
            style={[styles.secondaryBtn, isBusy && styles.disabled]}
            disabled={isBusy || code.trim().length < 4}
            onPress={() => onJoinDuel(code.trim())}
          >
            <Text style={styles.secondaryBtnText}>Join spellpath combat</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {duel ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>CHALLENGE CODE</Text>
          <Text style={styles.code}>{duel.code}</Text>
          <Text style={styles.hint}>Share this code so friends play the same pack.</Text>

          {champion ? (
            <View style={styles.championBanner}>
              <Text style={styles.championEyebrow}>SCORE TO BEAT</Text>
              <Text style={styles.championName}>{champion.player_name}</Text>
              <Text style={styles.championScore}>
                {champion.total_score.toFixed(2)} pts
              </Text>
              <Text style={styles.championMeta}>
                {formatDuration(champion.total_time_ms)} · {duel.attempt_count}{' '}
                {duel.attempt_count === 1 ? 'run' : 'runs'}
              </Text>
            </View>
          ) : (
            <View style={styles.openBanner}>
              <Text style={styles.openTitle}>Be the first champion</Text>
              <Text style={styles.openSub}>
                Set a record others will chase.
              </Text>
            </View>
          )}

          {preparing ? (
            <View style={styles.prepBox}>
              <ActivityIndicator color="#7c6cff" />
              <View style={styles.prepCopy}>
                <Text style={styles.prepText}>
                  Generating puzzle pack with DeepSeek…
                </Text>
                <Text style={styles.prepSub}>
                  {duel.prepared_count}/{duel.puzzle_count} ready — this can take a
                  few minutes
                </Text>
              </View>
            </View>
          ) : null}

          {duel.status === 'failed' ? (
            <Text style={styles.errorText}>
              {duel.error || 'Failed to prepare puzzles. Create a new spellpath combat.'}
            </Text>
          ) : null}

          {ready ? (
            <TouchableOpacity
              style={[styles.primaryBtn, isBusy && styles.disabled]}
              disabled={isBusy}
              onPress={onStartRun}
            >
              <Text style={styles.primaryBtnText}>
                {isBusy
                  ? 'Starting…'
                  : champion
                    ? `Challenge ${champion.player_name}`
                    : 'Start gauntlet'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    width: '100%',
  },
  topRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  backText: {
    color: '#7c6cff',
    fontWeight: '700',
    fontSize: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#f5f5ff',
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 16,
    color: '#aaa',
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#1a1a28',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    marginBottom: 12,
    gap: 10,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7c6cff',
    letterSpacing: 1.1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#fff',
    backgroundColor: '#1e1e2e',
  },
  primaryBtn: {
    backgroundColor: '#7c6cff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryBtn: {
    backgroundColor: '#2a2a3a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#555',
  },
  secondaryBtnText: {
    color: '#f5f5ff',
    fontWeight: '800',
    fontSize: 15,
  },
  orText: {
    textAlign: 'center',
    color: '#888',
    fontWeight: '600',
    marginVertical: 4,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  playerChip: {
    flex: 1,
    backgroundColor: '#1e1e2e',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  playerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7c6cff',
    letterSpacing: 0.8,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f5f5ff',
  },
  switchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  switchBtnText: {
    color: '#7c6cff',
    fontWeight: '800',
    fontSize: 13,
  },
  code: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 4,
    color: '#f5f5ff',
  },
  hint: {
    color: '#888',
    fontSize: 13,
  },
  championBanner: {
    backgroundColor: '#3b2f00',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fbbf24',
    alignItems: 'center',
  },
  championEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fbbf24',
    letterSpacing: 1.2,
  },
  championName: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '900',
    color: '#f5f5ff',
  },
  championScore: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fbbf24',
  },
  championMeta: {
    marginTop: 2,
    color: '#ccc',
    fontWeight: '600',
  },
  openBanner: {
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  openTitle: {
    fontWeight: '800',
    color: '#f5f5ff',
    fontSize: 16,
  },
  openSub: {
    marginTop: 2,
    color: '#aaa',
  },
  prepBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  prepCopy: {
    flex: 1,
  },
  prepText: {
    color: '#7c6cff',
    fontWeight: '700',
  },
  prepSub: {
    marginTop: 2,
    color: '#888',
    fontWeight: '600',
    fontSize: 12,
  },
  errorText: {
    color: '#ff6b6b',
    fontWeight: '700',
    marginTop: 8,
  },
  disabled: {
    opacity: 0.6,
  },
});
