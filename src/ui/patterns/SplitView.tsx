import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useTheme } from '../ThemeProvider';

export function SplitView({
  left,
  right,
  minSplitWidth = 900,
  leftRatio = 0.35
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  minSplitWidth?: number;
  leftRatio?: number;
}) {
  const { width } = useWindowDimensions();
  const t = useTheme();

  if (width < minSplitWidth) {
    return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{right ?? left}</View>;
  }

  const leftW = Math.floor(width * leftRatio);
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
      <View style={{ width: leftW, borderRightWidth: 1, borderRightColor: t.colors.border }}>{left}</View>
      <View style={{ flex: 1 }}>{right}</View>
    </View>
  );
}

