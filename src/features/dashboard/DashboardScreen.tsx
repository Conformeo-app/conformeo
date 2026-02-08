import React from 'react';
import { View } from 'react-native';
import { Screen } from '../../ui/layout/Screen';
import { Text } from '../../ui/components/Text';
import { Card } from '../../ui/components/Card';
import { Button } from '../../ui/components/Button';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

export function DashboardScreen() {
  const { spacing, colors } = useTheme();

  return (
    <Screen>
      <SectionHeader
        title="Vue terrain"
        subtitle="Priorite aux actions critiques, avec statut offline et synchronisation visible."
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
        <Button label="Nouveau rapport" />
        <Button label="Ajouter preuve" kind="ghost" />
      </View>

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Flux offline</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Outbox persistante, deltas, reprise automatique et idempotence serveur.
          </Text>
        </Card>
        <Card>
          <Text variant="h2">Medias optimises</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Compression locale, WebP et uploads en arriere-plan avec controle de file.
          </Text>
        </Card>
        <Card>
          <Text variant="h2">Plans annotables</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Pins normalises (page, x, y) relies aux taches, preuves et responsables.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
