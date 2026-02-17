import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function ListRow({
  title,
  subtitle,
  leftIcon,
  rightIcon = 'chevron-right',
  onPress,
  disabled = false
}: {
  title: string;
  subtitle?: string;
  leftIcon?: IconName;
  rightIcon?: IconName | null;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { colors, spacing, radii } = useTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        opacity: disabled ? 0.5 : 1
      }}
    >
      {leftIcon ? <Icon name={leftIcon} size={22} muted /> : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" style={{ color: colors.mutedText }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {rightIcon ? <Icon name={rightIcon} size={22} muted /> : null}
    </Pressable>
  );
}

