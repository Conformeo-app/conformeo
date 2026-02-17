import React from 'react';
import { Text, type TextProps } from 'react-native';
import { useTheme } from '../ThemeProvider';
import type { AppTheme } from '../theme';

type Variant = keyof AppTheme['typography'];
type ColorKey = keyof AppTheme['colors'];

export function ConformeoText({
  variant = 'body',
  color = 'textPrimary',
  style,
  children,
  ...props
}: TextProps & { variant?: Variant; color?: ColorKey }) {
  const t = useTheme();
  const typo = t.typography[variant];

  return (
    <Text
      {...props}
      style={[
        {
          color: t.colors[color],
          fontSize: typo.fontSize,
          fontWeight: typo.fontWeight,
          lineHeight: typo.lineHeight
        },
        style
      ]}
    >
      {children}
    </Text>
  );
}
