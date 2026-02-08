import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { spacing } = useTheme();
  return (
    <View style={[{ padding: spacing.lg, flex: 1 }, style]}>{children}</View>
  );
}
