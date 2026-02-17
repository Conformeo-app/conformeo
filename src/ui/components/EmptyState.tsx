import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function EmptyState({
  title,
  message,
  icon = 'inbox',
  ctas,
  primaryAction,
  secondaryAction
}: {
  title: string;
  message?: string;
  icon?: IconName;
  // Design System API (preferred)
  ctas?: Array<{ label: string; onPress: () => void }>;
  primaryAction?: { label: string; onPress: () => void };
  secondaryAction?: { label: string; onPress: () => void };
}) {
  const { colors, spacing } = useTheme();
  const resolvedPrimary = primaryAction ?? ctas?.[0];
  const resolvedSecondary = secondaryAction ?? ctas?.[1];

  return (
    <View style={{ padding: spacing.lg, alignItems: 'center', gap: spacing.sm }}>
      <Icon name={icon} size={28} color={colors.mutedText} />
      <Text variant="h2">{title}</Text>
      {message ? (
        <Text variant="body" style={{ color: colors.mutedText, textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}

      {resolvedPrimary || resolvedSecondary ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          {resolvedPrimary ? <Button label={resolvedPrimary.label} onPress={resolvedPrimary.onPress} /> : null}
          {resolvedSecondary ? (
            <Button label={resolvedSecondary.label} onPress={resolvedSecondary.onPress} variant="ghost" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
