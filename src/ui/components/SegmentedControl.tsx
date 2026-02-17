import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Chip } from './Chip';

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (next: T) => void;
}) {
  const { spacing } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm }}
    >
      {options.map((option) => (
        <Chip
          key={option.key}
          label={option.label}
          selected={option.key === value}
          onPress={() => onChange(option.key)}
        />
      ))}
      <View style={{ width: spacing.xs }} />
    </ScrollView>
  );
}

