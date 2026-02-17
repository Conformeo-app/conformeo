import { DrawerActions, type ParamListBase, type NavigationProp } from '@react-navigation/native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../core/auth';
import { useSyncStatus } from '../data/sync/useSyncStatus';
import { Badge } from '../ui/components/Badge';
import { Text } from '../ui/components/Text';
import { useTheme } from '../ui/theme/ThemeProvider';
import { useAppNavigationContext } from './contextStore';
import { useEnabledModules } from './EnabledModulesProvider';

const MIN_WIDE_LAYOUT_WIDTH = 1024;

function shortId(value: string | null | undefined, max = 18) {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(6, Math.floor(max / 2)))}…${value.slice(-6)}`;
}

function SyncBadge({ phase }: { phase: 'idle' | 'syncing' | 'offline' | 'error' }) {
  const label = useMemo(() => {
    if (phase === 'syncing') return 'Pending';
    if (phase === 'offline') return 'Offline';
    if (phase === 'error') return 'Failed';
    return 'Synced';
  }, [phase]);

  const tone = phase === 'error' ? 'danger' : phase === 'offline' ? 'warning' : phase === 'syncing' ? 'info' : 'success';
  const icon = phase === 'offline' ? 'wifi-off' : phase === 'error' ? 'alert-circle' : 'sync';

  return <Badge tone={tone} label={`Sync ${label}`} icon={icon} />;
}

function navigateToSearch(navigation: NavigationProp<ParamListBase>) {
  const parent = navigation.getParent();
  if (parent) {
    (parent as any).navigate('Security', { screen: 'Search' });
    return;
  }
  (navigation as any).navigate('Search');
}

function navigateToQuickActions(navigation: NavigationProp<ParamListBase>) {
  const parent = navigation.getParent();
  if (parent) {
    (parent as any).navigate('QuickActions');
    return;
  }
  (navigation as any).navigate('QuickActions');
}

export function ShellHeader(props: NativeStackHeaderProps) {
  const { colors, spacing, layout } = useTheme();
  const { width } = useWindowDimensions();
  const { activeOrgId } = useAuth();
  const { status } = useSyncStatus();
  const ctx = useAppNavigationContext();
  const { availableModules } = useEnabledModules();

  const title = props.options.title ?? props.route.name;
  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;
  const canSearch = availableModules.includes('search');
  const canQuickActions = availableModules.includes('accelerators');

  const subtitleParts = useMemo(() => {
    const items: string[] = [];
    if (activeOrgId) items.push(`Org: ${shortId(activeOrgId)}`);
    if (ctx.projectId) items.push(`Chantier: ${shortId(ctx.projectId)}`);
    return items;
  }, [activeOrgId, ctx.projectId]);

  const showMenuButton = !isWide && !props.back;

  return (
    <View
      style={{
        height: layout.topBarHeight,
        justifyContent: 'center',
        borderBottomWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
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
          <Pressable
            onPress={() => props.navigation.getParent()?.dispatch(DrawerActions.toggleDrawer())}
            hitSlop={10}
          >
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
          {subtitleParts.length > 0 ? (
            <Text variant="caption" style={{ color: colors.slate }} numberOfLines={1}>
              {subtitleParts.join(' · ')}
            </Text>
          ) : null}
        </View>

        {canQuickActions ? (
          <Pressable onPress={() => navigateToQuickActions(props.navigation)} hitSlop={10}>
            <Text variant="bodyStrong" style={{ color: colors.primary }}>
              Actions
            </Text>
          </Pressable>
        ) : null}

        {canSearch ? (
          <Pressable onPress={() => navigateToSearch(props.navigation)} hitSlop={10}>
            <Text variant="bodyStrong" style={{ color: colors.primary }}>
              Recherche
            </Text>
          </Pressable>
        ) : null}

        <SyncBadge phase={status.phase} />
      </View>
    </View>
  );
}
