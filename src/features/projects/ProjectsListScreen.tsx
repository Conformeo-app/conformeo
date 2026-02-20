import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { dashboard, type DashboardSummary } from '../../data/dashboard';
import { projects, type Project, type ProjectIndicators } from '../../data/projects';
import { ux } from '../../data/ux-accelerators';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { setCurrentContext, useAppNavigationContext } from '../../navigation/contextStore';
import type { ProjectsStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { SearchInput } from '../../ui/components/SearchInput';
import { Tag, type TagTone } from '../../ui/components/Tag';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { ReleaseBadge } from '../../ui/components/ReleaseBadge';

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
  const navCtx = useAppNavigationContext();
  const { status: syncStatus } = useSyncStatus();

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [indicators, setIndicators] = useState<Record<string, ProjectIndicators>>({});
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [remoteProbeError, setRemoteProbeError] = useState<string | null>(null);

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

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setCurrentContext({ projectId: undefined });
    });
    return unsubscribe;
  }, [navigation]);

  const refresh = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setProjectsList([]);
      setIndicators({});
      setRecentIds([]);
      setRemoteProbeError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setRemoteProbeError(null);
    try {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[CHANTIERS] orgId', activeOrgId);
      }

      const localCountBefore = await projects.countByOrg(activeOrgId);

      await projects.bootstrapFromDerivedProjects({ org_id: activeOrgId, created_by: user.id });

      const imported = await projects.bootstrapFromRemoteIfEmpty({ org_id: activeOrgId, actor_id: user.id });
      if (__DEV__ && imported > 0) {
        // eslint-disable-next-line no-console
        console.info('[projects] bootstrap remote -> local', { imported, org: activeOrgId });
      }

      let remoteCount: number | null = null;
      let remoteErrorMessage: string | null = null;
      if (__DEV__) {
        const remoteProbe = await projects.debugRemoteCount(activeOrgId);
        // eslint-disable-next-line no-console
        console.log('[CHANTIERS] remote probe', remoteProbe);
        remoteCount = remoteProbe.count;
        remoteErrorMessage = remoteProbe.error;
        if (remoteProbe.error) {
          setRemoteProbeError(remoteProbe.error);
        }
      }

      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.info('[projects] refresh context', {
          org: activeOrgId,
          user: user.id,
          localCount: localCountBefore,
          query,
          includeArchived,
          remoteCount,
          remoteError: remoteErrorMessage
        });
      }

      let [list, recents] = await Promise.all([
        projects.list({
          org_id: activeOrgId,
          query,
          include_archived: includeArchived,
          limit: 200,
          offset: 0
        }),
        ux.listRecents(30)
      ]);

      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[CHANTIERS] data.length', list.length);
      }

      if (list.length === 0 && !query && !includeArchived) {
        const remoteSync = await projects.syncFromRemote({
          org_id: activeOrgId,
          actor_id: user.id,
          limit: 200
        });

        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[CHANTIERS] fallback remote', remoteSync);
        }

        if (remoteSync.error) {
          setRemoteProbeError(remoteSync.error);
        }

        if (remoteSync.imported > 0) {
          list = await projects.list({
            org_id: activeOrgId,
            query,
            include_archived: includeArchived,
            limit: 200,
            offset: 0
          });
        }
      }

      const recentProjectIds = recents
        .filter((item) => item.entity === 'PROJECT')
        .map((item) => item.entity_id);

      setRecentIds(recentProjectIds);

      setProjectsList(list);

      const ids = list.map((item) => item.id);
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
  }, [activeOrgId, includeArchived, query, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Highlight the last opened project (no auto-navigation).
    if (!navCtx.projectId) return;
    const exists = projectsList.some((p) => p.id === navCtx.projectId);
    if (!exists) return;
    setSelectedProjectId((current) => (current === navCtx.projectId ? current : navCtx.projectId ?? null));
  }, [navCtx.projectId, projectsList]);

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

  return (
    <Screen>
      <View style={{ gap: spacing.md, flex: 1, minHeight: 0 }}>
        <SectionHeader
          title="Mes chantiers"
          subtitle="Sélectionne un chantier pour accéder aux onglets."
          right={<ReleaseBadge state="BETA" />}
        />

        <View style={{ flex: 1, minHeight: 0, flexDirection: isWide ? 'row' : 'column', gap: spacing.md }}>
          <View style={{ width: isWide ? 380 : undefined, flex: isWide ? undefined : 1, minHeight: 0 }}>
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

              {remoteProbeError ? (
                <Text variant="caption" style={{ color: colors.amber, marginTop: spacing.sm }}>
                  Synchronisation distante indisponible: {remoteProbeError}
                </Text>
              ) : null}
            </Card>

            <FlatList
              style={{ flex: 1, minHeight: 0 }}
              data={sortedProjects}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.sm, flexGrow: 1 }}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedProjectId;
                const indicator = indicators[item.id] ?? null;

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
                    {loading
                      ? 'Chargement des chantiers...'
                      : query.length > 0 || includeArchived
                        ? 'Aucun chantier ne correspond au filtre.'
                        : 'Aucun chantier trouvé pour cette organisation.'}
                  </Text>
                  {remoteProbeError ? (
                    <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                      Impossible de récupérer les chantiers depuis le serveur (droits / connexion). Détail : {remoteProbeError}
                    </Text>
                  ) : null}
                  <View style={{ marginTop: spacing.sm }}>
                    <Button label="Créer un chantier" onPress={() => navigation.navigate('ProjectCreate')} />
                  </View>
                  {remoteProbeError ? (
                    <View style={{ marginTop: spacing.sm }}>
                      <Button label="Réessayer la synchronisation" kind="ghost" onPress={() => void refresh()} />
                    </View>
                  ) : null}
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
