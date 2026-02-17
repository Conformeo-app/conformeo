import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function SplitLayout({
  isWide,
  sidebar,
  content
}: {
  isWide: boolean;
  sidebar: React.ReactNode;
  content: React.ReactNode;
}) {
  const { colors } = useTheme();

  if (!isWide) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View>{sidebar}</View>
        <View style={{ flex: 1, minHeight: 0 }}>{content}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <View style={{ width: 280 }}>{sidebar}</View>
      <View style={{ flex: 1, minHeight: 0 }}>{content}</View>
    </View>
  );
}
