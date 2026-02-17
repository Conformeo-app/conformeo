import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../ThemeProvider';

// NOTE: RN doesn't have true "position: sticky". Use ScrollView `stickyHeaderIndices`
// and render this component as the header content.
export function StickyHeader({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: t.colors.bg,
          paddingHorizontal: t.spacing.lg,
          paddingVertical: t.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border
        },
        style
      ]}
    >
      {children}
    </View>
  );
}

