import React from 'react';
import { Switch, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function Toggle({
  label,
  value,
  onChange,
  onValueChange,
  disabled = false
}: {
  label: string;
  value: boolean;
  // Design System API (preferred)
  onChange?: (next: boolean) => void;
  // Backwards-compatible alias (avoid in new code)
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const handler = onChange ?? onValueChange;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <Text variant="bodyStrong">{label}</Text>
      <Switch
        value={value}
        onValueChange={handler ?? (() => {})}
        disabled={disabled || !handler}
        trackColor={{ false: colors.fog, true: colors.mint }}
        thumbColor={value ? colors.primary : colors.mutedText}
      />
    </View>
  );
}
