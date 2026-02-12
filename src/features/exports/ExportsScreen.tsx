import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { ExportJob, ExportType, exportsDoe } from '../../data/exports';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

const EXPORT_TYPES: Array<{ value: ExportType; label: string; hint: string }> = [
  { value: 'REPORT_PDF', label: 'Rapport chantier', hint: 'PDF synthese + preuves en vignettes' },
  { value: 'CONTROL_PACK', label: 'Pack controle', hint: 'ZIP: PDF + annexes (preuves/docs)' },
  { value: 'DOE_ZIP', label: 'Dossier complet', hint: 'ZIP DOE complet + manifest' }
];

function statusLabel(status: ExportJob['status']) {
  if (status === 'PENDING') return 'PENDING';
  if (status === 'RUNNING') return 'RUNNING';
  if (status === 'DONE') return 'DONE';
  return 'FAILED';
}

function statusColor(status: ExportJob['status']) {
  if (status === 'PENDING') return '#F59E0B';
  if (status === 'RUNNING') return '#0EA5E9';
  if (status === 'DONE') return '#10B981';
  return '#EF4444';
}

function formatBytes(size?: number) {
  if (!size || size <= 0) {
    return '-';
  }

  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string) {
  if (!iso) {
    return '-';
  }

  return new Date(iso).toLocaleString('fr-FR');
}

