import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useDuelSocket } from './DuelSocketContext';

interface Props {
  onDuelStart: () => void;
}

export const DuelCountdownScreen: React.FC<Props> = ({ onDuelStart }) => {
  const { status, countdownStartAt, duelStartAt, phase, opponentName, connectionError, isReconnecting } =
    useDuelSocket();
  const [now, setNow] = useState(Date.now() / 1000);

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

  if (countdownStartAt == null || status === 'connecting' || status === 'connected') {
    return (
      <View style={styles.container}>
        {(connectionError || isReconnecting) && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {connectionError ?? 'Reconnecting…'}
            </Text>
          </View>
        )}
        <ActivityIndicator size="large" color="#7c6cff" />
        <Text style={styles.opponentText}>vs {opponentLabel}</Text>
        <Text style={styles.waitingText}>Waiting for opponent…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {(connectionError || isReconnecting) && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{connectionError ?? 'Reconnecting…'}</Text>
        </View>
      )}
      <Text style={styles.opponentText}>vs {opponentLabel}</Text>
      <Text style={styles.label}>Get ready</Text>
      <Text style={styles.countdown}>{countdownValue === 0 ? 'GO!' : countdownValue}</Text>
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
  banner: {
    position: 'absolute',
    top: 0,
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
    color: '#7c6cff',
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
    color: '#7c6cff',
  },
});
