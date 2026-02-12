import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from './core/auth';
import { ModuleKey, modules as coreModules } from './core/modules';
import { flags } from './data/feature-flags';
import { useSyncStatus } from './data/sync/useSyncStatus';
import { AdminMfaEnrollmentScreen } from './features/auth/AdminMfaEnrollmentScreen';
import { AuthAccessScreen } from './features/auth/AuthAccessScreen';
import { ControlModeScreen } from './features/control/ControlModeScreen';
import { ConflictsScreen } from './features/conflicts/ConflictsScreen';
import { DashboardScreen } from './features/dashboard/DashboardScreen';
import { DocumentsScreen } from './features/documents/DocumentsScreen';
import { ExportsScreen } from './features/exports/ExportsScreen';
import { MediaScreen } from './features/media/MediaScreen';
import { OfflineScreen } from './features/offline/OfflineScreen';
import { OrgsAdminScreen } from './features/orgs/OrgsAdminScreen';
import { PlansScreen } from './features/plans/PlansScreen';
import { SearchScreen } from './features/search/SearchScreen';
import { SecurityScreen } from './features/security/SecurityScreen';
import { UxAcceleratorsScreen } from './features/ux/UxAcceleratorsScreen';
import { TasksScreen } from './features/tasks/TasksScreen';
import { Sidebar } from './ui/components/Sidebar';
import { Text } from './ui/components/Text';
import { SplitLayout } from './ui/layout/SplitLayout';
import { ThemeProvider, useTheme } from './ui/theme/ThemeProvider';

const MIN_WIDE_LAYOUT_WIDTH = 1024;
const ALL_MODULE_KEYS = coreModules.map((item) => item.key);

const moduleToScreen: Record<ModuleKey, React.ComponentType> = {
  dashboard: DashboardScreen,
  accelerators: UxAcceleratorsScreen,
  orgs: OrgsAdminScreen,
  tasks: TasksScreen,
  documents: DocumentsScreen,
  exports: ExportsScreen,
  control: ControlModeScreen,
  search: SearchScreen,
  offline: OfflineScreen,
  conflicts: ConflictsScreen,
  media: MediaScreen,
  plans: PlansScreen,
  security: SecurityScreen
};

function computeEnabledModules(rows: Array<{ key: string; enabled: boolean }>): ModuleKey[] {
  const rowMap = new Map<string, boolean>(rows.map((item) => [item.key, item.enabled]));

  const enabled = coreModules
    .filter((module) => {
      if (!rowMap.has(module.key)) {
        return true;
      }
      return rowMap.get(module.key) === true;
    })
    .map((module) => module.key);

  if (enabled.length === 0) {
    return ['dashboard'];
  }

  return enabled;
}

function LoadingView() {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.teal} />
      <Text variant="caption" style={{ marginTop: spacing.sm, color: colors.slate }}>
        Initialisation...
      </Text>
    </View>
  );
}

function MainShell() {
  const { width } = useWindowDimensions();
  const { status } = useSyncStatus();
  const { activeOrgId, user } = useAuth();

  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [availableModules, setAvailableModules] = useState<ModuleKey[]>(ALL_MODULE_KEYS);

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  useEffect(() => {
    flags.setContext({
      org_id: activeOrgId ?? undefined,
      user_id: user?.id ?? undefined
    });

    let cancelled = false;

    const applyRows = (rows: Array<{ key: string; enabled: boolean }>) => {
      if (cancelled) {
        return;
      }
      setAvailableModules(computeEnabledModules(rows));
    };

    const run = async () => {
      if (!activeOrgId) {
        setAvailableModules(ALL_MODULE_KEYS);
        return;
      }

      try {
        const cached = await flags.listAll(activeOrgId);
        applyRows(cached);
      } catch {
        setAvailableModules(ALL_MODULE_KEYS);
      }

      try {
        const refreshed = await flags.refresh(activeOrgId);
        applyRows(refreshed);
      } catch {
        // Keep cached/default state when refresh fails.
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, user?.id]);

  useEffect(() => {
    if (availableModules.includes(activeModule)) {
      return;
    }

    setActiveModule(availableModules[0] ?? 'dashboard');
  }, [activeModule, availableModules]);

  const ActiveScreen = useMemo(() => moduleToScreen[activeModule], [activeModule]);

  return (
    <SplitLayout
      isWide={isWide}
      sidebar={
        <Sidebar
          active={activeModule}
          onSelect={setActiveModule}
          compact={!isWide}
          syncStatus={status}
          availableModules={availableModules}
        />
      }
      content={<ActiveScreen />}
    />
  );
}

export function AppRoot() {
  const { loading, session, hasMembership, requiresMfaEnrollment } = useAuth();

  return (
    <ThemeProvider>
      <SafeAreaView style={{ flex: 1 }}>
        {loading ? (
          <LoadingView />
        ) : !session || hasMembership === false ? (
          <AuthAccessScreen />
        ) : requiresMfaEnrollment ? (
          <AdminMfaEnrollmentScreen />
        ) : (
          <MainShell />
        )}
      </SafeAreaView>
    </ThemeProvider>
  );
}
