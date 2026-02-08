import React from 'react';
import { Text as RNText, TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Variant = 'display' | 'h1' | 'h2' | 'body' | 'bodyStrong' | 'caption';

export function Text({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const { typography, colors } = useTheme();
  return (
    <RNText
      {...props}
      style={[
        { color: colors.ink },
        typography[variant],
        style
      ]}
    />
  );
}
