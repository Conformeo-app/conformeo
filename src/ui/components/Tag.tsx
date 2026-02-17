import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type TagTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

function toneToColors(colors: Record<string, string>, tone: TagTone) {
  if (tone === 'info') return { bg: colors.infoBg, text: colors.info };
  if (tone === 'success') return { bg: colors.successBg, text: colors.success };
  if (tone === 'warning') return { bg: colors.warningBg, text: colors.warningText ?? colors.warning };
  if (tone === 'danger') return { bg: colors.dangerBg, text: colors.danger };
  return { bg: colors.surfaceAlt ?? colors.fog, text: colors.mutedText };
}

export function Tag({ label, tone = 'neutral', style }: { label: string; tone?: TagTone; style?: ViewStyle }) {
  const { colors, spacing, radii } = useTheme();
  const palette = toneToColors(colors as unknown as Record<string, string>, tone);

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: palette.bg,
          borderRadius: radii.xl,
          paddingHorizontal: spacing.sm,
          paddingVertical: 6,
          borderWidth: 1,
          borderColor: colors.border
        },
        style
      ]}
    >
      <Text variant="caption" style={{ color: palette.text }}>
        {label}
      </Text>
    </View>
  );
}
