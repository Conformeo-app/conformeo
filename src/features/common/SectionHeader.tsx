import React from 'react';
import { View } from 'react-native';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function SectionHeader({
  title,
  subtitle
}: {
  title: string;
  subtitle: string;
}) {
  const { colors, spacing } = useTheme();

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="display" style={{ marginBottom: spacing.xs }}>
        {title}
      </Text>
      <Text variant="body" style={{ color: colors.slate }}>
        {subtitle}
      </Text>
    </View>
  );
}
