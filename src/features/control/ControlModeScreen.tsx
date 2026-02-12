import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native';
import { useAuth } from '../../core/auth';
import {
  ChecklistWithItems,
  ControlActivity,
  ControlSummary,
  InspectionItem,
  controlMode
} from '../../data/control-mode';
import { ExportJob, exportsDoe } from '../../data/exports';
import { media, MediaAsset } from '../../data/media';
import { Task } from '../../data/tasks';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const FALLBACK_PROJECT_ID = 'chantier-conformeo-demo';
const PROOF_PAGE_SIZE = 90;

type TabKey = 'SUMMARY' | 'PROOFS';
type ProofWindow = 'ALL' | 'TODAY' | 'LAST_7_DAYS';

function formatDate(value: string | undefined) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('fr-FR');
}

function isImage(asset: MediaAsset) {
  return asset.mime === 'image/webp' || asset.mime === 'image/jpeg';
}

function riskColor(
  level: ControlSummary['riskLevel'],
  palette: { mint: string; amber: string; rose: string }
) {
  if (level === 'OK') return palette.mint;
  if (level === 'WATCH') return palette.amber;
  return palette.rose;
}

function taskStatusColor(
  status: Task['status'],
  palette: { mint: string; amber: string; teal: string; rose: string }
) {
  if (status === 'DONE') return palette.mint;
  if (status === 'TODO') return palette.amber;
  if (status === 'DOING') return palette.teal;
  return palette.rose;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue.';
}

function fromDateForWindow(window: ProofWindow) {
  if (window === 'ALL') {
    return undefined;
  }

  const now = new Date();

  if (window === 'TODAY') {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    return todayStart.toISOString();
  }

  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return last7Days.toISOString();
}

