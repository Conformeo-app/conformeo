import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import {
  QuickAction,
  applyQuickAction,
  conflicts,
  dashboard,
  DashboardActivity,
  DashboardAlert,
  DashboardSummary,
  DashboardWidgetKey,
  DashboardWidgetsConfig,
  useSyncStatus,
  ux
} from '../../data';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

const ORG_SCOPE = '__ORG__';
const DEMO_PROJECT_ID = 'chantier-exports-demo';

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Erreur inconnue';
}

function formatDate(iso?: string) {
  if (!iso) {
    return '-';
  }

  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return iso;
  }

  return value.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function widgetTitle(key: DashboardWidgetKey) {
  if (key === 'open_tasks') return 'Tâches ouvertes';
  if (key === 'blocked_tasks') return 'Tâches bloquées';
  if (key === 'proofs') return 'Preuves';
  if (key === 'documents') return 'Documents';
  if (key === 'exports_recent') return 'Exports 7j';
  if (key === 'alerts') return 'Alertes';
  return 'Activité';
}

function widgetValue(key: DashboardWidgetKey, summary: DashboardSummary | null) {
  if (!summary) {
    return '-';
  }

  if (key === 'open_tasks') return String(summary.openTasks);
  if (key === 'blocked_tasks') return String(summary.blockedTasks);
  if (key === 'proofs') return String(summary.proofs);
  if (key === 'documents') return String(summary.documents);
  if (key === 'exports_recent') return String(summary.recentExports);
  if (key === 'alerts') return String(summary.alerts.length);
  return String(summary.activity.length);
}

function alertColor(level: DashboardAlert['level'], rose: string, amber: string, teal: string) {
  if (level === 'ERROR') return rose;
  if (level === 'WARN') return amber;
  return teal;
}

