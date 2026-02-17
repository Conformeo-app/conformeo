import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function LoadingState({ label = 'Chargement...' }: { label?: string }) {
  const { colors, spacing } = useTheme();

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm }}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text variant="caption" style={{ color: colors.mutedText }}>
        {label}
      </Text>
    </View>
  );
}

