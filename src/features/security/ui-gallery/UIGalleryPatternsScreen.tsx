import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Screen } from '../../../ui/layout/Screen';
import { DrawerPanel } from '../../../ui/layout/DrawerPanel';
import { SplitView } from '../../../ui/layout/SplitView';
import {
  Button,
  Card,
  ListRow,
  SectionHeader,
  TabsBar,
  Text,
  TextField
} from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

type DemoTab = 'OVERVIEW' | 'TASKS' | 'MEDIA' | 'DOCS' | 'CONTROL';

export function UIGalleryPatternsScreen() {
  const { spacing, colors, radii } = useTheme();

  const [tab, setTab] = useState<DemoTab>('OVERVIEW');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const tabs = useMemo(
    () => [
      { key: 'OVERVIEW' as const, label: 'Synthèse' },
      { key: 'TASKS' as const, label: 'Tâches' },
      { key: 'MEDIA' as const, label: 'Preuves' },
      { key: 'DOCS' as const, label: 'Docs' },
      { key: 'CONTROL' as const, label: 'Contrôle' }
    ],
    []
  );

  return (
    <Screen>
      <SectionHeader title="UI Gallery — Patterns" subtitle="SplitView, TabsBar, DrawerPanel (iPad/iPhone)" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text variant="h2">TabsBar</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Exemple de barre d’onglets DS (scrollable) — alternative UI réutilisable.
          </Text>

          <View style={{ marginTop: spacing.md }}>
            <TabsBar value={tab} options={tabs} onChange={setTab} />
          </View>

          <View style={{ marginTop: spacing.md }}>
            <Text variant="bodyStrong">Onglet actif: {tab}</Text>
            <Text variant="caption" style={{ color: colors.mutedText }}>
              Dans les écrans métier, l’onglet doit rester “sticky” et éviter les scrolls imbriqués.
            </Text>
          </View>
        </Card>

        <Card>
          <Text variant="h2">DrawerPanel</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            iPad: drawer à droite. iPhone: bottom sheet. Usage typique: filtres avancés / quick create.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Ouvrir drawer" variant="secondary" onPress={() => setDrawerOpen(true)} />
          </View>
        </Card>

        <Card>
          <Text variant="h2">SplitView</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            iPad: 2 colonnes. iPhone: stack. Pas de scroll imbriqué; une zone scroll unique par panneau.
          </Text>

          <View style={{ height: 340, marginTop: spacing.md, borderRadius: radii.md, overflow: 'hidden' }}>
            <SplitView
              sidebar={
                <View style={{ padding: spacing.sm }}>
                  <View style={{ gap: spacing.sm }}>
                    <ListRow title="Item A" subtitle="Détail à droite" leftIcon="folder-outline" onPress={() => {}} />
                    <ListRow title="Item B" subtitle="Détail à droite" leftIcon="folder-outline" onPress={() => {}} />
                    <ListRow title="Item C" subtitle="Détail à droite" leftIcon="folder-outline" onPress={() => {}} />
                  </View>
                </View>
              }
              content={
                <View style={{ padding: spacing.sm }}>
                  <Card>
                    <Text variant="h2">Détail</Text>
                    <Text variant="body" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
                      Contenu detail (scrollable si nécessaire, mais éviter les scrolls imbriqués).
                    </Text>
                  </Card>
                </View>
              }
            />
          </View>
        </Card>
      </ScrollView>

      <DrawerPanel visible={drawerOpen} title="Filtres (exemple)" onClose={() => setDrawerOpen(false)}>
        <View style={{ gap: spacing.md }}>
          <TextField label="Recherche" value="" onChangeText={() => {}} placeholder="Filtrer…" />
          <Text variant="caption" style={{ color: colors.mutedText }}>
            Les filtres avancés doivent toujours avoir un bouton "Reset".
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button label="Reset" variant="ghost" onPress={() => {}} />
            <Button label="Appliquer" onPress={() => setDrawerOpen(false)} />
          </View>
        </View>
      </DrawerPanel>
    </Screen>
  );
}
