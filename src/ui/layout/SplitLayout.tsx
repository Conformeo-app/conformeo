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
      <View style={{ flex: 1, backgroundColor: colors.sand }}>
        {sidebar}
        {content}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.sand }}>
      <View style={{ width: 280 }}>{sidebar}</View>
      <View style={{ flex: 1 }}>{content}</View>
    </View>
  );
}
