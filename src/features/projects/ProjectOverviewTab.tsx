import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { overview, type ActivityEvent, type OverviewAlert, type OverviewHealth, type OverviewKpis } from '../../data/projects';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function formatDate(iso?: string) {
  if (!iso) return '-';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function levelColor(level: OverviewAlert['level'], palette: { rose: string; amber: string; slate: string }) {
  if (level === 'CRIT') return palette.rose;
  if (level === 'WARN') return palette.amber;
  return palette.slate;
}

function activityTabForEntity(entity: ActivityEvent['entity']): OverviewAlert['ctaRoute']['tab'] {
  if (entity === 'TASK') return 'Tasks';
  if (entity === 'MEDIA') return 'Media';
  if (entity === 'DOCUMENT') return 'Documents';
  if (entity === 'PIN') return 'Plans';
  return 'Control';
}

export function ProjectOverviewTab({
  projectId,
  onOpenTab,
  onOpenProjectScreen,
  tools
}: {
  projectId: string;
  onOpenTab?: (tab: OverviewAlert['ctaRoute']['tab'], params?: any) => void;
  onOpenProjectScreen?: (screen: 'WasteVolume' | 'Carbon' | 'Exports') => void;
  tools?: { waste?: boolean; carbon?: boolean; exports?: boolean };
}) {
  const { colors, spacing } = useTheme();

  const [kpis, setKpis] = useState<OverviewKpis | null>(null);
  const [health, setHealth] = useState<OverviewHealth | null>(null);
  const [alerts, setAlerts] = useState<OverviewAlert[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextKpis, nextHealth, nextAlerts, nextActivity] = await Promise.all([
        overview.getKpis(projectId),
        overview.getHealth(projectId),
        overview.getAlerts(projectId),
        overview.getActivity(projectId, 10)
      ]);

      setKpis(nextKpis);
      setHealth(nextHealth);
      setAlerts(nextAlerts);
      setActivity(nextActivity);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Impossible de charger la synthèse chantier.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cards = useMemo(() => {
    const openTasks = kpis?.openTasks ?? 0;
    const blockedTasks = kpis?.blockedTasks ?? 0;
    const mediaTotal = kpis?.mediaTotal ?? 0;
    const mediaPending = kpis?.mediaPending ?? 0;
    const docsTotal = kpis?.docsTotal ?? 0;
    const plansCount = kpis?.plansCount ?? 0;

    return [
      {
        key: 'open_tasks',
        label: 'Tâches ouvertes',
        value: String(kpis ? openTasks : '-'),
        hint: undefined,
        tab: 'Tasks' as const,
        params: undefined
      },
      {
        key: 'blocked_tasks',
        label: 'Tâches bloquées',
        value: String(kpis ? blockedTasks : '-'),
        hint: undefined,
        tab: 'Tasks' as const,
        params: undefined
      },
      {
        key: 'proofs',
        label: 'Preuves',
        value: String(kpis ? mediaTotal : '-'),
        hint: kpis ? `${mediaPending} en attente` : undefined,
        tab: 'Media' as const,
        params: { uploadStatus: 'PENDING' }
      },
      {
        key: 'documents',
        label: 'Documents',
        value: String(kpis ? docsTotal : '-'),
        hint: kpis ? `${plansCount} plan(s)` : undefined,
        tab: 'Documents' as const,
        params: undefined
      }
    ];
  }, [kpis]);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Aperçu" subtitle="KPIs, alertes et activité — 100% hors ligne d'abord." />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">État</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label={loading ? 'Chargement…' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
              {health ? (
                <>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Hors ligne: {health.offline ? 'oui' : 'non'}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Synchronisation en attente: {health.pendingOps}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Erreurs: {health.conflictCount + health.failedUploads}
                  </Text>
                </>
              ) : null}
            </View>
            {error ? (
              <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {cards.map((card) => (
              <Pressable
                key={card.key}
                style={{ flexBasis: '48%', flexGrow: 1 }}
                onPress={() => onOpenTab?.(card.tab, card.params)}
                disabled={!onOpenTab}
              >
                <Card>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {card.label}
                  </Text>
                  <Text variant="h1" style={{ marginTop: spacing.xs }}>
                    {card.value}
                  </Text>
                  {card.hint ? (
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      {card.hint}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            ))}
          </View>

          <Card>
            <Text variant="h2">Alertes</Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              {alerts.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune alerte.
                </Text>
              ) : (
                alerts.slice(0, 3).map((alert) => (
                  <View key={alert.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: levelColor(alert.level, colors) }} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={2}>
                        {alert.title}
                      </Text>
                    </View>
                    <Button
                      label={alert.ctaLabel}
                      kind="ghost"
                      onPress={() => onOpenTab?.(alert.ctaRoute.tab, alert.ctaRoute.params)}
                      disabled={!onOpenTab}
                    />
                  </View>
                ))
              )}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Activité récente</Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {activity.length === 0 ? (
                <Text variant="caption" style={{ color: colors.slate }}>
                  Aucune activité locale récente.
                </Text>
              ) : (
                activity.slice(0, 10).map((event) => (
                  <Pressable
                    key={event.id}
                    onPress={() => onOpenTab?.(activityTabForEntity(event.entity))}
                    disabled={!onOpenTab}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {event.label}
                        </Text>
                        <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
                          {event.type}
                        </Text>
                      </View>
                      <Text variant="caption" style={{ color: colors.slate }}>
                        {formatDate(event.created_at)}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          </Card>

          {onOpenProjectScreen && (tools?.waste || tools?.carbon || tools?.exports) ? (
            <Card>
              <Text variant="h2">Outils</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                {tools?.waste ? (
                  <Button label="Déchets" kind="ghost" onPress={() => onOpenProjectScreen('WasteVolume')} disabled={loading} />
                ) : null}
                {tools?.carbon ? (
                  <Button label="Carbone" kind="ghost" onPress={() => onOpenProjectScreen('Carbon')} disabled={loading} />
                ) : null}
                {tools?.exports ? (
                  <Button label="Exports" kind="ghost" onPress={() => onOpenProjectScreen('Exports')} disabled={loading} />
                ) : null}
              </View>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
