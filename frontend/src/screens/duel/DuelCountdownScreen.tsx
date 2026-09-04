import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDuelSocket } from './DuelSocketContext';

interface Props {
  onDuelStart: () => void;
  onAbort: () => void;
}

export const DuelCountdownScreen: React.FC<Props> = ({ onDuelStart, onAbort }) => {
  const {
    status,
    countdownStartAt,
    duelStartAt,
    phase,
    opponentName,
    connectionError,
    isReconnecting,
    abortMatch,
  } = useDuelSocket();
  const [now, setNow] = useState(Date.now() / 1000);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (phase === 'playing' || duelStartAt != null) {
      onDuelStart();
    }
  }, [duelStartAt, onDuelStart, phase]);

  const countdownValue = useMemo(() => {
    if (countdownStartAt == null) {
      return null;
    }
    const remaining = Math.ceil(countdownStartAt - now);
    if (remaining <= 0) {
      return 0;
    }
    return remaining;
  }, [countdownStartAt, now]);

  const opponentLabel = opponentName || 'your opponent';

  const handleQuit = useCallback(() => {
    if (leaving) {
      return;
    }
    Alert.alert(
      'Leave match?',
      'The duel has not started yet. You will return home and your opponent will be notified.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Quit',
          style: 'destructive',
          onPress: () => {
            setLeaving(true);
            void (async () => {
              await abortMatch();
              onAbort();
            })();
          },
        },
      ],
    );
  }, [abortMatch, leaving, onAbort]);

  const waitingForOpponent =
    countdownStartAt == null || status === 'connecting' || status === 'connected';

  return (
    <View style={styles.container}>
      {(connectionError || isReconnecting) && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {connectionError ?? 'Reconnecting…'}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.quitBtn}
        onPress={handleQuit}
        disabled={leaving}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.quitBtnText}>{leaving ? 'Leaving…' : 'Quit'}</Text>
      </TouchableOpacity>

      {waitingForOpponent ? (
        <>
          <ActivityIndicator size="large" color="#e85a3c" />
          <Text style={styles.opponentText}>vs {opponentLabel}</Text>
          <Text style={styles.waitingText}>Waiting for opponent…</Text>
        </>
      ) : (
        <>
          <Text style={styles.opponentText}>vs {opponentLabel}</Text>
          <Text style={styles.label}>Get ready</Text>
          <Text style={styles.countdown}>
            {countdownValue === 0 ? 'GO!' : countdownValue}
          </Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  quitBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#1a1a1a',
  },
  quitBtnText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '700',
  },
  banner: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#3b2f00',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bannerText: {
    color: '#fbbf24',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  opponentText: {
    color: '#e85a3c',
    fontSize: 18,
    fontWeight: '700',
  },
  waitingText: {
    color: '#aaa',
    fontSize: 16,
    marginTop: 4,
  },
  label: {
    color: '#aaa',
    fontSize: 18,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  countdown: {
    fontSize: 96,
    fontWeight: '900',
    color: '#e85a3c',
  },
});
