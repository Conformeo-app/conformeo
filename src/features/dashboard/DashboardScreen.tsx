import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { applyQuickAction, ux } from '../../data/ux-accelerators';
import { controlMode } from '../../data/control-mode';
import { useEnabledModules } from '../../navigation/EnabledModulesProvider';
import { nav } from '../../navigation/nav';
import { ROUTES } from '../../navigation/routes';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { KpiCard } from '../../ui/components/KpiCard';
import { QuotaBadge } from '../../ui/components/QuotaBadge';
import { RiskBadge } from '../../ui/components/RiskBadge';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { ErrorState } from '../../ui/states/ErrorState';
import { OfflineBanner } from '../../ui/states/OfflineBanner';
import { SyncStatusPill } from '../../ui/states/SyncStatusPill';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { getDashboardCockpit, type DashboardAlert, type DashboardCockpit, type ProjectSummary } from './dashboard.service';
import { useGlobalSyncStatus } from '../../app/hooks/useGlobalSyncStatus';

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue.';
}

function alertTone(level: DashboardAlert['level']) {
  if (level === 'CRIT') return 'danger';
  if (level === 'WARN') return 'warning';
  return 'info';
}

function formatProofsKpi(pending: number, failed: number) {
  if (pending <= 0 && failed <= 0) return '0';
  if (failed > 0) return `${pending} / ${failed}`;
  return String(pending);
}

function resolveProjectTarget(cockpit: DashboardCockpit | null) {
  if (cockpit?.lastProjectId) return cockpit.lastProjectId;
  if (cockpit?.projects?.[0]?.projectId) return cockpit.projects[0].projectId;
  return null;
}

