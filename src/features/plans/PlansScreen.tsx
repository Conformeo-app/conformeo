import React from 'react';
import { ScrollView, View } from 'react-native';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

export function PlansScreen() {
  const { colors, spacing } = useTheme();

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Plans annotables"
          subtitle="Pins normalises (page, x, y), liens vers taches et preuves."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Mode annotation</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Support cible: zoom/pan iPad, pins colores par statut et export du tableau de points.
            </Text>
          </Card>
          <Card>
            <Text variant="h2">Schema de pin</Text>
            <Text variant="bodyStrong" style={{ marginTop: spacing.xs }}>
              {`{ page: 2, x: 0.372, y: 0.611, status: "open" }`}
            </Text>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
