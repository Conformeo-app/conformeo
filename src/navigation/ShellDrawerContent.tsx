import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../core/auth';
import { flags } from '../data/feature-flags';
import { useSyncStatus } from '../data/sync/useSyncStatus';
import { useEnabledModules } from './EnabledModulesProvider';
import { Badge } from '../ui/components/Badge';
import { Icon } from '../ui/components/Icon';
import { Text } from '../ui/components/Text';
import { useTheme } from '../ui/theme/ThemeProvider';
import { setCurrentContext } from './contextStore';
import { DRAWER_ENTRIES } from './registry';
import { ROUTES } from './routes';

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderRightWidth: 1, borderColor: colors.border }}>
      <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text variant="h1">Conforméo</Text>
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
        {DRAWER_ENTRIES.map((entry) => {
          const isActive = entry.route === activeRouteName;
          const enabled = entry.isEnabled(availableModules, { galleryEnabled });

          return (
            <Pressable
              key={entry.route}
              onPress={() => {
                if (entry.route === ROUTES.PROJECTS) {
                  setCurrentContext({ projectId: undefined });
                  (props.navigation as any).navigate(ROUTES.PROJECTS, { screen: 'ProjectsList' });
                } else {
                  props.navigation.navigate(entry.route as never);
                }
                props.navigation.closeDrawer();
              }}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radii.md,
                backgroundColor: isActive ? colors.primarySoft : 'transparent'
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Icon name={entry.icon} muted={!enabled && !isActive} />

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" style={{ color: isActive ? colors.text : colors.textSecondary }} numberOfLines={1}>
                    {entry.label}
                  </Text>
                  <Text variant="caption" style={{ color: colors.textSecondary, opacity: 0.85 }} numberOfLines={2}>
                    {entry.hint}
                  </Text>
                  {!enabled ? (
                    <View style={{ marginTop: spacing.xs }}>
                      <Badge tone="warning" label="Désactivé" icon="lock-outline" />
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
