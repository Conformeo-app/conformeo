import { DrawerActions, type ParamListBase, type NavigationProp } from '@react-navigation/native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../core/auth';
import { org } from '../data/orgs-admin';
import { useSyncStatus } from '../data/sync/useSyncStatus';
import { Avatar } from '../ui/components/Avatar';
import { Badge } from '../ui/components/Badge';
import { Text } from '../ui/components/Text';
import { useTheme } from '../ui/theme/ThemeProvider';
import { OfflineBanner } from '../ui/states/OfflineBanner';
import { SyncStatusPill } from '../ui/states/SyncStatusPill';
import { useAppNavigationContext } from '../navigation/contextStore';
import { useEnabledModules } from '../navigation/EnabledModulesProvider';
import { useGlobalSyncStatus } from './hooks/useGlobalSyncStatus';
import { ROUTES } from '../navigation/routes';

const MIN_WIDE_LAYOUT_WIDTH = 1024;

function shortId(value: string | null | undefined, max = 18) {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(6, Math.floor(max / 2)))}…${value.slice(-6)}`;
}

function navigateToAccount(navigation: NavigationProp<ParamListBase>) {
  const parent = navigation.getParent();
  if (parent) {
    (parent as any).navigate(ROUTES.ACCOUNT);
    return;
  }
  (navigation as any).navigate(ROUTES.ACCOUNT);
}

function navigateToConflicts(navigation: NavigationProp<ParamListBase>) {
  const parent = navigation.getParent();
  if (parent) {
    (parent as any).navigate(ROUTES.SECURITY, { screen: 'Conflicts' });
    return;
  }
  (navigation as any).navigate('Conflicts');
}

export function TopBar(props: NativeStackHeaderProps) {
  const { colors, spacing, layout } = useTheme();
  const { width } = useWindowDimensions();
  const { user, activeOrgId } = useAuth();
  const ctx = useAppNavigationContext();
  const { availableModules } = useEnabledModules();
  const { status: syncStatus } = useSyncStatus();
  const global = useGlobalSyncStatus();

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;
  const showMenuButton = !isWide && !props.back;

  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!activeOrgId) {
        setOrgName(null);
        return;
      }

      try {
        const record = await org.getCurrent(activeOrgId);
        if (!cancelled) {
          setOrgName(record.name ?? null);
        }
      } catch {
        if (!cancelled) {
          setOrgName(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  const title = props.options.title ?? props.route.name;
  const orgLabel = orgName ?? shortId(activeOrgId, 22) ?? '—';

  const subtitleParts = useMemo(() => {
    const items: string[] = [];
    items.push(`Conforméo · ${orgLabel}`);
    if (ctx.projectId) items.push(`Chantier: ${shortId(ctx.projectId, 18)}`);
    return items;
  }, [ctx.projectId, orgLabel]);

  const syncTone =
    syncStatus.phase === 'error' ? 'danger' : syncStatus.phase === 'offline' ? 'warning' : global.pendingOps > 0 ? 'info' : 'success';
  const syncIcon = syncStatus.phase === 'offline' ? 'wifi-off' : syncStatus.phase === 'error' ? 'alert-circle' : 'sync';
  const syncLabel =
    syncStatus.phase === 'error'
      ? 'Synchronisation : échec'
      : syncStatus.phase === 'offline'
        ? 'Synchronisation : hors ligne'
        : global.pendingOps > 0
          ? `Synchronisation en attente · ${global.pendingOps}`
          : 'Synchronisation OK';

  const showConflicts = availableModules.includes('conflicts') && global.conflicts > 0;

  return (
    <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
      <View
        style={{
          height: layout.topBarHeight,
          justifyContent: 'center',
          paddingHorizontal: spacing.lg
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {props.back ? (
            <Pressable onPress={props.navigation.goBack} hitSlop={10}>
              <Text variant="bodyStrong" style={{ color: colors.primary }}>
                {'<'} Retour
              </Text>
            </Pressable>
          ) : showMenuButton ? (
            <Pressable onPress={() => props.navigation.getParent()?.dispatch(DrawerActions.toggleDrawer())} hitSlop={10}>
              <Text variant="bodyStrong" style={{ color: colors.primary }}>
                Menu
              </Text>
            </Pressable>
          ) : (
            <View style={{ width: 48 }} />
          )}

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" style={{ color: colors.textSecondary }} numberOfLines={1}>
              {subtitleParts.join(' · ')}
            </Text>
          </View>

          <Badge tone={syncTone as any} label={syncLabel} icon={syncIcon as any} />

          {showConflicts ? (
            <Pressable onPress={() => navigateToConflicts(props.navigation)} hitSlop={10}>
              <Badge tone="danger" label={`Conflits ${global.conflicts}`} icon="alert-circle" />
            </Pressable>
          ) : null}

          <Pressable onPress={() => navigateToAccount(props.navigation)} hitSlop={10}>
            <Avatar label={user?.email ?? '—'} />
          </Pressable>
        </View>
      </View>

      {global.isOffline ? <OfflineBanner /> : null}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <SyncStatusPill pending={global.pendingOps} conflicts={global.conflicts} failedUploads={global.failedUploads} />
      </View>
    </View>
  );
}
