import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from '../primitives/ConformeoText';
import { Badge } from '../primitives/Badge';

export function SyncStatusPill({
  pending = 0,
  conflicts = 0,
  failedUploads = 0
}: {
  pending?: number;
  conflicts?: number;
  failedUploads?: number;
}) {
  const t = useTheme();
  const show = pending > 0 || conflicts > 0 || failedUploads > 0;
  if (!show) return null;

  const parts: string[] = [];
  if (pending > 0) parts.push(`${pending} en attente`);
  if (conflicts > 0) parts.push(`${conflicts} conflits`);
  if (failedUploads > 0) parts.push(`${failedUploads} échecs`);

  const tone = conflicts > 0 || failedUploads > 0 ? 'danger' : 'info';

  return (
    <View style={[styles.container, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <Badge label="SYNC" tone={tone} />
      <ConformeoText variant="bodySmall" color="textSecondary" numberOfLines={1}>
        {parts.join(' • ')}
      </ConformeoText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start'
  }
});

