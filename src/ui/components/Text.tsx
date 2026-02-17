import React from 'react';
import { Text as RNText, TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Variant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'bodySmall' | 'caption';
type ThemeColorKey = keyof ReturnType<typeof useTheme>['colors'];

export function Text({
  variant = 'body',
  color,
  style,
  ...props
}: TextProps & { variant?: Variant; color?: ThemeColorKey }) {
  const { typography, colors } = useTheme();
  const resolvedColor = color ? (colors as any)[color] ?? colors.text : colors.text;
  return (
    <RNText
      {...props}
      style={[
        { color: resolvedColor },
        typography[variant],
        style
      ]}
    />
  );
}
