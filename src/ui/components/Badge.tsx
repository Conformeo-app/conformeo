import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'risk'
  | 'sync'
  | 'quota'
  | 'safety';

function toneStyles(colors: Record<string, string>, tone: BadgeTone) {
  const warningText = colors.warningText ?? colors.warning;

  if (tone === 'info' || tone === 'sync') return { bg: colors.infoBg, text: colors.info };
  if (tone === 'success') return { bg: colors.successBg, text: colors.success };
  if (tone === 'warning' || tone === 'quota' || tone === 'safety') return { bg: colors.warningBg, text: warningText };
  if (tone === 'danger' || tone === 'risk') return { bg: colors.dangerBg, text: colors.danger };

  return { bg: colors.surfaceAlt ?? colors.fog, text: colors.mutedText };
}

export function Badge({
  tone = 'neutral',
  label,
  icon,
  style
}: {
  tone?: BadgeTone;
  label: string;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const { colors, spacing, radii } = useTheme();
  const palette = toneStyles(colors as unknown as Record<string, string>, tone);

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
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
      {icon ? <Icon name={icon} size={14} color={palette.text} /> : null}
      <Text variant="caption" style={{ color: palette.text }}>
        {label}
      </Text>
    </View>
  );
}
