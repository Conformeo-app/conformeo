import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../core/auth';
import { flags } from '../data/feature-flags';
import { useSyncStatus } from '../data/sync/useSyncStatus';
import { useEnabledModules } from './EnabledModulesProvider';
import { Badge } from '../ui/components/Badge';
import { Text } from '../ui/components/Text';
import { useTheme } from '../ui/theme/ThemeProvider';
import { ROUTES } from './routes';

const LABELS: Record<string, { label: string; hint: string }> = {
  [ROUTES.DASHBOARD]: { label: 'Tableau de bord', hint: 'Synthèse chantier / entreprise' },
  [ROUTES.PROJECTS]: { label: 'Chantiers', hint: 'Liste + détail + onglets' },
  [ROUTES.EQUIPMENT]: { label: 'Équipements', hint: 'Matériel, mouvements, liaisons' },
  [ROUTES.PLANNING]: { label: 'Planning', hint: 'Calendrier + affectations' },
  [ROUTES.TEAM]: { label: 'Équipe', hint: 'Membres & équipes' },
  [ROUTES.SECURITY]: { label: 'Sécurité', hint: 'MFA, sessions, audit, synchronisation' },
  [ROUTES.ENTERPRISE]: { label: 'Entreprise', hint: 'Paramètres, modules, offres' },
  [ROUTES.ACCOUNT]: { label: 'Compte', hint: 'Profil & déconnexion' }
};

function phaseLabel(phase: 'idle' | 'syncing' | 'offline' | 'error') {
  if (phase === 'syncing') return 'En cours';
  if (phase === 'offline') return 'Hors ligne';
  if (phase === 'error') return 'Échec';
  return 'OK';
}

export function ShellDrawerContent(props: DrawerContentComponentProps) {
  const { colors, spacing, radii } = useTheme();
  const { user, activeOrgId, role } = useAuth();
  const { availableModules } = useEnabledModules();
  const { status } = useSyncStatus();

  const activeRouteName = props.state.routes[props.state.index]?.name;

  const galleryEnabled =
    __DEV__ || (role === 'ADMIN' && flags.isEnabled('ui_gallery', { orgId: activeOrgId ?? undefined, fallback: false }));

  const routeVisible = useMemo(() => {
    const hasSecurity =
      galleryEnabled ||
      availableModules.includes('security') ||
      availableModules.includes('search') ||
      availableModules.includes('offline') ||
      availableModules.includes('audit') ||
      availableModules.includes('conflicts') ||
      availableModules.includes('superadmin');

    const hasEnterprise =
      availableModules.includes('orgs') ||
      availableModules.includes('company') ||
      availableModules.includes('offers') ||
      availableModules.includes('governance') ||
      availableModules.includes('backup');

    const enabled = new Map<string, boolean>([
      [ROUTES.DASHBOARD, true],
      [ROUTES.PROJECTS, true], // section "core"
      [ROUTES.EQUIPMENT, availableModules.includes('equipment')],
      [ROUTES.PLANNING, availableModules.includes('planning')],
      [ROUTES.TEAM, availableModules.includes('orgs')],
      [ROUTES.SECURITY, hasSecurity],
      [ROUTES.ENTERPRISE, hasEnterprise],
      [ROUTES.ACCOUNT, true]
    ]);

    return (name: string) => enabled.get(name) === true;
  }, [availableModules, galleryEnabled]);

  const routes = useMemo(
    () =>
      props.state.routes
        .map((route) => route.name)
        .filter((name) => LABELS[name])
        .filter((name) => routeVisible(name))
        .filter((name) => name !== ROUTES.ACCOUNT),
    [props.state.routes, routeVisible]
  );

  if (__DEV__) {
    for (const routeName of routes) {
      if (!LABELS[routeName]) {
        // eslint-disable-next-line no-console
        console.warn(`[drawer] Route sans label: ${routeName}`);
      }
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderRightWidth: 1, borderColor: colors.border }}>
      <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text variant="h1">Conformeo</Text>
        <Text variant="caption" style={{ color: colors.textSecondary, marginTop: spacing.xs }} numberOfLines={1}>
          {user?.email ?? '—'} · {role ?? '—'}
        </Text>
        <Text variant="caption" style={{ color: colors.textSecondary, marginTop: spacing.xs }} numberOfLines={1}>
          Org: {activeOrgId ?? '—'}
        </Text>

        <View style={{ marginTop: spacing.md }}>
          <Badge
            tone={status.phase === 'error' ? 'danger' : status.phase === 'offline' ? 'warning' : status.phase === 'syncing' ? 'info' : 'success'}
            icon={status.phase === 'offline' ? 'wifi-off' : status.phase === 'error' ? 'alert-circle' : 'sync'}
            label={`Synchronisation ${phaseLabel(status.phase)} · file ${status.queueDepth}`}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {routes.map((name) => {
          const meta = LABELS[name] ?? { label: name, hint: '' };
          const isActive = name === activeRouteName;

          return (
            <Pressable
              key={name}
              onPress={() => {
                props.navigation.navigate(name as never);
                props.navigation.closeDrawer();
              }}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radii.md,
                backgroundColor: isActive ? colors.primarySoft : 'transparent'
              }}
            >
              <Text variant="bodyStrong" style={{ color: isActive ? colors.text : colors.textSecondary }}>
                {meta.label}
              </Text>
              <Text variant="caption" style={{ color: colors.textSecondary, opacity: 0.85 }}>
                {meta.hint}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border }}>
        <Pressable
          onPress={() => {
            props.navigation.navigate(ROUTES.ACCOUNT as never);
            props.navigation.closeDrawer();
          }}
          style={{
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: radii.md,
            backgroundColor: activeRouteName === ROUTES.ACCOUNT ? colors.primarySoft : 'transparent'
          }}
        >
          <Text
            variant="bodyStrong"
            style={{ color: activeRouteName === ROUTES.ACCOUNT ? colors.text : colors.textSecondary }}
          >
            {LABELS[ROUTES.ACCOUNT].label}
          </Text>
          <Text variant="caption" style={{ color: colors.textSecondary, opacity: 0.85 }}>
            {LABELS[ROUTES.ACCOUNT].hint}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
