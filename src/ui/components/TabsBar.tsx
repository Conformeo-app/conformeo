import React from 'react';
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TabOption<K extends string> = { key: K; label: string };

export function TabsBar<K extends string>({
  value,
  options,
  onChange,
  scrollable = true,
  style
}: {
  value: K;
  options: Array<TabOption<K>>;
  onChange: (key: K) => void;
  scrollable?: boolean;
  style?: ViewStyle;
}) {
  const { colors, spacing, radii } = useTheme();

  const inner = (
    <View style={{ flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs }}>
      {options.map((opt) => {
        const selected = opt.key === value;

        return (
          <Pressable
            key={opt.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(opt.key)}
            style={{
              minHeight: 48,
              paddingHorizontal: spacing.md,
              justifyContent: 'center',
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primarySoft : colors.surface
            }}
          >
            <Text
              variant="caption"
              style={{
                color: selected ? colors.text : colors.mutedText
              }}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) {
    return (
      <View
        style={[
          {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.md,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.sm
          },
          style
        ]}
      >
        {inner}
      </View>
    );
  }

  return (
    <View style={style}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.lg }}>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.md,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.sm
          }}
        >
          {inner}
        </View>
      </ScrollView>
    </View>
  );
}
