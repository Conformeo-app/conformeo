import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export function ErrorState({
  title = 'Erreur',
  message,
  retry,
  ctaLabel,
  onCta
}: {
  title?: string;
  message: string;
  retry?: { label?: string; onPress: () => void };
  // Design System API (preferred)
  ctaLabel?: string;
  onCta?: () => void;
}) {
  const { colors, spacing } = useTheme();
  const resolvedRetry = retry ?? (onCta ? { label: ctaLabel, onPress: onCta } : undefined);

  return (
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="alert-circle" size={22} color={colors.danger} />
        <Text variant="h2">{title}</Text>
      </View>
      <Text variant="body" style={{ color: colors.mutedText }}>
        {message}
      </Text>
      {resolvedRetry ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button label={resolvedRetry.label ?? 'Réessayer'} onPress={resolvedRetry.onPress} />
        </View>
      ) : null}
    </View>
  );
}
