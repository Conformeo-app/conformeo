import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from '../primitives/ConformeoText';
import { Button } from '../primitives/Button';

export function EmptyState({
  title,
  message,
  ctas = []
}: {
  title: string;
  message?: string;
  ctas?: Array<{ label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }>;
}) {
  const t = useTheme();
  return (
    <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
      <ConformeoText variant="h3">{title}</ConformeoText>
      {message ? (
        <ConformeoText variant="bodySmall" color="textSecondary">
          {message}
        </ConformeoText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
        {ctas.slice(0, 2).map((c) => (
          <Button key={c.label} label={c.label} onPress={c.onPress} variant={c.variant ?? 'primary'} />
        ))}
      </View>
    </View>
  );
}

