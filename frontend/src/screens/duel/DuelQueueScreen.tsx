import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createPlayer,
  fetchLiveDuelQueueStatus,
  joinLiveDuelBot,
  joinLiveDuelQueue,
  leaveLiveDuelQueue,
} from '../../api';
import { ServerHostButton } from '../../components/ServerHostButton';
import { hasSeenLiveDuelOnboarding, markLiveDuelOnboardingSeen } from '../../liveDuelOnboarding';
import { loadLiveDuelStats, LiveDuelStats } from '../../liveDuelStatsStorage';
import { loadPlayerProfile, savePlayerProfile } from '../../playerStorage';
import { PlayerProfile } from '../../types';
import { useDuelSocket } from './DuelSocketContext';

interface Props {
  onMatched: (duelId: string, opponentName?: string) => void;
  onBack: () => void;
  autoStart?: boolean;
}

const POLL_MS = 1500;
const BOT_OFFER_SEC = 15;

export const DuelQueueScreen: React.FC<Props> = ({ onMatched, onBack, autoStart }) => {
  const { disconnect, setOpponentName } = useDuelSocket();
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedOpponent, setMatchedOpponent] = useState<string | null>(null);
  const [waitSec, setWaitSec] = useState(0);
  const [showBotOffer, setShowBotOffer] = useState(false);
  const [stats, setStats] = useState<LiveDuelStats | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadPlayerProfile(), loadLiveDuelStats(), hasSeenLiveDuelOnboarding()]).then(
      ([profile, duelStats, seenOnboarding]) => {
        if (!mounted) {
          return;
        }
        if (profile) {
          setPlayer(profile);
          setNameInput(profile.name);
        }
        setStats(duelStats);
        if (!seenOnboarding) {
          setShowOnboarding(true);
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (waitTimerRef.current) {
      clearInterval(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setWaitSec(0);
    setShowBotOffer(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const ensurePlayer = useCallback(async (): Promise<PlayerProfile> => {
    if (player?.id) {
      return player;
    }
    const stored = await loadPlayerProfile();
    if (stored?.id) {
      setPlayer(stored);
      setNameInput(stored.name);
      return stored;
    }
    const name = nameInput.trim();
    if (!name) {
      throw new Error('Enter a display name');
    }
    const profile = await createPlayer(name);
    await savePlayerProfile(profile);
    setPlayer(profile);
    return profile;
  }, [nameInput, player]);

  const handleMatched = useCallback(
    (duelId: string, opponentName?: string) => {
      stopPolling();
      setWaiting(false);
      if (opponentName) {
        setMatchedOpponent(opponentName);
        setOpponentName(opponentName);
      }
      onMatched(duelId, opponentName);
    },
    [onMatched, setOpponentName, stopPolling],
  );

  const startPolling = useCallback(
    (userId: string) => {
      stopPolling();
      const controller = new AbortController();
      abortRef.current = controller;
      setWaitSec(0);
      setShowBotOffer(false);

      waitTimerRef.current = setInterval(() => {
        setWaitSec((s) => {
          const next = s + 1;
          if (next >= BOT_OFFER_SEC) {
            setShowBotOffer(true);
          }
          return next;
        });
      }, 1000);

      pollRef.current = setInterval(() => {
        void fetchLiveDuelQueueStatus(userId, controller.signal)
          .then((status) => {
            if (status.matched && status.duel_id) {
              handleMatched(status.duel_id, status.opponent_name ?? undefined);
            }
          })
          .catch(() => {
            // keep polling through transient errors
          });
      }, POLL_MS);
    },
    [handleMatched, stopPolling],
  );

  const handleFindDuel = useCallback(async () => {
    setError(null);
    setMatchedOpponent(null);
    setWaiting(true);
    try {
      const profile = await ensurePlayer();
      const response = await joinLiveDuelQueue(profile.id, profile.name);
      if (response.matched && response.duel_id) {
        handleMatched(response.duel_id, response.opponent_name ?? undefined);
        return;
      }
      startPolling(profile.id);
    } catch (err) {
      setWaiting(false);
      stopPolling();
      setError(err instanceof Error ? err.message : 'Could not join queue');
    }
  }, [ensurePlayer, handleMatched, startPolling, stopPolling]);

  const handlePlayBot = useCallback(async () => {
    setError(null);
    setWaiting(true);
    stopPolling();
    try {
      const profile = await ensurePlayer();
      const response = await joinLiveDuelBot(profile.id, profile.name);
      if (response.duel_id) {
        handleMatched(response.duel_id, response.opponent_name ?? 'Bot');
      }
    } catch (err) {
      setWaiting(false);
      setError(err instanceof Error ? err.message : 'Could not start bot duel');
    }
  }, [ensurePlayer, handleMatched, stopPolling]);

  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void handleFindDuel();
    }
  }, [autoStart, handleFindDuel]);

  const handleCancel = useCallback(async () => {
    stopPolling();
    setWaiting(false);
    setMatchedOpponent(null);
    if (player?.id) {
      try {
        await leaveLiveDuelQueue(player.id);
      } catch {
        // ignore
      }
    }
    disconnect();
    onBack();
  }, [disconnect, onBack, player?.id, stopPolling]);

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    void markLiveDuelOnboardingSeen();
  };

  const recordLine =
    stats != null
      ? `${stats.wins}W · ${stats.losses}L · ${stats.ties}T${stats.currentStreak > 0 ? ` · 🔥${stats.currentStreak}` : ''}`
      : null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Live Duel</Text>
        <ServerHostButton />
      </View>
      <Text style={styles.subtitle}>Race an opponent — 2 minutes, highest score wins.</Text>

      {recordLine ? <Text style={styles.recordLine}>{recordLine}</Text> : null}

      {!player ? (
        <TextInput
          style={styles.input}
          placeholder="Display name"
          placeholderTextColor="#888"
          value={nameInput}
          onChangeText={setNameInput}
          editable={!waiting}
          maxLength={24}
        />
      ) : (
        <Text style={styles.playerLabel}>Playing as {player.name}</Text>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {waiting ? (
        <View style={styles.waitingBox}>
          <ActivityIndicator size="large" color="#7c6cff" />
          {matchedOpponent ? (
            <>
              <Text style={styles.matchedText}>Matched with {matchedOpponent}!</Text>
              <Text style={styles.waitingText}>Connecting…</Text>
            </>
          ) : (
            <>
              <Text style={styles.waitingText}>Finding opponent…</Text>
              <Text style={styles.waitTimer}>{waitSec}s</Text>
            </>
          )}
          {showBotOffer && !matchedOpponent ? (
            <TouchableOpacity style={styles.botBtn} onPress={() => void handlePlayBot()}>
              <Text style={styles.botBtnText}>Play vs Bot instead</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => void handleFindDuel()}>
          <Text style={styles.primaryBtnText}>Find Duel</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.secondaryBtn} onPress={() => void handleCancel()}>
        <Text style={styles.secondaryBtnText}>{waiting ? 'Cancel' : 'Back'}</Text>
      </TouchableOpacity>

      <Modal visible={showOnboarding} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>How Live Duel works</Text>
            <Text style={styles.modalBody}>
              • You have 2 minutes to solve as many puzzles as possible{'\n'}
              • The target word is hidden — trace the path through letters{'\n'}
              • Puzzles get harder as you progress{'\n'}
              • Highest total score wins
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={dismissOnboarding}>
              <Text style={styles.primaryBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f5f5ff',
  },
  subtitle: {
    fontSize: 15,
    color: '#aaa',
    lineHeight: 22,
  },
  recordLine: {
    color: '#7c6cff',
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#1e1e2e',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  playerLabel: {
    color: '#ccc',
    textAlign: 'center',
    fontSize: 16,
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
  },
  waitingBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  matchedText: {
    color: '#7c6cff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  waitingText: {
    color: '#ccc',
    fontSize: 16,
  },
  waitTimer: {
    color: '#666',
    fontSize: 14,
  },
  botBtn: {
    marginTop: 8,
    backgroundColor: '#2a2a3a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#555',
  },
  botBtnText: {
    color: '#f5f5ff',
    fontWeight: '700',
    fontSize: 15,
  },
  primaryBtn: {
    backgroundColor: '#7c6cff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#888',
    fontSize: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalSheet: {
    backgroundColor: '#1a1a28',
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    color: '#f5f5ff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalBody: {
    color: '#aaa',
    fontSize: 15,
    lineHeight: 24,
  },
});
