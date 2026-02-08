import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { MediaAsset } from '../../data/media';
import { Task, TaskComment, TaskStatus, tasks } from '../../data/tasks';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { useTaskDictation } from './useTaskDictation';

const PAGE_SIZE = 25;
const DEMO_PROJECT_ID = 'chantier-tasks-demo';

const STATUS_ORDER: TaskStatus[] = ['TODO', 'DOING', 'DONE', 'BLOCKED'];

function statusColor(status: TaskStatus, palette: { teal: string; amber: string; rose: string; mint: string }) {
  if (status === 'TODO') return palette.amber;
  if (status === 'DOING') return palette.teal;
  if (status === 'DONE') return palette.mint;
  return palette.rose;
}

function sanitizeTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ');
}

function isPdf(mediaAsset: MediaAsset) {
  return mediaAsset.mime === 'application/pdf';
}

export function TasksScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [tasksList, setTasksList] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailMedia, setDetailMedia] = useState<MediaAsset[]>([]);
  const [detailComments, setDetailComments] = useState<TaskComment[]>([]);
  const [previewByTask, setPreviewByTask] = useState<Record<string, string | null>>({});

  const [quickTitle, setQuickTitle] = useState('');
  const [quickStatus, setQuickStatus] = useState<TaskStatus>('TODO');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(0);

  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    isAvailable: dictationAvailable,
    isListening,
    activeField,
    error: dictationError,
    startDictation,
    stopDictation,
    clearError: clearDictationError
  } = useTaskDictation();

  const selectedTaskId = selectedTask?.id ?? null;

  useEffect(() => {
    tasks.setActor(user?.id ?? null);
  }, [user?.id]);

  const refreshList = useCallback(async () => {
    if (!activeOrgId) {
      setTasksList([]);
      setPreviewByTask({});
      return;
    }

    setLoadingList(true);

    try {
      const nextTasks = await tasks.listByProject(DEMO_PROJECT_ID, {
        org_id: activeOrgId,
        status: filterStatus,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      });

      setTasksList(nextTasks);

      const previewEntries = await Promise.all(
        nextTasks.map(async (task) => {
          const medias = await tasks.listMedia(task.id);
          return [task.id, medias[0]?.local_thumb_path ?? null] as const;
        })
      );

      setPreviewByTask(Object.fromEntries(previewEntries));

      if (selectedTaskId && !nextTasks.some((task) => task.id === selectedTaskId)) {
        setSelectedTask(null);
        setDetailMedia([]);
        setDetailComments([]);
      }
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Impossible de charger les tâches.';
      setError(message);
    } finally {
      setLoadingList(false);
    }
  }, [activeOrgId, filterStatus, page, selectedTaskId]);

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
        setDescriptionDraft(task?.description ?? '');
      } catch (detailError) {
        const message = detailError instanceof Error ? detailError.message : 'Impossible de charger le détail tâche.';
        setError(message);
      } finally {
        setLoadingDetail(false);
      }
    },
    []
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const selectTask = useCallback(
    async (task: Task) => {
      setSelectedTask(task);
      setError(null);
      await refreshDetail(task.id);
    },
    [refreshDetail]
  );

  const createTask = useCallback(
    async (withPhoto: boolean) => {
      if (!activeOrgId || !user?.id) {
        setError('Session invalide: utilisateur ou organisation absente.');
        return;
      }

      const title = sanitizeTitle(quickTitle);
      if (title.length < 2) {
        setError('Titre trop court.');
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const newTask = await tasks.create({
          org_id: activeOrgId,
          project_id: DEMO_PROJECT_ID,
          title,
          status: quickStatus,
          created_by: user.id,
          priority: 'MEDIUM',
          last_transcript: activeField === 'title' ? title : undefined
        });

        if (withPhoto) {
          try {
            await tasks.addMedia(newTask.id, {
              org_id: activeOrgId,
              project_id: DEMO_PROJECT_ID,
              source: 'capture',
              tag: 'preuve_terrain'
            });
          } catch (mediaError) {
            const mediaMessage = mediaError instanceof Error ? mediaError.message : 'preuve non ajoutée';
            setError('Tâche créée, mais preuve non ajoutée: ' + mediaMessage);
          }
        }

        setQuickTitle('');
        setQuickStatus('TODO');
        setPage(0);

        await refreshList();
        await refreshDetail(newTask.id);
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : 'Création de tâche impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [activeField, activeOrgId, quickStatus, quickTitle, refreshDetail, refreshList, user?.id]
  );

  const updateSelectedTask = useCallback(
    async (patch: Parameters<typeof tasks.update>[1]) => {
      if (!selectedTask) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const updated = await tasks.update(selectedTask.id, patch);
        setSelectedTask(updated);
        setDescriptionDraft(updated.description ?? '');
        await refreshList();
        await refreshDetail(updated.id);
      } catch (updateError) {
        const message = updateError instanceof Error ? updateError.message : 'Mise à jour impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [refreshDetail, refreshList, selectedTask]
  );

  const setSelectedStatus = useCallback(
    async (status: TaskStatus) => {
      if (!selectedTask) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const updated = await tasks.setStatus(selectedTask.id, status);
        setSelectedTask(updated);
        await refreshList();
        await refreshDetail(updated.id);
      } catch (statusError) {
        const message = statusError instanceof Error ? statusError.message : 'Changement de statut impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [refreshDetail, refreshList, selectedTask]
  );

  const addProof = useCallback(
    async (source: 'capture' | 'import') => {
      if (!selectedTask || !activeOrgId) {
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await tasks.addMedia(selectedTask.id, {
          org_id: activeOrgId,
          project_id: selectedTask.project_id,
          source,
          tag: 'preuve_tache'
        });

        await refreshDetail(selectedTask.id);
        await refreshList();
      } catch (mediaError) {
        const message = mediaError instanceof Error ? mediaError.message : 'Ajout de preuve impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [activeOrgId, refreshDetail, refreshList, selectedTask]
  );

  const addComment = useCallback(async () => {
    if (!selectedTask) {
      return;
    }

    const text = commentDraft.trim();
    if (!text) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await tasks.addComment(selectedTask.id, text);
      setCommentDraft('');
      await refreshDetail(selectedTask.id);
      await refreshList();
    } catch (commentError) {
      const message = commentError instanceof Error ? commentError.message : 'Ajout commentaire impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [commentDraft, refreshDetail, refreshList, selectedTask]);

  const removeTask = useCallback(async () => {
    if (!selectedTask) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await tasks.softDelete(selectedTask.id);
      setSelectedTask(null);
      setDetailMedia([]);
      setDetailComments([]);
      await refreshList();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'Suppression impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [refreshList, selectedTask]);

  const startFieldDictation = useCallback(
    async (field: 'title' | 'description' | 'comment') => {
      clearDictationError();

      if (isListening && activeField === field) {
        await stopDictation();
        return;
      }

      const target =
        field === 'title'
          ? { initialText: quickTitle, onText: setQuickTitle }
          : field === 'description'
            ? { initialText: descriptionDraft, onText: setDescriptionDraft }
            : { initialText: commentDraft, onText: setCommentDraft };

      await startDictation({
        field,
        initialText: target.initialText,
        onText: target.onText
      });
    },
    [
      activeField,
      clearDictationError,
      commentDraft,
      descriptionDraft,
      isListening,
      quickTitle,
      startDictation,
      stopDictation
    ]
  );

  const quickTaskHint = useMemo(() => {
    if (!dictationAvailable) {
      return 'Dictée native indisponible: fallback clavier dictée.';
    }

    if (isListening && activeField) {
      return `Dictée active (${activeField}).`; 
    }

    return 'Objectif terrain: 1 titre + 1 statut + 1 preuve en moins de 10 secondes.';
  }, [activeField, dictationAvailable, isListening]);

  const hasNextPage = tasksList.length >= PAGE_SIZE;

  return (
    <Screen>
      <SectionHeader
        title="Tasks Smart"
        subtitle="Création offline ultra-rapide, preuves médias et suggestions mots-clés (v0)."
      />

      <View style={{ flex: 1, gap: spacing.md }}>
        <Card>
          <Text variant="h2">Création rapide (3 actions)</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            {quickTaskHint}
          </Text>

          <TextInput
            value={quickTitle}
            onChangeText={setQuickTitle}
            placeholder="Titre tâche (obligatoire)"
            placeholderTextColor={colors.slate}
            style={{
              borderWidth: 1,
              borderColor: colors.fog,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.white,
              marginTop: spacing.md,
              marginBottom: spacing.sm
            }}
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
            {STATUS_ORDER.map((status) => {
              const active = quickStatus === status;
              return (
                <Pressable
                  key={status}
                  onPress={() => setQuickStatus(status)}
                  style={{
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    backgroundColor: active ? statusColor(status, colors) : colors.white,
                    borderWidth: 1,
                    borderColor: active ? 'transparent' : colors.fog
                  }}
                >
                  <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                    {status}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button
              label={isListening && activeField === 'title' ? 'Stop dictée titre' : 'Dictée titre'}
              kind="ghost"
              onPress={() => void startFieldDictation('title')}
            />
            <Button label="Créer tâche" onPress={() => void createTask(false)} disabled={submitting} />
            <Button
              label="Créer + photo"
              onPress={() => void createTask(true)}
              disabled={submitting}
            />
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
            {(['ALL', ...STATUS_ORDER] as const).map((status) => {
              const active = filterStatus === status;
              return (
                <Pressable
                  key={status}
                  onPress={() => {
                    setFilterStatus(status);
                    setPage(0);
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
                    {status}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label="Page précédente"
              kind="ghost"
              onPress={() => setPage((previous) => Math.max(0, previous - 1))}
              disabled={page === 0 || submitting}
            />
            <Button
              label="Page suivante"
              kind="ghost"
              onPress={() => setPage((previous) => previous + 1)}
              disabled={!hasNextPage || submitting}
            />
            <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
              Page {page + 1} • sync queue {syncStatus.queueDepth}
            </Text>
          </View>
        </Card>

        <View style={{ flex: 1, gap: spacing.md }}>
          <FlatList
            data={tasksList}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
            renderItem={({ item }) => {
              const active = selectedTaskId === item.id;
              const thumbPath = previewByTask[item.id];

              return (
                <Pressable onPress={() => void selectTask(item)}>
                  <Card
                    style={{
                      borderColor: active ? colors.teal : colors.fog,
                      borderWidth: active ? 2 : 1
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {item.title}
                      </Text>
                      <View
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.xs,
                          borderRadius: radii.pill,
                          backgroundColor: statusColor(item.status, colors)
                        }}
                      >
                        <Text variant="caption">{item.status}</Text>
                      </View>
                    </View>

                    {thumbPath ? (
                      <Image
                        source={{ uri: thumbPath }}
                        style={{ width: '100%', height: 86, borderRadius: radii.sm, marginTop: spacing.sm }}
                        resizeMode="cover"
                      />
                    ) : null}

                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      Priorité {item.priority} • tags {item.tags.join(', ') || 'aucun'}
                    </Text>
                  </Card>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Card>
                <Text variant="body" style={{ color: colors.slate }}>
                  {loadingList ? 'Chargement tâches...' : 'Aucune tâche pour ce filtre.'}
                </Text>
              </Card>
            }
          />

          {selectedTask ? (
            <Card style={{ maxHeight: 360 }}>
              <ScrollView>
                <Text variant="h2">Détail tâche</Text>
                <Text variant="bodyStrong" style={{ marginTop: spacing.xs }}>
                  {selectedTask.title}
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  {STATUS_ORDER.map((status) => (
                    <Button
                      key={status}
                      label={status}
                      kind={selectedTask.status === status ? 'primary' : 'ghost'}
                      onPress={() => void setSelectedStatus(status)}
                      disabled={submitting || loadingDetail}
                    />
                  ))}
                </View>

                <TextInput
                  value={descriptionDraft}
                  onChangeText={setDescriptionDraft}
                  placeholder="Description"
                  multiline
                  placeholderTextColor={colors.slate}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.white,
                    marginTop: spacing.md,
                    minHeight: 72
                  }}
                />

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button
                    label={isListening && activeField === 'description' ? 'Stop dictée description' : 'Dictée description'}
                    kind="ghost"
                    onPress={() => void startFieldDictation('description')}
                    disabled={submitting}
                  />
                  <Button
                    label="Enregistrer description"
                    onPress={() =>
                      void updateSelectedTask({
                        description: descriptionDraft,
                        last_transcript: activeField === 'description' ? descriptionDraft : undefined
                      })
                    }
                    disabled={submitting || loadingDetail}
                  />
                  <Button
                    label="Supprimer (soft)"
                    kind="ghost"
                    onPress={() => void removeTask()}
                    disabled={submitting || loadingDetail}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button
                    label="Photo preuve"
                    onPress={() => void addProof('capture')}
                    disabled={submitting || loadingDetail}
                  />
                  <Button
                    label="Importer preuve"
                    kind="ghost"
                    onPress={() => void addProof('import')}
                    disabled={submitting || loadingDetail}
                  />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    {detailMedia.length === 0 ? (
                      <Text variant="caption" style={{ color: colors.slate }}>
                        Aucune preuve liée.
                      </Text>
                    ) : (
                      detailMedia.map((asset) => (
                        <View key={asset.id}>
                          {asset.local_thumb_path && !isPdf(asset) ? (
                            <Image
                              source={{ uri: asset.local_thumb_path }}
                              style={{ width: 96, height: 96, borderRadius: radii.sm }}
                              resizeMode="cover"
                            />
                          ) : (
                            <View
                              style={{
                                width: 96,
                                height: 96,
                                borderRadius: radii.sm,
                                backgroundColor: colors.fog,
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              <Text variant="caption" style={{ color: colors.slate }}>
                                {isPdf(asset) ? 'PDF' : 'thumb'}
                              </Text>
                            </View>
                          )}
                        </View>
                      ))
                    )}
                  </View>
                </ScrollView>

                <TextInput
                  value={commentDraft}
                  onChangeText={setCommentDraft}
                  placeholder="Ajouter un commentaire"
                  placeholderTextColor={colors.slate}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.fog,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.white,
                    marginTop: spacing.md
                  }}
                />

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button
                    label={isListening && activeField === 'comment' ? 'Stop dictée commentaire' : 'Dictée commentaire'}
                    kind="ghost"
                    onPress={() => void startFieldDictation('comment')}
                    disabled={submitting}
                  />
                  <Button label="Ajouter commentaire" onPress={() => void addComment()} disabled={submitting} />
                </View>

                <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
                  {detailComments.slice(0, 6).map((comment) => (
                    <View key={comment.id}>
                      <Text variant="caption" style={{ color: colors.slate }}>
                        {comment.created_by} • {new Date(comment.created_at).toLocaleString('fr-FR')}
                      </Text>
                      <Text variant="body">{comment.text}</Text>
                    </View>
                  ))}
                </View>

                {selectedTask.suggestions.length > 0 ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text variant="bodyStrong">Suggestions v0</Text>
                    {selectedTask.suggestions.map((suggestion) => (
                      <Text key={suggestion.id} variant="caption" style={{ color: colors.slate }}>
                        [{suggestion.type}] {suggestion.value}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            </Card>
          ) : null}
        </View>

        {error ? (
          <Text variant="caption" style={{ color: colors.rose }}>
            {error}
          </Text>
        ) : null}

        {dictationError ? (
          <Text variant="caption" style={{ color: colors.rose }}>
            Dictée: {dictationError}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
