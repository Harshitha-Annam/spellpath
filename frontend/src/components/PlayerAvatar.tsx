import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

interface Props {
  name: string;
  size?: number;
  style?: ViewStyle;
}

function initialForName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '?';
  }
  return trimmed.charAt(0).toUpperCase();
}

/** Circular avatar showing the first letter of a display name. */
export const PlayerAvatar: React.FC<Props> = ({ name, size = 56, style }) => {
  const fontSize = Math.round(size * 0.42);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    >
      <Text style={[styles.letter, { fontSize }]}>{initialForName(name)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: '#2a2a2a',
    borderWidth: 2,
    borderColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: '#f5f5f5',
    fontWeight: '800',
  },
});