export function ExportsScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [selectedType, setSelectedType] = useState<ExportType>('REPORT_PDF');
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [retentionDays, setRetentionDays] = useState('30');

  const runningCount = useMemo(() => jobs.filter((job) => job.status === 'RUNNING').length, [jobs]);

  useEffect(() => {
    exportsDoe.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setJobs([]);
      return;
    }

    setRefreshing(true);

    try {
      const next = await exportsDoe.listByProject(DEMO_PROJECT_ID);
      setJobs(next);
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : 'Chargement exports impossible.';
      setError(message);
    } finally {
      setRefreshing(false);
    }
  }, [activeOrgId]);

  const recomputeEstimate = useCallback(async () => {
    if (!activeOrgId) {
      setEstimatedSize(null);
      return;
    }

    try {
      const size = await exportsDoe.computeEstimatedSize(DEMO_PROJECT_ID, selectedType);
      setEstimatedSize(size);
    } catch {
      setEstimatedSize(null);
    }
  }, [activeOrgId, selectedType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void recomputeEstimate();
  }, [recomputeEstimate]);

  useEffect(() => {
    if (runningCount === 0) {
      return;
    }

    const id = setInterval(() => {
      void refresh();
    }, 1500);

    return () => clearInterval(id);
  }, [refresh, runningCount]);

  const withBusy = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      setError(null);

      try {
        await task();
        await refresh();
        await recomputeEstimate();
      } catch (taskError) {
        const message = taskError instanceof Error ? taskError.message : 'Operation export echouee.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [recomputeEstimate, refresh]
  );

  const launchExport = useCallback(() => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation absente.');
      return;
    }

    void withBusy(async () => {
      const estimated = await exportsDoe.computeEstimatedSize(DEMO_PROJECT_ID, selectedType);
      if (estimated > exportsDoe.config.maxLocalExportSizeBytes) {
        throw new Error('Export trop lourd: utiliser export serveur (v1).');
      }

      const created = await exportsDoe.createJob(DEMO_PROJECT_ID, selectedType);
      setJobs((current) => [created, ...current]);

      void exportsDoe.run(created.id).then(() => {
        void refresh();
        void recomputeEstimate();
      });
    });
  }, [activeOrgId, recomputeEstimate, refresh, selectedType, user?.id, withBusy]);

  const rerunJob = useCallback(
    (job: ExportJob) => {
      void withBusy(async () => {
        await exportsDoe.run(job.id);
      });
    },
    [withBusy]
  );

  const cancelJob = useCallback(
    (job: ExportJob) => {
      void withBusy(async () => {
        await exportsDoe.cancel(job.id);
      });
    },
    [withBusy]
  );

  const removeJob = useCallback(
    (job: ExportJob) => {
      void withBusy(async () => {
        await exportsDoe.remove(job.id);
      });
    },
    [withBusy]
  );

  const purgeOld = useCallback(() => {
    void withBusy(async () => {
      const parsed = Number.parseInt(retentionDays, 10);
      const days = Number.isFinite(parsed) ? parsed : 30;
      await exportsDoe.purgeOldExports(days);
    });
  }, [retentionDays, withBusy]);

  const shareJob = useCallback(async (job: ExportJob, mode: 'share' | 'open') => {
    if (!job.local_path) {
      setError('Fichier export absent.');
      return;
    }

    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        throw new Error('Partage non disponible sur ce device.');
      }

      await Sharing.shareAsync(job.local_path, {
        mimeType: exportsDoe.getMimeForType(job.type),
        dialogTitle: mode === 'open' ? 'Ouvrir export' : 'Partager export'
      });
    } catch (shareError) {
      const message = shareError instanceof Error ? shareError.message : 'Action de partage impossible.';
      setError(message);
    }
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        alwaysBounceVertical
      >
        <SectionHeader
          title="Exports DOE"
          subtitle="Generation locale PDF/ZIP offline-first avec retention et tracabilite."
        />

        <Card>
          <Text variant="h2">Creer un export (2 taps)</Text>
          <Text variant="body" style={{ color: colors.slate, marginTop: spacing.xs }}>
            1) Choisir le type  2) Lancer
          </Text>

          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {EXPORT_TYPES.map((type) => {
              const active = selectedType === type.value;
              return (
                <Pressable
                  key={type.value}
                  onPress={() => setSelectedType(type.value)}
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? `${colors.teal}18` : colors.white,
                    borderRadius: radii.md,
                    padding: spacing.md
                  }}
                >
                  <Text variant="bodyStrong">{type.label}</Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {type.hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button label="Lancer" onPress={launchExport} disabled={busy || !activeOrgId} />
            <Button label="Rafraichir" kind="ghost" onPress={() => void refresh()} disabled={busy || refreshing} />
          </View>

          <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
            <Text variant="caption" style={{ color: colors.slate }}>
              Estimation: {formatBytes(estimatedSize ?? undefined)} (max local: {formatBytes(exportsDoe.config.maxLocalExportSizeBytes)})
            </Text>
            <Text variant="caption" style={{ color: colors.slate }}>
              Sync queue globale: {syncStatus.queueDepth}
            </Text>
            <Text variant="caption" style={{ color: colors.slate }}>
              Jobs RUNNING: {runningCount}
            </Text>
          </View>

          {error ? (
            <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.rose }}>
              {error}
            </Text>
          ) : null}
        </Card>

        <Card>
          <Text variant="h2">Retention / purge</Text>
          <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TextInput
              value={retentionDays}
              onChangeText={setRetentionDays}
              keyboardType="number-pad"
              placeholder="Jours"
              placeholderTextColor={colors.slate}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.ink,
                backgroundColor: colors.white
              }}
            />
            <Button label="Purger" kind="ghost" onPress={purgeOld} disabled={busy} />
          </View>
        </Card>

        {jobs.length === 0 ? (
          <Card>
            <Text variant="body" style={{ color: colors.slate }}>
              Aucun export pour ce chantier.
            </Text>
          </Card>
        ) : null}

        {jobs.map((item) => {
          const isDone = item.status === 'DONE' && Boolean(item.local_path);
          return (
            <Card key={item.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{item.type}</Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {exportsDoe.getDisplayFileName(item)}
                  </Text>
                </View>

                <View
                  style={{
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                    backgroundColor: statusColor(item.status)
                  }}
                >
                  <Text variant="caption" style={{ color: '#FFFFFF' }}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: spacing.sm, gap: 3 }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Cree: {formatDate(item.created_at)}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Termine: {formatDate(item.finished_at)}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Taille: {formatBytes(item.size_bytes)}
                </Text>
              </View>

              {item.status === 'RUNNING' ? (
                <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <ActivityIndicator size="small" color={colors.teal} />
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Generation en cours...
                  </Text>
                </View>
              ) : null}

              {item.last_error ? (
                <Text variant="caption" style={{ marginTop: spacing.xs, color: colors.rose }}>
                  {item.last_error}
                </Text>
              ) : null}

              <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {isDone ? (
                  <>
                    <Button label="Ouvrir" kind="ghost" onPress={() => void shareJob(item, 'open')} disabled={busy} />
                    <Button label="Partager" onPress={() => void shareJob(item, 'share')} disabled={busy} />
                  </>
                ) : null}

                {item.status === 'FAILED' ? (
                  <Button label="Relancer" kind="ghost" onPress={() => rerunJob(item)} disabled={busy} />
                ) : null}

                {item.status === 'RUNNING' || item.status === 'PENDING' ? (
                  <Button label="Annuler" kind="ghost" onPress={() => cancelJob(item)} disabled={busy} />
                ) : null}

                <Button label="Supprimer" kind="ghost" onPress={() => removeJob(item)} disabled={busy} />
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
