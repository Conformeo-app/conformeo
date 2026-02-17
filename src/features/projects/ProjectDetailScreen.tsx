import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { controlMode } from '../../data/control-mode';
import { exportsDoe } from '../../data/exports';
import { media } from '../../data/media';
import { overview, projects, type OverviewHealth, type ProjectIndicators } from '../../data/projects';
import { quotas } from '../../data/quotas-limits';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { ux } from '../../data/ux-accelerators';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { setCurrentContext } from '../../navigation/contextStore';
import type { ProjectsStackParamList, ProjectTabsParamList, ProjectTabKey } from '../../navigation/types';
import { useEnabledModules } from '../../navigation/EnabledModulesProvider';
import { ControlModeScreen } from '../control/ControlModeScreen';
import { DocumentsScreen } from '../documents/DocumentsScreen';
import { MediaScreen } from '../media/MediaScreen';
import { PlansScreen } from '../plans/PlansScreen';
import { TasksScreen } from '../tasks/TasksScreen';
import { ProjectOverviewTab } from './ProjectOverviewTab';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';

type Props = NativeStackScreenProps<ProjectsStackParamList, 'ProjectDetail'>;

const Tab = createMaterialTopTabNavigator<ProjectTabsParamList>();

function tabToRouteName(tab?: ProjectTabKey): keyof ProjectTabsParamList {
  if (tab === 'Tasks') return 'TasksTab';
  if (tab === 'Plans') return 'PlansTab';
  if (tab === 'Media') return 'MediaTab';
  if (tab === 'Documents') return 'DocumentsTab';
  if (tab === 'Control') return 'ControlTab';
  return 'OverviewTab';
}

