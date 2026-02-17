import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function KpiCard({
  title,
  label,
  value,
  icon,
  tone = 'neutral',
  style,
  onPress
}: {
  // Design System API (preferred)
  title?: string;
  // Backwards-compatible alias (avoid in new code)
  label?: string;
  value: string | number;
  icon?: IconName;
  tone?: 'primary' | 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  style?: ViewStyle;
  onPress?: () => void;
}) {
  const { colors, spacing } = useTheme();

  const tint =
    tone === 'primary'
      ? colors.primary
      : tone === 'info'
      ? colors.info
      : tone === 'success'
        ? colors.success
        : tone === 'warning'
          ? colors.warning
          : tone === 'danger'
            ? colors.danger
            : colors.mutedText;

  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      {icon ? <Icon name={icon} size={22} color={tint} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="caption" style={{ color: colors.mutedText }}>
          {title ?? label ?? ''}
        </Text>
        <Text variant="h1">{String(value)}</Text>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Card style={style}>
          <View>{body}</View>
        </Card>
      </Pressable>
    );
  }

  return <Card style={style}>{body}</Card>;
}
