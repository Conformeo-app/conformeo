import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from './ConformeoText';

export function Chip({
  label,
  active,
  onPress
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: active ? t.colors.primarySoft : t.colors.surface,
          borderColor: active ? t.colors.primary : t.colors.border,
          opacity: pressed ? 0.85 : 1
        }
      ]}
    >
      <ConformeoText
        variant="caption"
        style={{ color: active ? t.colors.primary : t.colors.textSecondary }}
        numberOfLines={1}
      >
        {label}
      </ConformeoText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

