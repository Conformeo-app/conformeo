import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ConformeoText,
  Divider,
  EmptyState,
  ErrorState,
  KpiCard,
  OfflineBanner,
  SplitView,
  SyncStatusPill,
  Toggle,
  useTheme
} from '../ui';

type PlaygroundState = {
  offline: boolean;
  pendingOps: number;
  conflicts: number;
  quota: 'OK' | 'WARN' | 'CRIT';
};

export function UiGalleryScreen() {
  const t = useTheme();
  const [state, setState] = useState<PlaygroundState>({
    offline: false,
    pendingOps: 3,
    conflicts: 1,
    quota: 'WARN'
  });

  const quotaTone = useMemo(() => {
    if (state.quota === 'CRIT') return 'danger' as const;
    if (state.quota === 'WARN') return 'warning' as const;
    return 'success' as const;
  }, [state.quota]);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {state.offline ? <OfflineBanner /> : null}

      <SplitView
        left={
          <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
            <ConformeoText variant="h2">Galerie UI</ConformeoText>
            <ConformeoText variant="bodySmall" color="textSecondary">
              Terrain de jeu (hors ligne / en attente / conflits / quota)
            </ConformeoText>

            <Card>
              <ConformeoText variant="h3">Terrain de jeu</ConformeoText>
              <Divider />
              <Toggle
                label="Hors ligne"
                value={state.offline}
                onChange={(v) => setState((s) => ({ ...s, offline: v }))}
              />
              <Toggle
                label={`Ops en attente : ${state.pendingOps}`}
                value={state.pendingOps > 0}
                onChange={(v) => setState((s) => ({ ...s, pendingOps: v ? 5 : 0 }))}
              />
              <Toggle
                label={`Conflits : ${state.conflicts}`}
                value={state.conflicts > 0}
                onChange={(v) => setState((s) => ({ ...s, conflicts: v ? 2 : 0 }))}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
                <Chip
                  label="Quota OK"
                  active={state.quota === 'OK'}
                  onPress={() => setState((s) => ({ ...s, quota: 'OK' }))}
                />
                <Chip
                  label="Quota 80%"
                  active={state.quota === 'WARN'}
                  onPress={() => setState((s) => ({ ...s, quota: 'WARN' }))}
                />
                <Chip
                  label="Quota 95%+"
                  active={state.quota === 'CRIT'}
                  onPress={() => setState((s) => ({ ...s, quota: 'CRIT' }))}
                />
              </View>
            </Card>

            <Card>
              <ConformeoText variant="h3">Badges</ConformeoText>
              <Divider />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <Badge label="OK" tone="success" />
                <Badge label="VIGILANCE" tone="warning" />
                <Badge label="RISQUE" tone="danger" />
                <Badge
                  label={`SYNC ${state.pendingOps > 0 ? 'EN ATTENTE' : 'OK'}`}
                  tone={state.pendingOps > 0 ? 'info' : 'success'}
                />
                <Badge
                  label={`QUOTA ${state.quota === 'CRIT' ? '95%+' : state.quota === 'WARN' ? '80%' : 'OK'}`}
                  tone={quotaTone}
                />
              </View>
            </Card>

            <Card>
              <ConformeoText variant="h3">États</ConformeoText>
              <Divider />
              <SyncStatusPill pending={state.pendingOps} conflicts={state.conflicts} />
              <ErrorState
                title="Erreur actionnable"
                message="Explique la cause + propose une solution."
                ctaLabel="Réessayer"
                onCta={() => {}}
              />
              <EmptyState
                title="Rien ici"
                message="Tu peux commencer en créant une tâche ou une preuve."
                ctas={[{ label: 'Créer tâche', onPress: () => {} }]}
              />
            </Card>
          </ScrollView>
        }
        right={
          <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
            <ConformeoText variant="h2">Surfaces & indicateurs</ConformeoText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
              <KpiCard title="Tâches ouvertes" value="12" tone="info" />
              <KpiCard title="Bloquées" value="2" tone="danger" />
              <KpiCard title="Preuves" value="84" tone="primary" />
              <KpiCard title="Docs" value="17" tone="neutral" />
            </View>

            <Card>
              <ConformeoText variant="h3">Boutons</ConformeoText>
              <Divider />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <Button label="Action principale" variant="primary" onPress={() => {}} />
                <Button label="Secondaire" variant="secondary" onPress={() => {}} />
                <Button label="Danger" variant="danger" onPress={() => {}} />
                <Button label="Transparent" variant="ghost" onPress={() => {}} />
              </View>
            </Card>
          </ScrollView>
        }
      />
    </View>
  );
}
