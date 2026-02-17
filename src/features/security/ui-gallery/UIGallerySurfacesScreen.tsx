import React from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '../../../ui/layout/Screen';
import {
  Button,
  Card,
  Divider,
  Fab,
  KpiCard,
  ListRow,
  SectionHeader,
  Text
} from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export function UIGallerySurfacesScreen() {
  const { spacing, colors } = useTheme();

  return (
    <Screen>
      <SectionHeader title="Galerie UI — Surfaces" subtitle="Cartes, KPI, lignes, bouton flottant…" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text variant="h2">Carte</Text>
          <Text variant="body" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Une seule ombre standard (`shadows.sm`) + bordure tokenisée.
          </Text>
        </Card>

        <Card>
          <Text variant="h2">KPI</Text>
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <KpiCard label="Tâches ouvertes" value={12} icon="clipboard-text-outline" tone="info" onPress={() => {}} />
            <KpiCard label="Bloquées" value={2} icon="alert" tone="danger" />
            <KpiCard label="Preuves" value={134} icon="camera" tone="success" />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Ligne</Text>
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <ListRow title="Documents" subtitle="Plans, DOE, PV…" leftIcon="file-document-outline" onPress={() => {}} />
            <ListRow title="Preuves" subtitle="Téléversements en attente / échec…" leftIcon="camera" onPress={() => {}} />
            <ListRow title="Conflits" subtitle="Résolution requise" leftIcon="alert-circle-outline" onPress={() => {}} />
            <Divider />
            <Text variant="caption" style={{ color: colors.mutedText }}>
              Les listes denses doivent être virtualisées dans les écrans métier.
            </Text>
          </View>
        </Card>

        <Card>
          <Text variant="h2">Actions</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Principal" onPress={() => {}} />
            <Button label="Secondaire" variant="secondary" onPress={() => {}} />
            <Button label="Transparent" variant="ghost" onPress={() => {}} />
            <Button label="Danger" variant="danger" onPress={() => {}} />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Text variant="caption" style={{ color: colors.mutedText }}>
              FAB = action principale sur mobile / iPad selon contexte.
            </Text>
          </View>
        </Card>
      </ScrollView>

      <Fab icon="plus" onPress={() => {}} />
    </Screen>
  );
}
