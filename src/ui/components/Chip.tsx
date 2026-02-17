import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function Chip({
  label,
  active,
  selected = false,
  disabled = false,
  onPress,
  style
}: {
  label: string;
  // Design System API (preferred)
  active?: boolean;
  // Backwards-compatible alias (avoid in new code)
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const { colors, spacing, radii } = useTheme();
  const isSelected = typeof active === 'boolean' ? active : selected;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: isSelected }}
      hitSlop={8}
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          alignSelf: 'flex-start',
          borderRadius: radii.xl,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isSelected ? colors.primarySoft : colors.surface,
          borderWidth: 1,
          borderColor: isSelected ? colors.primary : colors.border
        },
        disabled ? { opacity: 0.45 } : null,
        style
      ]}
    >
      <Text variant="caption" style={{ color: isSelected ? colors.text : colors.mutedText }}>
        {label}
      </Text>
    </Pressable>
  );
}
