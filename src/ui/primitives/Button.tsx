import React from 'react';
import { Pressable, StyleSheet, type ViewStyle, ActivityIndicator } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from './ConformeoText';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const isDisabled = Boolean(disabled) || Boolean(loading);

  const bg =
    variant === 'primary'
      ? t.colors.primary
      : variant === 'danger'
        ? t.colors.danger
        : variant === 'secondary'
          ? t.colors.surface
          : 'transparent';

  const border =
    variant === 'secondary' ? t.colors.border : variant === 'ghost' ? t.colors.border : 'transparent';

  const textColor =
    variant === 'secondary'
      ? t.colors.textPrimary
      : variant === 'ghost'
        ? t.colors.textPrimary
        : t.colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1
        },
        style
      ]}
    >
      {loading ? <ActivityIndicator /> : null}
      <ConformeoText variant="bodySmall" style={{ color: textColor }}>
        {label}
      </ConformeoText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44
  }
});

