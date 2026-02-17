import React, { useMemo } from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

function initialsFromLabel(label: string) {
  const cleaned = label.trim();
  if (!cleaned) return '--';
  const parts = cleaned.split(/\s+/g).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  const value = `${first}${second}`.toUpperCase();
  return value || '--';
}

export function Avatar({
  label,
  size = 36,
  style
}: {
  label: string;
  size?: number;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const initials = useMemo(() => initialsFromLabel(label), [label]);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border
        },
        style
      ]}
    >
      <Text variant="caption" style={{ color: colors.mutedText }}>
        {initials}
      </Text>
    </View>
  );
}
