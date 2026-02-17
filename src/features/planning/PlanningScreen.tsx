import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { planning, PlanningItem } from '../../data/planning-engine';
import { Task, tasks } from '../../data/tasks';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const DEMO_PROJECT_ID = 'chantier-conformeo-demo';
const TASK_PAGE_SIZE = 25;

type ViewMode = 'TODAY' | 'WEEK';

function startOfDayIso(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDayIso(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function roundToNextQuarterHour(date: Date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  const next = Math.ceil(minutes / 15) * 15;
  if (next === minutes) {
    return d;
  }
  d.setMinutes(next);
  return d;
}

function labelForRange(mode: ViewMode) {
  return mode === 'TODAY' ? "Aujourd'hui" : '7 jours';
}

function formatLocal(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function PlanningScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [viewMode, setViewMode] = useState<ViewMode>('TODAY');
  const [planningItems, setPlanningItems] = useState<PlanningItem[]>([]);
  const [overlapWarnings, setOverlapWarnings] = useState<string[]>([]);

  const [taskQuery, setTaskQuery] = useState('');
  const [taskPage, setTaskPage] = useState(0);
  const [taskRows, setTaskRows] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [teamId, setTeamId] = useState('');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: colors.fog,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.ink,
      backgroundColor: colors.white
    }),
    [colors, radii.md, spacing.md, spacing.sm]
  );

  const range = useMemo(() => {
    const now = new Date();
    if (viewMode === 'TODAY') {
      return { start: startOfDayIso(now), end: endOfDayIso(now) };
    }
    return { start: startOfDayIso(now), end: endOfDayIso(addDays(now, 6)) };
  }, [viewMode]);

  const refreshPlanning = useCallback(async () => {
    if (!activeOrgId) {
      setPlanningItems([]);
      setOverlapWarnings([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await planning.listByProject(DEMO_PROJECT_ID, {
        org_id: activeOrgId,
        start_from: range.start,
        start_to: range.end,
        limit: 200,
        offset: 0
      });

      setPlanningItems(rows);

      const overlaps = planning.computeOverlaps(rows);
      setOverlapWarnings(
        overlaps.slice(0, 6).map((ov) => {
          return `${ov.resource_key} • ${ov.overlap_minutes} min • "${ov.first.title_snapshot}" ↔ "${ov.second.title_snapshot}"`;
        })
      );
    } catch (planningError) {
      const message = planningError instanceof Error ? planningError.message : 'Impossible de charger le planning.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, range.end, range.start]);

  const refreshTasks = useCallback(async () => {
    if (!activeOrgId) {
      setTaskRows([]);
      return;
    }

    try {
      const rows = await tasks.listByProject(DEMO_PROJECT_ID, {
        org_id: activeOrgId,
        limit: TASK_PAGE_SIZE,
        offset: taskPage * TASK_PAGE_SIZE,
        status: 'ALL'
      });

      const q = taskQuery.trim().toLowerCase();
      const filtered = q
        ? rows.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
        : rows;

      setTaskRows(filtered);
    } catch {
      // keep silent: planning screen shouldn't be blocked if tasks list fails
      setTaskRows([]);
    }
  }, [activeOrgId, taskPage, taskQuery]);

  useEffect(() => {
    void refreshPlanning();
  }, [refreshPlanning]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const selectTask = useCallback((task: Task) => {
    setSelectedTask(task);
    const base = roundToNextQuarterHour(new Date());
    const end = new Date(base);
    end.setMinutes(end.getMinutes() + 60);
    setStartAt(base.toISOString());
    setEndAt(end.toISOString());
    setAssigneeUserId(task.assignee_user_id ?? '');
    setTeamId('');
  }, []);

  const createPlanning = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur ou organisation manquante.');
      return;
    }

    if (!selectedTask) {
      setError('Sélectionne une tâche à planifier.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await planning.create({
        org_id: activeOrgId,
        project_id: DEMO_PROJECT_ID,
        task_id: selectedTask.id,
        title_snapshot: selectedTask.title,
        start_at: startAt,
        end_at: endAt,
        assignee_user_id: assigneeUserId.trim() || undefined,
        team_id: teamId.trim() || undefined,
        created_by: user.id
      });

      setSelectedTask(null);
      setAssigneeUserId('');
      setTeamId('');
      setStartAt('');
      setEndAt('');
      await refreshPlanning();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Création planning impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [activeOrgId, assigneeUserId, endAt, refreshPlanning, selectedTask, startAt, teamId, user?.id]);

  const deletePlanning = useCallback(
    async (id: string) => {
      setSubmitting(true);
      setError(null);
      try {
        await planning.softDelete(id);
        await refreshPlanning();
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : 'Suppression impossible.';
        setError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [refreshPlanning]
  );

  const hasNextTasks = taskRows.length >= TASK_PAGE_SIZE;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Planning"
          subtitle="Calendrier par chantier, assignations, et alertes de chevauchement (MVP)."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Vue</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              {(['TODAY', 'WEEK'] as const).map((mode) => (
                <Button
                  key={mode}
                  label={labelForRange(mode)}
                  kind={viewMode === mode ? 'primary' : 'ghost'}
                  onPress={() => setViewMode(mode)}
                  disabled={submitting}
                />
              ))}
              <Button label="Rafraîchir" kind="ghost" onPress={() => void refreshPlanning()} disabled={submitting} />
              <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
                queue sync {syncStatus.queueDepth}
              </Text>
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Période: {formatLocal(range.start)} → {formatLocal(range.end)}
            </Text>

            {overlapWarnings.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="caption" style={{ color: colors.rose }}>
                  Chevauchements détectés:
                </Text>
                {overlapWarnings.map((line) => (
                  <Text key={line} variant="caption" style={{ color: colors.rose }}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>

          <Card>
            <Text variant="h2">Planifier une tâche</Text>

            {selectedTask ? (
              <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                <Text variant="bodyStrong">{selectedTask.title}</Text>

                <TextInput
                  value={startAt}
                  onChangeText={setStartAt}
                  placeholder="start_at (ISO)"
                  placeholderTextColor={colors.slate}
                  style={inputStyle}
                />

                <TextInput
                  value={endAt}
                  onChangeText={setEndAt}
                  placeholder="end_at (ISO)"
                  placeholderTextColor={colors.slate}
                  style={inputStyle}
                />

                <TextInput
                  value={assigneeUserId}
                  onChangeText={setAssigneeUserId}
                  placeholder="assignee_user_id (optionnel)"
                  placeholderTextColor={colors.slate}
                  style={inputStyle}
                />

                <TextInput
                  value={teamId}
                  onChangeText={setTeamId}
                  placeholder="team_id (optionnel)"
                  placeholderTextColor={colors.slate}
                  style={inputStyle}
                />

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  <Button
                    label={submitting ? 'Création...' : 'Créer'}
                    onPress={() => void createPlanning()}
                    disabled={submitting}
                  />
                  <Button
                    label="Annuler"
                    kind="ghost"
                    onPress={() => setSelectedTask(null)}
                    disabled={submitting}
                  />
                </View>
              </View>
            ) : (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Sélectionne une tâche dans la liste ci-dessous.
              </Text>
            )}
          </Card>

          <Card>
            <Text variant="h2">Tâches (sélection)</Text>

            <TextInput
              value={taskQuery}
              onChangeText={(v) => {
                setTaskQuery(v);
                setTaskPage(0);
              }}
              placeholder="Rechercher une tâche"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button
                label="Page précédente"
                kind="ghost"
                onPress={() => setTaskPage((p) => Math.max(0, p - 1))}
                disabled={taskPage === 0 || submitting}
              />
              <Button
                label="Page suivante"
                kind="ghost"
                onPress={() => setTaskPage((p) => p + 1)}
                disabled={!hasNextTasks || submitting}
              />
              <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
                Page {taskPage + 1}
              </Text>
            </View>

            <FlatList
              data={taskRows}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              nestedScrollEnabled={false}
              contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}
              renderItem={({ item }) => (
                <Pressable onPress={() => selectTask(item)}>
                  <Card
                    style={{
                      borderColor: selectedTask?.id === item.id ? colors.teal : colors.fog,
                      borderWidth: selectedTask?.id === item.id ? 2 : 1
                    }}
                  >
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      {item.status} • priorité {item.priority}
                    </Text>
                  </Card>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                  Aucune tâche (ou filtre trop restrictif).
                </Text>
              }
            />
          </Card>

          <Card>
            <Text variant="h2">Planning ({loading ? 'chargement...' : `${planningItems.length}`})</Text>

            {planningItems.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Aucun item planifié sur la période.
              </Text>
            ) : (
              planningItems.map((item) => (
                <View key={item.id} style={{ marginTop: spacing.sm }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {item.title_snapshot}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    {formatLocal(item.start_at)} → {formatLocal(item.end_at)}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    {item.assignee_user_id ? `assignee ${item.assignee_user_id}` : item.team_id ? `team ${item.team_id}` : 'non assigné'}
                  </Text>
                  <View style={{ marginTop: spacing.xs }}>
                    <Button
                      label="Supprimer"
                      kind="ghost"
                      onPress={() => void deletePlanning(item.id)}
                      disabled={submitting}
                    />
                  </View>
                </View>
              ))
            )}
          </Card>

          {error ? (
            <Card>
              <Text variant="caption" style={{ color: colors.rose }}>
                {error}
              </Text>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(PlanningScreen as any).screenKey = 'PLANNING';