export function DashboardScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user, role } = useAuth();
  const { availableModules } = useEnabledModules();
  const global = useGlobalSyncStatus();

  const [cockpit, setCockpit] = useState<DashboardCockpit | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const hasTasks = availableModules.includes('tasks');
  const hasMedia = availableModules.includes('media');
  const hasConflicts = availableModules.includes('conflicts');
  const hasControl = availableModules.includes('control');
  const hasExports = availableModules.includes('exports');
  // Projects are a core navigation section (not feature-flagged as a module).
  const hasProjects = true;
  const hasOrgsAdmin = availableModules.includes('orgs');

  useEffect(() => {
    ux.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
    controlMode.setContext({ org_id: activeOrgId ?? undefined, user_id: user?.id ?? undefined });
  }, [activeOrgId, user?.id]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setCockpit(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const next = await getDashboardCockpit({ orgId: activeOrgId, userId: user?.id });
      setCockpit(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const targetProjectId = useMemo(() => resolveProjectTarget(cockpit), [cockpit]);

  const runQuickAction = useCallback(
    async (key: Parameters<typeof applyQuickAction>[0]) => {
      if (!activeOrgId || !user?.id) {
        setError('Session invalide.');
        return;
      }

      const projectId = targetProjectId;
      if (!projectId) {
        setError('Aucun chantier sélectionnable (crée un chantier).');
        return;
      }

      setBusy(true);
      setError(null);
      setInfo(null);

      try {
        const result = await applyQuickAction(key, { projectId });
        setInfo(result.message);

        if (key === 'NEW_TASK') {
          nav.openProject(projectId, 'Tasks');
        } else if (key === 'ADD_PROOF') {
          nav.openProject(projectId, 'Media');
        } else if (key === 'GENERATE_CONTROL_PACK') {
          nav.openProject(projectId, 'Control');
        } else if (key === 'GENERATE_REPORT') {
          nav.openProject(projectId, 'Overview');
        } else if (key === 'CREATE_CHECKLIST') {
          nav.openProject(projectId, 'Control');
        }

        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, refresh, targetProjectId, user?.id]
  );

  const toggleControlMode = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide.');
      return;
    }

    const projectId = targetProjectId;
    if (!projectId) {
      setError('Aucun chantier sélectionnable (crée un chantier).');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const enabled = await controlMode.isEnabled(projectId).catch(() => false);
      if (enabled) {
        await controlMode.disable(projectId);
        setInfo('Mode contrôle désactivé.');
      } else {
        await controlMode.enable(projectId);
        setInfo('Mode contrôle activé.');
      }

      nav.openProject(projectId, 'Control');
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, refresh, targetProjectId, user?.id]);

  const goToAlert = useCallback(
    (alert: DashboardAlert) => {
      const screen = alert.ctaRoute.screen;
      const params = alert.ctaRoute.params;

      if (screen === 'ProjectDetail') {
        const projectId = params?.projectId;
        nav.openProject(projectId, params?.tab, { mediaUploadStatus: params?.mediaUploadStatus });
        return;
      }

      if (screen === ROUTES.PROJECTS) {
        nav.goProjects();
        return;
      }

      if (screen === ROUTES.SECURITY) {
        nav.goSecurity(params);
        return;
      }

      if (screen === ROUTES.ENTERPRISE) {
        nav.goEnterprise(params);
        return;
      }

      if (screen === ROUTES.DASHBOARD) {
        nav.goDashboard();
        return;
      }

      // fallback (rare)
      (nav as any).navigate?.(screen, params);
    },
    []
  );

  const stats = cockpit?.stats;

  const kpis = useMemo(() => {
    const items: Array<{
      key: string;
      title: string;
      value: string;
      icon: any;
      tone: any;
      onPress?: () => void;
      visible: boolean;
    }> = [
      {
        key: 'projects',
        title: 'Chantiers actifs',
        value: String(stats?.activeProjects ?? 0),
        icon: 'office-building',
        tone: 'primary',
        onPress: hasProjects ? () => nav.goProjects() : undefined,
        visible: true
      },
      {
        key: 'open_tasks',
        title: 'Tâches ouvertes',
        value: String(stats?.openTasks ?? 0),
        icon: 'checkbox-marked-outline',
        tone: 'info',
        onPress: targetProjectId && hasTasks ? () => nav.openProject(targetProjectId, 'Tasks') : hasProjects ? () => nav.goProjects() : undefined,
        visible: hasTasks
      },
      {
        key: 'blocked_tasks',
        title: 'Bloquées',
        value: String(stats?.blockedTasks ?? 0),
        icon: 'alert',
        tone: 'danger',
        onPress: targetProjectId && hasTasks ? () => nav.openProject(targetProjectId, 'Tasks') : hasProjects ? () => nav.goProjects() : undefined,
        visible: hasTasks
      },
      {
        key: 'proofs',
        title: 'Preuves (att/échec)',
        value: formatProofsKpi(stats?.pendingUploads ?? 0, stats?.failedUploads ?? 0),
        icon: 'camera',
        tone: (stats?.failedUploads ?? 0) > 0 ? 'danger' : (stats?.pendingUploads ?? 0) > 0 ? 'info' : 'neutral',
        onPress:
          targetProjectId && hasMedia
            ? () =>
                nav.openProject(targetProjectId, 'Media', {
                  mediaUploadStatus: (stats?.failedUploads ?? 0) > 0 ? 'FAILED' : (stats?.pendingUploads ?? 0) > 0 ? 'PENDING' : 'ALL'
                })
            : hasProjects
              ? () => nav.goProjects()
              : undefined,
        visible: hasMedia
      }
    ];

    return items.filter((item) => item.visible).slice(0, 4);
  }, [hasMedia, hasProjects, hasTasks, stats?.activeProjects, stats?.blockedTasks, stats?.failedUploads, stats?.openTasks, stats?.pendingUploads, targetProjectId]);

  const alerts = useMemo(() => {
    const list = cockpit?.alerts ?? [];
    return list.filter((a) => {
      if (!hasConflicts && a.key === 'SYNC_CONFLICTS') return false;
      if (!hasOrgsAdmin && a.key === 'STORAGE_QUOTA') return false;
      return true;
    });
  }, [cockpit?.alerts, hasConflicts, hasOrgsAdmin]);

  const projectsRows = useMemo(() => cockpit?.projects ?? [], [cockpit?.projects]);

  const quotaBadge = useMemo(() => {
    return <QuotaBadge level={cockpit?.quotaLevel ?? 'OK'} />;
  }, [cockpit?.quotaLevel]);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Tableau de bord" subtitle="Santé globale, alertes, chantiers prioritaires, actions rapides (offline-first)." />

        {global.isOffline ? <OfflineBanner /> : null}
        <View style={{ marginTop: spacing.sm }}>
          <SyncStatusPill pending={global.pendingOps} conflicts={global.conflicts} failedUploads={global.failedUploads} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
          {quotaBadge}
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          <Button label="Rafraîchir" kind="ghost" onPress={() => void refresh()} disabled={loading || busy} />
        </View>

        {error ? (
          <Card style={{ marginTop: spacing.md }}>
            <ErrorState title="Erreur" message={error} ctaLabel="Réessayer" onCta={() => void refresh()} />
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md }}>
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} title={kpi.title} value={kpi.value} icon={kpi.icon} tone={kpi.tone} onPress={kpi.onPress} style={{ flexGrow: 1, minWidth: 220 }} />
          ))}
        </View>

        <Card style={{ marginTop: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="h2">Alertes</Text>
            <Text variant="caption" style={{ color: colors.mutedText }}>
              Top 3
            </Text>
          </View>

          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {alerts.length === 0 ? (
              <Text variant="caption" style={{ color: colors.mutedText }}>
                Aucune alerte active.
              </Text>
            ) : (
              alerts.map((alert) => (
                <View
                  key={alert.key}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    padding: spacing.md,
                    backgroundColor: colors.surfaceAlt
                  }}
                >
                  <Text variant="bodyStrong" style={{ color: (colors as any)[alertTone(alert.level)] ?? colors.text }}>
                    {alert.title}
                  </Text>
                  <View style={{ marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <Button label={alert.ctaLabel} kind="ghost" onPress={() => goToAlert(alert)} disabled={busy} />
                  </View>
                </View>
              ))
            )}
          </View>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="h2">Mes chantiers</Text>
            <Text variant="caption" style={{ color: colors.mutedText }}>
              8 max • tri risque/recents
            </Text>
          </View>

          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {projectsRows.length === 0 ? (
              <Text variant="caption" style={{ color: colors.mutedText }}>
                Aucun chantier. Crée ton premier chantier.
              </Text>
            ) : (
              projectsRows.map((row) => (
                <ProjectRow
                  key={row.projectId}
                  row={row}
                  onPress={() => nav.openProject(row.projectId, 'Overview')}
                />
              ))
            )}
          </View>

          {hasProjects ? (
            <View style={{ marginTop: spacing.md, flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Button label="Voir tous" kind="ghost" onPress={() => nav.goProjects()} disabled={busy} />
            </View>
          ) : null}
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text variant="h2">Actions rapides</Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
            Ciblées sur le dernier chantier ouvert (ou le plus prioritaire).
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            {hasTasks ? (
              <Button label="Tâche" onPress={() => void runQuickAction('NEW_TASK')} disabled={busy} />
            ) : null}
            {hasMedia ? (
              <Button label="Preuve" kind="ghost" onPress={() => void runQuickAction('ADD_PROOF')} disabled={busy} />
            ) : null}
            {hasProjects ? (
              <Button label="Chantier" kind="ghost" onPress={() => nav.createProject()} disabled={busy} />
            ) : null}
            {hasExports ? (
              <Button label="Pack contrôle" kind="ghost" onPress={() => void runQuickAction('GENERATE_CONTROL_PACK')} disabled={busy} />
            ) : null}
            {hasControl ? (
              <Button label="Mode contrôle" kind="ghost" onPress={() => void toggleControlMode()} disabled={busy} />
            ) : null}
          </View>
        </Card>

        {info ? (
          <Text variant="caption" style={{ color: colors.success, marginTop: spacing.md }}>
            {info}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ProjectRow({
  row,
  onPress
}: {
  row: ProjectSummary;
  onPress: () => void;
}) {
  const { colors, spacing, radii } = useTheme();

  const subtitle = `${row.openTasks} ouvertes • ${row.blockedTasks} bloquées • ${row.pendingUploads} uploads en attente`;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.md,
          padding: spacing.md,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.9 : 1
        }
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {row.name}
          </Text>
          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <RiskBadge level={row.risk} />
      </View>
    </Pressable>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(DashboardScreen as any).screenKey = 'DASHBOARD';
