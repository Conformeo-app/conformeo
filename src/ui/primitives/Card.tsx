import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../ThemeProvider';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderWidth: 1,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          ...t.shadows.sm
        },
        style
      ]}
    >
      {children}
    </View>
  );
}