export function ControlModeScreen() {
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [tab, setTab] = useState<TabKey>('SUMMARY');
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(FALLBACK_PROJECT_ID);

  const [modeEnabled, setModeEnabled] = useState(false);
  const [summary, setSummary] = useState<ControlSummary | null>(null);
  const [openIssues, setOpenIssues] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ControlActivity[]>([]);

  const [checklist, setChecklist] = useState<ChecklistWithItems | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const [proofs, setProofs] = useState<MediaAsset[]>([]);
  const [criticalOnly, setCriticalOnly] = useState(true);
  const [proofTag, setProofTag] = useState('');
  const [proofTaskId, setProofTaskId] = useState('');
  const [proofWindow, setProofWindow] = useState<ProofWindow>('ALL');
  const [proofPage, setProofPage] = useState(0);
  const [proofHasNext, setProofHasNext] = useState(false);

  const [exportJob, setExportJob] = useState<ExportJob | null>(null);

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingProofs, setLoadingProofs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proofColumns = width >= 1200 ? 3 : 2;

  const withBusy = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);

    try {
      await task();
    } catch (taskError) {
      setError(toErrorMessage(taskError));
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshProjectOptions = useCallback(async () => {
    if (!activeOrgId) {
      setProjectOptions([]);
      setProjectId(FALLBACK_PROJECT_ID);
      return;
    }

    try {
      const projects = await controlMode.listProjects();
      const nextOptions = projects.length > 0 ? projects : [FALLBACK_PROJECT_ID];
      setProjectOptions(nextOptions);
      setProjectId((current) => (nextOptions.includes(current) ? current : nextOptions[0]));
    } catch (projectError) {
      setError(toErrorMessage(projectError));
      setProjectOptions([FALLBACK_PROJECT_ID]);
      setProjectId(FALLBACK_PROJECT_ID);
    }
  }, [activeOrgId]);

  const refreshSummary = useCallback(async () => {
    if (!activeOrgId || !projectId) {
      setSummary(null);
      setOpenIssues([]);
      setActivity([]);
      setChecklist(null);
      setModeEnabled(false);
      return;
    }

    setLoadingSummary(true);

    try {
      const [enabled, summaryValue, issues, timeline, latestChecklist, currentExportJobs] = await Promise.all([
        controlMode.isEnabled(projectId),
        controlMode.getSummary(projectId),
        controlMode.listOpenIssues(projectId),
        controlMode.getRecentActivity(projectId, 10),
        controlMode.getLatestChecklist(projectId),
        exportsDoe.listByProject(projectId)
      ]);

      setModeEnabled(enabled);
      setSummary(summaryValue);
      setOpenIssues(issues);
      setActivity(timeline);
      setChecklist(latestChecklist);

      setCommentDrafts(
        Object.fromEntries(
          latestChecklist.items.map((item) => [item.id, item.comment ?? ''])
        )
      );

      const latestControlPack = currentExportJobs.find((job) => job.type === 'CONTROL_PACK') ?? null;
      setExportJob(latestControlPack);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoadingSummary(false);
    }
  }, [activeOrgId, projectId]);

  const refreshProofs = useCallback(async () => {
    if (!activeOrgId || !projectId) {
      setProofs([]);
      setProofHasNext(false);
      return;
    }

    setLoadingProofs(true);

    try {
      const fromDate = fromDateForWindow(proofWindow);
      const rows = await controlMode.listCriticalProofs(projectId, {
        task_id: proofTaskId.trim() || undefined,
        tag: proofTag.trim() || undefined,
        critical_only: criticalOnly,
        from_date: fromDate,
        limit: PROOF_PAGE_SIZE,
        offset: proofPage * PROOF_PAGE_SIZE
      });

      setProofs(rows);
      setProofHasNext(rows.length >= PROOF_PAGE_SIZE);
    } catch (proofError) {
      setError(toErrorMessage(proofError));
    } finally {
      setLoadingProofs(false);
    }
  }, [activeOrgId, criticalOnly, projectId, proofPage, proofTag, proofTaskId, proofWindow]);

  useEffect(() => {
    controlMode.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });

    exportsDoe.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  useEffect(() => {
    void refreshProjectOptions();
  }, [refreshProjectOptions]);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    if (tab !== 'PROOFS') {
      return;
    }

    void refreshProofs();
  }, [tab, refreshProofs]);

  useEffect(() => {
    setProofPage(0);
  }, [criticalOnly, proofTag, proofTaskId, proofWindow, projectId]);

  useEffect(() => {
    if (!exportJob) {
      return;
    }

    if (exportJob.status === 'DONE' || exportJob.status === 'FAILED') {
      return;
    }

    const intervalId = setInterval(() => {
      void exportsDoe.getById(exportJob.id).then((next) => {
        if (next) {
          setExportJob(next);
        }
      });
    }, 1500);

    return () => {
      clearInterval(intervalId);
    };
  }, [exportJob]);

  const applyModeChange = useCallback(
    async (nextEnabled: boolean) => {
      await withBusy(async () => {
        if (nextEnabled) {
          await controlMode.enable(projectId);
        } else {
          await controlMode.disable(projectId);
        }

        await refreshSummary();
      });
    },
    [projectId, refreshSummary, withBusy]
  );

  const confirmModeToggle = useCallback(() => {
    if (modeEnabled) {
      Alert.alert('Desactiver lecture seule', 'Le mode controle redeviendra modifiable.', [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Desactiver',
          style: 'destructive',
          onPress: () => {
            void applyModeChange(false);
          }
        }
      ]);
      return;
    }

    Alert.alert('Activer lecture seule', 'Aucune modification ne sera possible (sauf ajout de preuve).', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Activer',
        onPress: () => {
          void applyModeChange(true);
        }
      }
    ]);
  }, [applyModeChange, modeEnabled]);

  const captureProof = useCallback(() => {
    if (!activeOrgId || !projectId) {
      setError('Aucune organisation ou chantier actif.');
      return;
    }

    void withBusy(async () => {
      await media.capturePhoto({
        org_id: activeOrgId,
        project_id: projectId,
        tag: 'control-proof'
      });

      await Promise.all([refreshSummary(), refreshProofs()]);
    });
  }, [activeOrgId, projectId, refreshProofs, refreshSummary, withBusy]);

  const generateControlPack = useCallback(() => {
    void withBusy(async () => {
      const job = await controlMode.generateControlPack(projectId);
      setExportJob(job);
    });
  }, [projectId, withBusy]);

  const shareControlPack = useCallback(async () => {
    if (!exportJob?.local_path) {
      setError('Pack controle non disponible.');
      return;
    }

    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        throw new Error('Partage indisponible sur ce device.');
      }

      await Sharing.shareAsync(exportJob.local_path, {
        dialogTitle: 'Partager pack controle'
      });
    } catch (shareError) {
      setError(toErrorMessage(shareError));
    }
  }, [exportJob?.local_path]);

  const toggleChecklistItem = useCallback(
    (item: InspectionItem) => {
      if (modeEnabled) {
        setError('Lecture seule active: checklist verrouillee.');
        return;
      }

      void withBusy(async () => {
        await controlMode.toggleItem(item.id, !item.checked);
        await refreshSummary();
      });
    },
    [modeEnabled, refreshSummary, withBusy]
  );

  const saveChecklistComment = useCallback(
    (itemId: string) => {
      if (modeEnabled) {
        setError('Lecture seule active: checklist verrouillee.');
        return;
      }

      const value = (commentDrafts[itemId] ?? '').trim();

      void withBusy(async () => {
        await controlMode.setComment(itemId, value);
        await refreshSummary();
      });
    },
    [commentDrafts, modeEnabled, refreshSummary, withBusy]
  );

  const createNewChecklist = useCallback(() => {
    if (modeEnabled) {
      setError('Lecture seule active: creation checklist bloquee.');
      return;
    }

    void withBusy(async () => {
      await controlMode.createChecklist(projectId);
      await refreshSummary();
    });
  }, [modeEnabled, projectId, refreshSummary, withBusy]);

  const openCriticalProofsTab = useCallback(() => {
    setCriticalOnly(true);
    setTab('PROOFS');
  }, []);

  const riskPillColor = summary ? riskColor(summary.riskLevel, colors) : colors.fog;

  const proofHeader = useMemo(
    () => (
      <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
        <Card>
          <Text variant="h2">Filtres preuves</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Thumbnails uniquement. Pagination active.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              label={criticalOnly ? 'Critiques: OUI' : 'Critiques: NON'}
              kind={criticalOnly ? 'primary' : 'ghost'}
              onPress={() => setCriticalOnly((current) => !current)}
              disabled={busy}
            />
            <Button
              label={
                proofWindow === 'ALL'
                  ? 'Periode: Tout'
                  : proofWindow === 'TODAY'
                    ? "Periode: Aujourd'hui"
                    : 'Periode: 7 jours'
              }
              kind="ghost"
              onPress={() => {
                setProofWindow((current) => {
                  if (current === 'ALL') return 'TODAY';
                  if (current === 'TODAY') return 'LAST_7_DAYS';
                  return 'ALL';
                });
              }}
              disabled={busy}
            />
            <Button label="Rafraichir" kind="ghost" onPress={() => void refreshProofs()} disabled={busy} />
          </View>

          <TextInput
            value={proofTag}
            onChangeText={setProofTag}
            placeholder="Tag (ex: safety, permis_feu)"
            placeholderTextColor={colors.slate}
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.sm,
              color: colors.ink
            }}
          />

          <TextInput
            value={proofTaskId}
            onChangeText={setProofTaskId}
            placeholder="Filtrer par task_id"
            placeholderTextColor={colors.slate}
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.sm,
              color: colors.ink
            }}
          />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              label="Page precedente"
              kind="ghost"
              onPress={() => setProofPage((current) => Math.max(0, current - 1))}
              disabled={proofPage === 0 || busy}
            />
            <Button
              label="Page suivante"
              kind="ghost"
              onPress={() => setProofPage((current) => current + 1)}
              disabled={!proofHasNext || busy}
            />
            <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
              Page {proofPage + 1}
            </Text>
          </View>
        </Card>
      </View>
    ),
    [
      busy,
      colors,
      criticalOnly,
      proofHasNext,
      proofPage,
      proofTag,
      proofTaskId,
      proofWindow,
      radii.md,
      refreshProofs,
      spacing.md,
      spacing.sm,
      spacing.xs
    ]
  );

  return (
    <Screen>
      <SectionHeader
        title="Mode controle"
        subtitle="Lecture rapide inspection: synthese, preuves critiques, checklist et export controle en 1 clic."
      />

      <Card>
        <Text variant="h2">Chantier</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: spacing.sm }}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {projectOptions.map((option) => {
            const active = option === projectId;
            return (
              <Pressable
                key={option}
                onPress={() => setProjectId(option)}
                style={{
                  borderRadius: radii.pill,
                  borderWidth: 1,
                  borderColor: active ? colors.teal : colors.fog,
                  backgroundColor: active ? colors.mint : colors.white,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs
                }}
              >
                <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button
            label="Synthese"
            kind={tab === 'SUMMARY' ? 'primary' : 'ghost'}
            onPress={() => setTab('SUMMARY')}
          />
          <Button
            label="Preuves"
            kind={tab === 'PROOFS' ? 'primary' : 'ghost'}
            onPress={() => setTab('PROOFS')}
          />
        </View>

        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
          Sync queue: {syncStatus.queueDepth} | Lecture seule: {modeEnabled ? 'active' : 'inactive'}
        </Text>
      </Card>

      {tab === 'SUMMARY' ? (
        <ScrollView
          style={{ flex: 1, marginTop: spacing.md }}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="h2">Synthese inspection</Text>
              {loadingSummary ? <ActivityIndicator color={colors.teal} size="small" /> : null}
            </View>

            <View
              style={{
                marginTop: spacing.sm,
                borderRadius: radii.pill,
                alignSelf: 'flex-start',
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                backgroundColor: riskPillColor
              }}
            >
              <Text variant="caption">Risque: {summary?.riskLevel ?? '-'}</Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Card style={{ flex: 1, minWidth: 130 }}>
                <Text variant="caption" style={{ color: colors.slate }}>Taches ouvertes</Text>
                <Text variant="h2">{summary?.openTasks ?? 0}</Text>
              </Card>
              <Card style={{ flex: 1, minWidth: 130 }}>
                <Text variant="caption" style={{ color: colors.slate }}>Bloquees</Text>
                <Text variant="h2">{summary?.blockedTasks ?? 0}</Text>
              </Card>
              <Card style={{ flex: 1, minWidth: 130 }}>
                <Text variant="caption" style={{ color: colors.slate }}>Preuves</Text>
                <Text variant="h2">{summary?.mediaCount ?? 0}</Text>
              </Card>
              <Card style={{ flex: 1, minWidth: 130 }}>
                <Text variant="caption" style={{ color: colors.slate }}>Documents</Text>
                <Text variant="h2">{summary?.documentsCount ?? 0}</Text>
              </Card>
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Derniere activite: {formatDate(summary?.lastActivityAt)}
            </Text>
          </Card>

          <Card>
            <Text variant="h2">Actions rapides</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label={modeEnabled ? 'Desactiver lecture seule' : 'Activer lecture seule'} kind="ghost" onPress={confirmModeToggle} disabled={busy} />
              <Button label="Pack controle 1 clic" onPress={generateControlPack} disabled={busy || loadingSummary} />
              <Button label="Partager" kind="ghost" onPress={() => void shareControlPack()} disabled={!exportJob?.local_path || busy} />
              <Button label="Ajouter preuve" kind="ghost" onPress={captureProof} disabled={busy} />
              <Button label="Afficher preuves critiques" kind="ghost" onPress={openCriticalProofsTab} disabled={busy} />
            </View>

            {modeEnabled ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                Mode lecture seule actif: modifications verrouillees (ajout preuve autorise).
              </Text>
            ) : null}

            {exportJob ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Pack controle: {exportJob.status} | cree le {formatDate(exportJob.created_at)}
              </Text>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Issues ouvertes</Text>
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {openIssues.slice(0, 10).map((task) => (
                <View
                  key={task.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    padding: spacing.sm
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                    <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {task.title}
                    </Text>
                    <View
                      style={{
                        borderRadius: radii.pill,
                        backgroundColor: taskStatusColor(task.status, colors),
                        paddingHorizontal: spacing.sm,
                        paddingVertical: spacing.xs
                      }}
                    >
                      <Text variant="caption">{task.status}</Text>
                    </View>
                  </View>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
                    tags: {task.tags.join(', ') || 'aucun'}
                  </Text>
                </View>
              ))}
              {openIssues.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune issue ouverte.
                </Text>
              ) : null}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Dernieres activites</Text>
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {activity.map((item) => (
                <View key={item.id}>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {item.entity} | {formatDate(item.at)}
                  </Text>
                  <Text variant="bodyStrong">{item.title}</Text>
                  {item.subtitle ? <Text variant="caption" style={{ color: colors.slate }}>{item.subtitle}</Text> : null}
                </View>
              ))}
              {activity.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune activite recente.
                </Text>
              ) : null}
            </View>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="h2">Checklist inspection</Text>
              <Button label="Nouvelle checklist" kind="ghost" onPress={createNewChecklist} disabled={busy || modeEnabled} />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {checklist?.items.map((item) => (
                <View
                  key={item.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    padding: spacing.sm
                  }}
                >
                  <Pressable
                    onPress={() => toggleChecklistItem(item)}
                    disabled={busy || modeEnabled}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 1,
                        borderColor: colors.fog,
                        backgroundColor: item.checked ? colors.mint : colors.white
                      }}
                    />
                    <Text variant="bodyStrong" style={{ flex: 1 }}>
                      {item.label}
                    </Text>
                  </Pressable>

                  <TextInput
                    value={commentDrafts[item.id] ?? item.comment ?? ''}
                    onChangeText={(value) => setCommentDrafts((current) => ({ ...current, [item.id]: value }))}
                    editable={!modeEnabled && !busy}
                    placeholder="Commentaire (optionnel)"
                    placeholderTextColor={colors.slate}
                    multiline
                    style={{
                      borderWidth: 1,
                      borderColor: colors.fog,
                      borderRadius: radii.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      backgroundColor: colors.white,
                      marginTop: spacing.sm,
                      color: colors.ink,
                      minHeight: 56
                    }}
                  />

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <Button
                      label="Enregistrer commentaire"
                      kind="ghost"
                      onPress={() => saveChecklistComment(item.id)}
                      disabled={modeEnabled || busy}
                    />
                  </View>

                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    Maj: {formatDate(item.updated_at)} | auteur: {item.updated_by ?? '-'}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, minHeight: 0, marginTop: spacing.md }}>
          <FlatList
            data={proofs}
            keyExtractor={(item) => item.id}
            numColumns={proofColumns}
            style={{ flex: 1, minHeight: 0 }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            updateCellsBatchingPeriod={40}
            windowSize={7}
            removeClippedSubviews
            contentContainerStyle={{ paddingBottom: spacing.lg, gap: spacing.sm }}
            columnWrapperStyle={proofColumns > 1 ? { gap: spacing.sm } : undefined}
            ListHeaderComponent={proofHeader}
            renderItem={({ item }) => (
              <Card style={{ flex: 1, minHeight: 200 }}>
                {isImage(item) && item.local_thumb_path ? (
                  <Image
                    source={{ uri: item.local_thumb_path }}
                    style={{ width: '100%', height: 112, borderRadius: radii.md, marginBottom: spacing.xs }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: '100%',
                      height: 112,
                      borderRadius: radii.md,
                      marginBottom: spacing.xs,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.fog
                    }}
                  >
                    <Text variant="caption" style={{ color: colors.slate }}>
                      {item.mime === 'application/pdf' ? 'PDF' : 'Thumb indisponible'}
                    </Text>
                  </View>
                )}

                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.tag ?? 'preuve'}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                  task: {item.task_id ?? '-'}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  {formatDate(item.created_at)}
                </Text>
              </Card>
            )}
            ListEmptyComponent={
              <Card>
                <Text variant="body" style={{ color: colors.slate }}>
                  {loadingProofs ? 'Chargement preuves...' : 'Aucune preuve pour ces filtres.'}
                </Text>
              </Card>
            }
          />

          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
