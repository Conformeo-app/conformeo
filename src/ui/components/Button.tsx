import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

export function Button({
  label,
  onPress,
  kind,
  variant,
  iconLeft,
  style,
  disabled = false,
  fullWidth = false
}: {
  label: string;
  onPress?: () => void;
  // `variant` is the Design System API. `kind` is kept for backwards compatibility.
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  kind?: 'primary' | 'ghost';
  iconLeft?: React.ReactNode;
  style?: ViewStyle;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const { colors, spacing, radii } = useTheme();

  const resolvedVariant = variant ?? (kind === 'ghost' ? 'ghost' : 'primary');

  const base: ViewStyle = {
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center'
  };

  const styles: Record<typeof resolvedVariant, ViewStyle> = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
    danger: { backgroundColor: colors.danger },
    ghost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
  };

  const textColor =
    resolvedVariant === 'primary'
      ? colors.onPrimary
      : resolvedVariant === 'danger'
        ? colors.onPrimary
        : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        base,
        styles[resolvedVariant],
        pressed && !disabled
          ? resolvedVariant === 'primary'
            ? { backgroundColor: colors.primaryPressed }
            : resolvedVariant === 'danger'
              ? { opacity: 0.9 }
              : { backgroundColor: colors.surfaceAlt }
          : null,
        fullWidth ? { alignSelf: 'stretch' } : null,
        style,
        disabled ? { opacity: 0.45 } : null
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {iconLeft ? <View style={{ marginTop: 1 }}>{iconLeft}</View> : null}
        <Text variant="bodyStrong" style={{ color: textColor }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
