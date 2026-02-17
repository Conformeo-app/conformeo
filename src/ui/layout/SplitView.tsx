import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function SplitView({
  sidebar,
  content,
  breakpoint = 980,
  sidebarWidth
}: {
  sidebar: React.ReactNode;
  content: React.ReactNode;
  breakpoint?: number;
  sidebarWidth?: number;
}) {
  const { width } = useWindowDimensions();
  const { colors, layout } = useTheme();

  const isWide = width >= breakpoint;
  const leftWidth = sidebarWidth ?? (isWide ? Math.min(520, Math.max(260, Math.round(width * 0.35))) : undefined);

  if (!isWide) {
    return (
      <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.bg }}>
        <View>{sidebar}</View>
        <View style={{ flex: 1, minHeight: 0 }}>{content}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', backgroundColor: colors.bg }}>
      <View style={{ width: leftWidth ?? layout.sideMenuWidth }}>{sidebar}</View>
      <View style={{ flex: 1, minHeight: 0 }}>{content}</View>
    </View>
  );
}