export function DashboardScreen() {
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, user, role } = useAuth();
  const { status: syncStatus, syncNow } = useSyncStatus();

  const [scopeKey, setScopeKey] = useState<string>(ORG_SCOPE);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [widgetsConfig, setWidgetsConfig] = useState<DashboardWidgetsConfig | null>(null);
  const [selectedWidget, setSelectedWidget] = useState<DashboardWidgetKey>('alerts');
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [openConflictsCount, setOpenConflictsCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const projectId = scopeKey === ORG_SCOPE ? undefined : scopeKey;

  const scope = useMemo(() => {
    if (!activeOrgId) {
      return null;
    }

    return {
      orgId: activeOrgId,
      projectId
    };
  }, [activeOrgId, projectId]);

  const activeWidgets = useMemo(() => {
    const widgets = widgetsConfig?.widgets ?? [];
    return widgets.filter((item) => item.enabled).sort((left, right) => left.order - right.order);
  }, [widgetsConfig]);

  const widgetByKey = useMemo(() => {
    const map = new Map<DashboardWidgetKey, DashboardWidgetsConfig['widgets'][number]>();
    for (const item of widgetsConfig?.widgets ?? []) {
      map.set(item.key, item);
    }
    return map;
  }, [widgetsConfig]);

  const quickActionBlocked = useMemo(
    () => ({
      task: widgetByKey.get('open_tasks')?.lockedByFeatureFlag === true,
      proof: widgetByKey.get('proofs')?.lockedByFeatureFlag === true,
      report: widgetByKey.get('exports_recent')?.lockedByFeatureFlag === true
    }),
    [widgetByKey]
  );

  const refreshProjects = useCallback(async () => {
    if (!activeOrgId) {
      setProjectOptions([]);
      setScopeKey(ORG_SCOPE);
      return;
    }

    const projects = await dashboard.listProjects({ orgId: activeOrgId });

    const merged = projects.includes(DEMO_PROJECT_ID) ? projects : [DEMO_PROJECT_ID, ...projects];
    const deduped = Array.from(new Set(merged)).sort((left, right) => left.localeCompare(right));

    setProjectOptions(deduped);
    setScopeKey((current) => {
      if (current === ORG_SCOPE) {
        return current;
      }

      if (deduped.includes(current)) {
        return current;
      }

      return ORG_SCOPE;
    });
  }, [activeOrgId]);

  const refreshDashboard = useCallback(async () => {
    if (!scope) {
      setSummary(null);
      setWidgetsConfig(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      dashboard.setContext({
        org_id: scope.orgId,
        user_id: user?.id,
        project_id: scope.projectId
      });

      const [nextSummary, nextWidgets, nextOpenConflicts] = await Promise.all([
        dashboard.getSummary(scope),
        dashboard.getWidgetsConfig(scope),
        conflicts.getOpenCount(scope.orgId)
      ]);

      setSummary(nextSummary);
      setWidgetsConfig(nextWidgets);
      setOpenConflictsCount(nextOpenConflicts);

      const selected = nextWidgets.widgets.find((item) => item.key === selectedWidget);
      if (!selected || !selected.enabled) {
        const firstEnabled = nextWidgets.widgets.find((item) => item.enabled);
        if (firstEnabled) {
          setSelectedWidget(firstEnabled.key);
        }
      }
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [scope, selectedWidget, user?.id]);

  const refreshQuickActions = useCallback(async () => {
    const next = await ux.getQuickActions(role ?? 'FIELD');
    setQuickActions(next);
  }, [role]);

  useEffect(() => {
    ux.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined,
      project_id: scope?.projectId
    });

    conflicts.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });
  }, [activeOrgId, scope?.projectId, user?.id]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    void refreshQuickActions();
  }, [refreshQuickActions]);

  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await work();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const toggleWidget = async (key: DashboardWidgetKey) => {
    if (!widgetsConfig || !scope) {
      return;
    }

    const current = widgetsConfig.widgets.find((item) => item.key === key);
    if (!current || current.lockedByFeatureFlag) {
      return;
    }

    await withBusy(async () => {
      const next = await dashboard.setWidgetsConfig(
        {
          widgets: [{ key, enabled: !current.enabled, order: current.order }]
        },
        scope
      );

      setWidgetsConfig(next);
      const selected = next.widgets.find((item) => item.key === selectedWidget);
      if (!selected || !selected.enabled) {
        const firstEnabled = next.widgets.find((item) => item.enabled);
        if (firstEnabled) {
          setSelectedWidget(firstEnabled.key);
        }
      }
    });
  };

  const isQuickActionDisabled = useCallback(
    (action: QuickAction) => {
      const targetProject = projectId ?? projectOptions[0];

      if (busy) {
        return true;
      }

      if (action.requires_project && !targetProject) {
        return true;
      }

      if (action.key === 'NEW_TASK') {
        return quickActionBlocked.task;
      }

      if (action.key === 'ADD_PROOF') {
        return quickActionBlocked.proof;
      }

      if (action.key === 'GENERATE_REPORT') {
        return quickActionBlocked.report;
      }

      return false;
    },
    [busy, projectId, projectOptions, quickActionBlocked]
  );

  const runQuickAction = useCallback(
    async (action: QuickAction) => {
      if (!activeOrgId || !user?.id) {
        return;
      }

      const targetProject = projectId ?? projectOptions[0];
      if (action.requires_project && !targetProject) {
        setError('Sélectionne un chantier avant de lancer cette action.');
        return;
      }

      await withBusy(async () => {
        const result = await applyQuickAction(action.key, {
          projectId: targetProject
        });

        setInfo(result.message);
        await refreshDashboard();
      });
    },
    [activeOrgId, projectId, projectOptions, refreshDashboard, user?.id]
  );

  const drilldownBody = useMemo(() => {
    if (!summary) {
      return null;
    }

    if (selectedWidget === 'open_tasks') {
      return (
        <View style={{ gap: spacing.xs }}>
          {summary.openTaskPreviews.slice(0, 8).map((task) => (
            <View key={task.id}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {task.title}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                {task.status} • {task.priority} • {formatDate(task.updated_at)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    if (selectedWidget === 'blocked_tasks') {
      return (
        <View style={{ gap: spacing.xs }}>
          {summary.blockedTaskPreviews.slice(0, 8).map((task) => (
            <View key={task.id}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {task.title}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                {task.status} • {formatDate(task.updated_at)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    if (selectedWidget === 'proofs') {
      return (
        <View style={{ gap: spacing.sm }}>
          {summary.latestProofs.slice(0, 8).map((proof) => (
            <Card key={proof.id}>
              {proof.local_thumb_path ? (
                <Image
                  source={{ uri: proof.local_thumb_path }}
                  style={{ width: '100%', height: 110, borderRadius: radii.md, marginBottom: spacing.xs }}
                  resizeMode="cover"
                />
              ) : null}
              <Text variant="bodyStrong" numberOfLines={1}>
                {proof.tag ?? proof.mime}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                {proof.upload_status} • {formatDate(proof.created_at)}
              </Text>
            </Card>
          ))}
        </View>
      );
    }

    if (selectedWidget === 'documents') {
      return (
        <View style={{ gap: spacing.xs }}>
          {summary.latestDocuments.slice(0, 8).map((document) => (
            <View key={document.id}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {document.title}
              </Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                {document.doc_type} • {document.status} • {formatDate(document.updated_at)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    if (selectedWidget === 'exports_recent') {
      return (
        <View style={{ gap: spacing.xs }}>
          {summary.latestExports.slice(0, 8).map((exportRow) => (
            <View key={exportRow.id}>
              <Text variant="bodyStrong">{exportRow.type}</Text>
              <Text variant="caption" style={{ color: colors.slate }}>
                {exportRow.status} • {formatDate(exportRow.finished_at ?? exportRow.created_at)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    if (selectedWidget === 'alerts') {
      return (
        <View style={{ gap: spacing.xs }}>
          {summary.alerts.length === 0 ? (
            <Text variant="caption" style={{ color: colors.slate }}>
              Aucune alerte active.
            </Text>
          ) : (
            summary.alerts.map((alert) => (
              <Text
                key={alert.code}
                variant="caption"
                style={{ color: alertColor(alert.level, colors.rose, colors.amber, colors.tealDark) }}
              >
                {alert.message}
              </Text>
            ))
          )}
        </View>
      );
    }

    return (
      <View style={{ gap: spacing.xs }}>
        {summary.activity.slice(0, 12).map((item: DashboardActivity) => (
          <View key={item.id}>
            <Text variant="caption" style={{ color: colors.slate }}>
              {item.entity} • {formatDate(item.at)}
            </Text>
            <Text variant="bodyStrong">{item.title}</Text>
            {item.subtitle ? (
              <Text variant="caption" style={{ color: colors.slate }}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  }, [colors.amber, colors.rose, colors.slate, colors.tealDark, radii.md, selectedWidget, spacing.sm, spacing.xs, summary]);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader
          title="Dashboard"
          subtitle="Synthèse chantier/entreprise locale: activité, alertes, widgets rapides et actions terrain."
        />

        <Card>
          <Text variant="h2">Scope</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.sm, paddingRight: spacing.sm }}
          >
            <Pressable
              onPress={() => setScopeKey(ORG_SCOPE)}
              style={{
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: scopeKey === ORG_SCOPE ? colors.teal : colors.fog,
                backgroundColor: scopeKey === ORG_SCOPE ? colors.mint : colors.white,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs
              }}
            >
              <Text variant="caption">Entreprise</Text>
            </Pressable>

            {projectOptions.map((option) => {
              const active = option === scopeKey;
              return (
                <Pressable
                  key={option}
                  onPress={() => setScopeKey(option)}
                  style={{
                    borderRadius: radii.pill,
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? colors.mint : colors.white,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs
                  }}
                >
                  <Text variant="caption">{option}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Sync: {syncStatus.phase} • Queue: {syncStatus.queueDepth} • Dead letters: {syncStatus.deadLetterCount}
          </Text>

          <Text
            variant="caption"
            style={{ color: openConflictsCount > 0 ? colors.rose : colors.slate, marginTop: spacing.xs }}
          >
            Conflits ouverts: {openConflictsCount}
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Rafraîchir" kind="ghost" onPress={() => void refreshDashboard()} disabled={loading || busy} />
            <Button label="Sync maintenant" kind="ghost" onPress={() => void syncNow()} disabled={busy} />
          </View>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text variant="h2">Quick Actions</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {quickActions.map((action) => (
              <Button
                key={action.key}
                label={action.label}
                kind={action.key === 'NEW_TASK' ? 'primary' : 'ghost'}
                onPress={() => void runQuickAction(action)}
                disabled={isQuickActionDisabled(action)}
              />
            ))}
            {quickActions.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate }}>
                Aucune action rapide disponible.
              </Text>
            ) : null}
          </View>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="h2">Widgets</Text>
            {loading ? <ActivityIndicator size="small" color={colors.teal} /> : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {activeWidgets.map((widget) => {
              const active = selectedWidget === widget.key;
              return (
                <Pressable
                  key={widget.key}
                  onPress={() => setSelectedWidget(widget.key)}
                  style={{
                    borderWidth: 1,
                    borderColor: active ? colors.teal : colors.fog,
                    backgroundColor: active ? colors.mint : colors.white,
                    borderRadius: radii.md,
                    padding: spacing.md,
                    minWidth: 138,
                    flex: 1
                  }}
                >
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {widgetTitle(widget.key)}
                  </Text>
                  <Text variant="h2" style={{ marginTop: spacing.xs }}>
                    {widgetValue(widget.key, summary)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Tap widget → drill-down local sans appel réseau.
          </Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text variant="h2">Configurer Widgets</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {(widgetsConfig?.widgets ?? []).map((item) => {
              const blocked = item.lockedByFeatureFlag;
              return (
                <Button
                  key={item.key}
                  label={`${item.enabled ? '✓' : '○'} ${widgetTitle(item.key)}`}
                  kind={item.enabled ? 'primary' : 'ghost'}
                  onPress={() => void toggleWidget(item.key)}
                  disabled={busy || blocked}
                />
              );
            })}
          </View>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
            Les widgets verrouillés sont désactivés par feature flag d’organisation.
          </Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text variant="h2">Drill-down • {widgetTitle(selectedWidget)}</Text>
          <View style={{ marginTop: spacing.sm }}>{drilldownBody}</View>
        </Card>

        {syncStatus.lastError ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            Dernière erreur sync: {syncStatus.lastError}
          </Text>
        ) : null}

        {error ? (
          <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}

        {info ? (
          <Text variant="caption" style={{ color: colors.tealDark, marginTop: spacing.sm }}>
            {info}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
