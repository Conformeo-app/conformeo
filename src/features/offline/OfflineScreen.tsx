import React, { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { offlineDB } from '../../data/offline/outbox';
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
  return 'Synchronisation idle';
}

export function OfflineScreen() {
  const { colors, spacing } = useTheme();
  const { activeOrgId } = useAuth();
  const { status, syncNow, refreshQueue, retryDead } = useSyncStatus();

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

    await refreshQueue();
  }, [activeOrgId, refreshQueue]);

  const replayDeadLetters = useCallback(async () => {
    await retryDead();
    await refreshQueue();
  }, [refreshQueue, retryDead]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Offline-first"
          subtitle="Base locale prioritaire, synchronisation asynchrone et resiliente."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Etat de synchronisation</Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              {toStatusLabel(status.phase)}
            </Text>
            <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Operations en attente: {status.queueDepth}
            </Text>
            <Text
              variant="body"
              style={{ color: status.deadLetterCount > 0 ? colors.rose : colors.slate, marginTop: spacing.xs }}
            >
              Operations en echec terminal: {status.deadLetterCount}
            </Text>
            {status.lastResult ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Dernier cycle - push:{status.lastResult.pushed}, retry:{status.lastResult.failed}, dead:
                {status.lastResult.dead}
              </Text>
            ) : null}
            {status.lastSyncedAt ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                Derniere sync: {new Date(status.lastSyncedAt).toLocaleTimeString()}
              </Text>
            ) : null}
            {status.lastError ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
                {status.lastError}
              </Text>
            ) : null}
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button label="Rafraichir" onPress={() => void refreshQueue()} />
            <Button label="Ajouter operation demo" kind="ghost" onPress={() => void enqueueDemo()} />
            <Button label="Synchroniser" onPress={() => void syncNow()} />
            <Button label="Rejouer erreurs" kind="ghost" onPress={() => void replayDeadLetters()} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
