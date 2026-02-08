import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

export function Button({
  label,
  onPress,
  kind = 'primary',
  style,
  disabled = false
}: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'ghost';
  style?: ViewStyle;
  disabled?: boolean;
}) {
  const { colors, spacing, radii } = useTheme();

  const base: ViewStyle = {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center'
  };

  const styles: Record<string, ViewStyle> = {
    primary: { backgroundColor: colors.teal },
    ghost: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.fog }
  };

  const textColor = kind === 'primary' ? colors.white : colors.ink;

  return (
    <Pressable
      style={[base, styles[kind], style, disabled ? { opacity: 0.45 } : null]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text variant="bodyStrong" style={{ color: textColor }}>
        {label}
      </Text>
    </Pressable>
  );
}
