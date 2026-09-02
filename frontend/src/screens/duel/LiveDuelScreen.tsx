import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { joinLiveDuelBot } from '../../api';
import { loadPlayerProfile } from '../../playerStorage';
import { PlayerProfile } from '../../types';
import { DuelCountdownScreen } from './DuelCountdownScreen';
import { DuelGameScreen } from './DuelGameScreen';
import { DuelQueueScreen } from './DuelQueueScreen';
import { DuelResultScreen } from './DuelResultScreen';
import { DuelSocketProvider, useDuelSocket } from './DuelSocketContext';

interface InnerProps {
  onBackToSolo: () => void;
  onBoardDragChange?: (dragging: boolean) => void;
}

const LiveDuelFlow: React.FC<InnerProps> = ({ onBackToSolo, onBoardDragChange }) => {
  const {
    connect,
    phase,
    setPhase,
    disconnect,
    resetSession,
    setOpponentName,
    opponentName,
    rematchStatus,
    rematchDuelId,
  } = useDuelSocket();
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [autoStartQueue, setAutoStartQueue] = useState(false);
  const rematchHandledRef = useRef(false);

  useEffect(() => {
    void loadPlayerProfile().then(setPlayer);
    return () => disconnect();
  }, [disconnect]);

  const handleMatched = useCallback(
    async (matchedDuelId: string, matchedOpponentName?: string) => {
      rematchHandledRef.current = false;
      if (matchedOpponentName) {
        setOpponentName(matchedOpponentName);
      }
      resetSession();
      setPhase('countdown');
      const profile = player ?? (await loadPlayerProfile());
      if (!profile) {
        return;
      }
      setPlayer(profile);
      await connect(matchedDuelId, profile.id);
    },
    [connect, player, resetSession, setOpponentName, setPhase],
  );

  const handleNewGame = useCallback(() => {
    rematchHandledRef.current = false;
    resetSession();
    disconnect();
    setAutoStartQueue(true);
    setPhase('queue');
  }, [disconnect, resetSession, setPhase]);

  const handleRematchBot = useCallback(async () => {
    rematchHandledRef.current = false;
    resetSession();
    disconnect();
    const profile = player ?? (await loadPlayerProfile());
    if (!profile) {
      return;
    }
    setPlayer(profile);
    try {
      const response = await joinLiveDuelBot(profile.id, profile.name);
      if (response.duel_id) {
        await handleMatched(response.duel_id, response.opponent_name ?? 'Bot');
      }
    } catch {
      setAutoStartQueue(true);
      setPhase('queue');
    }
  }, [disconnect, handleMatched, player, resetSession, setPhase]);

  const handleMutualRematch = useCallback(
    async (duelId: string, matchedOpponent?: string) => {
      if (rematchHandledRef.current) {
        return;
      }
      rematchHandledRef.current = true;
      resetSession();
      disconnect();
      if (matchedOpponent) {
        setOpponentName(matchedOpponent);
      }
      setPhase('countdown');
      const profile = player ?? (await loadPlayerProfile());
      if (!profile) {
        return;
      }
      setPlayer(profile);
      await connect(duelId, profile.id);
    },
    [connect, disconnect, player, resetSession, setOpponentName, setPhase],
  );

  useEffect(() => {
    if (rematchStatus === 'matched' && rematchDuelId && player) {
      void handleMutualRematch(rematchDuelId, opponentName || undefined);
    }
  }, [handleMutualRematch, opponentName, player, rematchDuelId, rematchStatus]);

  if (phase === 'queue') {
    return (
      <DuelQueueScreen
        autoStart={autoStartQueue}
        onMatched={(id, opponentName) => {
          setAutoStartQueue(false);
          void handleMatched(id, opponentName);
        }}
        onBack={onBackToSolo}
      />
    );
  }

  if (phase === 'countdown') {
    return (
      <DuelCountdownScreen
        onDuelStart={() => setPhase('playing')}
      />
    );
  }

  if (phase === 'playing') {
    return (
      <View style={styles.gamePhase}>
        <DuelGameScreen
          onDuelEnd={() => setPhase('result')}
          onBoardDragChange={onBoardDragChange}
        />
      </View>
    );
  }

  if (phase === 'result' && player) {
    return (
      <View style={styles.flow}>
        <DuelResultScreen
          userId={player.id}
          onNewGame={handleNewGame}
          onRematchBot={() => void handleRematchBot()}
          onHome={onBackToSolo}
        />
      </View>
    );
  }

  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>Loading…</Text>
    </View>
  );
};

interface Props {
  onBackToSolo: () => void;
  onBoardDragChange?: (dragging: boolean) => void;
}

export const LiveDuelScreen: React.FC<Props> = (props) => {
  return (
    <View style={styles.screen}>
      <DuelSocketProvider>
        <LiveDuelFlow {...props} />
      </DuelSocketProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f0f18',
  },
  flow: {
    flex: 1,
  },
  gamePhase: {
    flex: 1,
  },
  fallback: {
    padding: 40,
    alignItems: 'center',
  },
  fallbackText: {
    color: '#aaa',
  },
});
