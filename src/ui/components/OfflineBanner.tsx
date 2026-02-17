import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Badge } from './Badge';
import { Text } from './Text';

export function OfflineBanner({
  visible = true,
  message = 'Mode hors ligne — synchronisation automatique dès connexion.',
  style
}: {
  visible?: boolean;
  message?: string;
  style?: ViewStyle;
}) {
  const { spacing } = useTheme();

  if (!visible) {
    return null;
  }

  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      <Badge tone="warning" label="OFFLINE" icon="wifi-off" />
      <Text variant="caption" style={{ marginTop: spacing.xs }}>
        {message}
      </Text>
    </View>
  );
}
