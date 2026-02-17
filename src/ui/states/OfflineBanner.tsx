import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from '../primitives/ConformeoText';
import { toneSoftBg } from '../theme';

export function OfflineBanner({
  message = 'Mode hors ligne — synchronisation automatique dès connexion.'
}: {
  message?: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: toneSoftBg('warning', t), borderColor: t.colors.border }]}>
      <ConformeoText variant="bodySmall" style={{ color: t.colors.warning }}>
        {message}
      </ConformeoText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10
  }
});

