import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { dashboard, type DashboardSummary } from '../../data/dashboard';
import { projects, type Project, type ProjectIndicators } from '../../data/projects';
import { ux } from '../../data/ux-accelerators';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { setCurrentContext } from '../../navigation/contextStore';
import type { ProjectsStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { SearchInput } from '../../ui/components/SearchInput';
import { Tag, type TagTone } from '../../ui/components/Tag';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectsList'>;

const MIN_WIDE_LAYOUT_WIDTH = 1024;

function normalizeText(value: string) {
  return value.trim();
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue.';
}

function riskTone(level: ProjectIndicators['riskLevel']): TagTone {
  if (level === 'RISK') return 'danger';
  if (level === 'WATCH') return 'warning';
  return 'success';
}

function riskLabel(level: ProjectIndicators['riskLevel']) {
  if (level === 'RISK') return 'RISQUE';
  if (level === 'WATCH') return 'VIGILANCE';
  return 'OK';
}

function syncTone(level: ProjectIndicators['syncState']): TagTone {
  if (level === 'ERROR') return 'danger';
  if (level === 'PENDING') return 'warning';
  return 'success';
}

function syncLabel(level: ProjectIndicators['syncState']) {
  if (level === 'ERROR') return 'ÉCHEC';
  if (level === 'PENDING') return 'EN ATTENTE';
  return 'OK';
}

function formatDateShort(iso?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatSummary(summary: DashboardSummary | null) {
  if (!summary) {
    return [
      { label: 'Tâches ouvertes', value: '-' },
      { label: 'Bloquées', value: '-' },
      { label: 'Preuves', value: '-' },
      { label: 'Docs', value: '-' }
    ];
  }

  return [
    { label: 'Tâches ouvertes', value: String(summary.openTasks) },
    { label: 'Bloquées', value: String(summary.blockedTasks) },
    { label: 'Preuves', value: String(summary.proofs) },
    { label: 'Docs', value: String(summary.documents) }
  ];
}

function ProjectPreview({
  project,
  indicator,
  onOpen,
  onEdit
}: {
  project: Project;
  indicator: ProjectIndicators | null;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { spacing, colors } = useTheme();
  const { activeOrgId, user } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setSummary(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      dashboard.setContext({ org_id: activeOrgId, user_id: user?.id ?? undefined, project_id: project.id });
      const next = await dashboard.getSummary({ orgId: activeOrgId, projectId: project.id });
      setSummary(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, project.id, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counters = useMemo(() => formatSummary(summary), [summary]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>
              {project.name}
            </Text>
            {project.address ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={2}>
                {project.address}
              </Text>
            ) : (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                {project.id}
              </Text>
            )}
            {project.start_date || project.end_date ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                {formatDateShort(project.start_date) ?? '—'} → {formatDateShort(project.end_date) ?? '—'}
              </Text>
            ) : null}
          </View>

          <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
            {indicator ? <Tag label={`Risque ${riskLabel(indicator.riskLevel)}`} tone={riskTone(indicator.riskLevel)} /> : null}
            {indicator ? <Tag label={`Sync ${syncLabel(indicator.syncState)}`} tone={syncTone(indicator.syncState)} /> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md }}>
          {counters.map((item) => (
            <View key={item.label} style={{ minWidth: 140 }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                {item.label}
              </Text>
              <Text variant="h2">{item.value}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Button label="Ouvrir" onPress={onOpen} disabled={loading} />
          <Button label="Modifier" kind="ghost" onPress={onEdit} disabled={loading} />
          <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
        </View>

        {error ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}
      </Card>
    </ScrollView>
  );
}

export function ProjectsListScreen({ navigation }: Props) {
  const { colors, spacing } = useTheme();
  const { width } = useWindowDimensions();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [indicators, setIndicators] = useState<Record<string, ProjectIndicators>>({});
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    ux.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, user?.id]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery((prev) => {
        const next = queryDraft.trim();
        return prev === next ? prev : next;
      });
    }, 220);

    return () => clearTimeout(handle);
  }, [queryDraft]);

  const refresh = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setProjectsList([]);
      setIndicators({});
      setFavoriteIds(new Set());
      setRecentIds([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      void (await projects.bootstrapFromDerivedProjects({ org_id: activeOrgId, created_by: user.id }));

      const [list, favorites, recents] = await Promise.all([
        projects.list({
          org_id: activeOrgId,
          query,
          include_archived: includeArchived,
          limit: 200,
          offset: 0
        }),
        ux.listFavorites(),
        ux.listRecents(30)
      ]);

      const favoriteSet = new Set(
        favorites.filter((fav) => fav.entity === 'PROJECT').map((fav) => fav.entity_id)
      );

      const recentProjectIds = recents
        .filter((item) => item.entity === 'PROJECT')
        .map((item) => item.entity_id);

      setFavoriteIds(favoriteSet);
      setRecentIds(recentProjectIds);

      const filteredList = favoritesOnly ? list.filter((item) => favoriteSet.has(item.id)) : list;
      setProjectsList(filteredList);

      const ids = filteredList.map((item) => item.id);
      const indicatorMap = await projects.getIndicators(activeOrgId, ids);
      setIndicators(indicatorMap);

      setSelectedProjectId((current) => {
        if (current && ids.includes(current)) {
          return current;
        }
        return ids[0] ?? null;
      });
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, favoritesOnly, includeArchived, query, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sortedProjects = useMemo(() => {
    if (!recentIds.length) {
      return projectsList;
    }

    const recentRank = new Map<string, number>();
    for (const [index, id] of recentIds.entries()) {
      recentRank.set(id, index);
    }

    return [...projectsList].sort((left, right) => {
      const leftRank = recentRank.get(left.id);
      const rightRank = recentRank.get(right.id);

      if (leftRank !== undefined || rightRank !== undefined) {
        if (leftRank === undefined) return 1;
        if (rightRank === undefined) return -1;
        return leftRank - rightRank;
      }

      return right.updated_at.localeCompare(left.updated_at);
    });
  }, [projectsList, recentIds]);

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return sortedProjects.find((item) => item.id === selectedProjectId) ?? null;
  }, [selectedProjectId, sortedProjects]);

  const openProject = useCallback(
    async (projectId: string) => {
      setCurrentContext({ projectId });
      try {
        await ux.trackRecent('PROJECT', projectId);
      } catch {
        // non bloquant
      }
      navigation.navigate('ProjectDetail', { projectId });
    },
    [navigation]
  );

  const toggleFavorite = useCallback(
    async (projectId: string) => {
      if (!activeOrgId || !user?.id) {
        return;
      }

      const alreadyFavorite = favoriteIds.has(projectId);

      try {
        if (alreadyFavorite) {
          await ux.removeFavorite('PROJECT', projectId);
        } else {
          await ux.addFavorite('PROJECT', projectId);
        }

        const nextFavorites = await ux.listFavorites();
        const nextSet = new Set(nextFavorites.filter((fav) => fav.entity === 'PROJECT').map((fav) => fav.entity_id));
        setFavoriteIds(nextSet);

        if (favoritesOnly) {
          setProjectsList((current) => current.filter((item) => nextSet.has(item.id)));
        }
      } catch (favError) {
        setError(toErrorMessage(favError));
      }
    },
    [activeOrgId, favoriteIds, favoritesOnly, user?.id]
  );

  return (
    <Screen>
      <View style={{ gap: spacing.md, flex: 1, minHeight: 0 }}>
        <SectionHeader title="Chantiers" subtitle="Sélectionne un chantier pour accéder aux onglets." />

        <View style={{ flex: 1, minHeight: 0, flexDirection: isWide ? 'row' : 'column', gap: spacing.md }}>
          <View style={{ width: isWide ? 380 : undefined, minHeight: 0 }}>
            <Card>
              <Text variant="bodyStrong">Filtrer</Text>
              <View style={{ marginTop: spacing.sm }}>
                <SearchInput value={queryDraft} onChangeText={setQueryDraft} placeholder="Rechercher un chantier..." />
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Nouveau" onPress={() => navigation.navigate('ProjectCreate')} disabled={loading} />
                <Button
                  label={loading ? 'Chargement...' : 'Rafraîchir'}
                  kind="ghost"
                  onPress={() => void refresh()}
                  disabled={loading}
                />
                <Button
                  label={includeArchived ? 'Masquer archivés' : 'Voir archivés'}
                  kind="ghost"
                  onPress={() => setIncludeArchived((current) => !current)}
                  disabled={loading}
                />
                <Button
                  label={favoritesOnly ? 'Tous' : 'Favoris'}
                  kind="ghost"
                  onPress={() => setFavoritesOnly((current) => !current)}
                  disabled={loading}
                />
              </View>

              {syncStatus.phase === 'offline' ? (
                <Text variant="caption" style={{ color: colors.amber, marginTop: spacing.sm }}>
                  Hors ligne : navigation et création locales OK.
                </Text>
              ) : null}

              {error ? (
                <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                  {error}
                </Text>
              ) : null}
            </Card>

            <FlatList
              data={sortedProjects}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.sm }}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedProjectId;
                const indicator = indicators[item.id] ?? null;
                const isFavorite = favoriteIds.has(item.id);

                return (
                  <Pressable
                    onPress={() => {
                      if (isWide) {
                        if (isSelected) {
                          void openProject(item.id);
                        } else {
                          setSelectedProjectId(item.id);
                        }
                      } else {
                        void openProject(item.id);
                      }
                    }}
                  >
                    <Card style={isSelected ? { borderColor: colors.teal, borderWidth: 2 } : undefined}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text variant="h2" numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                            {item.address ?? item.id}
                          </Text>
                        </View>

                        <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                          {indicator ? <Tag label={riskLabel(indicator.riskLevel)} tone={riskTone(indicator.riskLevel)} /> : null}
                          {indicator ? <Tag label={syncLabel(indicator.syncState)} tone={syncTone(indicator.syncState)} /> : null}
                        </View>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          gap: spacing.sm,
                          marginTop: spacing.sm
                        }}
                      >
                        <Pressable onPress={() => void toggleFavorite(item.id)} hitSlop={10}>
                          <Text variant="caption" style={{ color: isFavorite ? colors.teal : colors.slate }}>
                            {isFavorite ? 'Favori' : 'Ajouter favori'}
                          </Text>
                        </Pressable>

                        {recentIds.includes(item.id) ? (
                          <Text variant="caption" style={{ color: colors.slate }}>
                            Récent
                          </Text>
                        ) : null}
                      </View>
                    </Card>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Card>
                  <Text variant="body" style={{ color: colors.slate }}>
                    Aucun chantier. Crée un chantier, ou crée des tâches/preuves offline puis rafraîchis.
                  </Text>
                </Card>
              }
            />
          </View>

          {isWide ? (
            <View style={{ flex: 1, minHeight: 0 }}>
              {selectedProject ? (
                <ProjectPreview
                  project={selectedProject}
                  indicator={indicators[selectedProject.id] ?? null}
                  onOpen={() => void openProject(selectedProject.id)}
                  onEdit={() => navigation.navigate('ProjectEdit', { projectId: selectedProject.id })}
                />
              ) : (
                <Card>
                  <Text variant="body" style={{ color: colors.slate }}>
                    Sélectionne un chantier pour afficher la prévisualisation.
                  </Text>
                </Card>
              )}
            </View>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(ProjectsListScreen as any).screenKey = 'PROJECTS_LIST';
