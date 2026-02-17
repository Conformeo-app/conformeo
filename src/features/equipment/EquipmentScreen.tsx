import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { equipment, Equipment, EquipmentStatus } from '../../data/equipment-management';
import { Task, tasks } from '../../data/tasks';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const PAGE_SIZE = 25;
const DEMO_PROJECT_ID = 'chantier-conformeo-demo';

const STATUS_ORDER: EquipmentStatus[] = ['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'OUT_OF_SERVICE'];

function statusLabel(status: EquipmentStatus) {
  if (status === 'AVAILABLE') return 'Disponible';
  if (status === 'ASSIGNED') return 'Affecté';
  if (status === 'MAINTENANCE') return 'Maintenance';
  return 'HS';
}

export function EquipmentScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [items, setItems] = useState<Equipment[]>([]);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [movements, setMovements] = useState<Array<{ moved_at: string; from?: string; to?: string; note?: string }>>(
    []
  );
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);

  const [quickName, setQuickName] = useState('');
  const [quickType, setQuickType] = useState('');
  const [quickLocation, setQuickLocation] = useState('');
  const [quickStatus, setQuickStatus] = useState<EquipmentStatus>('AVAILABLE');

  const [filterStatus, setFilterStatus] = useState<EquipmentStatus | 'ALL'>('ALL');
  const [filterQ, setFilterQ] = useState('');
  const [page, setPage] = useState(0);

  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [editStatus, setEditStatus] = useState<EquipmentStatus>('AVAILABLE');

  const [moveToProjectId, setMoveToProjectId] = useState('');
  const [moveNote, setMoveNote] = useState('');

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selected?.id ?? null;

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

  const refreshList = useCallback(async () => {
    if (!activeOrgId) {
      setItems([]);
      setSelected(null);
      return;
    }

    setLoadingList(true);
    setError(null);

    try {
      const rows = await equipment.list({
        org_id: activeOrgId,
        status: filterStatus,
        q: filterQ,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      });
      setItems(rows);

      if (selectedId && !rows.some((row) => row.id === selectedId)) {
        setSelected(null);
        setMovements([]);
        setLinkedTasks([]);
      }
    } catch (listError) {
      const message = listError instanceof Error ? listError.message : 'Impossible de charger les équipements.';
      setError(message);
    } finally {
      setLoadingList(false);
    }
  }, [activeOrgId, filterQ, filterStatus, page, selectedId]);

  const refreshDetail = useCallback(
    async (id: string) => {
      if (!activeOrgId) {
        return;
      }

      setLoadingDetail(true);
      setError(null);

      try {
        const row = await equipment.getById(id);
        if (!row) {
          setSelected(null);
          setMovements([]);
          setLinkedTasks([]);
          return;
        }

        setSelected(row);
        setEditName(row.name);
        setEditType(row.type);
        setEditLocation(row.location ?? '');
        setEditProjectId(row.current_project_id ?? '');
        setEditStatus(row.status);

        const [moves, taskList] = await Promise.all([
          equipment.listMovements(row.id, { limit: 20 }),
          equipment.listLinkedTasks(row.id, activeOrgId)
        ]);

        setMovements(
          moves.map((m) => ({
            moved_at: m.moved_at,
            from: m.from_project_id,
            to: m.to_project_id,
            note: m.note
          }))
        );
        setLinkedTasks(taskList);
      } catch (detailError) {
        const message = detailError instanceof Error ? detailError.message : 'Impossible de charger le détail.';
        setError(message);
      } finally {
        setLoadingDetail(false);
      }
    },
    [activeOrgId]
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const hasNextPage = items.length >= PAGE_SIZE;

  const createEquipment = useCallback(async () => {
    if (!activeOrgId) {
      setError('Organisation manquante.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const record = await equipment.create({
        org_id: activeOrgId,
        name: quickName,
        type: quickType,
        status: quickStatus,
        location: quickLocation || undefined
      });

      setQuickName('');
      setQuickType('');
      setQuickLocation('');
      setQuickStatus('AVAILABLE');
      setPage(0);

      await refreshList();
      await refreshDetail(record.id);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Création impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [activeOrgId, quickLocation, quickName, quickStatus, quickType, refreshDetail, refreshList]);

  const saveSelected = useCallback(async () => {
    if (!selected) return;

    setSubmitting(true);
    setError(null);

    try {
      const updated = await equipment.update(selected.id, {
        name: editName,
        type: editType,
        location: editLocation,
        current_project_id: editProjectId || undefined,
        status: editStatus
      });
      setSelected(updated);
      await refreshList();
      await refreshDetail(updated.id);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Mise à jour impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [editLocation, editName, editProjectId, editStatus, editType, refreshDetail, refreshList, selected]);

  const moveSelected = useCallback(async () => {
    if (!selected) return;

    setSubmitting(true);
    setError(null);

    try {
      const nextTo = moveToProjectId.trim() || undefined;
      const { equipment: updated } = await equipment.move(selected.id, {
        to_project_id: nextTo,
        note: moveNote
      });

      setMoveToProjectId('');
      setMoveNote('');
      setSelected(updated);
      await refreshList();
      await refreshDetail(updated.id);
    } catch (moveError) {
      const message = moveError instanceof Error ? moveError.message : 'Déplacement impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [moveNote, moveToProjectId, refreshDetail, refreshList, selected]);

  const createLinkedTask = useCallback(async () => {
    if (!selected || !activeOrgId || !user?.id) {
      setError('Session invalide: utilisateur/organisation/equipement manquant.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const projectId = selected.current_project_id ?? DEMO_PROJECT_ID;
      const task = await tasks.create({
        org_id: activeOrgId,
        project_id: projectId,
        title: `Équipement: ${selected.name}`,
        status: 'TODO',
        created_by: user.id,
        priority: 'MEDIUM',
        tags: ['equipment']
      });

      await equipment.linkTask({ org_id: activeOrgId, equipment_id: selected.id, task_id: task.id });
      await refreshDetail(selected.id);
      await refreshList();
    } catch (linkError) {
      const message = linkError instanceof Error ? linkError.message : 'Création/lien tâche impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [activeOrgId, refreshDetail, refreshList, selected, user?.id]);

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await equipment.softDelete(selected.id);
      setSelected(null);
      setMovements([]);
      setLinkedTasks([]);
      await refreshList();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Suppression impossible.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [refreshList, selected]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Équipements"
          subtitle="Gestion offline-first des équipements, mouvements et liaisons tâches."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">Création rapide</Text>

            <TextInput
              value={quickName}
              onChangeText={setQuickName}
              placeholder="Nom (obligatoire)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.md }}
            />

            <TextInput
              value={quickType}
              onChangeText={setQuickType}
              placeholder="Type (ex: échafaudage, nacelle...)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <TextInput
              value={quickLocation}
              onChangeText={setQuickLocation}
              placeholder="Localisation (optionnel)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.sm }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
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
                      backgroundColor: active ? colors.mint : colors.white,
                      borderWidth: 1,
                      borderColor: active ? colors.teal : colors.fog
                    }}
                  >
                    <Text variant="caption" style={{ color: active ? colors.ink : colors.slate }}>
                      {statusLabel(status)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={submitting ? 'Création...' : 'Créer équipement'} onPress={() => void createEquipment()} />
              <Text variant="caption" style={{ color: colors.slate, alignSelf: 'center' }}>
                queue sync {syncStatus.queueDepth}
              </Text>
            </View>
          </Card>

          <Card>
            <Text variant="h2">Liste</Text>

            <TextInput
              value={filterQ}
              onChangeText={(v) => {
                setFilterQ(v);
                setPage(0);
              }}
              placeholder="Rechercher (nom, type, lieu)"
              placeholderTextColor={colors.slate}
              style={{ ...inputStyle, marginTop: spacing.md }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              {(['ALL', ...STATUS_ORDER] as const).map((status) => {
                const active = filterStatus === status;
                const label = status === 'ALL' ? 'Tous' : statusLabel(status);
                return (
                  <Button
                    key={status}
                    label={label}
                    kind={active ? 'primary' : 'ghost'}
                    onPress={() => {
                      setFilterStatus(status);
                      setPage(0);
                    }}
                    disabled={loadingList || submitting}
                  />
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
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
                Page {page + 1}
              </Text>
            </View>
          </Card>

          <View style={{ gap: spacing.md }}>
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              nestedScrollEnabled={false}
              contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
              renderItem={({ item }) => {
                const active = selectedId === item.id;
                return (
                  <Pressable onPress={() => void refreshDetail(item.id)}>
                    <Card
                      style={{
                        borderColor: active ? colors.teal : colors.fog,
                        borderWidth: active ? 2 : 1
                      }}
                    >
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                        {item.type} • {statusLabel(item.status)}
                        {item.current_project_id ? ` • chantier ${item.current_project_id}` : ''}
                      </Text>
                      {item.location ? (
                        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                          Lieu: {item.location}
                        </Text>
                      ) : null}
                    </Card>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Card>
                  <Text variant="body" style={{ color: colors.slate }}>
                    {loadingList ? 'Chargement...' : 'Aucun équipement pour ce filtre.'}
                  </Text>
                </Card>
              }
            />

            {selected ? (
              <Card>
                <Text variant="h2">Détail</Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  id: {selected.id}
                </Text>

                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Nom"
                  placeholderTextColor={colors.slate}
                  style={{ ...inputStyle, marginTop: spacing.md }}
                />

                <TextInput
                  value={editType}
                  onChangeText={setEditType}
                  placeholder="Type"
                  placeholderTextColor={colors.slate}
                  style={{ ...inputStyle, marginTop: spacing.sm }}
                />

                <TextInput
                  value={editLocation}
                  onChangeText={setEditLocation}
                  placeholder="Localisation (texte)"
                  placeholderTextColor={colors.slate}
                  style={{ ...inputStyle, marginTop: spacing.sm }}
                />

                <TextInput
                  value={editProjectId}
                  onChangeText={setEditProjectId}
                  placeholder="Chantier (project_id)"
                  placeholderTextColor={colors.slate}
                  style={{ ...inputStyle, marginTop: spacing.sm }}
                />

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                  {STATUS_ORDER.map((status) => (
                    <Button
                      key={status}
                      label={statusLabel(status)}
                      kind={editStatus === status ? 'primary' : 'ghost'}
                      onPress={() => setEditStatus(status)}
                      disabled={submitting || loadingDetail}
                    />
                  ))}
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button
                    label={submitting ? 'Enregistrement...' : 'Enregistrer'}
                    onPress={() => void saveSelected()}
                    disabled={submitting || loadingDetail}
                  />
                  <Button
                    label="Supprimer"
                    kind="ghost"
                    onPress={() => void deleteSelected()}
                    disabled={submitting || loadingDetail}
                  />
                  <Button
                    label="Créer tâche liée"
                    kind="ghost"
                    onPress={() => void createLinkedTask()}
                    disabled={submitting || loadingDetail}
                  />
                </View>

                <Text variant="h2" style={{ marginTop: spacing.lg }}>
                  Déplacement / affectation
                </Text>

                <TextInput
                  value={moveToProjectId}
                  onChangeText={setMoveToProjectId}
                  placeholder="Vers project_id (vide = désaffecter)"
                  placeholderTextColor={colors.slate}
                  style={{ ...inputStyle, marginTop: spacing.sm }}
                />

                <TextInput
                  value={moveNote}
                  onChangeText={setMoveNote}
                  placeholder="Note (optionnel)"
                  placeholderTextColor={colors.slate}
                  style={{ ...inputStyle, marginTop: spacing.sm }}
                />

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button
                    label={submitting ? 'Déplacement...' : 'Déplacer'}
                    onPress={() => void moveSelected()}
                    disabled={submitting || loadingDetail}
                  />
                </View>

                <Text variant="h2" style={{ marginTop: spacing.lg }}>
                  Mouvements (20 derniers)
                </Text>

                {movements.length === 0 ? (
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                    Aucun mouvement enregistré.
                  </Text>
                ) : (
                  movements.map((m, idx) => (
                    <View key={`${m.moved_at}:${idx}`} style={{ marginTop: spacing.sm }}>
                      <Text variant="caption" style={{ color: colors.slate }}>
                        {new Date(m.moved_at).toLocaleString('fr-FR')} • {m.from ?? '—'} → {m.to ?? '—'}
                      </Text>
                      {m.note ? (
                        <Text variant="caption" style={{ color: colors.slate }}>
                          {m.note}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}

                <Text variant="h2" style={{ marginTop: spacing.lg }}>
                  Tâches liées
                </Text>

                {linkedTasks.length === 0 ? (
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                    Aucune tâche liée.
                  </Text>
                ) : (
                  linkedTasks.map((t) => (
                    <View key={t.id} style={{ marginTop: spacing.sm }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {t.title}
                      </Text>
                      <Text variant="caption" style={{ color: colors.slate }}>
                        {t.status} • priorité {t.priority} • {t.project_id}
                      </Text>
                    </View>
                  ))
                )}
              </Card>
            ) : null}

            {error ? (
              <Card>
                <Text variant="caption" style={{ color: colors.rose }}>
                  {error}
                </Text>
              </Card>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

