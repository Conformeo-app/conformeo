import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { offlineDB, OfflineOperation } from '../../data/offline/outbox';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function toStatusLabel(phase: 'idle' | 'syncing' | 'offline' | 'error') {
  if (phase === 'syncing') return 'Synchronisation en cours';
  if (phase === 'offline') return 'Mode hors ligne';
  if (phase === 'error') return 'Erreur de synchronisation';
  return 'Synchronisation OK';
}

export function OfflineScreen() {
  const { colors, spacing } = useTheme();
  const { activeOrgId } = useAuth();
  const { status, syncNow, refreshQueue, retryDead } = useSyncStatus();

  const [pendingOps, setPendingOps] = useState<OfflineOperation[]>([]);
  const [failedOps, setFailedOps] = useState<OfflineOperation[]>([]);

  const refreshDetails = useCallback(async () => {
    const now = Date.now();
    const [pending, failed] = await Promise.all([
      offlineDB.getPendingOperations(10, now),
      offlineDB.getFailedOperations(10, 1)
    ]);

    setPendingOps(pending);
    setFailedOps(failed);
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshQueue();
    await refreshDetails();
  }, [refreshDetails, refreshQueue]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  const enqueueDemo = useCallback(async () => {
    if (!activeOrgId) {
      return;
    }

    const inspectionId = offlineDB.createOperationId('inspection');
    await offlineDB.create('inspection', {
      id: inspectionId,
      status: 'ready_for_sync',
      orgId: activeOrgId,
      createdAt: new Date().toISOString()
    });

    await refreshAll();
  }, [activeOrgId, refreshAll]);

  const replayDeadLetters = useCallback(async () => {
    await retryDead();
    await refreshAll();
  }, [refreshAll, retryDead]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Hors ligne d'abord"
          subtitle="Base locale prioritaire, synchronisation asynchrone et résiliente."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">État de synchronisation</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              {toStatusLabel(status.phase)}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Opérations en attente: {status.queueDepth}
            </Text>
            <Text
              variant="body"
              style={{ color: status.deadLetterCount > 0 ? colors.rose : colors.slate, marginTop: spacing.xs }}
            >
              Opérations en échec terminal: {status.deadLetterCount}
            </Text>
            {status.lastResult ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Dernier cycle - envoyés:{status.lastResult.pushed}, retentatives:{status.lastResult.failed}, terminaux:
                {status.lastResult.dead}
              </Text>
            ) : null}
            {status.lastSyncedAt ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Dernière synchronisation: {new Date(status.lastSyncedAt).toLocaleTimeString()}
              </Text>
            ) : null}
            {status.lastError ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                {status.lastError}
              </Text>
            ) : null}
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button label="Rafraîchir" onPress={() => void refreshAll()} />
            <Button label="Ajouter opération démo" kind="ghost" onPress={() => void enqueueDemo()} />
            <Button label="Synchroniser" onPress={() => void syncNow()} />
            <Button label="Rejouer les erreurs" kind="ghost" onPress={() => void replayDeadLetters()} />
          </View>

          <Card>
            <Text variant="h2">Opérations prêtes (top 10)</Text>
            {pendingOps.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Aucune opération prête.
              </Text>
            ) : (
              pendingOps.map((op) => (
                <View key={op.id} style={{ marginTop: spacing.sm }}>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {op.entity} · {op.type} · retry {op.retry_count}
                  </Text>
                  {op.last_error ? (
                    <Text variant="caption" style={{ color: colors.rose }} numberOfLines={2}>
                      {op.last_error}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text variant="h2">Dernières erreurs (top 10)</Text>
            {failedOps.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Aucune erreur enregistrée.
              </Text>
            ) : (
              failedOps.map((op) => (
                <View key={op.id} style={{ marginTop: spacing.sm }}>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {op.entity} · {op.type} · retry {op.retry_count} · next {new Date(op.next_attempt_at).toLocaleTimeString("fr-FR")}
                  </Text>
                  {op.last_error ? (
                    <Text variant="caption" style={{ color: colors.rose }} numberOfLines={2}>
                      {op.last_error}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
