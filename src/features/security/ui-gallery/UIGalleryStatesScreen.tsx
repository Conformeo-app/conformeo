import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../../ui/theme/ThemeProvider';
import { Screen } from '../../../ui/layout/Screen';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineBanner,
  SectionHeader,
  SyncPill,
  Tag,
  Text
} from '../../../ui/components';
import { ui } from '../../../ui/runtime/ui';
import { useGalleryState } from './galleryState';

type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

function phaseFrom(state: { offline: boolean; pendingOps: number; conflicts: number }): SyncPhase {
  if (state.offline) return 'offline';
  if (state.conflicts > 0) return 'error';
  if (state.pendingOps > 0) return 'syncing';
  return 'idle';
}

export function UIGalleryStatesScreen() {
  const { spacing, colors } = useTheme();
  const state = useGalleryState();

  const phase = useMemo(() => phaseFrom(state), [state]);

  const quotaTone = state.quotaLevel === 'CRIT' ? 'danger' : state.quotaLevel === 'WARN' ? 'warning' : 'success';

  return (
    <Screen>
      <SectionHeader
        title="UI Gallery — States"
        subtitle="Offline, pending sync, conflits, quota, erreurs… (pilotés par le Playground)."
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text variant="h2">Indicateurs globaux</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Badge
              tone={phase === 'error' ? 'danger' : phase === 'offline' ? 'warning' : phase === 'syncing' ? 'sync' : 'success'}
              label={phase === 'offline' ? 'OFFLINE' : phase === 'syncing' ? 'SYNCING' : phase === 'error' ? 'ERROR' : 'OK'}
              icon={phase === 'offline' ? 'wifi-off' : phase === 'syncing' ? 'sync' : phase === 'error' ? 'alert-circle' : 'check-circle'}
            />
            <Tag label={`Pending ops: ${state.pendingOps}`} tone={state.pendingOps > 0 ? 'warning' : 'success'} />
            <Tag label={`Conflits: ${state.conflicts}`} tone={state.conflicts > 0 ? 'danger' : 'neutral'} />
            <Tag label={`Quota: ${state.quotaLevel}`} tone={quotaTone} />
          </View>

          <View style={{ marginTop: spacing.md }}>
            <OfflineBanner visible={state.offline} message="Mode hors ligne — synchronisation automatique dès connexion." />
          </View>

          <View style={{ marginTop: spacing.md }}>
            <SyncPill
              phase={phase}
              queueDepth={state.pendingOps}
              deadLetterCount={state.conflicts}
              lastError={state.conflicts > 0 ? 'Conflits à résoudre avant une sync propre.' : null}
              lastSyncedAt={null}
              lastResult={null}
            />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button
              label="Toast (info)"
              variant="secondary"
              onPress={() => ui.showToast('Info: exemple de toast DS.', 'info')}
            />
            <Button
              label="Toast (danger)"
              variant="secondary"
              onPress={() => ui.showToast('Erreur: exemple de toast DS.', 'danger')}
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Loading</Text>
          <View style={{ marginTop: spacing.md }}>
            <LoadingState label="Compression des preuves…" />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Empty</Text>
          <View style={{ marginTop: spacing.md }}>
            <EmptyState
              title="Aucune preuve"
              message="Ajoute une photo: elle sera disponible offline immédiatement."
              primaryAction={{ label: 'Ajouter une preuve', onPress: () => {} }}
              secondaryAction={{ label: 'Créer une tâche', onPress: () => {} }}
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Error</Text>
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="Upload bloqué"
              message={
                state.quotaLevel === 'CRIT'
                  ? 'Quota atteint. Upload bloqué. Continue offline et libère de l’espace (ou upgrade) avant de relancer.'
                  : 'Réseau indisponible ou quota proche. Continue offline, puis réessaie quand possible.'
              }
              retry={{ label: 'Voir les échecs', onPress: () => {} }}
            />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
