import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import type { MediaAsset } from '../../data/media';
import type { Task, TaskComment, TaskFilters, TaskStatus, TaskUpdatePatch } from '../../data/tasks';
import { tasks } from '../../data/tasks';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskQuickCreateDrawer } from './TaskQuickCreateDrawer';
import { useTaskDictation } from './useTaskDictation';

const PAGE_SIZE = 25;
const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

type ProofFilter = 'ALL' | 'WITH' | 'WITHOUT';

type SyncBadge = 'SYNCED' | 'PENDING' | 'ERROR';

const STATUS_CHIPS: Array<{ key: TaskStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'Tous' },
  { key: 'TODO', label: 'À faire' },
  { key: 'DOING', label: 'En cours' },
  { key: 'BLOCKED', label: 'Bloquées' },
  { key: 'DONE', label: 'Terminées' }
];

function statusColor(status: TaskStatus, palette: { teal: string; amber: string; rose: string; mint: string }) {
  if (status === 'TODO') return palette.amber;
  if (status === 'DOING') return palette.teal;
  if (status === 'DONE') return palette.mint;
  return palette.rose;
}

function statusLabel(status: TaskStatus) {
  if (status === 'TODO') return 'À faire';
  if (status === 'DOING') return 'En cours';
  if (status === 'DONE') return 'Terminée';
  return 'Bloquée';
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function isSafetyTask(task: Task) {
  const tags = task.tags ?? [];
  return tags.includes('safety') || tags.includes('permis_feu');
}

function avatarInitials(assigneeId: string | undefined, currentUserId: string | undefined) {
  if (!assigneeId) return '--';
  if (currentUserId && assigneeId === currentUserId) return 'ME';
  return assigneeId.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '--';
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [delayMs, value]);

  return debounced;
}

