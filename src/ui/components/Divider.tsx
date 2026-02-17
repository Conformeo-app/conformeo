import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function Divider({ style }: { style?: ViewStyle }) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        {
          height: 1,
          backgroundColor: colors.border
        },
        style
      ]}
    />
  );
}

