import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function SectionHeader({
  title,
  subtitle,
  right,
  style
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors, spacing } = useTheme();

  return (
    <View style={[{ marginBottom: spacing.lg, gap: spacing.xs }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="display" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" style={{ color: colors.mutedText }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={{ alignSelf: 'center' }}>{right}</View> : null}
      </View>
    </View>
  );
}

