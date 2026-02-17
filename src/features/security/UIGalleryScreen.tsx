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
      { key: 'WARN' as const, label: 'Quota WARN' },
      { key: 'CRIT' as const, label: 'Quota CRIT' }
    ],
    []
  );

  return (
    <Screen>
      <SectionHeader
        title="UI Gallery"
        subtitle="Catalogue interne du Design System (DEV). Objectif: cohérence, accessibilité, iPad-first."
      />

      <View style={{ gap: spacing.md, flex: 1, minHeight: 0 }}>
        <Card>
          <Text variant="h2">Catégories</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Chaque page montre les composants réels du DS + variations (3-5 max).
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <ListRow
              title="Atoms"
              subtitle="Text, Icon, Badge, Tag, Chip, Divider, Avatar…"
              leftIcon="cube-outline"
              onPress={() => navigation.navigate('UIGalleryAtoms')}
            />
            <ListRow
              title="Inputs"
              subtitle="TextField, SearchInput, Toggle, SegmentedControl, dictée…"
              leftIcon="form-textbox"
              onPress={() => navigation.navigate('UIGalleryInputs')}
            />
            <ListRow
              title="Surfaces"
              subtitle="Card, KPI, ListRow, FAB…"
              leftIcon="layers-outline"
              onPress={() => navigation.navigate('UIGallerySurfaces')}
            />
            <ListRow
              title="Patterns"
              subtitle="SplitView, TabsBar, DrawerPanel…"
              leftIcon="view-split-vertical"
              onPress={() => navigation.navigate('UIGalleryPatterns')}
            />
            <ListRow
              title="States"
              subtitle="Offline, pending sync, quota, conflits, erreurs…"
              leftIcon="alert-circle-outline"
              onPress={() => navigation.navigate('UIGalleryStates')}
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Playground (states)</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Simule offline/pending/quota/conflits pour valider les composants d’état. Zéro dépendance réseau.
          </Text>

          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            <Toggle
              label="Offline"
              value={state.offline}
              onValueChange={(v) => gallery.setOffline(v)}
            />

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Pending ops"
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
              <Button label="Reset" variant="ghost" onPress={() => {
                gallery.setOffline(false);
                gallery.setPendingOps(0);
                gallery.setConflicts(0);
                gallery.setQuotaLevel('OK');
              }} />
              <Button label="Aller à States" variant="secondary" onPress={() => navigation.navigate('UIGalleryStates')} />
            </View>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

