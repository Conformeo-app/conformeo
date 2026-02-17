import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors, radii, spacing, shadows } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.md,
          padding: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.sm
        },
        style
      ]}
    >
      {children}
    </View>
  );
}
