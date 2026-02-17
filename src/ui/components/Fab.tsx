import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { IconButton } from './IconButton';
import type { IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';

export function Fab({
  icon,
  onPress,
  style
}: {
  icon: IconName;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const { spacing } = useTheme();
  return (
    <View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          right: spacing.lg,
          bottom: spacing.lg
        },
        style
      ]}
    >
      <IconButton icon={icon} onPress={onPress} tone="primary" size={56} />
    </View>
  );
}