export function ProjectTasksTab({ projectId }: { projectId?: string } = {}) {
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();
  const split = width >= 980;

  const { activeOrgId, user } = useAuth();
  const navCtx = useAppNavigationContext();
  const { status: syncStatus } = useSyncStatus();

  const effectiveProjectId = projectId ?? navCtx.projectId ?? DEMO_PROJECT_ID;

  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [filterSafety, setFilterSafety] = useState(false);
  const [filterProofs, setFilterProofs] = useState<ProofFilter>('ALL');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 220);

  const [items, setItems] = useState<Task[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proofCounts, setProofCounts] = useState<Record<string, number>>({});
  const [syncBadges, setSyncBadges] = useState<Record<string, SyncBadge>>({});

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailMedia, setDetailMedia] = useState<MediaAsset[]>([]);
  const [detailComments, setDetailComments] = useState<TaskComment[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickStatus, setQuickStatus] = useState<TaskStatus>('TODO');
  const [quickSafety, setQuickSafety] = useState(false);

  const {
    isAvailable: dictationAvailable,
    isListening,
    activeField,
    error: dictationError,
    startDictation,
    stopDictation,
    clearError: clearDictationError
  } = useTaskDictation();

  useEffect(() => {
    tasks.setActor(user?.id ?? null);
  }, [user?.id]);

  const baseFilters: TaskFilters = useMemo(() => {
    return {
      org_id: activeOrgId ?? undefined,
      status: filterStatus,
      safety: filterSafety ? true : undefined,
      proofs: filterProofs === 'WITH' ? 'WITH' : filterProofs === 'WITHOUT' ? 'WITHOUT' : undefined,
      limit: PAGE_SIZE,
      offset: 0
    };
  }, [activeOrgId, filterProofs, filterSafety, filterStatus]);

  const hydrateListMeta = useCallback(
    async (tasksPage: Task[], mode: 'replace' | 'merge') => {
      if (!activeOrgId) {
        return;
      }

      const ids = tasksPage.map((task) => task.id);
      if (ids.length === 0) {
        if (mode === 'replace') {
          setProofCounts({});
          setSyncBadges({});
        }
        return;
      }

      const [counts, badges] = await Promise.all([
        tasks.getProofCounts(ids),
        tasks.getSyncBadges(ids, activeOrgId)
      ]);

      if (mode === 'replace') {
        setProofCounts(counts);
        setSyncBadges(badges);
      } else {
        setProofCounts((prev) => ({ ...prev, ...counts }));
        setSyncBadges((prev) => ({ ...prev, ...badges }));
      }
    },
    [activeOrgId]
  );

  const fetchPage = useCallback(
    async (nextPage: number, options: { replace: boolean }) => {
      if (!activeOrgId) {
        setItems([]);
        setHasMore(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const effectiveFilters: TaskFilters = { ...baseFilters, offset: nextPage * PAGE_SIZE };
        const q = debouncedQuery.trim();
        const pageItems =
          q.length > 0
            ? await tasks.searchByProject(effectiveProjectId, q, effectiveFilters)
            : await tasks.listByProject(effectiveProjectId, effectiveFilters);

        setHasMore(pageItems.length >= PAGE_SIZE);

        if (options.replace) {
          setItems(pageItems);
          setPage(nextPage);
          setSelectedTask(null);
          setDetailMedia([]);
          setDetailComments([]);
          setDetailOpen(false);
          await hydrateListMeta(pageItems, 'replace');
        } else {
          setItems((prev) => [...prev, ...pageItems]);
          setPage(nextPage);
          await hydrateListMeta(pageItems, 'merge');
        }
      } catch (fetchError) {
        const message = fetchError instanceof Error ? fetchError.message : 'Impossible de charger les taches.';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [activeOrgId, baseFilters, debouncedQuery, effectiveProjectId, hydrateListMeta]
  );

  // Reset list on filter change.
  useEffect(() => {
    void fetchPage(0, { replace: true });
  }, [debouncedQuery, filterProofs, filterSafety, filterStatus, activeOrgId, effectiveProjectId, fetchPage]);

  const refreshDetail = useCallback(
    async (taskId: string) => {
      setLoadingDetail(true);
      try {
        const [task, mediaList, comments] = await Promise.all([
          tasks.getById(taskId),
          tasks.listMedia(taskId),
          tasks.listComments(taskId)
        ]);

        setSelectedTask(task);
        setDetailMedia(mediaList);
        setDetailComments(comments);
      } finally {
        setLoadingDetail(false);
      }
    },
    []
  );

  const selectTask = useCallback(
    async (task: Task) => {
      setSelectedTask(task);
      setError(null);
      if (!split) {
        setDetailOpen(true);
      }
      await refreshDetail(task.id);
    },
    [refreshDetail, split]
  );

  const startOrStopDictation = useCallback(
    async (field: 'title' | 'description' | 'comment', options: { initialText: string; onText: (value: string) => void }) => {
      clearDictationError();

      if (isListening && activeField === field) {
        await stopDictation();
        return;
      }

      await startDictation({
        field,
        initialText: options.initialText,
        onText: options.onText
      });
    },
    [activeField, clearDictationError, isListening, startDictation, stopDictation]
  );

  const openCreate = useCallback((defaults?: { title?: string; safety?: boolean; status?: TaskStatus }) => {
    setQuickTitle(defaults?.title ?? '');
    setQuickSafety(Boolean(defaults?.safety));
    setQuickStatus(defaults?.status ?? 'TODO');
    setCreateOpen(true);
  }, []);

  const createTask = useCallback(
    async (options: { withPhoto: boolean }) => {
      if (!activeOrgId || !user?.id) {
        setError('Session invalide: utilisateur ou organisation absente.');
        return;
      }

      const title = normalizeText(quickTitle);
      if (title.length < 2) {
        setError('Titre trop court.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const newTask = await tasks.create({
          org_id: activeOrgId,
          project_id: effectiveProjectId,
          title,
          status: quickStatus,
          created_by: user.id,
          priority: 'MEDIUM',
          tags: quickSafety ? ['safety'] : [],
          last_transcript: activeField === 'title' ? title : undefined
        });

        if (options.withPhoto) {
          await tasks.addMedia(newTask.id, {
            org_id: activeOrgId,
            project_id: effectiveProjectId,
            source: 'capture',
            tag: 'preuve_tache'
          });
        }

        setCreateOpen(false);
        setQuickTitle('');
        setQuickSafety(false);
        setQuickStatus('TODO');

        await fetchPage(0, { replace: true });
        await refreshDetail(newTask.id);
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : 'Creation de tache impossible.';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [activeField, activeOrgId, effectiveProjectId, fetchPage, quickSafety, quickStatus, quickTitle, refreshDetail, user?.id]
  );

  const quickAddProofTask = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation absente.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newTask = await tasks.create({
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        title: 'Preuve chantier',
        status: 'TODO',
        created_by: user.id,
        priority: 'MEDIUM'
      });

      await tasks.addMedia(newTask.id, {
        org_id: activeOrgId,
        project_id: effectiveProjectId,
        source: 'capture',
        tag: 'preuve_tache'
      });

      await fetchPage(0, { replace: true });
      await refreshDetail(newTask.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ajout preuve impossible.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, effectiveProjectId, fetchPage, refreshDetail, user?.id]);

  const updateSelectedTask = useCallback(
    async (patch: TaskUpdatePatch) => {
      if (!selectedTask) return;
      setLoading(true);
      setError(null);

      try {
        const updated = await tasks.update(selectedTask.id, patch);
        setSelectedTask(updated);

        // refresh meta for this task (sync badge may have changed)
        if (activeOrgId) {
          const [counts, badges] = await Promise.all([
            tasks.getProofCounts([updated.id]),
            tasks.getSyncBadges([updated.id], activeOrgId)
          ]);
          setProofCounts((prev) => ({ ...prev, ...counts }));
          setSyncBadges((prev) => ({ ...prev, ...badges }));
        }

        await fetchPage(0, { replace: true });
        await refreshDetail(updated.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Mise a jour impossible.');
      } finally {
        setLoading(false);
      }
    },
    [activeOrgId, fetchPage, refreshDetail, selectedTask]
  );

  const setSelectedStatus = useCallback(
    async (status: TaskStatus) => {
      if (!selectedTask) return;
      void updateSelectedTask({ status });
    },
    [selectedTask, updateSelectedTask]
  );

  const addProof = useCallback(
    async (source: 'capture' | 'import') => {
      if (!selectedTask || !activeOrgId) return;

      setLoading(true);
      setError(null);

      try {
        await tasks.addMedia(selectedTask.id, {
          org_id: activeOrgId,
          project_id: selectedTask.project_id,
          source,
          tag: 'preuve_tache'
        });

        const counts = await tasks.getProofCounts([selectedTask.id]);
        setProofCounts((prev) => ({ ...prev, ...counts }));

        await refreshDetail(selectedTask.id);
        await fetchPage(0, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ajout de preuve impossible.');
      } finally {
        setLoading(false);
      }
    },
    [activeOrgId, fetchPage, refreshDetail, selectedTask]
  );

  const addComment = useCallback(
    async (text: string) => {
      if (!selectedTask) return;
      setLoading(true);
      setError(null);

      try {
        await tasks.addComment(selectedTask.id, text);
        await refreshDetail(selectedTask.id);
        await fetchPage(0, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ajout commentaire impossible.');
      } finally {
        setLoading(false);
      }
    },
    [fetchPage, refreshDetail, selectedTask]
  );

  const softDelete = useCallback(async () => {
    if (!selectedTask) return;
    setLoading(true);
    setError(null);

    try {
      await tasks.softDelete(selectedTask.id);
      setSelectedTask(null);
      setDetailMedia([]);
      setDetailComments([]);
      setDetailOpen(false);
      await fetchPage(0, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression impossible.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage, selectedTask]);

  const dismissSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!selectedTask) return;
      setLoading(true);
      setError(null);

      try {
        await tasks.dismissSuggestion(selectedTask.id, suggestionId);
        await refreshDetail(selectedTask.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Suggestion: dismiss impossible.');
      } finally {
        setLoading(false);
      }
    },
    [refreshDetail, selectedTask]
  );

  const assignToMe = useCallback(() => {
    if (!user?.id || !selectedTask) return;
    void updateSelectedTask({ assignee_user_id: user.id });
  }, [selectedTask, updateSelectedTask, user?.id]);

  const renderTask = useCallback(
    ({ item }: { item: Task }) => {
      const active = selectedTask?.id === item.id;
      const proofs = proofCounts[item.id] ?? 0;
      const badge = syncBadges[item.id] ?? 'SYNCED';
      const safety = isSafetyTask(item);
      const initials = avatarInitials(item.assignee_user_id, user?.id);

      const badgeColor = badge === 'ERROR' ? colors.rose : badge === 'PENDING' ? colors.amber : colors.mint;
      const badgeLabel = badge === 'ERROR' ? 'ÉCHEC' : badge === 'PENDING' ? 'SYNC' : 'OK';

      return (
        <Pressable onPress={() => void selectTask(item)}>
          <Card
            style={{
              borderColor: active ? colors.teal : colors.fog,
              borderWidth: active ? 2 : 1
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {item.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderRadius: radii.pill,
                    backgroundColor: badgeColor
                  }}
                >
                  <Text variant="caption">{badgeLabel}</Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderRadius: radii.pill,
                    backgroundColor: statusColor(item.status, colors)
                  }}
                >
                  <Text variant="caption">{statusLabel(item.status)}</Text>
                </View>
              </View>
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
              {item.tags?.length ? item.tags.slice(0, 6).join(', ') : 'sans tags'}
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {safety ? (
                  <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.amber }}>
                    <Text variant="caption">SÉCURITÉ</Text>
                  </View>
                ) : null}
                <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.fog }}>
                  <Text variant="caption">{proofs} preuve(s)</Text>
                </View>
              </View>

              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 34,
                  backgroundColor: colors.fog,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text variant="caption" style={{ color: colors.slate }}>
                  {initials}
                </Text>
              </View>
            </View>
          </Card>
        </Pressable>
      );
    },
    [colors, proofCounts, radii.pill, selectTask, selectedTask?.id, spacing.sm, spacing.xs, syncBadges, user?.id]
  );

  const listHeader = useMemo(() => {
    return (
      <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: spacing.sm }}>
          <SectionHeader title="Tâches" subtitle="Hors ligne d'abord : création rapide, filtres, preuves, suggestions." />
          <Button label="+" onPress={() => openCreate()} disabled={loading} />
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher (titre, description)"
          placeholderTextColor={colors.slate}
          style={{
            borderWidth: 1,
            borderColor: colors.fog,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.white
          }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {STATUS_CHIPS.map((chip) => {
            const active = filterStatus === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => {
                  setFilterStatus(chip.key);
                }}
                style={{
                  borderRadius: radii.pill,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  backgroundColor: active ? colors.mint : colors.white,
                  borderWidth: 1,
                  borderColor: active ? 'transparent' : colors.fog
                }}
              >
                <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            label={filterSafety ? 'Securite: ON' : 'Securite: OFF'}
            kind={filterSafety ? 'primary' : 'ghost'}
            onPress={() => setFilterSafety((prev) => !prev)}
            disabled={loading}
          />

          <Button
            label="Toutes preuves"
            kind={filterProofs === 'ALL' ? 'primary' : 'ghost'}
            onPress={() => setFilterProofs('ALL')}
            disabled={loading}
          />
          <Button
            label="Avec preuves"
            kind={filterProofs === 'WITH' ? 'primary' : 'ghost'}
            onPress={() => setFilterProofs('WITH')}
            disabled={loading}
          />
          <Button
            label="Sans preuves"
            kind={filterProofs === 'WITHOUT' ? 'primary' : 'ghost'}
            onPress={() => setFilterProofs('WITHOUT')}
            disabled={loading}
          />
        </View>

        <Text variant="caption" style={{ color: colors.slate }}>
          {items.length} élément(s) chargé(s) • file sync {syncStatus.queueDepth}
        </Text>

        {error ? (
          <Text variant="caption" style={{ color: colors.rose }}>
            {error}
          </Text>
        ) : null}

        {dictationError ? (
          <Text variant="caption" style={{ color: colors.rose }}>
            Dictee: {dictationError}
          </Text>
        ) : null}
      </View>
    );
  }, [
    colors.amber,
    colors.fog,
    colors.ink,
    colors.mint,
    colors.rose,
    colors.slate,
    colors.white,
    dictationError,
    error,
    filterProofs,
    filterSafety,
    filterStatus,
    items.length,
    loading,
    openCreate,
    query,
    radii.md,
    radii.pill,
    spacing.md,
    spacing.sm,
    spacing.xs,
    syncStatus.queueDepth
  ]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <Card>
          <Text variant="body" style={{ color: colors.slate }}>
            Chargement...
          </Text>
        </Card>
      );
    }

    return (
      <Card>
        <Text variant="body" style={{ color: colors.slate }}>
          Aucune tache pour ces filtres.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label="Creer tache" onPress={() => openCreate()} />
          <Button label="Ajouter une preuve" kind="ghost" onPress={() => void quickAddProofTask()} />
        </View>
      </Card>
    );
  }, [colors.slate, loading, openCreate, quickAddProofTask, spacing.md, spacing.sm]);

  return (
    <Screen>
      <View style={{ flex: 1, minHeight: 0, flexDirection: split ? 'row' : 'column', gap: spacing.md }}>
        <View style={{ flex: split ? 0.54 : 1, minHeight: 0 }}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderTask}
            contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            onEndReached={() => {
              if (loading || !hasMore) return;
              void fetchPage(page + 1, { replace: false });
            }}
            onEndReachedThreshold={0.7}
          />
        </View>

        {split ? (
          <View style={{ flex: 0.46, minHeight: 0 }}>
            <TaskDetailPanel
              task={selectedTask}
              media={detailMedia}
              comments={detailComments}
              busy={loading || loadingDetail}
              currentUserId={user?.id ?? null}
              dictationAvailable={dictationAvailable}
              isListening={isListening}
              activeField={activeField}
              onToggleDictation={(field, options) => {
                void startOrStopDictation(field, options);
              }}
              onUpdate={(patch) => void updateSelectedTask(patch)}
              onSetStatus={(status) => void setSelectedStatus(status)}
              onAddProof={(source) => void addProof(source)}
              onAddComment={(text) => void addComment(text)}
              onSoftDelete={() => void softDelete()}
              onDismissSuggestion={(id) => void dismissSuggestion(id)}
              onAssignToMe={assignToMe}
              onOpenCreate={() => openCreate()}
            />
          </View>
        ) : null}
      </View>

      {!split ? (
        <Modal visible={detailOpen} animationType="slide" onRequestClose={() => setDetailOpen(false)}>
          <Screen>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="h2">Tache</Text>
              <Button label="Fermer" kind="ghost" onPress={() => setDetailOpen(false)} disabled={loading || loadingDetail} />
            </View>
            <View style={{ flex: 1, minHeight: 0, marginTop: spacing.md }}>
              <TaskDetailPanel
                task={selectedTask}
                media={detailMedia}
                comments={detailComments}
                busy={loading || loadingDetail}
                currentUserId={user?.id ?? null}
                dictationAvailable={dictationAvailable}
                isListening={isListening}
                activeField={activeField}
                onToggleDictation={(field, options) => {
                  void startOrStopDictation(field, options);
                }}
                onUpdate={(patch) => void updateSelectedTask(patch)}
                onSetStatus={(status) => void setSelectedStatus(status)}
                onAddProof={(source) => void addProof(source)}
                onAddComment={(text) => void addComment(text)}
                onSoftDelete={() => void softDelete()}
                onDismissSuggestion={(id) => void dismissSuggestion(id)}
                onAssignToMe={assignToMe}
                onOpenCreate={() => openCreate()}
              />
            </View>
          </Screen>
        </Modal>
      ) : null}

      <TaskQuickCreateDrawer
        visible={createOpen}
        title={quickTitle}
        status={quickStatus}
        safety={quickSafety}
        busy={loading}
        error={error}
        dictationAvailable={dictationAvailable}
        isListeningTitle={Boolean(isListening && activeField === 'title')}
        onChangeTitle={setQuickTitle}
        onChangeStatus={setQuickStatus}
        onToggleSafety={() => setQuickSafety((prev) => !prev)}
        onToggleTitleDictation={() => void startOrStopDictation('title', { initialText: quickTitle, onText: setQuickTitle })}
        onCreate={(options) => void createTask(options)}
        onClose={() => setCreateOpen(false)}
      />
    </Screen>
  );
}
