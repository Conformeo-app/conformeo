import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { ConformeoText } from '../primitives/ConformeoText';
import { Button } from '../primitives/Button';

export function ErrorState({
  title = 'Erreur',
  message,
  ctaLabel,
  onCta,
  secondaryLabel,
  onSecondary
}: {
  title?: string;
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const t = useTheme();

  return (
    <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
      <ConformeoText variant="h3" style={{ color: t.colors.danger }}>
        {title}
      </ConformeoText>
      <ConformeoText variant="bodySmall" color="textSecondary">
        {message}
      </ConformeoText>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
        {ctaLabel && onCta ? <Button label={ctaLabel} onPress={onCta} variant="danger" /> : null}
        {secondaryLabel && onSecondary ? (
          <Button label={secondaryLabel} onPress={onSecondary} variant="secondary" />
        ) : null}
      </View>
    </View>
  );
}

