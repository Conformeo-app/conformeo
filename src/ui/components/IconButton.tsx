import React from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

export function IconButton({
  icon,
  onPress,
  disabled = false,
  tone = 'neutral',
  size = 44,
  style
}: {
  icon: IconName;
  onPress?: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
  size?: number;
  style?: ViewStyle;
}) {
  const { colors, radii } = useTheme();

  const palette =
    tone === 'primary'
      ? { bg: colors.primary, icon: colors.onPrimary, border: 'transparent' }
      : tone === 'danger'
        ? { bg: colors.danger, icon: colors.onPrimary, border: 'transparent' }
        : { bg: colors.surface, icon: colors.text, border: colors.border };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radii.pill,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center'
        },
        disabled ? { opacity: 0.45 } : null,
        style
      ]}
    >
      <Icon name={icon} size={22} color={palette.icon} />
    </Pressable>
  );
}

