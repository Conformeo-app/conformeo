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
        title="Galerie UI — États"
        subtitle="Hors ligne, synchro en attente, conflits, quota, erreurs… (pilotés par le terrain de jeu)."
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
              label={phase === 'offline' ? 'HORS LIGNE' : phase === 'syncing' ? 'SYNCHRO' : phase === 'error' ? 'ÉCHEC' : 'OK'}
              icon={phase === 'offline' ? 'wifi-off' : phase === 'syncing' ? 'sync' : phase === 'error' ? 'alert-circle' : 'check-circle'}
            />
            <Tag label={`Ops en attente : ${state.pendingOps}`} tone={state.pendingOps > 0 ? 'warning' : 'success'} />
            <Tag label={`Conflits : ${state.conflicts}`} tone={state.conflicts > 0 ? 'danger' : 'neutral'} />
            <Tag
              label={`Quota : ${state.quotaLevel === 'CRIT' ? '95%+' : state.quotaLevel === 'WARN' ? '80%' : 'OK'}`}
              tone={quotaTone}
            />
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
              label="Notification (info)"
              variant="secondary"
              onPress={() => ui.showToast('Info : exemple de notification DS.', 'info')}
            />
            <Button
              label="Notification (danger)"
              variant="secondary"
              onPress={() => ui.showToast('Erreur : exemple de notification DS.', 'danger')}
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Chargement</Text>
          <View style={{ marginTop: spacing.md }}>
            <LoadingState label="Compression des preuves…" />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Vide</Text>
          <View style={{ marginTop: spacing.md }}>
            <EmptyState
              title="Aucune preuve"
              message="Ajoute une photo : elle sera disponible hors ligne immédiatement."
              primaryAction={{ label: 'Ajouter une preuve', onPress: () => {} }}
              secondaryAction={{ label: 'Créer une tâche', onPress: () => {} }}
            />
          </View>
        </Card>

        <Card>
          <Text variant="h2">Erreur</Text>
          <View style={{ marginTop: spacing.md }}>
            <ErrorState
              title="Téléversement bloqué"
              message={
                state.quotaLevel === 'CRIT'
                  ? 'Quota atteint. Téléversement bloqué. Continue hors ligne et libère de l’espace (ou passe sur un plan supérieur) avant de relancer.'
                  : 'Réseau indisponible ou quota proche. Continue hors ligne, puis réessaie quand possible.'
              }
              retry={{ label: 'Voir les échecs', onPress: () => {} }}
            />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
