import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import type { SecurityStackParamList } from '../../navigation/types';
import { Screen } from '../../ui/layout/Screen';
import {
  Button,
  Card,
  IconButton,
  ListRow,
  SectionHeader,
  SegmentedControl,
  Text,
  TextField,
  Toggle
} from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { gallery, useGalleryState, type QuotaLevel } from './ui-gallery/galleryState';

type Props = NativeStackScreenProps<SecurityStackParamList, 'UIGallery'>;

function clampInt(input: string, fallback: number) {
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function UIGalleryScreen({ navigation }: Props) {
  const { spacing, colors } = useTheme();
  const state = useGalleryState();

  const quotaOptions = useMemo(
    () => [
      { key: 'OK' as const, label: 'Quota OK' },
      { key: 'WARN' as const, label: 'Quota 80%' },
      { key: 'CRIT' as const, label: 'Quota 95%+' }
    ],
    []
  );

  return (
    <Screen>
      <SectionHeader
        title="Galerie UI"
        subtitle="Catalogue interne du Design System (DEV). Objectif: cohérence, accessibilité, iPad d'abord."
      />

      <View style={{ gap: spacing.md, flex: 1, minHeight: 0 }}>
        <Card>
          <Text variant="h2">Catégories</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Chaque page montre les composants réels du DS + variations (3-5 max).
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <ListRow
              title="Atomes"
              subtitle="Texte, icônes, badges, tags, chips, séparateurs, avatars…"
              leftIcon="cube-outline"
              onPress={() => navigation.navigate('UIGalleryAtoms')}
            />
            <ListRow
              title="Champs"
              subtitle="Champs texte, recherche, toggle, segmented, dictée…"
              leftIcon="form-textbox"
              onPress={() => navigation.navigate('UIGalleryInputs')}
            />
            <ListRow
              title="Surfaces"
              subtitle="Cartes, KPI, lignes, bouton flottant…"
              leftIcon="layers-outline"
              onPress={() => navigation.navigate('UIGallerySurfaces')}
            />
            <ListRow
              title="Structures"
              subtitle="SplitView (liste/détail), barre d'onglets, panneau latéral…"
              leftIcon="view-split-vertical"
              onPress={() => navigation.navigate('UIGalleryPatterns')}
            />
            <ListRow
              title="États"
              subtitle="Hors ligne, synchro en attente, quota, conflits, erreurs…"
              leftIcon="alert-circle-outline"
              onPress={() => navigation.navigate('UIGalleryStates')}
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Terrain de jeu (états)</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Simule hors ligne/en attente/quota/conflits pour valider les composants d’état. Zéro dépendance réseau.
          </Text>

          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            <Toggle
              label="Hors ligne"
              value={state.offline}
              onValueChange={(v) => gallery.setOffline(v)}
            />

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Ops en attente"
                  keyboardType="number-pad"
                  value={String(state.pendingOps)}
                  onChangeText={(v) => gallery.setPendingOps(clampInt(v, state.pendingOps))}
                />
              </View>
              <IconButton icon="minus" onPress={() => gallery.setPendingOps(Math.max(0, state.pendingOps - 1))} />
              <IconButton icon="plus" onPress={() => gallery.setPendingOps(state.pendingOps + 1)} tone="primary" />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Conflits"
                  keyboardType="number-pad"
                  value={String(state.conflicts)}
                  onChangeText={(v) => gallery.setConflicts(clampInt(v, state.conflicts))}
                />
              </View>
              <IconButton icon="minus" onPress={() => gallery.setConflicts(Math.max(0, state.conflicts - 1))} />
              <IconButton icon="plus" onPress={() => gallery.setConflicts(state.conflicts + 1)} tone="primary" />
            </View>

            <SegmentedControl
              value={state.quotaLevel}
              options={quotaOptions}
              onChange={(key) => gallery.setQuotaLevel(key as QuotaLevel)}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Button label="Réinitialiser" variant="ghost" onPress={() => {
                gallery.setOffline(false);
                gallery.setPendingOps(0);
                gallery.setConflicts(0);
                gallery.setQuotaLevel('OK');
              }} />
              <Button label="Aller aux états" variant="secondary" onPress={() => navigation.navigate('UIGalleryStates')} />
            </View>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
