import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from './ConformeoText';
import type { Tone } from '../theme';
import { toneSoftBg, toneToColor } from '../theme';

export function KpiCard({
  title,
  value,
  tone = 'neutral',
  onPress
}: {
  title: string;
  value: string;
  tone?: Tone;
  onPress?: () => void;
}) {
  const t = useTheme();
  const bg = toneSoftBg(tone, t);
  const fg = toneToColor(tone, t);

  const Inner = (
    <View style={[styles.base, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={[styles.pill, { backgroundColor: bg, borderColor: t.colors.border }]}>
        <ConformeoText variant="caption" style={{ color: fg }}>
          {title}
        </ConformeoText>
      </View>
      <ConformeoText variant="h2" style={{ marginTop: t.spacing.sm }}>
        {value}
      </ConformeoText>
    </View>
  );

  if (!onPress) return Inner;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
      {Inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    minWidth: 220
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6
  }
});

