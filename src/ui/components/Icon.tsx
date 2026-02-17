import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { useTheme } from '../theme/ThemeProvider';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({
  name,
  size = 20,
  color,
  muted = false
}: {
  name: IconName;
  size?: number;
  color?: string;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  const resolved = color ?? (muted ? colors.mutedText : colors.text);
  return <MaterialCommunityIcons name={name} size={size} color={resolved} />;
}

