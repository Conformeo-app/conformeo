import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { modules as appModules } from '../../core/modules';
import { offers, OfferPlan, OfferPlanChange, OfferPricing, OrgOfferState } from '../../data/offer-management';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';

function formatEur(value: number) {
  return `${Math.round(value)} €`;
}

export function OfferManagementScreen() {
  const { colors, spacing } = useTheme();
  const { activeOrgId, user } = useAuth();
  const { status: syncStatus } = useSyncStatus();

  const [plans, setPlans] = useState<OfferPlan[]>([]);
  const [state, setState] = useState<OrgOfferState | null>(null);
  const [pricing, setPricing] = useState<OfferPricing | null>(null);
  const [history, setHistory] = useState<OfferPlanChange[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const currentPlan = useMemo(() => {
    if (!state) return null;
    return plans.find((p) => p.key === state.plan_key) ?? null;
  }, [plans, state]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setPlans([]);
      setState(null);
      setPricing(null);
      setHistory([]);
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const nextPlans = offers.listPlans();
      setPlans(nextPlans);
      const [current, price, hist] = await Promise.all([
        offers.getCurrent(activeOrgId),
        offers.computePricing(activeOrgId),
        offers.listHistory(activeOrgId, 20)
      ]);
      setState(current);
      setPricing(price);
      setHistory(hist);
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Chargement offre impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPlan = useCallback(
    async (planKey: string) => {
      if (!activeOrgId) {
        setError('Organisation manquante.');
        return;
      }

      setBusy(true);
      setError(null);
      setInfo(null);

      try {
        const next = await offers.setPlan({
          org_id: activeOrgId,
          plan_key: planKey,
          actor_user_id: user?.id
        });
        setState(next);
        const [price, hist] = await Promise.all([
          offers.computePricing(activeOrgId),
          offers.listHistory(activeOrgId, 20)
        ]);
        setPricing(price);
        setHistory(hist);
        setInfo(`Plan mis à jour: ${planKey}`);
      } catch (planError) {
        const message = planError instanceof Error ? planError.message : 'Changement de plan impossible.';
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, user?.id]
  );

  const applyModules = useCallback(async () => {
    if (!activeOrgId || !state) {
      setError('Organisation/plan manquant.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const results = await offers.applyPlanModulesToFlags(activeOrgId, state.plan_key);
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      setInfo(`Feature flags appliqués: ${ok} ok, ${failed.length} échec(s).`);
      if (failed.length > 0 && __DEV__) {
        console.warn('[offer-management] failed flags', failed);
      }
    } catch (applyError) {
      const message = applyError instanceof Error ? applyError.message : 'Application des modules impossible.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, state]);

  const includedModules = useMemo(() => {
    if (!currentPlan) return [];
    const allowed = new Set(currentPlan.included_modules);
    return appModules.filter((m) => allowed.has(m.key));
  }, [currentPlan]);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <SectionHeader
          title="Offres (SaaS)"
          subtitle="Plans, modules inclus, surcoûts par chantier actif et historique des changements (MVP)."
        />

        <View style={{ gap: spacing.md }}>
          <Card>
            <Text variant="h2">État</Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              queue sync {syncStatus.queueDepth}
            </Text>
            <Text variant="bodyStrong" style={{ marginTop: spacing.sm }}>
              Plan: {state?.plan_key ?? '—'}
            </Text>
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Source: {state?.source ?? '—'} • maj: {state?.updated_at ? new Date(state.updated_at).toLocaleString('fr-FR') : '—'}
            </Text>

            {pricing ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Chantiers actifs (estimation): {pricing.active_projects} • inclus: {pricing.included_active_projects} • extra: {pricing.extra_projects}
                </Text>
                <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                  Base: {formatEur(pricing.base_price_eur_month)} / mois • extra/projet: {formatEur(pricing.extra_project_eur_month)} / mois
                </Text>
                <Text variant="bodyStrong" style={{ marginTop: spacing.xs }}>
                  Estimation total: {formatEur(pricing.estimated_total_eur_month)} / mois
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={busy ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={busy} />
              <Button label={busy ? '...' : 'Appliquer modules du plan'} onPress={() => void applyModules()} disabled={busy || !state} />
            </View>

            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
              Note: calcul “chantiers actifs” basé sur les `tasks.project_id` (MVP). Tarifs = placeholders configurables.
            </Text>
          </Card>

          <Card>
            <Text variant="h2">Plans</Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              {plans.map((plan) => {
                const active = state?.plan_key === plan.key;
                return (
                  <Card key={plan.key} style={{ borderWidth: 1, borderColor: active ? colors.teal : colors.fog }}>
                    <Text variant="bodyStrong">
                      {plan.name} ({plan.key})
                    </Text>
                    <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                      Base {formatEur(plan.base_price_eur_month)} / mois • inclus {plan.included_active_projects} chantier(s) • extra {formatEur(plan.extra_project_eur_month)} / chantier / mois
                    </Text>
                    <View style={{ marginTop: spacing.sm }}>
                      <Button
                        label={active ? 'Actif' : 'Sélectionner'}
                        kind={active ? 'ghost' : 'primary'}
                        onPress={() => void setPlan(plan.key)}
                        disabled={busy || active}
                      />
                    </View>
                  </Card>
                );
              })}
            </View>
          </Card>

          <Card>
            <Text variant="h2">Modules inclus</Text>
            {currentPlan ? (
              <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                {includedModules.map((m) => (
                  <Text key={m.key} variant="caption" style={{ color: colors.slate }}>
                    {m.label} ({m.key})
                  </Text>
                ))}
              </View>
            ) : (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Aucun plan sélectionné.
              </Text>
            )}
          </Card>

          <Card>
            <Text variant="h2">Historique</Text>
            {history.length === 0 ? (
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Aucun changement de plan.
              </Text>
            ) : (
              history.map((row) => (
                <View key={row.id} style={{ marginTop: spacing.sm }}>
                  <Text variant="caption" style={{ color: colors.slate }}>
                    {new Date(row.changed_at).toLocaleString('fr-FR')} • {row.old_plan_key ?? '—'} → {row.new_plan_key}
                  </Text>
                  {row.changed_by ? (
                    <Text variant="caption" style={{ color: colors.slate }}>
                      par {row.changed_by}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </Card>

          {info ? (
            <Card>
              <Text variant="caption" style={{ color: colors.slate }}>
                {info}
              </Text>
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
      </ScrollView>
    </Screen>
  );
}