export function ProjectDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();
  const { availableModules } = useEnabledModules();

  const { projectId, tab, mediaUploadStatus } = route.params;

  useEffect(() => {
    setCurrentContext({ projectId });
  }, [projectId]);

  useEffect(() => {
    controlMode.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });

    exportsDoe.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });

    ux.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined,
      project_id: projectId
    });
  }, [activeOrgId, projectId, user?.id]);

  useEffect(() => {
    if (!activeOrgId || !user?.id) {
      return;
    }

    void ux.trackRecent('PROJECT', projectId).catch(() => {
      // non-bloquant
    });
  }, [activeOrgId, projectId, user?.id]);

  const tabConfig = useMemo(
    () => ({
      tasks: availableModules.includes('tasks'),
      plans: availableModules.includes('plans'),
      media: availableModules.includes('media'),
      documents: availableModules.includes('documents'),
      control: availableModules.includes('control'),
      waste: availableModules.includes('waste'),
      carbon: availableModules.includes('carbon'),
      exports: availableModules.includes('exports')
    }),
    [availableModules]
  );

  const [projectName, setProjectName] = useState<string>('Chantier');
  const [projectAddress, setProjectAddress] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<ProjectIndicators | null>(null);
  const [health, setHealth] = useState<OverviewHealth | null>(null);
  const [headerBusy, setHeaderBusy] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [controlEnabled, setControlEnabled] = useState<boolean>(false);

  const refreshHeader = useCallback(async () => {
    if (!activeOrgId) {
      setIndicator(null);
      setHealth(null);
      setHeaderError(null);
      return;
    }

    setHeaderError(null);
    try {
      const project = await projects.getById(projectId);
      setProjectName(project?.name ?? 'Chantier');
      setProjectAddress(project?.address ?? null);

      const [indicators, nextHealth, enabled] = await Promise.all([
        projects.getIndicators(activeOrgId, [projectId]),
        overview.getHealth(projectId),
        controlMode.isEnabled(projectId).catch(() => false)
      ]);

      setIndicator(indicators[projectId] ?? null);
      setHealth(nextHealth);
      setControlEnabled(enabled);
    } catch (e) {
      setHeaderError(e instanceof Error ? e.message : 'Impossible de charger le chantier.');
    }
  }, [activeOrgId, projectId]);

  useEffect(() => {
    void refreshHeader();
  }, [refreshHeader]);

  const initialRouteName = useMemo(() => {
    const wanted = tabToRouteName(tab);
    if (wanted === 'TasksTab' && !tabConfig.tasks) return 'OverviewTab';
    if (wanted === 'PlansTab' && !tabConfig.plans) return 'OverviewTab';
    if (wanted === 'MediaTab' && !tabConfig.media) return 'OverviewTab';
    if (wanted === 'DocumentsTab' && !tabConfig.documents) return 'OverviewTab';
    if (wanted === 'ControlTab' && !tabConfig.control) return 'OverviewTab';
    return wanted;
  }, [tab, tabConfig]);

  useEffect(() => {
    navigation.setOptions({ title: projectName });
  }, [navigation, projectName]);

  const openTab = useCallback(
    (next: ProjectTabKey) => {
      navigation.setParams({ tab: next });
    },
    [navigation]
  );

  const quickPhoto = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setHeaderError('Session invalide.');
      return;
    }

    setHeaderBusy(true);
    setHeaderError(null);

    try {
      const reason = await quotas.explainUploadBlock(0);
      if (reason) {
        Alert.alert('Upload bloqué', reason);
        return;
      }

      await media.capturePhoto({
        org_id: activeOrgId,
        project_id: projectId,
        tag: 'preuve_terrain'
      });

      openTab('Media');
      await refreshHeader();
    } catch (e) {
      setHeaderError(e instanceof Error ? e.message : 'Capture photo impossible.');
    } finally {
      setHeaderBusy(false);
    }
  }, [activeOrgId, openTab, projectId, refreshHeader, user?.id]);

  const quickControlPack = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setHeaderError('Session invalide.');
      return;
    }

    setHeaderBusy(true);
    setHeaderError(null);

    try {
      const reason = await quotas.explainExportBlock();
      if (reason) {
        Alert.alert('Export bloqué', reason);
        return;
      }

      const job = await exportsDoe.createJob(projectId, 'CONTROL_PACK');
      void exportsDoe.run(job.id);
      openTab('Control');
      await refreshHeader();
    } catch (e) {
      setHeaderError(e instanceof Error ? e.message : 'Export impossible.');
    } finally {
      setHeaderBusy(false);
    }
  }, [activeOrgId, openTab, projectId, refreshHeader, user?.id]);

  const toggleControlMode = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setHeaderError('Session invalide.');
      return;
    }

    setHeaderBusy(true);
    setHeaderError(null);

    try {
      if (controlEnabled) {
        await controlMode.disable(projectId);
        setControlEnabled(false);
      } else {
        await controlMode.enable(projectId);
        setControlEnabled(true);
      }

      openTab('Control');
      await refreshHeader();
    } catch (e) {
      setHeaderError(e instanceof Error ? e.message : 'Mode contrôle impossible.');
    } finally {
      setHeaderBusy(false);
    }
  }, [activeOrgId, controlEnabled, openTab, projectId, refreshHeader, user?.id]);

  const pendingSyncCount = health?.pendingOps ?? (indicator ? indicator.pendingOps + indicator.pendingUploads : 0);
  const conflictCount = health?.conflictCount ?? indicator?.openConflicts ?? 0;
  const failedUploads = health?.failedUploads ?? indicator?.failedUploads ?? 0;
  const errorsCount = conflictCount + failedUploads;

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>
              {projectName}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: 2 }} numberOfLines={1}>
              {projectAddress ? projectAddress : projectId}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {indicator ? (
              <Text variant="caption" style={{ color: indicator.riskLevel === 'RISK' ? colors.rose : indicator.riskLevel === 'WATCH' ? colors.amber : colors.mint }}>
                Risque: {indicator.riskLevel}
              </Text>
            ) : null}
            {syncStatus.phase === 'offline' ? (
              <Text variant="caption" style={{ color: colors.amber }}>
                Offline
              </Text>
            ) : (
              <Text variant="caption" style={{ color: colors.mint }}>
                Online
              </Text>
            )}
            {pendingSyncCount > 0 ? (
              <Text variant="caption" style={{ color: colors.amber }}>
                Pending: {pendingSyncCount}
              </Text>
            ) : null}
            {errorsCount > 0 ? (
              <Text variant="caption" style={{ color: colors.rose }}>
                Erreurs: {errorsCount}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {tabConfig.tasks ? <Button label="Tâche" kind="ghost" onPress={() => openTab('Tasks')} disabled={headerBusy} /> : null}
          {tabConfig.media ? <Button label="Photo" kind="ghost" onPress={() => void quickPhoto()} disabled={headerBusy} /> : null}
          {tabConfig.plans ? <Button label="Plan" kind="ghost" onPress={() => openTab('Plans')} disabled={headerBusy} /> : null}
          {tabConfig.control ? (
            <Button
              label={controlEnabled ? 'Contrôle ON' : 'Contrôle OFF'}
              kind="ghost"
              onPress={() => void toggleControlMode()}
              disabled={headerBusy}
            />
          ) : null}
          {tabConfig.control ? (
            <Button label="Pack contrôle" kind="ghost" onPress={() => void quickControlPack()} disabled={headerBusy} />
          ) : null}
          <Button
            label="Modifier"
            kind="ghost"
            onPress={() => navigation.navigate('ProjectEdit', { projectId })}
            disabled={headerBusy || controlEnabled}
          />
        </View>

        {controlEnabled ? (
          <Text
            variant="caption"
            style={{
              color: colors.rose,
              marginTop: 8
            }}
          >
            MODE CONTRÔLE ACTIF — ce chantier est en lecture seule (preuves autorisées).
          </Text>
        ) : null}

        {headerError ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: 8 }}>
            {headerError}
          </Text>
        ) : null}
      </Card>

      <View style={{ flex: 1, minHeight: 0 }}>
        <Tab.Navigator
          key={`${projectId}:${initialRouteName}`}
          initialRouteName={initialRouteName}
          screenOptions={{
            lazy: true,
            tabBarScrollEnabled: true,
            tabBarStyle: { backgroundColor: colors.white },
            tabBarIndicatorStyle: { backgroundColor: colors.teal, height: 3 },
            tabBarActiveTintColor: colors.ink,
            tabBarInactiveTintColor: colors.slate
          }}
        >
          <Tab.Screen
            name="OverviewTab"
            options={{ title: 'Synthèse' }}
            children={({ navigation: tabNav }) => (
              <ProjectOverviewTab
                projectId={projectId}
                onOpenTab={(tabKey, params) => {
                  if (tabKey === 'Tasks' && !tabConfig.tasks) return;
                  if (tabKey === 'Plans' && !tabConfig.plans) return;
                  if (tabKey === 'Media' && !tabConfig.media) return;
                  if (tabKey === 'Documents' && !tabConfig.documents) return;
                  if (tabKey === 'Control' && !tabConfig.control) return;

                  const routeName =
                    tabKey === 'Tasks'
                      ? 'TasksTab'
                      : tabKey === 'Plans'
                        ? 'PlansTab'
                        : tabKey === 'Media'
                          ? 'MediaTab'
                          : tabKey === 'Documents'
                            ? 'DocumentsTab'
                            : 'ControlTab';

                  tabNav.navigate(routeName as never, { projectId, ...(params ?? {}) } as never);
                }}
                onOpenProjectScreen={(screen) => {
                  const parent = tabNav.getParent();
                  if (parent) {
                    (parent as any).navigate(screen, { projectId });
                  }
                }}
                tools={{ waste: tabConfig.waste, carbon: tabConfig.carbon, exports: tabConfig.exports }}
              />
            )}
          />

      {tabConfig.tasks ? (
        <Tab.Screen
          name="TasksTab"
          options={{ title: 'Tâches' }}
          children={() => <TasksScreen projectId={projectId} />}
        />
      ) : null}

      {tabConfig.plans ? (
        <Tab.Screen
          name="PlansTab"
          options={{ title: 'Plans' }}
          children={() => <PlansScreen projectId={projectId} />}
        />
      ) : null}

      {tabConfig.media ? (
        <Tab.Screen
          name="MediaTab"
          options={{ title: 'Médias' }}
          children={({ route }) => (
            <MediaScreen projectId={projectId} initialUploadStatus={route.params?.uploadStatus ?? mediaUploadStatus} />
          )}
        />
      ) : null}

      {tabConfig.documents ? (
        <Tab.Screen
          name="DocumentsTab"
          options={{ title: 'Documents' }}
          children={() => <DocumentsScreen projectId={projectId} />}
        />
      ) : null}

      {tabConfig.control ? (
        <Tab.Screen
          name="ControlTab"
          options={{ title: 'Contrôle' }}
          children={() => (
            <ControlModeScreen
              projectId={projectId}
              controlEnabled={controlEnabled}
              onControlModeChanged={(enabled) => {
                setControlEnabled(enabled);
                void refreshHeader();
              }}
            />
          )}
        />
      ) : null}
        </Tab.Navigator>
      </View>
    </View>
  );
}
