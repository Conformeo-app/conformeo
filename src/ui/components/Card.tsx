import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors, radii, spacing, elevation } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.white,
          borderRadius: radii.lg,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: colors.fog,
          ...elevation.card
        },
        style
      ]}
    >
      {children}
    </View>
  );
}
